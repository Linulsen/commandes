import type { SupabaseClient } from "@supabase/supabase-js";
import { sb, selectAll } from "./db";

/**
 * Inventaire : comptage du stock de tout le restaurant, lieu par lieu.
 *
 * Plusieurs personnes comptent en même temps, chacune dans un lieu. Un
 * comptage est donc rangé par produit ET par lieu : deux téléphones dans deux
 * lieux différents n'écrivent jamais la même ligne. Le total d'un produit est
 * la somme de ses comptages dans tous les lieux.
 *
 * total (en unité de comptage) = colis × fact + unités + détail ÷ contenance
 */

// Les tables d'inventaire ne sont pas décrites dans `schema.ts` : client non typé.
const db = () => sb() as unknown as SupabaseClient;

export type Inventaire = {
  id: number;
  date_inventaire: string;
  heure_inventaire: string | null;
  libelle: string | null;
  statut: "en_cours" | "cloture";
  cree_le: string;
  cree_par: string | null;
  cloture_le: string | null;
  cloture_par: string | null;
};

export type Lieu = { id: number; nom: string; ordre: number; secondaire: boolean };

export type LigneInventaire = {
  produitId: number;
  zoneId: number;
  nom: string;
  /** Place dans l'ordre de rangement ; null : pas encore placé. */
  rang: number | null;
  conditionnement: string | null;
  unite: string | null;
  fact: number;
  contenance: number | null;
  uniteContenance: "kg" | "L" | null;
  saisieDetail: boolean;
  /** Lieu principal du produit (sinon : emplacement secondaire). */
  principal: boolean;
  /** Produit retiré de la carte ou hors commande, encore en stock. */
  inactif: boolean;
  colis: number | null;
  unites: number | null;
  detail: number | null;
  total: number | null;
  prenom: string | null;
  majLe: number;
};

export type ProduitCatalogue = {
  produitId: number;
  nom: string;
  rang: number | null;
  conditionnement: string | null;
  unite: string | null;
  fact: number;
  contenance: number | null;
  uniteContenance: "kg" | "L" | null;
  saisieDetail: boolean;
  inactif: boolean;
  lieuPrincipal: number;
};

export type SaisieServeur = {
  produit_id: number;
  zone_id: number;
  colis: number | null;
  unites: number | null;
  detail: number | null;
  total: number;
  prenom: string | null;
  saisi_le: string;
};

type ProduitInv = {
  id: number;
  zone_id: number;
  lieu_id: number | null;
  nom: string;
  conditionnement: string | null;
  unite: string | null;
  fact: number;
  actif: boolean;
  contenance: number | null;
  unite_contenance: "kg" | "L" | null;
  saisie_detail: boolean;
  rang: number | null;
};

const COLONNES_PRODUIT =
  "id,zone_id,lieu_id,nom,conditionnement,unite,fact,actif,contenance,unite_contenance,saisie_detail,rang";

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Total en unité de comptage ; null si rien n'est saisi. */
export function totalDe(
  p: { fact: number; contenance: number | null },
  s: { colis: number | null; unites: number | null; detail: number | null },
): number | null {
  if (s.colis === null && s.unites === null && s.detail === null) return null;
  const detail = s.detail !== null && p.contenance ? s.detail / p.contenance : 0;
  const t = (s.colis ?? 0) * p.fact + (s.unites ?? 0) + detail;
  return Math.round(t * 10000) / 10000;
}

export async function getInventaireEnCours(): Promise<Inventaire | null> {
  const { data, error } = await db()
    .from("inv_inventaires")
    .select("*")
    .eq("statut", "en_cours")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Inventaire | null) ?? null;
}

export async function getDernierInventaireCloture(): Promise<Inventaire | null> {
  const { data, error } = await db()
    .from("inv_inventaires")
    .select("*")
    .eq("statut", "cloture")
    .order("date_inventaire", { ascending: false })
    .order("cloture_le", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Inventaire | null) ?? null;
}

/** Démarre un inventaire, ou rend celui déjà en cours (un seul à la fois). */
export async function demarrerInventaire(
  date: string,
  heure: string | null,
  prenom: string | null,
  appareilId: string | null,
): Promise<Inventaire> {
  const enCours = await getInventaireEnCours();
  if (enCours) return enCours;
  const { data, error } = await db()
    .from("inv_inventaires")
    .insert({ date_inventaire: date, heure_inventaire: heure, cree_par: prenom })
    .select("*")
    .single();
  if (error) {
    // Deux téléphones ont démarré au même instant : l'index unique a laissé
    // passer le premier, on rejoint son inventaire.
    const autre = await getInventaireEnCours();
    if (autre) return autre;
    throw new Error(error.message);
  }
  const inv = data as Inventaire;
  await db().from("app_journal").insert({
    action: "inventaire_demarre",
    objet: "inventaire",
    objet_id: String(inv.id),
    details: { date, heure },
    prenom,
    appareil_id: appareilId,
  });
  return inv;
}

