-- Relevé en cartons + unités (demandé par Nicolas le 07/10/2026).
--
-- Dans la Cave, la Réserve sèche, l'Économat et la Chambre négative, la case
-- de stock est coupée en deux : cartons et unités. Le stock enregistré reste
-- le total en unités de comptage (cartons × fact + unités) : aucun calcul de
-- commande ne change. Le nombre de cartons est gardé à part pour réafficher
-- la saisie telle qu'elle a été faite.

alter table cmd_zones
  add column if not exists saisie_colis boolean not null default false;
comment on column cmd_zones.saisie_colis is
  'Vrai : le relevé se saisit en cartons + unités pour les produits de plus d''une unité par colis.';

alter table cmd_lignes
  add column if not exists stock_colis numeric;
comment on column cmd_lignes.stock_colis is
  'Nombre de cartons saisis au relevé (déjà inclus dans stock, en unités). Null : saisi en unités seulement.';

update cmd_zones set saisie_colis = true
 where fournisseur_id = (select id from cmd_fournisseurs where slug = 'gld')
   and nom in ('Cave', 'Réserve sèche', 'Economat', 'Économat', 'Chambre négative');

-- Unités raccourcies (affichage seulement) : SACHET → SAC, POCHE → POC.
update cmd_produits set unite = 'SAC' where unite = 'SACHET';
update cmd_produits set unite = 'POC' where unite = 'POCHE';
