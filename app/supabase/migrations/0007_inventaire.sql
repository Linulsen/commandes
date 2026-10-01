-- Inventaire : base de données (étape 1 du cahier des charges « Inventaire »).
--
-- L'inventaire se fait par LIEU réel du restaurant, tous fournisseurs
-- confondus, et en quantités seulement. Il réutilise la fiche produit de
-- l'appli Commandes sans rien changer à ses calculs :
--   * l'unité de comptage (`unite`) et le nombre d'unités par colis (`fact`)
--     restent ceux des commandes ;
--   * on ajoute la contenance d'une unité (kg ou L) et la « saisie au détail »
--     (une case en kg ou en L pour compter un reste).
--
-- Saisie : total (en unité de comptage) = colis × fact + unités + détail ÷ contenance
--   ex. 1 carton de 6 sachets de 1 kg, 3 sachets, 1,600 kg → 10,6 sachets = 10,6 kg
--   ex. 1 carton de 6 Btl de 0,75 L et 1,5 Btl → 7,5 Btl = 5,625 L
--
-- Toutes les tables restent fermées au navigateur (RLS sans règle) : l'appli
-- y accède uniquement depuis son serveur, comme pour les commandes.

-- 1. Lieux -----------------------------------------------------------------
-- Les « chambres » Boissons (France Boissons) et Fruits et légumes (Cledor)
-- servent aux commandes mais ne sont pas des lieux physiques : à l'inventaire,
-- leurs produits sont comptés dans leur lieu réel (`cmd_produits.lieu_id`).

alter table cmd_zones
  add column if not exists est_lieu boolean not null default true;
comment on column cmd_zones.est_lieu is
  'Vrai si la chambre est un lieu physique parcouru à l''inventaire. Faux pour les chambres « de commande » (Boissons, Fruits et légumes) dont les produits sont rangés ailleurs.';

update cmd_zones set est_lieu = false where slug in (
  select z.slug from cmd_zones z join cmd_fournisseurs f on f.id = z.fournisseur_id
  where f.nom in ('France Boissons', 'Cledor')
);

-- 2. Fiche produit ---------------------------------------------------------

alter table cmd_produits
  add column if not exists lieu_id int references cmd_zones(id) on delete set null,
  add column if not exists contenance numeric check (contenance is null or contenance > 0),
  add column if not exists unite_contenance text check (unite_contenance in ('kg', 'L')),
  add column if not exists saisie_detail boolean not null default false,
  add column if not exists hors_commande boolean not null default false,
  add column if not exists fournisseur_libre text,
  add column if not exists a_verifier boolean not null default false,
  add column if not exists cree_par text,
  add column if not exists cree_appareil_id uuid,
  add column if not exists cree_le timestamptz,
  add column if not exists valide_le timestamptz;

alter table cmd_produits drop constraint if exists cmd_produits_contenance_unite;
alter table cmd_produits add constraint cmd_produits_contenance_unite
  check ((contenance is null) = (unite_contenance is null));
alter table cmd_produits drop constraint if exists cmd_produits_detail_contenance;
alter table cmd_produits add constraint cmd_produits_detail_contenance
  check (not saisie_detail or contenance is not null);

comment on column cmd_produits.lieu_id is
  'Lieu d''inventaire quand la chambre de commande n''est pas un lieu physique (ex. Jus d''orange 1L → Chambre froide boisson). Vide = la chambre du produit.';
comment on column cmd_produits.contenance is
  'Contenu d''une unité de comptage, dans `unite_contenance` (ex. 0,75 pour une Btl de 75 cl, 20 pour un fût de 20 L).';
comment on column cmd_produits.unite_contenance is 'kg ou L.';
comment on column cmd_produits.saisie_detail is
  'Inventaire : affiche une case en kg ou L pour compter un reste (ex. 1,600 kg de champignons).';
comment on column cmd_produits.hors_commande is
  'Article créé depuis l''inventaire, jamais passé par une commande. Toujours inactif côté commandes.';
comment on column cmd_produits.fournisseur_libre is
  'Article hors commande : fournisseur ou origine déclarée (ex. « Metro », « acheté ailleurs »).';
comment on column cmd_produits.a_verifier is
  'Article créé depuis l''inventaire en attente de validation par le responsable.';

-- 3. Emplacements secondaires ----------------------------------------------

create table if not exists cmd_produit_emplacements (
  produit_id int not null references cmd_produits(id) on delete cascade,
  zone_id    int not null references cmd_zones(id) on delete cascade,
  ajoute_le  timestamptz not null default now(),
  primary key (produit_id, zone_id)
);
comment on table cmd_produit_emplacements is
  'Lieux où un produit est aussi rangé, en plus de son lieu principal (ex. Lambrusco en Cave et en Chambre froide boisson). À l''inventaire, toutes les saisies du produit s''additionnent.';

