/**
 * Échanges de marchandise avec les autres restaurants Del Arte.
 *
 * Fichier sans accès à la base : utilisable par les écrans comme par le
 * serveur. Les soldes se lisent dans la vue `cmd_del_arte_soldes`
 * (voir `getSoldesDelArte` dans model.ts).
 */

/** Restaurants avec lesquels on échange (liste donnée par Nicolas). */
export const RESTAURANTS_DEL_ARTE = [
  "Del Arte Vaulx en Velin",
  "Del Arte Dardilly",
  "Del Arte Brignais",
] as const;

export type TypeEchange = "emprunt" | "rendu" | "pret" | "retour";

/** Type enregistré dans cmd_receptions pour chaque échange. */
export const TYPE_RECEPTION: Record<TypeEchange, "depannage" | "rendu" | "pret" | "retour"> = {
  emprunt: "depannage",
  rendu: "rendu",
  pret: "pret",
  retour: "retour",
};

/** Libellé d'un échange, tel qu'on le lit dans les listes. */
export const LIBELLE_ECHANGE: Record<TypeEchange, string> = {
  emprunt: "Ils nous prêtent",
  rendu: "Nous rendons",
  pret: "Nous prêtons",
  retour: "Ils nous rendent",
};

/** Le type d'échange d'une réception, ou null si ce n'en est pas un. */
export function echangeDe(r: {
  type: string;
  del_arte?: string | null;
}): TypeEchange | null {
  if (!r.del_arte) return null;
  if (r.type === "depannage") return "emprunt";
  if (r.type === "rendu" || r.type === "pret" || r.type === "retour") return r.type;
  return null;
}

/** Ce que l'échange fait au stock : entrée (emprunt, retour) ou sortie. */
export const estEntree = (e: TypeEchange) => e === "emprunt" || e === "retour";

/** Solde d'un produit avec un restaurant, en unités de stock du produit. */
export type SoldeDelArte = {
  delArte: string;
  produitId: number;
  /** Emprunté et pas encore rendu : réservé dans notre stock. */
  nousDevons: number;
  /** Prêté et pas encore revenu. */
  ilsDoivent: number;
};

/** Petits écarts d'arrondi (0,000001) : rien à rendre. */
export const positif = (x: number) => (x > 1e-6 ? Math.round(x * 1000) / 1000 : 0);
