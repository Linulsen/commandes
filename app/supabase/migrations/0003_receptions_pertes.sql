-- Réceptions, dépannages et pertes.
--
-- Jusqu'ici la consommation se déduisait en supposant que tout ce qui était
-- commandé avait été livré, et que tout ce qui avait disparu de la chambre
-- avait été servi. Deux angles morts, signalés par Nicolas :
--   · une livraison incomplète, ou un dépannage chez Metro quand on tombe en
--     rupture, faussent le stock de départ de la période ;
--   · un produit jeté parce que sa DLC est passée serait compté comme
--     consommé, et la prévision en recommanderait d'autant plus la fois
--     suivante — l'inverse de ce qu'il faut.
--
-- La consommation d'une période devient :
--   stock relevé(t-1) + livré après t-1 + dépannages entre t-1 et t
--   − jeté entre t-1 et t − stock relevé(t)
-- où « livré » est la réception validée si elle existe, sinon la commande
-- telle que passée (c'est le cas de tout l'historique repris du classeur).

alter table cmd_lignes add column if not exists perte numeric;
alter table cmd_lignes add column if not exists maj_le timestamptz not null default now();
comment on column cmd_lignes.perte is
  'Quantité jetée depuis le relevé précédent (DLC dépassée…), en unités de stock. Retirée de la consommation : ce n''est pas une consommation client, et la compter ferait recommander davantage.';
comment on column cmd_lignes.maj_le is
  'Dernière écriture. Le téléphone garde ses saisies hors ligne : il compare leur date à celle-ci pour savoir laquelle est la plus récente.';

create table if not exists cmd_receptions (
  id              serial primary key,
  type            text not null default 'livraison' check (type in ('livraison','depannage')),
  session_id      int  references cmd_sessions(id) on delete cascade,
  fournisseur_id  int  references cmd_fournisseurs(id) on delete cascade,
  date_reception  date not null default current_date,
  provenance      text,
  statut          text not null default 'brouillon' check (statut in ('brouillon','validee')),
  note            text,
  created_at      timestamptz not null default now(),
  validee_le      timestamptz,
  check (type = 'depannage' or session_id is not null)
);
comment on table cmd_receptions is
  'Ce qui est réellement entré en chambre. Une livraison répond à une commande (session) ; un dépannage est un achat d''urgence hors commande (Metro, un confrère…), daté, qui compte dans la période où il a eu lieu.';
create unique index if not exists cmd_receptions_livraison_uniq
  on cmd_receptions(session_id) where type = 'livraison';
create index if not exists cmd_receptions_date_idx on cmd_receptions(type, date_reception);

create table if not exists cmd_reception_lignes (
  id               bigserial primary key,
  reception_id     int not null references cmd_receptions(id) on delete cascade,
  produit_id       int not null references cmd_produits(id) on delete cascade,
  colis_commandes  numeric,
  colis_recus      numeric,
  unites           numeric,
  recu             boolean not null default false,
  maj_le           timestamptz not null default now(),
  unique (reception_id, produit_id)
);
comment on column cmd_reception_lignes.colis_commandes is
  'Quantité commandée, recopiée à l''ouverture de la réception pour pouvoir comparer. Vide pour un produit ajouté hors commande.';
comment on column cmd_reception_lignes.unites is
  'Ce qui entre en stock, en unités de stock : colis reçus × fact pour une livraison, quantité saisie telle quelle pour un dépannage. Seules les lignes cochées « reçu » comptent.';
create index if not exists cmd_reception_lignes_produit_idx on cmd_reception_lignes(produit_id);

alter table cmd_receptions       enable row level security;
alter table cmd_reception_lignes enable row level security;

