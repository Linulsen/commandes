import { sb, selectAll } from "./db";
import { alerte, couverture, prevoir, suggerer, type Prevision } from "./forecast";
import type {
  CommandeRpc,
  Fournisseur,
  Ligne,
  Produit,
  Session,
  Zone,
} from "./types";

export type LigneEnrichie = {
  ligne: Ligne;
  produit: Produit;
  zone: Zone;
  prevision: Prevision;
  suggestion: number;
  alerte: ReturnType<typeof alerte>;
  couverture: number | null;
  /** Stock relevé la fois précédente, pour situer la saisie en cours. */
  stockPrecedent: number | null;
};

/**
 * Quantité qui fait foi pour une ligne : celle que Nicolas a arrêtée, sinon la
 * proposition. Sans ce repli, une ligne relevée dont la quantité n'aurait pas
 * été renvoyée au serveur disparaîtrait du bon de commande alors qu'elle
 * s'affiche à l'écran.
 */
export function quantiteRetenue(l: LigneEnrichie): number {
  if (l.ligne.colis !== null) return Number(l.ligne.colis);
  return l.ligne.stock !== null ? l.suggestion : 0;
}

export async function getFournisseurs() {
  const { data, error } = await sb()
    .from("cmd_fournisseurs")
    .select("*")
    .order("ordre");
  if (error) throw new Error(error.message);
  return (data ?? []) as Fournisseur[];
}

