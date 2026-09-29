-- Cartes du restaurant et mouvements de produits qu'elles entraînent.
--
-- Un changement de carte met à jour la liste des produits commandés. Rien n'est
-- supprimé : un produit qui quitte la carte devient inactif (actif = false,
-- date dans retire_le) et garde son historique, en vue de la fonctionnalité
-- d'inventaire. Chaque effet (ajout, retrait, déplacement de chambre,
-- renommage) est noté dans cmd_carte_mouvements.
--
-- Appliquée dans Supabase le 29/09/2026 à 18:30, avec la première carte :
-- « Carte Automne Hiver 2026 - 2027 » (classeur Aide a la commande - 25.09.2026).

create table if not exists cmd_cartes (
  id            serial primary key,
  libelle       text not null unique,
  appliquee_le  timestamptz not null default now(),
  source        text,
  note          text
);
comment on table cmd_cartes is
  'Changements de carte du restaurant (ex. « Carte Automne Hiver 2026 - 2027 »). Chaque changement met à jour la liste des produits commandés ; appliquee_le garde la date et l''heure de la mise à jour.';

create table if not exists cmd_carte_mouvements (
  id           bigserial primary key,
  carte_id     int  not null references cmd_cartes(id) on delete cascade,
  produit_id   int  references cmd_produits(id) on delete set null,
  produit_nom  text not null,
  zone         text,
  action       text not null check (action in ('ajout','retrait','deplacement','renommage','suppression')),
  detail       text,
  created_at   timestamptz not null default now()
);
comment on table cmd_carte_mouvements is
  'Ce que chaque changement de carte a fait aux produits : ajoutés, retirés (gardés inactifs avec leur historique, pour l''inventaire), déplacés de chambre, renommés.';
create index if not exists cmd_carte_mouvements_carte_idx on cmd_carte_mouvements(carte_id);
create index if not exists cmd_carte_mouvements_produit_idx on cmd_carte_mouvements(produit_id);

alter table cmd_produits add column if not exists retire_le timestamptz;
comment on column cmd_produits.retire_le is
  'Date et heure où le produit a été retiré de la carte (actif = false). Le produit et son historique sont conservés pour l''inventaire.';

-- RLS actif sans policy, comme les autres tables : tout passe par les routes
-- serveur de l'application, avec la clé service_role.
alter table cmd_cartes           enable row level security;
alter table cmd_carte_mouvements enable row level security;
