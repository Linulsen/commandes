-- Dépannages et échanges Del Arte saisis en colis pour certains articles
-- (ex. pâton pizza : on emprunte des cartons de 55, pas des pièces).
-- L'écran convertit : la base garde les quantités en unités de stock
-- (colis × fact), aucun calcul n'est modifié. Les pertes restent en unités.
alter table cmd_produits
  add column if not exists depannage_en_colis boolean not null default false;

comment on column cmd_produits.depannage_en_colis is
  'Dépannages et échanges Del Arte saisis en colis à l''écran (stockés en unités : colis × fact).';

update cmd_produits set depannage_en_colis = true where id = 239; -- PATON PIZZA 200G
