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
  /** Quantité jetée depuis le relevé précédent, en unités de stock. */
  perte: number | null;
  maj_le: string | null;
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

/**
 * Un intervalle entre deux relevés : ce qui a été consommé, et en combien de
 * jours. `creneau` est le libellé du relevé qui ouvre l'intervalle : chez un
 * fournisseur livré deux fois par semaine, il distingue la période qui couvre
 * le week-end de celle qui ne le couvre pas.
 */
export type PointConso = { date: string; conso: number; jours: number; creneau?: string };

/** Un relevé passé, tel qu'on le montre au chef : daté, en clair. */
export type ReleveResume = {
  date: string;
  stock: number | null;
  colis: number | null;
  livre: number | null;
  perte: number | null;
  conso: number | null;
};

export type Reception = {
  id: number;
  type: "livraison" | "depannage";
  session_id: number | null;
  fournisseur_id: number | null;
  date_reception: string;
  provenance: string | null;
  statut: "brouillon" | "validee";
  note: string | null;
  created_at: string;
  validee_le: string | null;
};

export type ReceptionLigne = {
  id: number;
  reception_id: number;
  produit_id: number;
  colis_commandes: number | null;
  colis_recus: number | null;
  unites: number | null;
  recu: boolean;
  maj_le: string;
};

/** Charge utile de la fonction SQL `cmd_commande`. */
export type CommandeRpc = {
  session: Session;
  zones: Zone[];
  lignes: {
    produit: Produit;
    ligne: Partial<Ligne>;
    nbReleves: number;
    stockPrecedent: number | null;
    serie: PointConso[];
    releves: ReleveResume[];
  }[];
};