export async function getZones(fournisseurId?: number) {
  let q = sb().from("cmd_zones").select("*").order("ordre");
  if (fournisseurId) q = q.eq("fournisseur_id", fournisseurId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Zone[];
}

export async function getSession(id: number) {
  const { data, error } = await sb()
    .from("cmd_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Session) ?? null;
}

export async function getSessions(limite = 40) {
  const { data, error } = await sb()
    .from("cmd_sessions")
    .select("*")
    .order("date_commande", { ascending: false })
    .order("id", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as Session[];
}

/**
 * Tout ce qu'il faut pour afficher une commande : les produits du fournisseur,
 * leur historique, la prévision et la quantité proposée.
 *
 * Une seule requête. L'assemblage vivait auparavant ici, en huit allers-retours
 * enchaînés dont quatre pour paginer l'historique ; il tient maintenant dans la
 * fonction SQL `cmd_commande`, qui exclut d'elle-même la session en cours —
 * sinon le relevé qu'on est en train de saisir servirait à prédire sa propre
 * consommation.
 */
export async function getCommande(sessionId: number) {
  const { data, error } = await sb().rpc("cmd_commande", {
    p_session_id: sessionId,
  });
  if (error) throw new Error(error.message);
  const paquet = data as CommandeRpc | null;
  if (!paquet?.session) return null;

  const { session, zones } = paquet;
  const zoneParId = new Map(zones.map((z) => [z.id, z]));

  const lignes: LigneEnrichie[] = paquet.lignes.map((brut) => {
    const produit = brut.produit;
    const prevision = prevoir(brut.serie, undefined, brut.nbReleves);
    const ligne: Ligne = {
      id: brut.ligne.id ?? 0,
      session_id: sessionId,
      produit_id: produit.id,
      stock: brut.ligne.stock ?? null,
      colis: brut.ligne.colis ?? null,
      suggestion: brut.ligne.suggestion ?? null,
      conso_prevue: brut.ligne.conso_prevue ?? null,
      conso_manuelle: brut.ligne.conso_manuelle ?? null,
      note: brut.ligne.note ?? null,
    };
    return {
      ligne,
      produit,
      zone: zoneParId.get(produit.zone_id)!,
      prevision,
      suggestion: suggerer(
        prevision.consoPrevue,
        ligne.stock,
        Number(produit.fact),
        Number(session.marge),
      ),
      alerte: alerte(prevision, ligne.stock),
      couverture: couverture(prevision, ligne.stock),
      stockPrecedent: brut.stockPrecedent,
    };
  });

  return { session, zones, lignes };
}

/**
 * Ouvre la commande suivante d'un fournisseur : une session vide, et une ligne
 * par produit actif prête à recevoir le relevé de stock.
 */
export async function ouvrirSession(
  fournisseurId: number,
  dateCommande: string,
  libelle = "",
) {
  const existante = await sb()
    .from("cmd_sessions")
    .select("*")
    .eq("fournisseur_id", fournisseurId)
    .eq("date_commande", dateCommande)
    .eq("libelle", libelle)
    .maybeSingle();
  let session = existante.data as Session | null;

  if (!session) {
    const { data, error } = await sb()
      .from("cmd_sessions")
      .insert({
        fournisseur_id: fournisseurId,
        date_commande: dateCommande,
        libelle,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    session = data as Session;
  }

  const zones = await getZones(fournisseurId);
  const produits = await selectAll<Pick<Produit, "id" | "actif">>(() =>
    sb()
      .from("cmd_produits")
      .select("id,actif")
      .in("zone_id", zones.map((z) => z.id))
      .order("id"),
  );
  const { error } = await sb().from("cmd_lignes").upsert(
    produits
      .filter((p) => p.actif)
      .map((p) => ({ session_id: session!.id, produit_id: p.id })),
    { onConflict: "session_id,produit_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  return session;
}

/** Date du prochain relevé : une semaine après le dernier, ou aujourd'hui. */
export function prochaineDate(derniere: string | null, frequence: string) {
  const pas = frequence === "bi-hebdo" ? 3 : 7;
  const base = derniere ? new Date(`${derniere}T12:00:00Z`) : new Date();
  if (derniere) base.setUTCDate(base.getUTCDate() + pas);
  const aujourdhui = new Date();
  aujourdhui.setUTCHours(12, 0, 0, 0);
  return (base > aujourdhui ? base : aujourdhui).toISOString().slice(0, 10);
}

export type ResumeFournisseur = {
  fournisseur: Fournisseur;
  nbProduits: number;
  derniereValidee: Session | null;
  brouillon: (Session & { saisis: number; total: number }) | null;
  prochaineDate: string;
};

/** Ce qu'il faut pour l'accueil : où en est chaque fournisseur. */
export async function getAccueil(): Promise<ResumeFournisseur[]> {
  const [fournisseurs, zones, sessions] = await Promise.all([
    getFournisseurs(),
    getZones(),
    getSessions(300),
  ]);
  const produits = await selectAll<Pick<Produit, "id" | "zone_id" | "actif">>(
    () => sb().from("cmd_produits").select("id,zone_id,actif"),
  );

  const zonesPar = new Map<number, number[]>();
  for (const z of zones) {
    zonesPar.set(z.fournisseur_id, [...(zonesPar.get(z.fournisseur_id) ?? []), z.id]);
  }

  const brouillons = sessions.filter((s) => s.statut === "brouillon");
  const compte = new Map<number, { saisis: number; total: number }>();
  if (brouillons.length) {
    const lignes = await selectAll<Pick<Ligne, "session_id" | "stock">>(() =>
      sb()
        .from("cmd_lignes")
        .select("session_id,stock")
        .in("session_id", brouillons.map((s) => s.id))
        .order("id"),
    );
    for (const l of lignes) {
      const c = compte.get(l.session_id) ?? { saisis: 0, total: 0 };
      c.total += 1;
      if (l.stock !== null) c.saisis += 1;
      compte.set(l.session_id, c);
    }
  }

  return fournisseurs.map((f) => {
    const ids = new Set(zonesPar.get(f.id) ?? []);
    const siennes = sessions.filter((s) => s.fournisseur_id === f.id);
    const derniereValidee = siennes.find((s) => s.statut === "validee") ?? null;
    const b = siennes.find((s) => s.statut === "brouillon") ?? null;
    return {
      fournisseur: f,
      nbProduits: produits.filter((p) => p.actif && ids.has(p.zone_id)).length,
      derniereValidee,
      brouillon: b
        ? { ...b, ...(compte.get(b.id) ?? { saisis: 0, total: 0 }) }
        : null,
      prochaineDate: prochaineDate(
        derniereValidee?.date_commande ?? null,
        f.frequence,
      ),
    };
  });
}
