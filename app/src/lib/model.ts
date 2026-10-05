import { sb, selectAll } from "./db";
import { alerte, couverture, prevoir, suggerer, type Prevision } from "./forecast";
import type {
  CommandeRpc,
  Fournisseur,
  Ligne,
  Produit,
  Reception,
  ReceptionLigne,
  ReleveResume,
  Session,
  Zone,
} from "./types";

/** Ordre alphabétique à la française : « Écrasé » avec les E, pas après Z. */
export const alpha = (a: string, b: string) =>
  a.localeCompare(b, "fr", { sensitivity: "base", numeric: true });

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
  /** Les quatre derniers relevés, du plus récent au plus ancien. */
  releves: ReleveResume[];
  /**
   * Stock qui sert au calcul : celui de la ligne, plus celui des lignes de
   * comptage qui lui sont rattachées (converti). Égal à `ligne.stock` sinon.
   */
  stockTotal: number | null;
};

/** Une ligne de comptage complète un autre produit et ne se commande jamais. */
export const estLigneDeComptage = (p: Pick<Produit, "compte_pour">) =>
  p.compte_pour !== null && p.compte_pour !== undefined;

/**
 * Quantité qui fait foi pour une ligne : celle que Nicolas a arrêtée, sinon la
 * proposition. Sans ce repli, une ligne relevée dont la quantité n'aurait pas
 * été renvoyée au serveur disparaîtrait du bon de commande alors qu'elle
 * s'affiche à l'écran.
 */
export function quantiteRetenue(l: LigneEnrichie): number {
  if (estLigneDeComptage(l.produit)) return 0;
  if (l.ligne.colis !== null) return Number(l.ligne.colis);
  return l.stockTotal !== null ? l.suggestion : 0;
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

  // Ce que les lignes de comptage ajoutent au stock de leur produit principal
  // (ex. sucrines en sachet de 6, comptées en sachets de 3).
  const rattache = new Map<number, number>();
  for (const brut of paquet.lignes) {
    const p = brut.produit;
    if (!estLigneDeComptage(p) || brut.ligne.stock == null) continue;
    const ajout = Number(brut.ligne.stock) * Number(p.equivalence ?? 1);
    rattache.set(p.compte_pour!, (rattache.get(p.compte_pour!) ?? 0) + ajout);
  }

  const lignes: LigneEnrichie[] = paquet.lignes.map((brut) => {
    const produit = brut.produit;
    const prevision = prevoir(
      brut.serie,
      undefined,
      brut.nbReleves,
      session.libelle || undefined,
    );
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
      perte: brut.ligne.perte ?? null,
      maj_le: brut.ligne.maj_le ?? null,
    };
    const ajout = rattache.get(produit.id);
    const stockTotal =
      ligne.stock === null && ajout === undefined
        ? null
        : Number(ligne.stock ?? 0) + (ajout ?? 0);
    const comptage = estLigneDeComptage(produit);
    return {
      ligne,
      produit,
      zone: zoneParId.get(produit.zone_id)!,
      prevision,
      suggestion: comptage
        ? 0
        : suggerer(
            prevision.consoPrevue,
            stockTotal,
            Number(produit.fact),
            Number(session.marge),
          ),
      alerte: comptage ? null : alerte(prevision, stockTotal),
      couverture: comptage ? null : couverture(prevision, stockTotal),
      stockPrecedent: brut.stockPrecedent,
      releves: brut.releves ?? [],
      stockTotal,
    };
  });

  // Nicolas cherche un produit par son nom en parcourant la chambre : l'ordre
  // du classeur, hérité de l'ordre de saisie, ne lui disait rien.
  const rangZone = new Map(zones.map((z, i) => [z.id, i]));
  lignes.sort(
    (a, b) =>
      rangZone.get(a.zone.id)! - rangZone.get(b.zone.id)! ||
      alpha(a.produit.nom, b.produit.nom),
  );

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

/** Les deux créneaux d'un fournisseur livré deux fois par semaine. */
const CRENEAUX = [
  { jour: 0, libelle: "Dimanche pour mardi" },
  { jour: 3, libelle: "Mercredi pour vendredi" },
];

/**
 * Créneau d'une commande bi-hebdomadaire, d'après son jour : du dimanche au
 * mardi on prépare la livraison du mardi, du mercredi au samedi celle du
 * vendredi. Ce libellé était écrit en dur, si bien que les relevés du mercredi
 * se confondaient avec ceux du dimanche.
 */
export function libelleCreneau(date: string, frequence: string) {
  if (frequence !== "bi-hebdo") return "";
  const jour = new Date(`${date}T12:00:00Z`).getUTCDay();
  return jour >= 3 ? CRENEAUX[1].libelle : CRENEAUX[0].libelle;
}

/**
 * Date du prochain relevé : une semaine après le dernier, ou aujourd'hui.
 * Chez un fournisseur bi-hebdomadaire, le prochain dimanche ou mercredi.
 */
