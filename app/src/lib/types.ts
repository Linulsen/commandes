export type Fournisseur = {
  id: number;
  nom: string;
  slug: string;
  frequence: string;
  rythme: string | null;
  ordre: number;
};

export type Zone = {
  id: number;
  fournisseur_id: number;
  nom: string;
  slug: string;
  secteur: string | null;
  ordre: number;
};

export type Produit = {
  id: number;
  zone_id: number;
  nom: string;
  conditionnement: string | null;
  unites_par_conditionnement: number | null;
  unite: string | null;
  fact: number;
  actif: boolean;
  ordre: number;
};

export type Session = {
  id: number;
  fournisseur_id: number;
  date_commande: string;
  libelle: string;
  statut: "brouillon" | "validee";
  marge: number;
  note: string | null;
  created_at: string;
  validee_le: string | null;
};

export type Ligne = {
  id: number;
  session_id: number;
  produit_id: number;
  stock: number | null;
  colis: number | null;
  suggestion: number | null;
  conso_prevue: number | null;
  conso_manuelle: number | null;
  note: string | null;
};

export type PointHistorique = {
  produit_id: number;
  session_id: number;
  date_commande: string;
  stock: number | null;
  colis: number | null;
  total: number | null;
  conso: number | null;
};
