/**
 * Motifs de perte. Ils sont gardés en texte dans `cmd_receptions.provenance`
 * (type `perte`) ; une liste fixe permet de les compter au bilan hebdomadaire :
 * « DLC dépassée » signale un produit commandé en trop ou trop tôt, les autres
 * motifs sont des accidents qui ne remettent pas la commande en cause.
 */
export const MOTIFS_PERTE = [
  "DLC dépassée",
  "Abîmé / qualité",
  "Casse / renversé",
  "Erreur de préparation",
  "Autre",
] as const;

export type MotifPerte = (typeof MOTIFS_PERTE)[number];

/** « Autre » peut porter une précision : « Autre : rappel fournisseur ». */
export const SEPARATEUR_AUTRE = " : ";

/** Motif de la liste et précision éventuelle, d'après le texte enregistré. */
export function lireMotif(texte: string | null): { motif: MotifPerte | null; precision: string } {
  const t = (texte ?? "").trim();
  if (!t) return { motif: null, precision: "" };
  const exact = MOTIFS_PERTE.find((m) => m === t);
  if (exact) return { motif: exact, precision: "" };
  if (t.startsWith("Autre" + SEPARATEUR_AUTRE))
    return { motif: "Autre", precision: t.slice(("Autre" + SEPARATEUR_AUTRE).length) };
  // Ancien motif libre : rangé dans « Autre », texte conservé.
  return { motif: "Autre", precision: t };
}

export function ecrireMotif(motif: MotifPerte | null, precision: string): string {
  if (!motif) return "";
  const p = precision.trim();
  return motif === "Autre" && p ? `Autre${SEPARATEUR_AUTRE}${p}` : motif;
}
