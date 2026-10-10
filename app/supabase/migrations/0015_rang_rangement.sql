-- Ordre de rangement (demandé par Nicolas le 10/10/2026).
--
-- Chaque produit peut avoir une place dans son lieu (lieu d'inventaire, sinon
-- sa chambre de commande), réglée depuis la page « Ordre de rangement ». Les
-- écrans de relevé et d'inventaire peuvent alors afficher les produits dans
-- l'ordre où on les trouve dans la chambre, au lieu de l'ordre alphabétique.
--
-- rang = (ordre du lieu + 1) × 1000 + place dans le lieu (1, 2, 3…). Un seul
-- nombre suffit donc à trier aussi un fournisseur réparti dans plusieurs
-- lieux (France Boissons : Cave, Chambre froide boisson, Réserve sèche).
-- Null : produit pas encore placé, affiché après les autres, par ordre
-- alphabétique (c'est le cas d'un produit tout juste ajouté par une carte).
--
-- La colonne `ordre`, héritée du classeur, n'est pas réutilisée. Aucun calcul
-- de commande ne lit `rang`.

alter table cmd_produits
  add column if not exists rang integer;
comment on column cmd_produits.rang is
  'Place du produit dans son lieu, pour l''ordre de rangement : (ordre du lieu + 1) × 1000 + position. Null : pas encore placé.';
