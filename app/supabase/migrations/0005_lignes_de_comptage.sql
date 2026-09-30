-- Lignes de comptage rattachées à un autre produit.
--
-- Cledor livre les sucrines en sachets de 3 et en sachets de 6, mais on ne les
-- commande qu'en sachets de 3. On compte donc les deux formats sur deux lignes
-- du relevé, et seule la ligne « sachet de 3 » calcule et commande : le stock
-- de la ligne « sachet de 6 » s'y ajoute, converti (1 sachet de 6 = 2 sachets
-- de 3).
--
-- Une ligne de comptage porte `compte_pour` (le produit qu'elle complète) et
-- `equivalence` (combien d'unités de ce produit vaut une de ses unités). Elle
-- n'est jamais commandée. Tout le calcul de consommation du produit principal
-- se fait sur son stock total, ligne de comptage comprise, et les pertes
-- déclarées sur la ligne de comptage s'y ajoutent de la même façon.

alter table cmd_produits
  add column if not exists compte_pour int references cmd_produits(id) on delete set null,
  add column if not exists equivalence numeric;
comment on column cmd_produits.compte_pour is
  'Ligne de comptage seulement : produit dont ce stock complète le relevé (ex. sucrines en sachet de 6 → sucrines en sachet de 3). Jamais commandée.';
comment on column cmd_produits.equivalence is
  'Pour une ligne de comptage : nombre d''unités du produit principal que vaut une unité de cette ligne (ex. 2 : un sachet de 6 = deux sachets de 3).';

create or replace view cmd_historique as
with livraisons as (
  select r.session_id, rl.produit_id,
         coalesce(sum(rl.unites) filter (where rl.recu), 0::numeric) as unites
  from cmd_receptions r
  join cmd_reception_lignes rl on rl.reception_id = r.id
  where r.type = 'livraison' and r.statut = 'validee'
  group by r.session_id, rl.produit_id
), receptionnees as (
  select session_id from cmd_receptions
  where type = 'livraison' and statut = 'validee'
), rattachees as (
  -- Ce que les lignes de comptage ajoutent au produit principal, par relevé.
  select lc.session_id, pc.compte_pour as produit_id,
         sum(lc.stock * pc.equivalence) filter (where lc.stock is not null) as stock,
         sum(lc.perte * pc.equivalence) filter (where lc.perte is not null) as perte
  from cmd_lignes lc
  join cmd_produits pc on pc.id = lc.produit_id
  where pc.compte_pour is not null and pc.equivalence is not null
  group by lc.session_id, pc.compte_pour
), base as (
  select l.produit_id,
         s.id as session_id,
         s.fournisseur_id,
         s.date_commande,
         s.libelle,
         s.statut,
         case when l.stock is null and ra.stock is null then null
              else coalesce(l.stock, 0) + coalesce(ra.stock, 0) end as stock,
         l.colis,
         l.conso_manuelle,
         p.fact,
         case when l.perte is null and ra.perte is null then null
              else coalesce(l.perte, 0) + coalesce(ra.perte, 0) end as perte,
         case when s.id in (select session_id from receptionnees)
              then coalesce(lv.unites, 0::numeric)
              else coalesce(l.colis, 0::numeric) * p.fact end as livre
  from cmd_lignes l
  join cmd_sessions s on s.id = l.session_id
  join cmd_produits p on p.id = l.produit_id
  left join livraisons lv on lv.session_id = s.id and lv.produit_id = l.produit_id
  left join rattachees ra on ra.session_id = l.session_id and ra.produit_id = l.produit_id
), fenetre as (
  select b.*,
         b.stock + b.livre as total,
         lag(b.stock + b.livre) over w as total_precedent,
         lag(b.date_commande) over w as date_precedente,
         lag(b.libelle) over w as libelle_precedent,
         lag(b.colis) over w as colis_precedent
  from base b
  window w as (partition by b.produit_id order by b.date_commande, b.session_id)
), avec_depannages as (
  select f.*,
         coalesce((
           select sum(rl.unites)
           from cmd_reception_lignes rl
           join cmd_receptions r on r.id = rl.reception_id
           where r.type = 'depannage' and r.statut = 'validee' and rl.recu
             and rl.produit_id = f.produit_id
             and r.date_reception >= f.date_precedente
             and r.date_reception < f.date_commande
         ), 0::numeric) as depannage
  from fenetre f
)
select produit_id, session_id, fournisseur_id, date_commande, libelle, statut,
       stock, colis, conso_manuelle, fact, total, total_precedent,
       coalesce(total_precedent + depannage - coalesce(perte, 0::numeric) - stock, conso_manuelle) as conso,
       perte, livre, depannage, date_precedente, libelle_precedent, colis_precedent
from avec_depannages;

alter view public.cmd_historique set (security_invoker = true);
