import type { PointConso } from "./types";

export type Fiabilite = "bonne" | "moyenne" | "faible" | "aucune";

export type Prevision = {
  /** Consommation attendue, en unités, d'ici la prochaine livraison. */
  consoPrevue: number;
  /** Rythme de consommation, en unités par jour. */
  consoParJour: number;
  /** Nombre de jours couverts par la commande en préparation. */
  joursHorizon: number;
  fiabilite: Fiabilite;
  /** Consommations relevées, de la plus ancienne à la plus récente. */
  serie: PointConso[];
  derniere: number | null;
  /** Coefficient de variation : la régularité du produit, pas son volume. */
  variation: number | null;
  nbPoints: number;
  /** Relevés où le stock a augmenté sans livraison : comptage douteux. */
  anomalies: number;
};

const moyenne = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

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
 */
export function prevoir(
  serieComplete: PointConso[],
  joursHorizon?: number,
  nbRelevesTotal?: number,
  creneau?: string,
): Prevision {
  const memeCreneau = creneau
    ? serieComplete.filter((s) => (s.creneau ?? "") === creneau)
    : [];
  const serie = memeCreneau.length >= 3 ? memeCreneau : serieComplete;
  const parJour = serie.map((s) => s.conso / s.jours);
  const n = parJour.length;
  const horizon = joursHorizon ?? horizonHabituel(serie);
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
    fiabilite,
    serie: serieComplete,
    derniere: serieComplete.length
      ? serieComplete[serieComplete.length - 1].conso
      : null,
    variation,
    nbPoints: nbRelevesTotal ?? n,
    anomalies,
  };
}

/**
 * Quantité à commander, en colis.
 *
 * On vise la consommation attendue plus une marge de sécurité, on retranche ce
 * qui reste en chambre, et on convertit en colis entiers — un fournisseur ne
 * livre pas des demi-cartons. L'arrondi se fait au plus proche pour ne pas
 * empiler du stock, sauf si cela laisserait le restaurant en dessous de sa
 * consommation attendue : là, on remonte d'un colis.
 */
export function suggerer(
  consoPrevue: number,
  stock: number | null,
  fact: number,
  marge: number,
): number {
  const f = fact > 0 ? fact : 1;
  const enStock = stock ?? 0;
  const besoin = consoPrevue * (1 + marge) - enStock;
  if (besoin <= 0) return 0;
  let colis = Math.max(1, Math.round(besoin / f));
  while (enStock + colis * f < consoPrevue && colis < 999) colis += 1;
  return colis;
}

export type Alerte = "rupture" | "surstock" | "nouveau" | null;

export function alerte(p: Prevision, stock: number | null): Alerte {
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
