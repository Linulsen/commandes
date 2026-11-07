-- Date de livraison prévue d'une commande (demandé par Nicolas le 07/11/2026,
-- relevé Logistimax avancé au dimanche 08/11 à cause du 11 novembre).
--
-- Vide : l'appli prend le délai habituel du fournisseur (médiane des 12
-- dernières réceptions). Renseignée : le délai relevé → livraison est celui de
-- cette date, pour cette commande seulement. La proposition doit alors faire
-- tenir le stock compté jusqu'à cette livraison, puis la livraison jusqu'à la
-- suivante.
alter table cmd_sessions add column if not exists livraison_prevue date;

comment on column cmd_sessions.livraison_prevue is
  'Date de livraison attendue pour cette commande, saisie quand elle s''écarte du délai habituel (jour férié, relevé avancé). Null : délai habituel du fournisseur.';
