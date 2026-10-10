import type { SupabaseClient } from "@supabase/supabase-js";
import { sb, selectAll } from "./db";
import { alphabetique } from "./tri-commun";

/**
 * Ordre de rangement : la place de chaque produit dans son lieu (lieu
 * d'inventaire, sinon sa chambre de commande), pour afficher le relevé et
 * l'inventaire dans l'ordre où l'on passe devant les étagères.
 *
 * rang = (ordre du lieu + 1) × 1000 + position. Un seul nombre trie donc
 * aussi un fournisseur réparti dans plusieurs lieux.
 */

const db = () => sb() as unknown as SupabaseClient;

export type LieuRangement = { id: number; nom: string; ordre: number };

export type ProduitRangement = {
  id: number;
  nom: string;
  conditionnement: string | null;
  unite: string | null;
  rang: number | null;
  /** Fournisseur, affiché quand il diffère de celui du lieu (ex. France Boissons en Cave). */
  fournisseur: string | null;
  comptage: boolean;
};

type ProduitBrut = {
  id: number;
  zone_id: number;
  lieu_id: number | null;
  nom: string;
  conditionnement: string | null;
  unite: string | null;
  rang: number | null;
  actif: boolean;
  compte_pour: number | null;
};

type ZoneBrute = { id: number; nom: string; ordre: number; est_lieu: boolean; fournisseur_id: number | null };

const PAS = 1000;

async function lireZones() {
  const { data, error } = await db()
    .from("cmd_zones")
    .select("id,nom,ordre,est_lieu,fournisseur_id")
    .order("ordre");
  if (error) throw new Error(error.message);
  return (data ?? []) as ZoneBrute[];
}

/** Les lieux réels à ranger (les emplacements secondaires n'ont pas de produits propres). */
export async function getLieuxRangement(): Promise<LieuRangement[]> {
  const zones = await lireZones();
  return zones
    .filter((z) => z.est_lieu && z.fournisseur_id !== null)
    .map((z) => ({ id: z.id, nom: z.nom, ordre: z.ordre }));
}

async function produitsDuLieu(lieuId: number) {
  return selectAll<ProduitBrut>(() =>
    db()
      .from("cmd_produits")
      .select("id,zone_id,lieu_id,nom,conditionnement,unite,rang,actif,compte_pour")
      .or(`lieu_id.eq.${lieuId},and(lieu_id.is.null,zone_id.eq.${lieuId})`)
      .order("id"),
  );
}

/** Tri de la page : les produits placés dans l'ordre, puis les autres de A à Z. */
const parRang = (a: { rang: number | null; nom: string }, b: { rang: number | null; nom: string }) => {
  const ra = a.rang ?? Number.MAX_SAFE_INTEGER;
  const rb = b.rang ?? Number.MAX_SAFE_INTEGER;
  return ra - rb || alphabetique(a.nom, b.nom);
};

/** Les produits actifs d'un lieu, dans leur ordre de rangement actuel. */
export async function getProduitsRangement(lieuId: number): Promise<ProduitRangement[]> {
  const [zones, produits, fournisseurs] = await Promise.all([
    lireZones(),
    produitsDuLieu(lieuId),
    db()
      .from("cmd_fournisseurs")
      .select("id,nom")
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: number; nom: string }[];
      }),
  ]);
  const zone = new Map(zones.map((z) => [z.id, z]));
  const nomFournisseur = new Map(fournisseurs.map((f) => [f.id, f.nom]));
  const fournisseurDuLieu = zone.get(lieuId)?.fournisseur_id ?? null;
  return produits
    .filter((p) => p.actif)
    .map((p) => {
      const f = zone.get(p.zone_id)?.fournisseur_id ?? null;
      return {
        id: p.id,
        nom: p.nom,
        conditionnement: p.conditionnement,
        unite: p.unite,
        rang: p.rang,
        fournisseur: f !== null && f !== fournisseurDuLieu ? (nomFournisseur.get(f) ?? null) : null,
        comptage: p.compte_pour !== null,
      };
    })
    .sort(parRang);
}

/**
 * Enregistre l'ordre d'un lieu. `ids` : les produits actifs du lieu, dans
 * l'ordre voulu. Les produits retirés de la carte qui y sont encore rangés
 * passent après (ils peuvent réapparaître à l'inventaire s'il en reste).
 */
export async function enregistrerRangement(
  lieuId: number,
  ids: number[],
  qui: { prenom: string | null; appareilId: string | null },
) {
  const lieux = await getLieuxRangement();
  const lieu = lieux.find((l) => l.id === lieuId);
  if (!lieu) throw new Error("Lieu inconnu");

  const produits = await produitsDuLieu(lieuId);
  const actifs = new Set(produits.filter((p) => p.actif).map((p) => p.id));
  if (new Set(ids).size !== ids.length || ids.some((id) => !actifs.has(id))) {
    throw new Error("Liste de produits invalide : rechargez la page.");
  }
  // Un produit ajouté au lieu depuis l'ouverture de la page, absent de la
  // liste envoyée, garde sa place à la suite plutôt que d'être oublié.
  const restants = produits
    .filter((p) => !ids.includes(p.id))
    .sort((a, b) => Number(b.actif) - Number(a.actif) || parRang(a, b))
    .map((p) => p.id);

  const base = (lieu.ordre + 1) * PAS;
  const ordre = [...ids, ...restants];
  const rangActuel = new Map(produits.map((p) => [p.id, p.rang]));
  const aChanger = ordre
    .map((id, i) => ({ id, rang: base + i + 1 }))
    .filter((x) => rangActuel.get(x.id) !== x.rang);

  for (let i = 0; i < aChanger.length; i += 20) {
    const resultats = await Promise.all(
      aChanger
        .slice(i, i + 20)
        .map((x) => db().from("cmd_produits").update({ rang: x.rang }).eq("id", x.id)),
    );
    const echec = resultats.find((r) => r.error);
    if (echec?.error) throw new Error(echec.error.message);
  }

  await db().from("app_journal").insert({
    action: "rangement_modifie",
    objet: "lieu",
    objet_id: String(lieuId),
    details: { lieu: lieu.nom, produits: ids.length, modifies: aChanger.length },
    prenom: qui.prenom,
    appareil_id: qui.appareilId,
  });
  return { modifies: aChanger.length };
}
