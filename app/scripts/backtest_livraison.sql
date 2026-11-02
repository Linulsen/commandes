-- Rejeu de l'historique, directement dans la base (SQL Editor de Supabase).
-- 02/11/2026 : compare le calcul du 25/10 (marge +50 % sur tout l'horizon) à la
-- règle en service depuis le 02/11 (stock ramené au jour de livraison, jamais
-- sous zéro ; marge sur la période livrée ; +20 % pour les produits réguliers).
-- Critère : la livraison tient-elle jusqu'à la livraison suivante ?
-- (stock restant au jour de livraison + livré >= consommation jusqu'à la suivante)
-- Résultat au 02/11/2026 (4 132 commandes) :
--   actuel 15 538 colis, 6,1 % de manques ; nouvelle règle 10 971 colis, 9,8 % ;
--   commandes réellement passées 10 159 colis, 8,2 %.
with h as (
 select h.produit_id pid, h.session_id sid, h.date_commande::date d, h.stock::float8 stock, h.colis::float8 colis, h.conso::float8 conso, s.fournisseur_id fid,
   row_number() over (partition by h.produit_id order by h.date_commande, h.session_id) idx
 from cmd_historique h join cmd_sessions s on s.id=h.session_id),
h2 as (select h.*, lag(d) over w dprev, lead(d) over w dnext, lead(sid) over w sidnext, lead(conso) over w consonext,
   lead(d,2) over w dnext2, lead(conso,2) over w consonext2
 from h window w as (partition by pid order by idx)),
r as (select h2.*, case when idx>1 and conso is not null then conso/greatest(1,(d-dprev)) end rate from h2),
rv as (select r.*, case when rate is not null then count(rate) over (partition by pid order by idx) end vn from r),
dl as (select distinct on (s.id) s.id sid, (rc.date_reception::date - s.date_commande::date) delai
  from cmd_receptions rc join cmd_sessions s on s.id=rc.session_id where rc.type='livraison' and rc.statut='validee'),
cases as (
 select p.pid, p.fid, p.stock s, coalesce(p.colis,0) reel, greatest(pr.fact::float8,1) f,
  coalesce(dl.delai, case when p.fid=1 then 3 else 2 end) dd, (p.dnext-p.d) j, greatest(1,p.dnext2-p.dnext) japres,
  p.consonext, p.consonext2, st.*
 from rv p join cmd_produits pr on pr.id=p.pid left join dl on dl.sid=p.sidnext
 cross join lateral (
   select count(*) nb,
     avg(x.rate) filter (where x.vn > q.mx-4) m4, avg(x.rate) filter (where x.vn > q.mx-8) m8, avg(x.rate) mall,
     case when count(*) filter (where x.vn>q.mx-8)>=3 and avg(x.rate) filter (where x.vn>q.mx-8)>0
       then stddev_samp(x.rate) filter (where x.vn>q.mx-8)/avg(x.rate) filter (where x.vn>q.mx-8) end cv
   from rv x, (select coalesce(max(vn),0) mx from rv y where y.pid=p.pid and y.idx<p.idx) q
   where x.pid=p.pid and x.idx<p.idx and x.rate is not null) st
 where p.stock is not null and p.idx>1 and p.consonext>0 and p.dnext>p.d and p.consonext2 is not null and p.dnext - p.d > 2),
c2 as (select c.*, case when nb=0 then 0 when nb<3 then greatest(0,mall) else greatest(0,0.6*m4+0.4*m8) end rt,
   (nb>=6 and cv<0.4) bonne,
   greatest(0, s - consonext*dd/j) s_liv,
   consonext*(j-dd)/j + greatest(0,consonext2/japres)*dd besoin_liv from cases c),
v(nom, mode, m, mb) as (values ('Avant (25/10)','A',0.5,0.5),('Règle du 02/11','B',0.5,0.2)),
calc as (select v.nom, c2.*,
   case when v.mode='A' then rt*(j+dd)*(1+case when bonne then v.mb else v.m end) - s
        else rt*j*(1+case when bonne then v.mb else v.m end) - greatest(0, s - rt*dd) end b,
   case when v.mode='A' then rt*(j+dd) - s else rt*j - greatest(0, s - rt*dd) end fl
 from c2 cross join v),
prop as (select calc.*, case when b<=0 then 0 else greatest(greatest(1,round((b/f)::numeric)::float8), ceil(fl/f)) end p from calc
 union all select 'Commandes réelles', c2.*, 0, 0, reel from c2)
select nom, count(*) n, round(100.0*avg((s_liv+p*f<besoin_liv)::int),1) manques_pct, sum(p)::int colis
from prop group by nom order by nom;
