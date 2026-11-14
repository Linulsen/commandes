import type { PointConso } from "./types";

export type Fiabilite = "bonne" | "moyenne" | "faible" | "aucune";

export type Prevision = {
  /** Consommation attendue, en unités, d'ici la prochaine livraison. */
  consoPrevue: number;
  /** Rythme de consommation, en unités par jour. */
  consoParJour: number;
  /**
   * Nombre de jours couverts par la commande en préparation : du relevé
   * jusqu'à la livraison qui suit celle qu'on commande (intervalle habituel
   * entre relevés + délai de livraison du fournisseur).
   */
  joursHorizon: number;
  /** Délai de livraison compris dans `joursHorizon` (0 : non mesuré). */
  delaiLivraison: number;
  fiabilite: Fiabilite;
  /** Consommations relevées, de la plus ancienne à la plus récente. */
  serie: PointConso[];
  derniere: number | null;
  /** Coefficient de variation : la régularité du produit, pas son volume. */
  variation: number | null;
  nbPoints: number;
  /** Relevés où le stock a augmenté sans livraison : comptage douteux. */
  anomalies: number;
  /** Le produit s'est vendu sur au moins une des 8 dernières périodes. */
  aConsomme: boolean;
};

const moyenne = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/**
 * Délai habituel entre la commande et la livraison, en jours (médiane des
 * dernières réceptions du fournisseur). `defaut` quand rien n'est mesuré.
 */
export function delaiHabituel(delais: number[], defaut = 2) {
  const d = delais.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!d.length) return defaut;
  return d[Math.floor(d.length / 2)];
}

/** Durée typique entre deux relevés, pour projeter la période à venir. */
export function horizonHabituel(serie: { jours: number }[], defaut = 7) {
  if (!serie.length) return defaut;
  const recents = serie.slice(-6).map((s) => s.jours).sort((a, b) => a - b);
  return recents[Math.floor(recents.length / 2)];
}

/**
 * Prévision de consommation d'un produit à partir de son historique.
 *
 * La série arrive déjà construite par la fonction SQL `cmd_commande` : chaque
 * point porte ce qui a été consommé et en combien de jours. Deux relevés ne
 * sont pas toujours séparés du même nombre de jours — Cledor livre deux fois
 * par semaine à trois puis quatre jours d'intervalle, et une semaine peut
 * sauter — donc tout se raisonne en rythme journalier.
 *
 * Une consommation négative n'est pas une aberration à jeter : elle dit qu'un
 * relevé de stock a été surévalué, et la période suivante porte l'excédent
 * symétrique. Les supprimer gonflerait la moyenne. On les garde donc telles
 * quelles — une moyenne sur fenêtre les compense d'elle-même, puisque la somme
 * des consommations d'une fenêtre ne dépend que des stocks de ses deux bornes
 * et des livraisons intermédiaires.
 *
 * `nbRelevesTotal` peut dépasser la longueur de la série : celle-ci est bornée
 * aux derniers relevés, alors que l'écran annonce l'historique réellement
 * disponible.
 *
 * `creneau` sert aux fournisseurs livrés deux fois par semaine. Chez Cledor, la
 * commande du mercredi pour vendredi couvre le week-end, celle du dimanche pour
 * mardi non : ni le rythme ni la durée ne sont les mêmes. Dès qu'il y a assez
 * de périodes du même créneau, on ne regarde qu'elles.
 *
 * `delaiLivraison` (corrigé le 25/10/2026, après la rupture de fondants au
 * chocolat) : le stock compté au relevé doit tenir jusqu'à la livraison de
 * cette commande, et cette livraison jusqu'à la suivante. La commande couvre
 * donc l'intervalle entre deux relevés PLUS le délai de livraison de la
 * commande d'après (lundi → jeudi suivant chez Logistimax : 7 + 3 = 10 jours).
 * Avant, seul l'intervalle entre relevés était couvert et la marge de +50 %
 * était presque entièrement absorbée par ces jours-là. Rejoué sur 3 534
 * commandes : manques jusqu'à la livraison suivante 14,7 % → 3,9 %.
 */
