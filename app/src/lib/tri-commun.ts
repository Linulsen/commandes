/**
 * Ordre d'affichage des produits au relevé et à l'inventaire : alphabétique,
 * ou dans l'ordre où ils sont rangés dans la chambre (page « Ordre de
 * rangement »). Utilisable côté serveur comme côté téléphone.
 */
export type Tri = "alpha" | "rangement";

/** Ordre alphabétique à la française : « Écrasé » avec les E. */
export const alphabetique = (a: string, b: string) =>
  a.localeCompare(b, "fr", { sensitivity: "base", numeric: true });

/**
 * Comparateur selon le tri choisi. En ordre de rangement, un produit pas
 * encore placé (rang null) vient après les autres, par ordre alphabétique.
 */
export function comparer(tri: Tri) {
  return (a: { nom: string; rang: number | null }, b: { nom: string; rang: number | null }) => {
    if (tri === "rangement") {
      const ra = a.rang ?? Number.MAX_SAFE_INTEGER;
      const rb = b.rang ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
    }
    return alphabetique(a.nom, b.nom);
  };
}