-- 4. Appareils et journal --------------------------------------------------

create table if not exists app_appareils (
  id                  uuid primary key,
  nom                 text not null,
  type                text,
  prenom              text,
  premiere_connexion  timestamptz not null default now(),
  derniere_connexion  timestamptz not null default now(),
  deconnecte_le       timestamptz
);
comment on table app_appareils is
  'Appareils connectés : identifiant créé par l''appli à la première connexion, nom donné par l''utilisateur (« Tablette cuisine »), type relevé automatiquement. Un appareil déconnecté par le responsable doit redonner le code.';

create table if not exists app_journal (
  id          bigint generated always as identity primary key,
  quand       timestamptz not null default now(),
  action      text not null,
  objet       text not null,
  objet_id    text,
  details     jsonb,
  prenom      text,
  appareil_id uuid references app_appareils(id) on delete set null
);
create index if not exists app_journal_quand on app_journal (quand desc);
comment on table app_journal is
  'Trace des créations, modifications, validations et clôtures : qui (prénom), sur quel appareil, quand.';

-- 5. Inventaires -----------------------------------------------------------

create table if not exists inv_inventaires (
  id                  serial primary key,
  date_inventaire     date not null default current_date,
  libelle             text,
  statut              text not null default 'en_cours' check (statut in ('en_cours', 'cloture')),
  cree_le             timestamptz not null default now(),
  cree_par            text,
  cloture_le          timestamptz,
  cloture_par         text,
  cloture_appareil_id uuid references app_appareils(id) on delete set null
);
create unique index if not exists inv_un_seul_en_cours
  on inv_inventaires ((true)) where statut = 'en_cours';
comment on table inv_inventaires is
  'Un inventaire complet du restaurant à une date. Un seul en cours à la fois ; une fois clôturé (code responsable), il n''est plus modifiable.';

create table if not exists inv_saisies (
  id                uuid primary key default gen_random_uuid(),
  inventaire_id     int not null references inv_inventaires(id) on delete cascade,
  produit_id        int not null references cmd_produits(id),
  zone_id           int not null references cmd_zones(id),
  colis             numeric check (colis is null or colis >= 0),
  unites            numeric check (unites is null or unites >= 0),
  detail            numeric check (detail is null or detail >= 0),
  -- Fiche produit au moment de la saisie : un inventaire clôturé ne bouge
  -- plus si la fiche change ensuite.
  fact              numeric not null,
  contenance        numeric,
  unite_contenance  text,
  total             numeric not null check (total >= 0),
  prenom            text,
  appareil_id       uuid references app_appareils(id) on delete set null,
  saisi_le          timestamptz not null default now(),
  unique (inventaire_id, produit_id, zone_id)
);
create index if not exists inv_saisies_produit on inv_saisies (produit_id);
comment on table inv_saisies is
  'Comptage d''un produit dans un lieu, pour un inventaire. total = colis × fact + unités + détail ÷ contenance, en unité de comptage. Le total d''un produit est la somme de ses saisies (tous lieux).';

-- 6. Vue : produits à présenter à l'inventaire, par lieu --------------------
-- Un produit apparaît dans son lieu principal et ses emplacements secondaires
-- s'il est actif, OU s'il avait du stock au dernier inventaire clôturé
-- (produit retiré de la carte ou hors commande). Les lignes de comptage
-- (`compte_pour`) sont des produits à part entière à l'inventaire.

create or replace view inv_produits_attendus as
with dernier as (
  select id from inv_inventaires where statut = 'cloture'
  order by date_inventaire desc, cloture_le desc limit 1
), en_stock as (
  select s.produit_id from inv_saisies s
  where s.inventaire_id = (select id from dernier)
  group by s.produit_id having sum(s.total) > 0
), visibles as (
  select p.* from cmd_produits p
  where p.actif or p.id in (select produit_id from en_stock)
)
select v.id as produit_id, coalesce(v.lieu_id, v.zone_id) as zone_id, true as principal
from visibles v
union
select v.id, e.zone_id, false
from visibles v join cmd_produit_emplacements e on e.produit_id = v.id
where e.zone_id <> coalesce(v.lieu_id, v.zone_id);
comment on view inv_produits_attendus is
  'Produits à compter à l''inventaire, par lieu (principal ou secondaire).';

-- 7. Sécurité : accès serveur uniquement -----------------------------------

alter table cmd_produit_emplacements enable row level security;
alter table app_appareils            enable row level security;
alter table app_journal              enable row level security;
alter table inv_inventaires          enable row level security;
alter table inv_saisies              enable row level security;
alter view  inv_produits_attendus    set (security_invoker = true);