export function prevoir(
  serieComplete: PointConso[],
  joursHorizon?: number,
  nbRelevesTotal?: number,
  creneau?: string,
  delaiLivraison = 0,
): Prevision {
  const memeCreneau = creneau
    ? serieComplete.filter((s) => (s.creneau ?? "") === creneau)
    : [];
  const serie = memeCreneau.length >= 3 ? memeCreneau : serieComplete;
  const parJour = serie.map((s) => s.conso / s.jours);
  const n = parJour.length;
  const horizon = joursHorizon ?? horizonHabituel(serie) + delaiLivraison;
  const anomalies = serie.filter((s) => s.conso < 0).length;

  // La fenêtre courte suit la carte du moment, la longue amortit les à-coups
  // (un banquet, une semaine creuse). On penche vers la courte sans lui laisser
  // toute la place : une seule semaine atypique ne doit pas emporter la commande.
  let consoParJour: number;
  if (n === 0) consoParJour = 0;
  else if (n < 3) consoParJour = Math.max(0, moyenne(parJour)!);
  else
    consoParJour = Math.max(
      0,
      0.6 * moyenne(parJour.slice(-4))! + 0.4 * moyenne(parJour.slice(-8))!,
    );

  const recents = parJour.slice(-8);
  const m = moyenne(recents);
  let variation: number | null = null;
  if (m !== null && m > 0 && recents.length >= 3) {
    const v = recents.reduce((a, x) => a + (x - m) ** 2, 0) / (recents.length - 1);
    variation = Math.sqrt(v) / m;
  }

  let fiabilite: Fiabilite = "aucune";
  if (n >= 6 && variation !== null && variation < 0.4) fiabilite = "bonne";
  else if (n >= 4 && variation !== null && variation < 0.8) fiabilite = "moyenne";
  else if (n >= 2) fiabilite = "faible";

  return {
    consoPrevue: Math.round(consoParJour * horizon * 100) / 100,
    consoParJour: Math.round(consoParJour * 1000) / 1000,
    joursHorizon: horizon,
    delaiLivraison: joursHorizon === undefined ? delaiLivraison : 0,
    fiabilite,
    serie: serieComplete,
    derniere: serieComplete.length
      ? serieComplete[serieComplete.length - 1].conso
      : null,
    variation,
    nbPoints: nbRelevesTotal ?? n,
    anomalies,
    aConsomme: serie.slice(-8).some((s) => s.conso > 0),
  };
}

/**
 * Version des règles de calcul, enregistrée sur chaque commande validée
 * (cmd_sessions.version_calcul) pour savoir avec quel calcul elle a été
 * proposée. À changer, avec les tests (app/tests), à chaque modification qui
 * change les quantités proposées :
 * - 2026-11-02 : calcul à partir du jour de livraison, +20 % pour les réguliers.
 */
export const VERSION_CALCUL = "2026-11-02";

/** Marge des produits réguliers (fiabilité « bonne »), depuis le 02/11/2026. */
export const MARGE_REGULIERS = 0.2;

/**
 * Quantité à commander, en colis.
 *
 * On vise la consommation attendue plus une marge de sécurité, on retranche ce
 * qui reste en chambre, et on convertit en colis entiers — un fournisseur ne
 * livre pas des demi-cartons. L'arrondi se fait au plus proche pour ne pas
 * empiler du stock, sauf si cela laisserait le restaurant en dessous de sa
 * consommation attendue : là, on remonte d'un colis.
 *
 * `periode` (corrigé le 02/11/2026, après 11 cartons de burrata et 16 seaux
 * de crème proposés pour une semaine qui en consomme 7 et 8) : la commande se
 * raisonne à partir du jour de livraison.
 * - Le stock compté sert d'abord jusqu'à la livraison ; ce qui en reste ce
 *   jour-là ne descend jamais sous zéro. Ce qui manquerait avant la livraison
 *   ne peut pas être rattrapé par elle (un dépannage, oui) : le compter faisait
 *   commander ces jours-là en plus, marge comprise.
 * - La marge porte sur la période que la livraison doit tenir (jusqu'à la
 *   livraison suivante), plus sur les jours d'avant.
 * - Produits réguliers (fiabilité « bonne ») : marge de +20 %, au lieu de la
 *   marge de la commande (+50 %).
 * Rejoué sur 4 132 commandes : 15 538 → 10 971 colis, manques jusqu'à la
 * livraison suivante 6,1 % → 9,8 % (commandes réellement passées : 10 159
 * colis, 8,2 %).
 */