export function prochaineDate(derniere: string | null, frequence: string) {
  const aujourdhui = new Date();
  aujourdhui.setUTCHours(12, 0, 0, 0);
  const base = derniere ? new Date(`${derniere}T12:00:00Z`) : new Date(aujourdhui);

  if (frequence === "bi-hebdo") {
    const d = new Date(Math.max(base.getTime() + (derniere ? 864e5 : 0), aujourdhui.getTime()));
    while (!CRENEAUX.some((c) => c.jour === d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  if (derniere) base.setUTCDate(base.getUTCDate() + 7);
  return (base > aujourdhui ? base : aujourdhui).toISOString().slice(0, 10);
}

export type ResumeFournisseur = {
  fournisseur: Fournisseur;
  nbProduits: number;
  derniereValidee: Session | null;
  brouillon: (Session & { saisis: number; total: number }) | null;
  prochaineDate: string;
  prochainLibelle: string;
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
      ...(() => {
        const date = prochaineDate(derniereValidee?.date_commande ?? null, f.frequence);
        return { prochaineDate: date, prochainLibelle: libelleCreneau(date, f.frequence) };
      })(),
    };
  });
}

/* ------------------------------------------------------------------------ */
/* Réceptions                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Commandes validées depuis l'application et pas encore réceptionnées. Les
 * relevés repris du classeur n'ont pas de date de validation : ils ne sont pas
 * proposés, personne n'ira réceptionner une livraison de juin.
 */
/**
 * Dépannages et pertes ouverts sans rien dedans : un essai, ou un bouton touché
 * par erreur. On les cache de la liste au bout de 15 minutes et on les efface
 * au bout de 12 heures — pas avant, au cas où un téléphone hors ligne (chez
 * Metro…) aurait des saisies pas encore envoyées.
 * Rend les ids à cacher.
 */
async function nettoyerHorsCommandeVides(): Promise<Set<number>> {
  const { data, error } = await sb()
    .from("cmd_receptions")
    .select("id,created_at")
    .in("type", ["depannage", "perte"])
    .eq("statut", "brouillon");
  if (error || !data?.length) return new Set();
  const ids = data.map((r) => r.id as number);
  const pleines = await sb()
    .from("cmd_reception_lignes")
    .select("reception_id")
    .in("reception_id", ids)
    .eq("recu", true);
  if (pleines.error) return new Set();
  const avecSaisie = new Set((pleines.data ?? []).map((l) => l.reception_id as number));
  const maintenant = Date.now();
  const age = (r: { created_at: string }) => maintenant - Date.parse(r.created_at);
  const vides = data.filter((r) => !avecSaisie.has(r.id as number));
  const aEffacer = vides.filter((r) => age(r) > 12 * 3600e3).map((r) => r.id as number);
  if (aEffacer.length) {
    await sb().from("cmd_receptions").delete().in("id", aEffacer).eq("statut", "brouillon");
  }
  return new Set(vides.filter((r) => age(r) > 15 * 60e3).map((r) => r.id as number));
}

export async function getReceptionsAccueil() {
  const caches = await nettoyerHorsCommandeVides().catch(() => new Set<number>());
  const depuis = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [sessions, receptions, fournisseurs] = await Promise.all([
    sb()
      .from("cmd_sessions")
      .select("*")
      .eq("statut", "validee")
      .not("validee_le", "is", null)
      .gte("date_commande", depuis)
      .order("date_commande", { ascending: false }),
    sb()
      .from("cmd_receptions")
      .select("*")
      .order("date_reception", { ascending: false })
      .order("id", { ascending: false })
      .limit(60),
    getFournisseurs(),
  ]);
  if (sessions.error) throw new Error(sessions.error.message);
  if (receptions.error) throw new Error(receptions.error.message);
  const toutes = (receptions.data ?? []) as Reception[];
  const parSession = new Map(
    toutes.filter((r) => r.type === "livraison").map((r) => [r.session_id, r]),
  );
  const aReceptionnerTout = ((sessions.data ?? []) as Session[]).filter(
    (s) => parSession.get(s.id)?.statut !== "validee",
  );
  // Un relevé validé sans commande n'attend aucune livraison.
  const avecCommande = new Set<number>();
  if (aReceptionnerTout.length) {
    const { data, error } = await sb()
      .from("cmd_lignes")
      .select("session_id")
      .in("session_id", aReceptionnerTout.map((s) => s.id))
      // Même règle que quantiteRetenue : la quantité arrêtée, sinon la proposition.
      .or("colis.gt.0,and(colis.is.null,stock.not.is.null,suggestion.gt.0)");
    if (error) throw new Error(error.message);
    for (const l of data ?? []) avecCommande.add(l.session_id as number);
  }
  const aReceptionner = aReceptionnerTout.filter((s) => avecCommande.has(s.id));
  return {
    aReceptionner: aReceptionner.map((s) => ({
      session: s,
      reception: parSession.get(s.id) ?? null,
    })),
    enCours: toutes.filter((r) => r.statut === "brouillon" && !caches.has(r.id)),
    recentes: toutes.filter((r) => r.statut === "validee").slice(0, 20),
    fournisseurs,
  };
}

