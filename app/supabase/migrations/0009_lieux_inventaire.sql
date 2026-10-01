-- Lieux réservés à l'inventaire : Congélateur à glaces, Mise en place, Bar.
--
-- Ce sont des emplacements secondaires : on n'y commande rien, mais on y
-- trouve du stock à compter (glaces sorties de la chambre négative, mise en
-- place en cuisine, bouteilles ouvertes au bar…). Ils n'appartiennent donc à
-- aucun fournisseur : `fournisseur_id` devient facultatif. Les écrans de
-- commande ne lisent que les chambres d'un fournisseur et ne les voient pas.

alter table cmd_zones alter column fournisseur_id drop not null;
comment on column cmd_zones.fournisseur_id is
  'Fournisseur dont la commande parcourt cette chambre. Vide pour un lieu réservé à l''inventaire.';

insert into cmd_zones (fournisseur_id, nom, slug, ordre, est_lieu) values
  (null, 'Congélateur à glaces', 'inventaire-congelateur-glaces', 20, true),
  (null, 'Mise en place',        'inventaire-mise-en-place',      21, true),
  (null, 'Bar',                  'inventaire-bar',                22, true)
on conflict (slug) do nothing;
