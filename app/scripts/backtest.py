"""Rejoue l'historique et mesure ce que l'application aurait proposé.

Pour chaque relevé, on reconstruit la prévision à partir des seuls relevés
antérieurs, on la confronte à la commande réellement passée, puis à la
consommation effectivement constatée sur la période suivante.

Deux méthodes sont comparées : une moyenne par période, et la même moyenne
ramenée au jour puis reprojetée sur la durée réelle jusqu'à la livraison
suivante — c'est la seconde qui est en service.

Une précision de lecture : la ligne « reel » affiche 0 % de ruptures par
construction, pas par mérite. La consommation est déduite du stock livré, donc
elle ne peut jamais dépasser ce qui a été commandé. Seul le chiffre des
méthodes prédictives a un sens : il compte les cas où la quantité proposée
serait passée sous ce que le restaurant a réellement consommé.

Usage : SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… MARGE=0.5 python3 scripts/backtest.py
"""
import os, statistics, datetime, requests
from collections import defaultdict
URL=os.environ['SUPABASE_URL'].rstrip('/'); KEY=os.environ['SUPABASE_SERVICE_ROLE_KEY']
H={'apikey':KEY,'Authorization':f'Bearer {KEY}'}
def page(t, sel):
    out=[]; off=0
    while True:
        r=requests.get(f'{URL}/rest/v1/{t}',params={'select':sel,'limit':1000,'offset':off},headers=H,timeout=180).json()
        out+=r
        if len(r)<1000: break
        off+=1000
    return out
hist=page('cmd_historique','produit_id,session_id,date_commande,stock,colis,conso')
prods={p['id']:p for p in page('cmd_produits','id,zone_id,fact')}
sess={s['id']:s for s in page('cmd_sessions','id,fournisseur_id,date_commande')}
four={f['id']:f['nom'] for f in page('cmd_fournisseurs','id,nom')}
def f(x): return None if x is None else float(x)
par=defaultdict(list)
for h in hist: par[h['produit_id']].append(h)
for k in par: par[k].sort(key=lambda h:(h['date_commande'],h['session_id']))
D=lambda s: datetime.date.fromisoformat(s)

def moy(vals):
    n=len(vals)
    if n==0: return 0.0
    if n<3: return max(0.0,sum(vals)/n)
    return max(0.0, 0.6*sum(vals[-4:])/len(vals[-4:]) + 0.4*sum(vals[-8:])/len(vals[-8:]))

def sugg(conso, stock, fact, marge):
    fa=fact if fact>0 else 1; s=stock or 0
    b=conso*(1+marge)-s
    if b<=0: return 0
    c=max(1,round(b/fa))
    while s+c*fa<conso and c<999: c+=1
    return c

MARGE=float(os.environ.get('MARGE','0.5'))
stat=defaultdict(lambda: defaultdict(lambda: {'n':0,'exact':0,'pm1':0,'rup':0,'sur':[]}))
for pid, pts in par.items():
    fact=float(prods[pid]['fact'] or 1)
    par_periode=[]; par_jour=[]
    for i,p in enumerate(pts):
        stock=f(p['stock']); reel=f(p['colis']) or 0.0
        suite=f(pts[i+1]['conso']) if i+1<len(pts) else None
        jours_suite=(D(pts[i+1]['date_commande'])-D(p['date_commande'])).days if i+1<len(pts) else None
        if stock is not None and i>0 and suite is not None and suite>0 and jours_suite:
            k=four[sess[p['session_id']]['fournisseur_id']]
            props={'periode': sugg(moy(par_periode), stock, fact, MARGE),
                   'jour': sugg(moy(par_jour)*jours_suite, stock, fact, MARGE),
                   'reel': reel}
            for nom,prop in props.items():
                for cle in (k,'TOTAL'):
                    r=stat[nom][cle]; r['n']+=1
                    if prop==reel: r['exact']+=1
                    if abs(prop-reel)<=1: r['pm1']+=1
                    if stock+prop*fact<suite: r['rup']+=1
                    r['sur'].append((stock+prop*fact-suite)/suite)
        c=f(p['conso'])
        if c is not None and i>0:
            j=(D(p['date_commande'])-D(pts[i-1]['date_commande'])).days or 1
            par_periode.append(c); par_jour.append(c/j)

print(f"marge {MARGE:.0%}")
print(f"{'méthode':10s} {'fournisseur':17s} {'lignes':>7s} {'exact':>7s} {'±1':>6s} {'ruptures':>9s} {'surplus méd.':>13s}")
for nom in ('periode','jour','reel'):
    for cle in ('GLD','France Boissons','Cledor','TOTAL'):
        r=stat[nom][cle]
        if not r['n']: continue
        print(f"{nom:10s} {cle:17s} {r['n']:7d} {r['exact']/r['n']:6.0%} {r['pm1']/r['n']:5.0%} "
              f"{r['rup']/r['n']:8.0%} {statistics.median(r['sur']):+12.0%}")
    print()
