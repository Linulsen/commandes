import { sb, selectAll } from "./db";
import { alerte, couverture, prevoir, suggerer, type Prevision } from "./forecast";
import type {
  Fournisseur,
  Ligne,
  PointHistorique,
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
 * L'historique exclut la session en cours — sinon le relevé qu'on est en train
 * de saisir servirait à prédire sa propre consommation.
 */
export async function getCommande(sessionId: number) {
  const session = await getSession(sessionId);
  if (!session) return null;

  const zones = await getZones(session.fournisseur_id);
  const zoneIds = zones.map((z) => z.id);
  const produits = await selectAll<Produit>(() =>
    sb().from("cmd_produits").select("*").in("zone_id", zoneIds),
  );
  const produitIds = produits.map((p) => p.id);

  const lignes = await selectAll<Ligne>(() =>
    sb().from("cmd_lignes").select("*").eq("session_id", sessionId),
  );

  const historique = await selectAll<PointHistorique>(() =>
    sb()
      .from("cmd_historique")
      .select("produit_id,session_id,date_commande,stock,colis,total,conso")
      .in("produit_id", produitIds)
      .order("date_commande"),
  );

  const parProduit = new Map<number, PointHistorique[]>();
  for (const h of historique) {
    if (h.session_id === sessionId) continue;
    if (h.date_commande > session.date_commande) continue;
    const l = parProduit.get(h.produit_id) ?? [];
    l.push(h);
    parProduit.set(h.produit_id, l);
  }

  const zoneParId = new Map(zones.map((z) => [z.id, z]));
  const ligneParProduit = new Map(lignes.map((l) => [l.produit_id, l]));

  const enrichies: LigneEnrichie[] = produits
    .filter((p) => p.actif)
    .map((produit) => {
      const points = (parProduit.get(produit.id) ?? []).sort((a, b) =>
        a.date_commande.localeCompare(b.date_commande),
      );
      const prevision = prevoir(points);
      const ligne =
        ligneParProduit.get(produit.id) ??
        ({
          id: 0,
          session_id: sessionId,
          produit_id: produit.id,
          stock: null,
          colis: null,
          suggestion: null,
          conso_prevue: null,
          conso_manuelle: null,
          note: null,
        } as Ligne);
      const dernier = points.at(-1);
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
        stockPrecedent: dernier?.stock === undefined ? null : Number(dernier.stock),
      };
    })
    .sort(
      (a, b) =>
        a.zone.ordre - b.zone.ordre ||
        a.produit.ordre - b.produit.ordre ||
        a.produit.nom.localeCompare(b.produit.nom),
    );

  return { session, zones, lignes: enrichies };
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
      .in("zone_id", zones.map((z) => z.id)),
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
        .in("session_id", brouillons.map((s) => s.id)),
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
