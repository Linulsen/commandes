-- Inventaire : les articles retirés de la carte restent à compter
-- (demandé par Nicolas le 12/10/2026).
--
-- Avant : un article retiré n'apparaissait à l'inventaire que s'il avait du
-- stock au dernier inventaire clôturé. Comme aucun inventaire n'avait encore
-- été clôturé, les 28 articles retirés n'apparaissaient nulle part.
--
-- Maintenant, un article retiré apparaît (dans son lieu habituel) :
--   - s'il avait du stock au dernier inventaire clôturé ;
--   - ou s'il a été retiré après ce dernier inventaire clôturé (ou s'il n'y en
--     a encore aucun) : il n'a pas encore été compté depuis son retrait.
-- Un article retiré compté à 0 dans un inventaire clôturé disparaît ensuite.
--
-- Inventaire seulement : relevés, commandes et bons de commande ne lisent pas
-- cette vue et continuent d'ignorer les articles retirés.

create or replace view inv_produits_attendus as
with dernier as (
  select id, cloture_le from inv_inventaires where statut = 'cloture'
  order by date_inventaire desc, cloture_le desc limit 1
), en_stock as (
  select s.produit_id from inv_saisies s
  where s.inventaire_id = (select id from dernier)
  group by s.produit_id having sum(s.total) > 0
), visibles as (
  select p.* from cmd_produits p
  where p.actif
     or p.id in (select produit_id from en_stock)
     or not exists (select 1 from dernier)
     or p.retire_le is null
     or p.retire_le > (select cloture_le from dernier)
)
select v.id as produit_id, coalesce(v.lieu_id, v.zone_id) as zone_id, true as principal
from visibles v
union
select v.id, e.zone_id, false
from visibles v join cmd_produit_emplacements e on e.produit_id = v.id
where e.zone_id <> coalesce(v.lieu_id, v.zone_id);

comment on view inv_produits_attendus is
  'Produits à compter à l''inventaire, par lieu (principal ou secondaire) : actifs, retirés avec du stock au dernier inventaire clôturé, et retirés depuis.';
alter view inv_produits_attendus set (security_invoker = true);
