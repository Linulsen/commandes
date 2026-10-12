-- Stock impossible au relevé (demandé par Nicolas le 12/10/2026).
--
-- Une consommation négative n'existe pas : si l'on compte plus qu'il ne
-- pouvait rester (stock du relevé précédent + livraison + dépannages et
-- retours − prêts, rendus et pertes déclarées), c'est qu'une saisie est fausse
-- ou qu'une entrée n'a pas été enregistrée. Le relevé pose alors la question
-- avant de laisser valider.
--
-- `cmd_commande` renvoie pour chaque produit ce `plafond` (null si le produit
-- n'a pas de relevé précédent). `cmd_lignes.stock_verifie` garde le stock que
-- le chef a confirmé malgré tout : la question revient si le stock change.
-- Aucun calcul de commande ni l'historique ne changent.

alter table cmd_lignes
  add column if not exists stock_verifie numeric;
comment on column cmd_lignes.stock_verifie is
  'Stock (total, lignes de comptage comprises) confirmé au relevé alors qu''il dépassait le maximum possible.';

create or replace function public.cmd_commande(p_session_id integer)
 returns jsonb
 language sql
 stable
as $function$
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
-- Ce qui pouvait rester en chambre à ce relevé : tout ce qui est arrivé
-- depuis le précédent, moins ce qui est sorti sans être consommé. La perte
-- saisie sur la ligne elle-même est remise : le téléphone la retranche en
-- direct, elle peut changer pendant la saisie.
cur as (
  select
    hi.produit_id,
    hi.total_precedent + hi.depannage - hi.sorties_del_arte
      - coalesce(hi.perte, 0) + coalesce(l.perte, 0) as plafond
  from cmd_historique hi
  join p on p.id = hi.produit_id
  left join cmd_lignes l on l.session_id = hi.session_id and l.produit_id = hi.produit_id
  where hi.session_id = p_session_id
    and hi.total_precedent is not null
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
        'plafond',        c.plafond,
        'serie',          coalesce(se.points, '[]'::jsonb),
        'releves',        coalesce(se.releves, '[]'::jsonb)
      )
      order by (select zz.ordre from z zz where zz.id = p.zone_id), lower(p.nom)
    )
    from p
    left join cmd_lignes l on l.produit_id = p.id and l.session_id = p_session_id
    left join serie se on se.produit_id = p.id
    left join cur c on c.produit_id = p.id
  ), '[]'::jsonb)
)
where exists (select 1 from s);
$function$;