export function suggerer(
  consoPrevue: number,
  stock: number | null,
  fact: number,
  marge: number,
  aConsomme = false,
  periode?: { joursHorizon: number; delai: number; fiabilite: Fiabilite },
): number {
  const f = fact > 0 ? fact : 1;
  const enStock = stock ?? 0;
  let besoin: number;
  let plancher: number;
  const delai = periode?.delai ?? 0;
  if (periode && delai > 0 && periode.joursHorizon > delai && consoPrevue > 0) {
    const parJour = consoPrevue / periode.joursHorizon;
    const m = periode.fiabilite === "bonne" ? Math.min(marge, MARGE_REGULIERS) : marge;
    const resteALivraison = Math.max(0, enStock - parJour * delai);
    const aTenir = parJour * (periode.joursHorizon - delai);
    besoin = aTenir * (1 + m) - resteALivraison;
    plancher = aTenir - resteALivraison;
  } else {
    besoin = consoPrevue * (1 + marge) - enStock;
    plancher = consoPrevue - enStock;
  }
  // Sécurité : plus rien en chambre d'un produit qui se vend. Un relevé faux
  // peut faire tomber la prévision à zéro (consommation négative) ; on ne
  // laisse pas pour autant le restaurant sans rien.
  if (besoin <= 0) return aConsomme && stock !== null && enStock <= 0 ? 1 : 0;
  let colis = Math.max(1, Math.round(besoin / f));
  while (colis * f < plancher && colis < 999) colis += 1;
  return colis;
}

/**
 * Produit nouveau : aucune période complète dans l'historique (un seul relevé
 * validé avant celui-ci). La prévision tomberait à zéro et rien ne serait
 * proposé, même en rupture — c'est arrivé le 12/10/2026 au mélange
 * champignons-cèpes et aux rondelles de pommes de terre, entrés à la carte le
 * 29/09.
 *
 * On se sert alors de ce qui est sorti depuis le dernier relevé, calculé avec
 * le stock en cours de saisie (la ligne « Aujourd'hui » de la fiche) :
 * plafond − stock − jeté, ramené à un rythme par jour sur `jours`.
 *
 * Dès qu'une période complète existe, la prévision habituelle reprend la main.
 */
export function prevoirSansHistorique(
  p: { consoPrevue: number; aConsomme: boolean; nbPoints: number; joursHorizon: number },
  plafond: number | null,
  stock: number | null,
  perte: number | null,
  jours: number | null,
): { consoPrevue: number; aConsomme: boolean } {
  const inchange = { consoPrevue: p.consoPrevue, aConsomme: p.aConsomme };
  if (p.nbPoints > 0 || plafond === null || stock === null || !jours || jours <= 0)
    return inchange;
  const conso = plafond - stock - (perte ?? 0);
  if (conso <= 0) return inchange;
  return {
    consoPrevue: Math.round((conso / jours) * p.joursHorizon * 100) / 100,
    aConsomme: true,
  };
}

/** Nombre de jours entre deux dates « AAAA-MM-JJ ». */
/**
 * Prévision avec la semaine en cours (demandé par Nicolas le 19/10/2026).
 *
 * Le relevé du jour donne déjà la consommation de la semaine qui s'achève :
 * plafond (stock du relevé précédent + entrées − sorties enregistrées) − stock
 * compté − jeté. On l'ajoute à l'historique comme une période de plus, sans
 * attendre la validation du relevé. Rejoué sur 4 565 commandes passées : un
 * peu moins de manques (1,8 % → 1,7 %) avec un peu moins de colis.
 *
 * Remplace aussi le cas « produit nouveau » (aucune période complète) : la
 * semaine en cours y est la seule période, comme le faisait
 * `prevoirSansHistorique`.
 *
 * Renvoie null quand la semaine en cours ne peut pas servir (stock pas encore
 * saisi, pas de relevé précédent) ou qu'elle donne une consommation négative
 * non confirmée (« stock impossible » pas encore tranché) : on garde alors la
 * prévision de l'historique seul.
 */
export function prevoirAvecReleveDuJour(
  p: { serie: PointConso[]; nbPoints: number; joursHorizon: number },
  creneau: string | undefined,
  enCours: {
    plafond: number | null;
    stock: number | null;
    perte: number | null;
    jours: number | null;
    creneau: string | null;
    /** Le stock a été confirmé malgré le plafond (« Le compte est juste »). */
    verifie: boolean;
  },
): { consoPrevue: number; aConsomme: boolean } | null {
  const { plafond, stock, perte, jours } = enCours;
  if (plafond === null || stock === null || !jours || jours <= 0) return null;
  const conso = Math.round((plafond - stock - (perte ?? 0)) * 1000) / 1000;
  if (conso < 0 && !enCours.verifie) return null;
  const r = prevoir(
    [...p.serie, { date: "", conso, jours, creneau: enCours.creneau ?? "" }],
    p.joursHorizon,
    p.nbPoints + 1,
    creneau,
  );
  return { consoPrevue: r.consoPrevue, aConsomme: r.aConsomme };
}