/** Résumé pour l'accueil : comptages faits sur le nombre de lignes attendues. */
export async function getResumeInventaire() {
  const enCours = await getInventaireEnCours();
  if (!enCours) return { enCours: null, faits: 0, total: 0 };
  const [{ count: total }, { count: faits }] = await Promise.all([
    db().from("inv_produits_attendus").select("*", { count: "exact", head: true }),
    db()
      .from("inv_saisies")
      .select("*", { count: "exact", head: true })
      .eq("inventaire_id", enCours.id),
  ]);
  return { enCours, faits: faits ?? 0, total: total ?? 0 };
}

export async function getInventaire(id: number) {
  const { data: inv, error } = await db()
    .from("inv_inventaires")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!inv) return null;
  const inventaire = inv as Inventaire;

  const [zones, attendus, saisies] = await Promise.all([
    db()
      .from("cmd_zones")
      .select("id,nom,ordre,fournisseur_id")
      .eq("est_lieu", true)
      .order("ordre")
      .then(({ data, error: e }) => {
        if (e) throw new Error(e.message);
        return (data ?? []) as { id: number; nom: string; ordre: number; fournisseur_id: number | null }[];
      }),
    // Un inventaire clôturé se relit tel qu'il a été compté : seulement ses
    // saisies, pas la liste attendue d'aujourd'hui.
    inventaire.statut === "cloture"
      ? Promise.resolve([] as { produit_id: number; zone_id: number; principal: boolean }[])
      : selectAll<{ produit_id: number; zone_id: number; principal: boolean }>(() =>
          db()
            .from("inv_produits_attendus")
            .select("produit_id,zone_id,principal")
            .order("produit_id")
            .order("zone_id"),
        ),
    selectAll<SaisieServeur>(() =>
      db()
        .from("inv_saisies")
        .select("produit_id,zone_id,colis,unites,detail,total,prenom,saisi_le,id")
        .eq("inventaire_id", id)
        .order("id"),
    ),
  ]);

  // Tout le catalogue, y compris les produits retirés de la carte et hors
  // commande : on peut en trouver dans un lieu où on ne les attendait pas.
  const tous = await selectAll<ProduitInv>(() =>
    db().from("cmd_produits").select(COLONNES_PRODUIT).order("id"),
  );
  const produits = new Map(tous.map((p) => [p.id, p]));

  const lieux: Lieu[] = zones.map((z) => ({
    id: z.id,
    nom: z.nom,
    ordre: z.ordre,
    secondaire: z.fournisseur_id === null,
  }));
  const lieuIds = new Set(lieux.map((l) => l.id));

  const parCle = new Map<string, LigneInventaire>();
  const ajouter = (produitId: number, zoneId: number, principal: boolean) => {
    const p = produits.get(produitId);
    if (!p || !lieuIds.has(zoneId)) return;
    const cle = `${produitId}:${zoneId}`;
    if (parCle.has(cle)) return;
    parCle.set(cle, {
      produitId,
      zoneId,
      nom: p.nom,
      rang: p.rang ?? null,
      conditionnement: p.conditionnement,
      unite: p.unite,
      fact: Number(p.fact),
      contenance: num(p.contenance),
      uniteContenance: p.unite_contenance,
      saisieDetail: p.saisie_detail,
      principal,
      inactif: !p.actif,
      colis: null,
      unites: null,
      detail: null,
      total: null,
      prenom: null,
      majLe: 0,
    });
  };
  for (const a of attendus) ajouter(a.produit_id, a.zone_id, a.principal);
  for (const s of saisies) {
    const p = produits.get(s.produit_id);
    ajouter(s.produit_id, s.zone_id, !!p && (p.lieu_id ?? p.zone_id) === s.zone_id);
    const l = parCle.get(`${s.produit_id}:${s.zone_id}`);
    if (!l) continue;
    l.colis = num(s.colis);
    l.unites = num(s.unites);
    l.detail = num(s.detail);
    l.total = num(s.total);
    l.prenom = s.prenom;
    l.majLe = Date.parse(s.saisi_le);
  }

  const lignes = [...parCle.values()].sort((a, b) =>
    a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }),
  );
  const catalogue: ProduitCatalogue[] = tous
    .map((p) => ({
      produitId: p.id,
      nom: p.nom,
      rang: p.rang ?? null,
      conditionnement: p.conditionnement,
      unite: p.unite,
      fact: Number(p.fact),
      contenance: num(p.contenance),
      uniteContenance: p.unite_contenance,
      saisieDetail: p.saisie_detail,
      inactif: !p.actif,
      lieuPrincipal: p.lieu_id ?? p.zone_id,
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
  return { inventaire, lieux, lignes, catalogue };
}

/**
 * Range un produit dans un lieu pour les prochains inventaires (emplacement
 * secondaire), quand on l'y a trouvé sans qu'il y soit attendu.
 */
export async function ajouterEmplacement(
  produitId: number,
  zoneId: number,
  qui: { prenom: string | null; appareilId: string | null },
) {
  const { data: p, error: e1 } = await db()
    .from("cmd_produits")
    .select("id,zone_id,lieu_id")
    .eq("id", produitId)
    .maybeSingle();
  if (e1) throw new Error(e1.message);
  if (!p) return "produit inconnu";
  const principal = (p as { lieu_id: number | null; zone_id: number }).lieu_id ?? (p as { zone_id: number }).zone_id;
  if (principal === zoneId) return "ok";
  const { error } = await db()
    .from("cmd_produit_emplacements")
    .upsert({ produit_id: produitId, zone_id: zoneId }, { onConflict: "produit_id,zone_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  await db().from("app_journal").insert({
    action: "emplacement_ajoute",
    objet: "produit",
    objet_id: String(produitId),
    details: { zone_id: zoneId },
    prenom: qui.prenom,
    appareil_id: qui.appareilId,
  });
  return "ok";
}

/** Saisies modifiées depuis un instant donné (pour voir celles des collègues). */
export async function getSaisiesDepuis(id: number, depuis: string) {
  const { data, error } = await db()
    .from("inv_saisies")
    .select("produit_id,zone_id,colis,unites,detail,total,prenom,saisi_le")
    .eq("inventaire_id", id)
    .gt("saisi_le", depuis)
    .order("saisi_le")
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as SaisieServeur[];
}

type Brute = Record<string, unknown>;
const nombre = (v: unknown) =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) || Number(v) < 0
    ? null
    : Number(v);

/**
 * Enregistre un paquet de comptages venus d'un téléphone. Le total est
 * recalculé ici, d'après la fiche produit du moment, qui est aussi recopiée
 * dans la saisie : un inventaire clôturé ne bouge plus si la fiche change.
 * Une ligne entièrement vide efface le comptage.
 */
export async function enregistrerSaisies(
  lignes: Brute[],
  qui: { prenom: string | null; appareilId: string | null },
) {
  const refusees: { index: number; erreur: string }[] = [];
  const invIds = [...new Set(lignes.map((l) => l.inventaireId).filter(Number.isInteger))] as number[];
  const prodIds = [...new Set(lignes.map((l) => l.produitId).filter(Number.isInteger))] as number[];

  const [{ data: invs, error: e1 }, { data: prods, error: e2 }] = await Promise.all([
    db().from("inv_inventaires").select("id,statut").in("id", invIds.length ? invIds : [-1]),
    db().from("cmd_produits").select("id,fact,contenance,unite_contenance").in("id", prodIds.length ? prodIds : [-1]),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  const statut = new Map(((invs ?? []) as { id: number; statut: string }[]).map((i) => [i.id, i.statut]));
  const produit = new Map(
    ((prods ?? []) as { id: number; fact: number; contenance: number | null; unite_contenance: string | null }[]).map(
      (p) => [p.id, p],
    ),
  );

  const maintenant = new Date().toISOString();
  const aEcrire = new Map<string, Record<string, unknown>>();
  const aEffacer: { inventaire_id: number; produit_id: number; zone_id: number }[] = [];

  lignes.forEach((l, index) => {
    const { inventaireId, produitId, zoneId } = l;
    if (![inventaireId, produitId, zoneId].every(Number.isInteger)) {
      return void refusees.push({ index, erreur: "ligne inconnue" });
    }
    const st = statut.get(inventaireId as number);
    if (!st) return void refusees.push({ index, erreur: "inventaire inconnu" });
    if (st === "cloture") return void refusees.push({ index, erreur: "inventaire déjà clôturé" });
    const p = produit.get(produitId as number);
    if (!p) return void refusees.push({ index, erreur: "produit inconnu" });

    const s = { colis: nombre(l.colis), unites: nombre(l.unites), detail: nombre(l.detail) };
    const fiche = { fact: Number(p.fact), contenance: num(p.contenance) };
    const total = totalDe(fiche, s);
    const cle = { inventaire_id: inventaireId as number, produit_id: produitId as number, zone_id: zoneId as number };
    if (total === null) {
      aEffacer.push(cle);
      return;
    }
    aEcrire.set(`${inventaireId}:${produitId}:${zoneId}`, {
      ...cle,
      ...s,
      fact: fiche.fact,
      contenance: fiche.contenance,
      unite_contenance: p.unite_contenance,
      total,
      prenom: qui.prenom,
      appareil_id: qui.appareilId,
      saisi_le: maintenant,
    });
  });

  if (aEcrire.size) {
    const { error } = await db()
      .from("inv_saisies")
      .upsert([...aEcrire.values()], { onConflict: "inventaire_id,produit_id,zone_id" });
    if (error) throw new Error(error.message);
  }
  for (const c of aEffacer) {
    const { error } = await db()
      .from("inv_saisies")
      .delete()
      .eq("inventaire_id", c.inventaire_id)
      .eq("produit_id", c.produit_id)
      .eq("zone_id", c.zone_id);
    if (error) throw new Error(error.message);
  }
  return refusees;
}
