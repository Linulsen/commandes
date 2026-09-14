-- Praedic Commandes — aide à la commande du restaurant (Il Ristorante / DomusVi).
-- Reprend le modèle du classeur « Aide a la commande » : un relevé de stock par
-- chambre, une commande en colis, une consommation déduite d'un relevé à l'autre.
-- Tables préfixées cmd_ car elles cohabitent avec le schéma d'études du projet.

create table if not exists cmd_fournisseurs (
  id          serial primary key,
  nom         text not null unique,
  slug        text not null unique,
  frequence   text not null default 'hebdo',   -- hebdo | bi-hebdo
  rythme      text,                            -- libellé libre : « Dimanche pour Mardi »
  ordre       int  not null default 0
);
comment on table cmd_fournisseurs is
  'Fournisseurs du restaurant. GLD livre les 6 chambres en une commande hebdomadaire ; France Boissons et Cledor ont leur propre liste et leur propre rythme.';

create table if not exists cmd_zones (
  id              serial primary key,
  fournisseur_id  int  not null references cmd_fournisseurs(id) on delete cascade,
  nom             text not null,
  slug            text not null unique,
  secteur         text,
  ordre           int  not null default 0
);
comment on table cmd_zones is
  'Les « chambres » : lieux de stockage parcourus un par un pour l''inventaire (Cave, Chambre froide, Chambre négative, Réserve sèche, Economat...). Une zone appartient à un seul fournisseur.';

create table if not exists cmd_produits (
  id                          serial primary key,
  zone_id                     int  not null references cmd_zones(id) on delete cascade,
  nom                         text not null,
  conditionnement             text,
  unites_par_conditionnement  numeric,
  unite                       text,
  fact                        numeric not null default 1,
  actif                       boolean not null default true,
  ordre                       int not null default 0,
  unique (zone_id, nom)
);
comment on column cmd_produits.fact is
  'Nombre d''unités livrées par colis commandé. C''est le multiplicateur réellement utilisé dans le classeur (colonne E des onglets chambres, colonne Fact chez France Boissons et Cledor) : il diverge parfois de unites_par_conditionnement, qui reste indicatif.';

create table if not exists cmd_sessions (
  id              serial primary key,
  fournisseur_id  int  not null references cmd_fournisseurs(id) on delete cascade,
  date_commande   date not null,
  libelle         text not null default '',
  statut          text not null default 'brouillon' check (statut in ('brouillon','validee')),
  marge           numeric not null default 0.5,
  note            text,
  created_at      timestamptz not null default now(),
  validee_le      timestamptz,
  unique (fournisseur_id, date_commande, libelle)
);
comment on table cmd_sessions is
  'Une campagne de commande : le relevé de stock de toutes les chambres du fournisseur à une date, et la commande qui en découle. Une colonne de semaine du classeur = une session.';
comment on column cmd_sessions.marge is
  'Marge de sécurité appliquée à la consommation prévue pour suggérer les quantités (0.5 = +50 %). Valeur retenue après rejeu des 60 relevés du classeur : à 25 % la proposition passait sous la consommation réellement constatée dans 6 % des cas, à 50 % dans 4 %, tout en laissant en chambre nettement moins de stock que les commandes passées à la main.';

create table if not exists cmd_lignes (
  id              bigserial primary key,
  session_id      int  not null references cmd_sessions(id) on delete cascade,
  produit_id      int  not null references cmd_produits(id) on delete cascade,
  stock           numeric,
  colis           numeric,
  suggestion      numeric,
  conso_prevue    numeric,
  conso_manuelle  numeric,
  note            text,
  unique (session_id, produit_id)
);
comment on column cmd_lignes.suggestion is
  'Quantité en colis proposée par la prévision au moment de la saisie. Conservée telle quelle même si l''utilisateur la corrige : c''est la seule façon de mesurer après coup si la prévision vaut mieux que le nez du chef.';
comment on column cmd_lignes.conso_manuelle is
  'Consommation saisie à la main, utilisée pour le tout premier relevé d''un produit, quand aucun relevé antérieur ne permet de la déduire.';

create index if not exists cmd_lignes_produit_idx on cmd_lignes(produit_id);
create index if not exists cmd_lignes_session_idx on cmd_lignes(session_id);
create index if not exists cmd_zones_fournisseur_idx on cmd_zones(fournisseur_id);
create index if not exists cmd_produits_zone_idx on cmd_produits(zone_id);
create index if not exists cmd_sessions_fournisseur_idx on cmd_sessions(fournisseur_id, date_commande desc);

-- Historique par produit, avec la consommation déduite d'un relevé à l'autre :
-- conso(t) = total livré au relevé précédent - stock constaté au relevé t.
create or replace view cmd_historique as
with base as (
  select
    l.produit_id,
    s.id            as session_id,
    s.fournisseur_id,
    s.date_commande,
    s.libelle,
    s.statut,
    l.stock,
    l.colis,
    l.conso_manuelle,
    p.fact,
    l.stock + coalesce(l.colis, 0) * p.fact as total
  from cmd_lignes l
  join cmd_sessions s on s.id = l.session_id
  join cmd_produits p on p.id = l.produit_id
)
select
  b.*,
  lag(b.total) over w as total_precedent,
  coalesce(
    lag(b.total) over w - b.stock,
    b.conso_manuelle
  ) as conso
from base b
window w as (partition by b.produit_id order by b.date_commande, b.session_id);

-- Sans cette option, la vue s'exécute avec les droits de son propriétaire et
-- contourne le RLS des tables qu'elle lit : n'importe quel porteur de la clé
-- anonyme pourrait relire tout l'historique des relevés.
alter view public.cmd_historique set (security_invoker = true);

alter table cmd_fournisseurs enable row level security;
alter table cmd_zones        enable row level security;
alter table cmd_produits     enable row level security;
alter table cmd_sessions     enable row level security;
alter table cmd_lignes       enable row level security;
-- RLS actif sans policy : ces tables ne sont jamais lues depuis le navigateur.
-- Tout passe par les routes serveur de l'application, avec la clé service_role.
