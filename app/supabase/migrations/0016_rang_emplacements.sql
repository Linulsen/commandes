-- Ordre de rangement réglé depuis l'inventaire (demandé par Nicolas le 11/10/2026).
--
-- L'ordre se règle lieu par lieu, sur la liste de l'inventaire : articles
-- actifs, articles retirés encore en stock, emplacements secondaires (Bar,
-- Congélateur à glaces…). Le rang d'un article dans son lieu principal reste
-- dans cmd_produits.rang (c'est lui que suit le relevé fournisseur) ; son rang
-- dans un emplacement secondaire est gardé ici. Même calcul :
-- (ordre du lieu + 1) × 1000 + position ; null = pas encore placé.

alter table cmd_produit_emplacements
  add column if not exists rang integer;
comment on column cmd_produit_emplacements.rang is
  'Place du produit dans cet emplacement secondaire, pour l''ordre de rangement. Null : pas encore placé.';
