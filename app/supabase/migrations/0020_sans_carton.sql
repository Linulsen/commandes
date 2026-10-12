-- Comptage sans carton (demandé par Nicolas le 12/10/2026).
--
-- Les glaces et sorbets en bac se comptent au bac, jamais au carton : au
-- relevé (Chambre négative, saisie cartons + unités) comme à l'inventaire,
-- la case « carton » disparaît pour eux. Le stock enregistré reste en unités
-- de comptage : aucun calcul de commande ne change, et la commande se passe
-- toujours en cartons.

alter table cmd_produits
  add column if not exists sans_carton boolean not null default false;
comment on column cmd_produits.sans_carton is
  'Vrai : au relevé et à l''inventaire, le stock se compte seulement dans l''unité (pas de case carton).';

update cmd_produits set sans_carton = true
 where unite = 'BAC'
   and (nom ilike 'glace%' or nom ilike 'sorbet%');
