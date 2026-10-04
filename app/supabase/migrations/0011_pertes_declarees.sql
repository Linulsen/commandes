-- Pertes déclarées au fil de l'eau.
--
-- Jusqu'ici, un produit jeté ne se déclarait que dans le relevé (« Jeté depuis
-- le dernier relevé », colonne cmd_lignes.perte). Nicolas veut pouvoir le
-- déclarer au moment où on jette, comme un dépannage mais en négatif : une
-- « perte » est une réception de type 'perte', datée, sans commande, dont les
-- quantités sont en unités de stock.
--
-- Effet sur la consommation : une perte validée, datée entre deux relevés,
-- s'ajoute au « jeté » de la période. Elle sort donc de la consommation, comme
-- le jeté du relevé : ce qui part à la poubelle n'a pas été servi, et la
-- prévision ne doit pas en recommander davantage.
--
--   consommé = stock précédent + livré + dépannages − jeté − pertes − stock actuel
--
-- Même fenêtre que les dépannages : date_precedente <= date < date du relevé.
-- Une perte saisie sur une ligne de comptage est convertie (× équivalence).
-- La colonne `perte` de la vue additionne désormais le jeté du relevé et les
-- pertes déclarées, pour que l'historique affiche le total jeté.

alter table cmd_receptions drop constraint if exists cmd_receptions_type_check;
alter table cmd_receptions
  add constraint cmd_receptions_type_check
  check (type in ('livraison', 'depannage', 'perte'));

alter table cmd_receptions drop constraint if exists cmd_receptions_check;
alter table cmd_receptions
  add constraint cmd_receptions_check
  check (type <> 'livraison' or session_id is not null);

comment on table cmd_receptions is
  'Mouvements de stock hors relevé. Une livraison répond à une commande (session) ; un dépannage est un achat d''urgence hors commande (Metro, un confrère…) ; une perte est ce qui a été jeté (DLC dépassée, produit abîmé…). Dépannages et pertes sont datés et comptent dans la période où ils ont eu lieu.';
comment on column cmd_receptions.provenance is
  'Dépannage : où il a été acheté (Metro…). Perte : le motif (DLC dépassée, abîmé…).';

create or replace view cmd_historique as
with livraisons as (
  select r.session_id,
         coalesce(pr.compte_pour, rl.produit_id) as produit_id,
         coalesce(sum(rl.unites *
           case when pr.compte_pour is not null then coalesce(pr.equivalence, 1::numeric)
                else 1::numeric end) filter (where rl.recu), 0::numeric) as unites
    from cmd_receptions r
    join cmd_reception_lignes rl on rl.reception_id = r.id
    join cmd_produits pr on pr.id = rl.produit_id
   where r.type = 'livraison' and r.statut = 'validee'
   group by r.session_id, coalesce(pr.compte_pour, rl.produit_id)
), receptionnees as (
  select session_id from cmd_receptions
   where type = 'livraison' and statut = 'validee'
), rattachees as (
  select lc.session_id,
         pc.compte_pour as produit_id,
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
              then coalesce(lv.unites, 0)
              else coalesce(l.colis, 0) * p.fact end as livre
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
           select sum(rl.unites *
                    case when pr.compte_pour is not null then coalesce(pr.equivalence, 1::numeric)
                         else 1::numeric end)
             from cmd_reception_lignes rl
             join cmd_receptions r on r.id = rl.reception_id
             join cmd_produits pr on pr.id = rl.produit_id
            where r.type = 'depannage' and r.statut = 'validee' and rl.recu
              and coalesce(pr.compte_pour, rl.produit_id) = f.produit_id
              and r.date_reception >= f.date_precedente
              and r.date_reception < f.date_commande
         ), 0::numeric) as depannage,
         coalesce((
           select sum(rl.unites *
                    case when pr.compte_pour is not null then coalesce(pr.equivalence, 1::numeric)
                         else 1::numeric end)
             from cmd_reception_lignes rl
             join cmd_receptions r on r.id = rl.reception_id
             join cmd_produits pr on pr.id = rl.produit_id
            where r.type = 'perte' and r.statut = 'validee' and rl.recu
              and coalesce(pr.compte_pour, rl.produit_id) = f.produit_id
              and r.date_reception >= f.date_precedente
              and r.date_reception < f.date_commande
         ), 0::numeric) as pertes_declarees
    from fenetre f
), avec_pertes as (
  select a.*,
         case when a.perte is null and a.pertes_declarees = 0 then null
              else coalesce(a.perte, 0) + a.pertes_declarees end as perte_totale
    from avec_depannages a
)
select produit_id, session_id, fournisseur_id, date_commande, libelle, statut,
       stock, colis, conso_manuelle, fact, total, total_precedent,
       coalesce(total_precedent + depannage - coalesce(perte_totale, 0::numeric) - stock,
                conso_manuelle) as conso,
       perte_totale as perte,
       livre, depannage, date_precedente, libelle_precedent, colis_precedent
  from avec_pertes;

alter view public.cmd_historique set (security_invoker = true);