export function joursEntre(debut: string | null | undefined, fin: string): number | null {
  if (!debut) return null;
  const d = Date.parse(debut.slice(0, 10));
  const f = Date.parse(fin.slice(0, 10));
  if (Number.isNaN(d) || Number.isNaN(f)) return null;
  return Math.max(1, Math.round((f - d) / 86_400_000));
}

/**
 * Stock qui sert à la proposition, compte tenu des échanges avec les autres
 * Del Arte :
 * - ce que nous devons (emprunté, pas encore rendu) est réservé : il est en
 *   chambre mais pas à nous, on le retire ;
 * - ce qu'un autre restaurant nous doit n'est compté que si l'on a choisi, à
 *   ce relevé, de compter sur son retour (`retourAttendu`).
 * Ainsi un emprunt non rendu est recommandé à chaque commande, sans jamais
 * l'être deux fois : ce qui a été livré en plus est dans le stock compté.
 */
export function stockDisponible(
  stockTotal: number | null,
  reserve: number,
  retourAttendu: number | null,
): number | null {
  if (stockTotal === null) return null;
  return Math.round((stockTotal - reserve + (retourAttendu ?? 0)) * 1000) / 1000;
}

export type Alerte = "rupture" | "surstock" | "nouveau" | null;

export function alerte(p: Prevision, stock: number | null): Alerte {
  // Plus rien d'un produit qui se vend : rupture, même s'il est nouveau.
  if (stock !== null && stock <= 0 && p.aConsomme) return "rupture";
  if (p.nbPoints < 2) return "nouveau";
  if (stock === null || p.consoPrevue <= 0) return null;
  if (stock < p.consoPrevue * 0.5) return "rupture";
  if (stock > p.consoPrevue * 3) return "surstock";
  return null;
}

/** Nombre de périodes de livraison que le stock actuel permet de tenir. */
export function couverture(p: Prevision, stock: number | null): number | null {
  if (stock === null || p.consoPrevue <= 0) return null;
  return Math.round((stock / p.consoPrevue) * 10) / 10;
}

/**
 * Consommation anormalement basse depuis le dernier relevé (demandé par
 * Nicolas le 08/11/2026, après la rupture de sauce bolognaise).
 *
 * Au relevé Logistimax du 02/11/2026, les 6 cartons livrés le jeudi ont été
 * comptés pleins (37 sachets) : 4 sachets consommés dans la semaine au lieu
 * d'une vingtaine, rien proposé, rupture le dimanche 08/11. Même chose pour
 * la mousse mascarpone vanille (3 cartons comptés, soit toute la livraison).
 * Le stock n'était pas « impossible », seulement invraisemblable.
 *
 * On demande donc de recompter quand, à la fois :
 * - quelque chose est entré depuis le dernier relevé (livraison, dépannage) :
 *   c'est le cas d'un carton compté plein alors qu'il est entamé ;
 * - le produit est régulier : consommé sur au moins 6 des 8 dernières périodes ;
 * - la consommation attendue sur la période (rythme médian × jours) atteint
 *   au moins 4 unités ;
 * - la consommation comptée est inférieure au tiers de l'attendue.
 * Une consommation négative relève de « stock impossible », pas d'ici.
 *
 * Rejoué sur les relevés depuis le 01/09/2026 : 0 à 5 produits par relevé
 * (surtout Logistimax), dont la bolognaise et la mousse le 02/11.
 */
export function consoAnormalementBasse(
  serie: PointConso[],
  enCours: {
    plafond: number | null;
    stock: number | null;
    perte: number | null;
    jours: number | null;
    stockPrecedent: number | null;
  },
): { conso: number; attendu: number } | null {
  const { plafond, stock, perte, jours, stockPrecedent } = enCours;
  if (plafond === null || stock === null || stockPrecedent === null || !jours || jours <= 0)
    return null;
  // Rien n'est entré depuis le dernier relevé.
  if (plafond <= stockPrecedent + 0.0005) return null;
  const conso = Math.round((plafond - stock - (perte ?? 0)) * 1000) / 1000;
  if (conso < 0) return null;
  const recents = serie.slice(-8).filter((s) => s.jours > 0);
  if (recents.filter((s) => s.conso > 0).length < 6) return null;
  const parJour = recents.map((s) => s.conso / s.jours).sort((a, b) => a - b);
  const milieu = Math.floor(parJour.length / 2);
  const mediane =
    parJour.length % 2 ? parJour[milieu] : (parJour[milieu - 1] + parJour[milieu]) / 2;
  const attendu = Math.round(mediane * jours * 10) / 10;
  if (attendu < 4 || conso >= attendu / 3) return null;
  return { conso, attendu };
}