-- Relevés enrichis de ce qui est entré et sorti autour d'eux. Remplace
-- l'ancienne vue : mêmes colonnes en tête, pour les scripts qui la lisent.
drop view if exists cmd_historique;
create view cmd_historique with (security_invoker = true) as
with livraisons as (
  select r.session_id, rl.produit_id,
         coalesce(sum(rl.unites) filter (where rl.recu), 0) as unites
  from cmd_receptions r
  join cmd_reception_lignes rl on rl.reception_id = r.id
  where r.type = 'livraison' and r.statut = 'validee'
  group by 1, 2
),
receptionnees as (
  select session_id from cmd_receptions
  where type = 'livraison' and statut = 'validee'
),
base as (
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
    l.perte,
    case
      when s.id in (select session_id from receptionnees) then coalesce(lv.unites, 0)
      else coalesce(l.colis, 0) * p.fact
    end as livre
  from cmd_lignes l
  join cmd_sessions s on s.id = l.session_id
  join cmd_produits p on p.id = l.produit_id
  left join livraisons lv on lv.session_id = s.id and lv.produit_id = l.produit_id
),
fenetre as (
  select
    b.*,
    b.stock + b.livre as total,
    lag(b.stock + b.livre) over w as total_precedent,
    lag(b.date_commande)   over w as date_precedente,
    lag(b.libelle)         over w as libelle_precedent,
    lag(b.colis)           over w as colis_precedent
  from base b
  window w as (partition by b.produit_id order by b.date_commande, b.session_id)
),
avec_depannages as (
  select
    f.*,
    coalesce((
      select sum(rl.unites)
      from cmd_reception_lignes rl
      join cmd_receptions r on r.id = rl.reception_id
      where r.type = 'depannage' and r.statut = 'validee' and rl.recu
        and rl.produit_id = f.produit_id
        and r.date_reception >= f.date_precedente
        and r.date_reception <  f.date_commande
    ), 0) as depannage
  from fenetre f
)
select
  produit_id, session_id, fournisseur_id, date_commande, libelle, statut,
  stock, colis, conso_manuelle, fact, total, total_precedent,
  coalesce(
    total_precedent + depannage - coalesce(perte, 0) - stock,
    conso_manuelle
  ) as conso,
  perte, livre, depannage, date_precedente, libelle_precedent, colis_precedent
from avec_depannages;

-- La fonction de l'écran de relevé lit maintenant cette vue, et rend en plus
-- les quatre derniers relevés de chaque produit, lisibles tels quels : date,
-- stock, commandé, consommé, jeté.
create or replace function public.cmd_commande(p_session_id int)
returns jsonb
language sql
stable
as $$
with s as (
  select * from cmd_sessions where id = p_session_id
),
z as (
  select z.* from cmd_zones z join s on z.fournisseur_id = s.fournisseur_id
),
p as (
  select pr.* from cmd_produits pr join z on z.id = pr.zone_id where pr.actif
),
h as (
  select
    hi.*,
    row_number() over (partition by hi.produit_id
                       order by hi.date_commande desc, hi.session_id desc) as rang
  from cmd_historique hi
  join p on p.id = hi.produit_id
  where hi.session_id <> p_session_id
    and hi.date_commande <= (select date_commande from s)
),
serie as (
  select
    produit_id,
    count(*) filter (where total_precedent is not null) as nb_releves,
    max(stock) filter (where rang = 1) as stock_precedent,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date',  date_commande,
          'conso', conso,
          'jours', greatest(1, date_commande - date_precedente),
          'creneau', coalesce(libelle_precedent, '')
        )
        order by date_commande, session_id
      ) filter (where rang <= 26 and total_precedent is not null),
      '[]'::jsonb
    ) as points,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date',   date_commande,
          'stock',  stock,
          'colis',  colis,
          'livre',  livre,
          'perte',  perte,
          'conso',  case when total_precedent is not null then conso end
        )
        order by date_commande desc, session_id desc
      ) filter (where rang <= 4),
      '[]'::jsonb
    ) as releves
  from h
  group by produit_id
)
select jsonb_build_object(
  'session', (select to_jsonb(s) from s),
  'zones',   coalesce((select jsonb_agg(to_jsonb(z) order by z.ordre, z.id) from z), '[]'::jsonb),
  'lignes',  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'produit', to_jsonb(p) - 'actif',
        'ligne',   coalesce(to_jsonb(l) - 'session_id' - 'produit_id', '{}'::jsonb),
        'nbReleves',      coalesce(se.nb_releves, 0),
        'stockPrecedent', se.stock_precedent,
        'serie',          coalesce(se.points, '[]'::jsonb),
        'releves',        coalesce(se.releves, '[]'::jsonb)
      )
      order by (select zz.ordre from z zz where zz.id = p.zone_id), lower(p.nom)
    )
    from p
    left join cmd_lignes l on l.produit_id = p.id and l.session_id = p_session_id
    left join serie se on se.produit_id = p.id
  ), '[]'::jsonb)
)
where exists (select 1 from s);
$$;

revoke execute on function public.cmd_commande(int) from anon, authenticated;

-- Les relevés Cledor ouverts un mercredi portaient le libellé du dimanche :
-- l'accueil l'écrivait en dur. Les deux créneaux n'ont pas le même volume
-- (le vendredi couvre le week-end), la prévision doit pouvoir les distinguer.
update cmd_sessions s
set libelle = 'Mercredi pour vendredi'
from cmd_fournisseurs f
where f.id = s.fournisseur_id
  and f.frequence = 'bi-hebdo'
  and s.libelle = 'Dimanche pour mardi'
  and extract(dow from s.date_commande) in (3, 4, 5, 6)
  and not exists (
    select 1 from cmd_sessions d
    where d.fournisseur_id = s.fournisseur_id
      and d.date_commande = s.date_commande
      and d.libelle = 'Mercredi pour vendredi'
  );
