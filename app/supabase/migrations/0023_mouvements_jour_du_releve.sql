-- Mouvements (dépannages, retours, pertes déclarées, prêts et rendus Del Arte)
-- datés du jour même d'un relevé (25/10/2026, demandé par Nicolas).
--
-- Jusqu'ici, un mouvement comptait dans la période « date du relevé précédent
-- incluse, date du relevé exclue » : un dépannage daté du jour du relevé était
-- toujours renvoyé à la période suivante, comme s'il était arrivé après le
-- comptage. Le 25/10, 4 sachets d'épinards Grand Frais saisis à 16:18, avant le
-- comptage Cledor du même jour, donnaient « stock impossible ».
--
-- Nouvelle règle, pour un mouvement daté du jour d'un relevé : il compte dans
-- ce relevé s'il a été saisi (created_at) avant que le stock du produit y soit
-- enregistré (cmd_lignes.stock_saisi_le, ou pas encore enregistré), sinon dans le
-- relevé suivant. On ne se fie pas à l'ouverture du relevé : chez Logistimax,
-- le relevé suivant est créé dès la validation du précédent, une semaine avant.
-- Les mouvements datés d'autres jours ne changent pas de période.
--
-- L'heure de saisie du stock est gardée dans une colonne à part
-- (cmd_lignes.stock_saisi_le), mise à jour seulement quand le stock change :
-- maj_le bouge aussi quand on corrige le nombre de colis. Pour les relevés
-- déjà faits, elle part de maj_le (seule heure connue).

alter table cmd_lignes add column if not exists stock_saisi_le timestamptz;

update cmd_lignes set stock_saisi_le = maj_le
where stock is not null and stock_saisi_le is null;

create or replace function cmd_lignes_stock_saisi_le() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.stock is not null then new.stock_saisi_le := now(); end if;
  elsif new.stock is distinct from old.stock then
    new.stock_saisi_le := case when new.stock is null then null else now() end;
  end if;
  return new;
end $$;

drop trigger if exists cmd_lignes_stock_saisi_le on cmd_lignes;
create trigger cmd_lignes_stock_saisi_le
  before insert or update on cmd_lignes
  for each row execute function cmd_lignes_stock_saisi_le();