/**
 * Ouvre la réception d'une commande, en recopiant ce qui a été commandé : c'est
 * la base à cocher, et la référence pour repérer ce qui manque.
 */
export async function ouvrirReception(sessionId: number) {
  const existante = await sb()
    .from("cmd_receptions")
    .select("*")
    .eq("session_id", sessionId)
    .eq("type", "livraison")
    .maybeSingle();
  if (existante.error) throw new Error(existante.error.message);
  if (existante.data) return existante.data as Reception;

  const commande = await getCommande(sessionId);
  if (!commande) throw new Error("Commande inconnue");

  const { data, error } = await sb()
    .from("cmd_receptions")
    .insert({
      type: "livraison",
      session_id: sessionId,
      fournisseur_id: commande.session.fournisseur_id,
      date_reception: new Date().toISOString().slice(0, 10),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  const reception = data as Reception;

  const commandees = commande.lignes
    .map((l) => ({ l, colis: quantiteRetenue(l) }))
    .filter((x) => x.colis > 0);
  if (commandees.length) {
    const ins = await sb().from("cmd_reception_lignes").insert(
      commandees.map(({ l, colis }) => ({
        reception_id: reception.id,
        produit_id: l.produit.id,
        colis_commandes: colis,
        colis_recus: colis,
        unites: colis * Number(l.produit.fact),
        recu: false,
      })),
    );
    if (ins.error) throw new Error(ins.error.message);
  }
  return reception;
}

/**
 * Ouvre un mouvement hors commande : un dépannage (achat d'urgence, qui entre
 * en stock) ou une perte (produit jeté, qui sort de la consommation). Pour une
 * perte, `provenance` porte le motif (DLC dépassée…).
 */
export async function creerDepannage(
  provenance: string | null,
  type: "depannage" | "perte" = "depannage",
) {
  const { data, error } = await sb()
    .from("cmd_receptions")
    .insert({
      type,
      provenance,
      date_reception: new Date().toISOString().slice(0, 10),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Reception;
}

export type ProduitCatalogue = Pick<
  Produit,
  "id" | "nom" | "conditionnement" | "unite" | "fact" | "zone_id"
> & {
  zone: string;
  fournisseurId: number;
  /** Ligne de comptage : le produit qu'elle complète, et sa conversion. */
  comptePour: number | null;
  equivalence: number | null;
  nomRattache: string | null;
};

/**
 * Tout ce qu'il faut pour l'écran de réception : la réception, ses lignes, et
 * le catalogue dans lequel piocher un produit ajouté — celui du fournisseur
 * pour une livraison, tous les produits pour un dépannage ou une perte.
 */
export async function getReception(id: number) {
  const { data, error } = await sb()
    .from("cmd_receptions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const reception = data as Reception;

  const [lignes, zones, fournisseurs, session] = await Promise.all([
    selectAll<ReceptionLigne>(() =>
      sb()
        .from("cmd_reception_lignes")
        .select("*")
        .eq("reception_id", id)
        .order("id"),
    ),
    getZones(reception.fournisseur_id ?? undefined),
    getFournisseurs(),
    reception.session_id ? getSession(reception.session_id) : Promise.resolve(null),
  ]);
  const zoneParId = new Map(zones.map((z) => [z.id, z]));
  const produits = await selectAll<Produit>(() =>
    sb()
      .from("cmd_produits")
      .select("*")
      .in("zone_id", zones.map((z) => z.id))
      .order("id"),
  );
  const rangZone = new Map(zones.map((z, i) => [z.id, i]));
  const catalogue: ProduitCatalogue[] = produits
    .filter((p) => p.actif || lignes.some((l) => l.produit_id === p.id))
    .map((p) => ({
      id: p.id,
      nom: p.nom,
      conditionnement: p.conditionnement,
      unite: p.unite,
      fact: Number(p.fact),
      zone_id: p.zone_id,
      zone: zoneParId.get(p.zone_id)?.nom ?? "",
      fournisseurId: zoneParId.get(p.zone_id)?.fournisseur_id ?? 0,
      comptePour: p.compte_pour ?? null,
      equivalence: p.equivalence == null ? null : Number(p.equivalence),
      nomRattache:
        p.compte_pour == null
          ? null
          : (produits.find((q) => q.id === p.compte_pour)?.nom ?? null),
    }))
    .sort(
      (a, b) =>
        rangZone.get(a.zone_id)! - rangZone.get(b.zone_id)! || alpha(a.nom, b.nom),
    );

  return {
    reception,
    session,
    lignes,
    catalogue,
    fournisseur: fournisseurs.find((f) => f.id === reception.fournisseur_id) ?? null,
    fournisseurs,
  };
}
