-- Tout ce qu'il faut pour afficher un relevé, en un seul aller-retour.
--
-- L'application assemblait la page en huit requêtes enchaînées, dont quatre
-- rien que pour paginer les 3 571 relevés de GLD par tranches de mille. Chaque
-- aller-retour coûte sa latence, et ils s'additionnaient.
--
-- La pagination était aussi fausse : elle triait sur la seule date de commande,
-- qui n'est pas unique, si bien que deux pages successives ne voyaient pas le
-- même ordre. Sur GLD, 45 relevés revenaient en double et 45 n'étaient jamais
-- lus, ce qui décalait la prévision d'un produit sur deux.
--
-- La série rendue est bornée aux 26 derniers relevés par produit : la prévision
-- ne regarde que les huit derniers, et sans borne la page grossirait
-- indéfiniment au fil des semaines. `nb_releves` reste le compte réel, pour que
-- l'écran n'annonce pas moins d'historique qu'il n'en existe.
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
    l.produit_id,
    se.date_commande,
    l.stock,
    lag(l.stock + coalesce(l.colis, 0) * pr.fact)
      over (partition by l.produit_id order by se.date_commande, se.id) as total_precedent,
    lag(se.date_commande)
      over (partition by l.produit_id order by se.date_commande, se.id) as date_precedente,
    row_number()
      over (partition by l.produit_id order by se.date_commande desc, se.id desc) as rang
  from cmd_lignes l
  join cmd_sessions se on se.id = l.session_id
  join p pr on pr.id = l.produit_id
  where se.id <> p_session_id
    and se.date_commande <= (select date_commande from s)
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
          'conso', total_precedent - stock,
          'jours', greatest(1, date_commande - date_precedente)
        )
        order by date_commande
      ) filter (where rang <= 26 and total_precedent is not null),
      '[]'::jsonb
    ) as points
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
        'serie',          coalesce(se.points, '[]'::jsonb)
      )
      order by (select zz.ordre from z zz where zz.id = p.zone_id), p.ordre, p.nom
    )
    from p
    left join cmd_lignes l on l.produit_id = p.id and l.session_id = p_session_id
    left join serie se on se.produit_id = p.id
  ), '[]'::jsonb)
)
where exists (select 1 from s);
$$;

-- La fonction n'est appelée que par les routes serveur, avec la clé de service.
revoke execute on function public.cmd_commande(int) from anon, authenticated;