create or replace view cmd_historique as
with livraisons as (
  select r.session_id,
    coalesce(pr.compte_pour, rl.produit_id) as produit_id,
    coalesce(sum(rl.unites *
      case when pr.compte_pour is not null then coalesce(pr.equivalence, 1::numeric) else 1::numeric end)
      filter (where rl.recu), 0::numeric) as unites
  from cmd_receptions r
    join cmd_reception_lignes rl on rl.reception_id = r.id
    join cmd_produits pr on pr.id = rl.produit_id
  where r.type = 'livraison' and r.statut = 'validee'
  group by r.session_id, coalesce(pr.compte_pour, rl.produit_id)
), receptionnees as (
  select cmd_receptions.session_id
  from cmd_receptions
  where cmd_receptions.type = 'livraison' and cmd_receptions.statut = 'validee'
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
    case
      when l.stock is null and ra.stock is null then null::numeric
      else coalesce(l.stock, 0::numeric) + coalesce(ra.stock, 0::numeric)
    end as stock,
    l.colis,
    l.conso_manuelle,
    p.fact,
    case
      when l.perte is null and ra.perte is null then null::numeric
      else coalesce(l.perte, 0::numeric) + coalesce(ra.perte, 0::numeric)
    end as perte,
    case
      when s.id in (select receptionnees.session_id from receptionnees) then coalesce(lv.unites, 0::numeric)
      else coalesce(l.colis, 0::numeric) * p.fact
    end as livre,
    -- Heure où le stock du produit a été enregistré à ce relevé (null : pas
    -- encore saisi).
    case when l.stock is not null then coalesce(l.stock_saisi_le, l.maj_le) end as stock_saisi_le
  from cmd_lignes l
    join cmd_sessions s on s.id = l.session_id
    join cmd_produits p on p.id = l.produit_id
    left join livraisons lv on lv.session_id = s.id and lv.produit_id = l.produit_id
    left join rattachees ra on ra.session_id = l.session_id and ra.produit_id = l.produit_id
), fenetre as (
  select b.produit_id,
    b.session_id,
    b.fournisseur_id,
    b.date_commande,
    b.libelle,
    b.statut,
    b.stock,
    b.colis,
    b.conso_manuelle,
    b.fact,
    b.perte,
    b.livre,
    b.stock_saisi_le,
    b.stock + b.livre as total,
    lag(b.stock + b.livre) over w as total_precedent,
    lag(b.date_commande) over w as date_precedente,
    lag(b.libelle) over w as libelle_precedent,
    lag(b.colis) over w as colis_precedent,
    lag(b.stock_saisi_le) over w as stock_saisi_le_precedent
  from base b
  window w as (partition by b.produit_id order by b.date_commande, b.session_id)
), mouvements as (
  select r.type,
    r.date_reception,
    r.created_at,
    coalesce(pr.compte_pour, rl.produit_id) as produit_id,
    rl.unites *
      case when pr.compte_pour is not null then coalesce(pr.equivalence, 1::numeric) else 1::numeric end as q
  from cmd_reception_lignes rl
    join cmd_receptions r on r.id = rl.reception_id
    join cmd_produits pr on pr.id = rl.produit_id
  where r.type <> 'livraison' and r.statut = 'validee' and rl.recu
), dans_periode as (
  -- Pour chaque relevé, les mouvements de sa période : après le relevé
  -- précédent, jusqu'au comptage de celui-ci.
  select f.produit_id, f.session_id, m.type, m.q
  from fenetre f
    join mouvements m on m.produit_id = f.produit_id
  where
    (m.date_reception > f.date_precedente
      or (m.date_reception = f.date_precedente
          and f.stock_saisi_le_precedent is not null
          and m.created_at >= f.stock_saisi_le_precedent))
    and
    (m.date_reception < f.date_commande
      or (m.date_reception = f.date_commande
          and (f.stock_saisi_le is null or m.created_at < f.stock_saisi_le)))
), sommes as (
  select produit_id, session_id,
    sum(q) filter (where type in ('depannage', 'retour')) as depannage,
    sum(q) filter (where type = 'perte') as pertes_declarees,
    sum(q) filter (where type in ('pret', 'rendu')) as sorties_del_arte
  from dans_periode
  group by produit_id, session_id
), avec_depannages as (
  select f.produit_id,
    f.session_id,
    f.fournisseur_id,
    f.date_commande,
    f.libelle,
    f.statut,
    f.stock,
    f.colis,
    f.conso_manuelle,
    f.fact,
    f.perte,
    f.livre,
    f.total,
    f.total_precedent,
    f.date_precedente,
    f.libelle_precedent,
    f.colis_precedent,
    coalesce(so.depannage, 0::numeric) as depannage,
    coalesce(so.pertes_declarees, 0::numeric) as pertes_declarees,
    coalesce(so.sorties_del_arte, 0::numeric) as sorties_del_arte
  from fenetre f
    left join sommes so on so.produit_id = f.produit_id and so.session_id = f.session_id
), avec_pertes as (
  select a.*,
    case
      when a.perte is null and a.pertes_declarees = 0::numeric then null::numeric
      else coalesce(a.perte, 0::numeric) + a.pertes_declarees
    end as perte_totale
  from avec_depannages a
)
select produit_id,
  session_id,
  fournisseur_id,
  date_commande,
  libelle,
  statut,
  stock,
  colis,
  conso_manuelle,
  fact,
  total,
  total_precedent,
  coalesce(total_precedent + depannage - coalesce(perte_totale, 0::numeric) - sorties_del_arte - stock, conso_manuelle) as conso,
  perte_totale as perte,
  livre,
  depannage,
  date_precedente,
  libelle_precedent,
  colis_precedent,
  sorties_del_arte
from avec_pertes;
