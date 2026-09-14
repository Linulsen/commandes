import type {
  Fournisseur,
  Ligne,
  PointHistorique,
  Produit,
  Session,
  Zone,
} from "./types";

/**
 * Description des seules tables `cmd_` utilisées ici. La base héberge aussi les
 * référentiels d'études du cabinet : les décrire n'apporterait rien et rendrait
 * ce fichier illisible.
 */
type Table<Row, Insert = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      cmd_fournisseurs: Table<Fournisseur>;
      cmd_zones: Table<Zone>;
      cmd_produits: Table<Produit>;
      cmd_sessions: Table<
        Session,
        Partial<Session> & { fournisseur_id: number; date_commande: string }
      >;
      cmd_lignes: Table<
        Ligne,
        Partial<Ligne> & { session_id: number; produit_id: number }
      >;
    };
    Views: {
      cmd_historique: { Row: PointHistorique; Relationships: [] };
    };
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
