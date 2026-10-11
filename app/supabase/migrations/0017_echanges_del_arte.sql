-- Échanges de marchandise avec les autres restaurants Del Arte.
--
-- Un dépannage chez Metro est un achat : la marchandise est à nous. Un
-- dépannage chez un autre Del Arte est un prêt : la marchandise entre en stock
-- et compte dans la consommation comme un dépannage, mais elle reste due, et
-- devra être rendue. Nicolas veut aussi suivre l'inverse, ce que nous prêtons.
--
-- Quatre mouvements, tous dans cmd_receptions, avec le restaurant dans
-- `del_arte` :
--   · depannage + del_arte : ils nous prêtent (entrée, comme un dépannage) ;
--   · rendu  : nous leur rendons (sortie) ;
--   · pret   : nous leur prêtons (sortie) ;
--   · retour : ils nous rendent (entrée).
--
-- Consommation : prêts et rendus sortent de la chambre sans être consommés,
-- retours y entrent sans être achetés. Même fenêtre que les dépannages
-- (date du relevé précédent incluse, date du relevé exclue) :
--   consommé = stock précédent + livré + dépannages + retours
--              − jeté − pertes − prêts − rendus − stock actuel
--
-- Soldes (vue cmd_del_arte_soldes), par restaurant et par produit :
--   · nous_devons  = emprunts − rendus : quantité réservée dans notre stock, à
--     retirer du stock disponible pour la prévision tant qu'elle n'est pas
--     rendue (elle est donc recommandée à chaque commande) ;
--   · ils_doivent  = prêts − retours : pas comptée dans notre stock ; au relevé
--     on demande si l'on compte sur leur retour (cmd_lignes.retour_attendu).
-- Le rendu partiel est un rendu d'une quantité moindre : le reste reste dû.

alter table cmd_receptions add column if not exists del_arte text;
comment on column cmd_receptions.del_arte is
  'Restaurant Del Arte concerné par un échange (Del Arte Vaulx en Velin, Dardilly, Brignais). Vide pour un dépannage en magasin.';

alter table cmd_receptions drop constraint if exists cmd_receptions_type_check;
alter table cmd_receptions
  add constraint cmd_receptions_type_check
  check (type in ('livraison', 'depannage', 'perte', 'pret', 'rendu', 'retour'));

alter table cmd_receptions drop constraint if exists cmd_receptions_del_arte_check;
alter table cmd_receptions
  add constraint cmd_receptions_del_arte_check
  check (type not in ('pret', 'rendu', 'retour') or del_arte is not null);

alter table cmd_lignes add column if not exists retour_attendu numeric;
comment on column cmd_lignes.retour_attendu is
  'Relevé : quantité qu''un autre Del Arte nous doit et dont on attend le retour cette semaine (ajoutée au stock pour la proposition). Null : question pas encore posée ; 0 : commander selon la préconisation.';

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
), mouvements as (
  -- Mouvements hors commande validés, convertis en unités du produit principal.
  select r.type,
         r.date_reception,
         coalesce(pr.compte_pour, rl.produit_id) as produit_id,
         rl.unites * case when pr.compte_pour is not null
                          then coalesce(pr.equivalence, 1::numeric) else 1::numeric end as q
    from cmd_reception_lignes rl
    join cmd_receptions r on r.id = rl.reception_id
    join cmd_produits pr on pr.id = rl.produit_id
   where r.type <> 'livraison' and r.statut = 'validee' and rl.recu
), avec_depannages as (
  select f.*,
         coalesce((select sum(m.q) from mouvements m
                    where m.type in ('depannage', 'retour')
                      and m.produit_id = f.produit_id
                      and m.date_reception >= f.date_precedente
                      and m.date_reception < f.date_commande), 0::numeric) as depannage,
         coalesce((select sum(m.q) from mouvements m
                    where m.type = 'perte'
                      and m.produit_id = f.produit_id
                      and m.date_reception >= f.date_precedente
                      and m.date_reception < f.date_commande), 0::numeric) as pertes_declarees,
         coalesce((select sum(m.q) from mouvements m
                    where m.type in ('pret', 'rendu')
                      and m.produit_id = f.produit_id
                      and m.date_reception >= f.date_precedente
                      and m.date_reception < f.date_commande), 0::numeric) as sorties_del_arte
    from fenetre f
), avec_pertes as (
  select a.*,
         case when a.perte is null and a.pertes_declarees = 0 then null
              else coalesce(a.perte, 0) + a.pertes_declarees end as perte_totale
    from avec_depannages a
)
select produit_id, session_id, fournisseur_id, date_commande, libelle, statut,
       stock, colis, conso_manuelle, fact, total, total_precedent,
       coalesce(total_precedent + depannage - coalesce(perte_totale, 0::numeric)
                - sorties_del_arte - stock,
                conso_manuelle) as conso,
       perte_totale as perte,
       livre, depannage, date_precedente, libelle_precedent, colis_precedent,
       sorties_del_arte
  from avec_pertes;

alter view public.cmd_historique set (security_invoker = true);

create or replace view cmd_del_arte_soldes with (security_invoker = true) as
select r.del_arte,
       coalesce(pr.compte_pour, rl.produit_id) as produit_id,
       sum(case r.type when 'depannage' then 1 when 'rendu' then -1 else 0 end
           * rl.unites * case when pr.compte_pour is not null
                              then coalesce(pr.equivalence, 1::numeric) else 1::numeric end)
         as nous_devons,
       sum(case r.type when 'pret' then 1 when 'retour' then -1 else 0 end
           * rl.unites * case when pr.compte_pour is not null
                              then coalesce(pr.equivalence, 1::numeric) else 1::numeric end)
         as ils_doivent
  from cmd_receptions r
  join cmd_reception_lignes rl on rl.reception_id = r.id
  join cmd_produits pr on pr.id = rl.produit_id
 where r.del_arte is not null and r.statut = 'validee' and rl.recu
 group by r.del_arte, coalesce(pr.compte_pour, rl.produit_id);

comment on view cmd_del_arte_soldes is
  'Ce que nous devons à chaque Del Arte (emprunts − rendus) et ce qu''il nous doit (prêts − retours), par produit, en unités de stock du produit principal.';

revoke all on cmd_del_arte_soldes from anon, authenticated;
