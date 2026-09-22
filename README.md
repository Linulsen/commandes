# Praedic Commandes

Aide à la commande du restaurant : relevé des stocks chambre par chambre,
prévision des consommations, bon de commande prérempli et export PDF.
Remplace le classeur `Aide a la commande - <date>.xlsx`, dont il reprend
exactement le mode de calcul.

## Comment ça marche

Le classeur tenait, pour chaque produit, une colonne par semaine :
stock relevé, consommation, commande en colis, total après livraison. La
consommation n'y était jamais comptée, elle se déduisait :

```
consommation(t) = total après livraison(t-1) − stock relevé(t)
total(t)        = stock relevé(t) + colis commandés(t) × unités par colis
```

L'application garde ce modèle (vue `cmd_historique`) et y ajoute la prévision :
le rythme de consommation par jour de chaque produit, projeté sur la durée
jusqu'à la prochaine livraison, moins ce qui reste en chambre.

Depuis la deuxième passe, la consommation tient compte de ce qui s'est
réellement passé entre deux relevés :

```
consommation(t) = stock(t-1) + livré après t-1 + dépannages − jeté − stock(t)
```

« Livré » est la réception validée quand elle existe, sinon la commande telle
que passée (tout l'historique du classeur). Chez Cledor, livré deux fois par
semaine, la prévision ne regarde que les périodes du même créneau : celle du
vendredi couvre le week-end, celle du mardi non.

Les saisies sont d'abord écrites dans le téléphone, puis envoyées dès qu'il y a
du réseau (`src/lib/file-attente.ts`) ; un service worker (`public/sw.js`)
permet de rouvrir l'application hors ligne.

## Structure

| Chemin | Rôle |
| --- | --- |
| `app/src/lib/forecast.ts` | prévision et quantité suggérée |
| `app/src/lib/model.ts` | assemblage produits / historique / session |
| `app/src/app/commande/[id]` | écran de relevé, une chambre à la fois |
| `app/src/app/receptions`, `reception/[id]` | réceptions de livraison et dépannages |
| `app/src/lib/file-attente.ts` | saisies gardées hors ligne et renvoyées |
| `app/src/app/api/session/[id]/pdf` | bon de commande PDF |
| `app/supabase/migrations` | schéma de la base |
| `app/scripts/import_excel.py` | reprise du classeur |

## Reprendre un classeur

```sh
cd app
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  python3 scripts/import_excel.py "../Aide a la commande - 22.06.2026.xlsx" --reset
```

`--reset` efface les relevés existants avant de réimporter. Sans lui, l'import
complète les données en place.

## Développement

```sh
cd app
npm install
cp .env.example .env.local   # puis remplir les quatre variables
npm run dev
```
