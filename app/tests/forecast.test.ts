/**
 * Tests du calcul des propositions (app/src/lib/forecast.ts).
 *
 * Lancés avant chaque compilation (`npm run build`, donc à chaque déploiement
 * Vercel) : si l'un d'eux échoue, le déploiement échoue et la version en
 * service reste en ligne. Aucune dépendance à installer : Node exécute le
 * TypeScript directement (`node --experimental-strip-types --test`).
 *
 * Chaque cas vient d'une situation réelle du restaurant ou d'une règle
 * décidée avec Nicolas (dates entre parenthèses). Changer une règle de
 * calcul = mettre à jour le test correspondant ET `VERSION_CALCUL`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARGE_REGULIERS,
  VERSION_CALCUL,
  alerte,
  consoAnormalementBasse,
  couverture,
  delaiHabituel,
  horizonHabituel,
  joursEntre,
  prevoir,
  prevoirAvecReleveDuJour,
  stockDisponible,
  suggerer,
} from "../src/lib/forecast.ts";

type Point = { date: string; conso: number; jours: number; creneau?: string };

/** Série hebdomadaire : une consommation par semaine de 7 jours. */
const hebdo = (...consos: number[]): Point[] =>
  consos.map((conso, i) => ({ date: `s${i + 1}`, conso, jours: 7 }));

const proche = (reel: number, attendu: number, ecart = 0.01) =>
  assert.ok(Math.abs(reel - attendu) <= ecart, `${reel} au lieu de ${attendu}`);

// ---------------------------------------------------------------------------
// Quantité proposée (suggerer)
// ---------------------------------------------------------------------------

test("burrata, relevé Logistimax du 02/11/2026 : 7 cartons (et non 11)", () => {
  // 17 pots, ~7,1 par jour, carton de 8, lundi → jeudi (3 j), couverture 10 j,
  // produit régulier : marge ramenée à +20 %.
  const colis = suggerer(71, 17, 8, 0.5, true, { joursHorizon: 10, delai: 3, fiabilite: "bonne" });
  assert.equal(colis, 7);
});

test("crème épaisse, relevé du 02/11/2026 : 9 seaux (et non 16)", () => {
  const colis = suggerer(11, 1, 1, 0.5, true, { joursHorizon: 10, delai: 3, fiabilite: "bonne" });
  assert.equal(colis, 9);
});

test("le stock restant au jour de livraison ne descend jamais sous zéro (02/11/2026)", () => {
  // Stock 0 ou stock 2 : tout est consommé avant la livraison dans les deux
  // cas, la livraison doit donc couvrir exactement la même chose.
  const p = { joursHorizon: 10, delai: 3, fiabilite: "moyenne" as const };
  assert.equal(suggerer(30, 0, 1, 0.5, true, p), suggerer(30, 2, 1, 0.5, true, p));
});

test("le stock qui reste à la livraison est déduit", () => {
  // 1 par jour, 10 en stock : 7 restent au jeudi ; 7 jours à tenir × 1,5 = 10,5 → 3,5 → 4 colis de 1.
  const colis = suggerer(10, 10, 1, 0.5, true, { joursHorizon: 10, delai: 3, fiabilite: "moyenne" });
  assert.equal(colis, 4);
});

test("marge : +20 % au plus pour un produit régulier, la marge du relevé sinon", () => {
  const regulier = suggerer(100, 0, 1, 0.5, true, { joursHorizon: 10, delai: 3, fiabilite: "bonne" });
  const irregulier = suggerer(100, 0, 1, 0.5, true, { joursHorizon: 10, delai: 3, fiabilite: "moyenne" });
  assert.equal(regulier, Math.round(70 * (1 + MARGE_REGULIERS)));
  assert.equal(irregulier, Math.round(70 * 1.5));
});

test("arrondi : jamais sous la consommation prévue, on remonte d'un colis", () => {
  // 10 à couvrir, marge 10 % → 11 ; 11 / 8 = 1,4 → 1 colis = 8 < 10 → 2 colis.
  assert.equal(suggerer(10, 0, 8, 0.1), 2);
});

test("au moins 1 colis dès qu'il y a un besoin", () => {
  assert.equal(suggerer(2, 0, 24, 0.5), 1);
});

test("sécurité stock à 0 (12/10/2026) : 1 colis même si le rythme est tombé à 0", () => {
  // Glace pâte à tartiner : un relevé faux avait annulé la consommation.
  assert.equal(suggerer(0, 0, 4, 0.5, true), 1);
  // Mais rien pour un produit qui ne se vend plus.
  assert.equal(suggerer(0, 0, 4, 0.5, false), 0);
});

test("produit peu vendu : rien tant qu'il en reste (audit du 14/11/2026)", () => {
  // Une bouteille vendue en 2 mois, 1 en stock : aucune « commande fantôme ».
  assert.equal(suggerer(0.17, 1, 6, 0.5, true, { joursHorizon: 10, delai: 3, fiabilite: "faible" }), 0);
});

test("stock suffisant : 0 colis", () => {
  assert.equal(suggerer(10, 40, 6, 0.5, true, { joursHorizon: 10, delai: 3, fiabilite: "bonne" }), 0);
});

// ---------------------------------------------------------------------------
// Prévision (prevoir)
// ---------------------------------------------------------------------------

test("rythme : 60 % sur les 4 dernières périodes, 40 % sur les 8 dernières", () => {
  // 1 par jour pendant 4 semaines, puis 2 par jour : 0,6 × 2 + 0,4 × 1,5 = 1,8.
  const p = prevoir(hebdo(7, 7, 7, 7, 14, 14, 14, 14), undefined, undefined, undefined, 3);
  proche(p.consoParJour, 1.8);
  assert.equal(p.joursHorizon, 10); // 7 j entre relevés + 3 j de délai
  proche(p.consoPrevue, 18);
});

test("fiabilité : bonne, moyenne, faible, aucune", () => {
  assert.equal(prevoir(hebdo(10, 11, 9, 10, 10, 11)).fiabilite, "bonne");
  assert.equal(prevoir(hebdo(10, 11, 9, 10, 10)).fiabilite, "moyenne"); // 5 périodes seulement
  assert.equal(prevoir(hebdo(2, 20, 1, 25, 0, 30)).fiabilite, "faible"); // très irrégulier
  assert.equal(prevoir(hebdo(10)).fiabilite, "aucune");
});

test("une consommation négative (relevé faux) est gardée, pas effacée", () => {
  // −5 puis +25 : la fenêtre compense, la moyenne reste à 10 par semaine.
  const p = prevoir(hebdo(10, 10, -5, 25));
  proche(p.consoParJour, 10 / 7);
  assert.equal(p.anomalies, 1);
});

test("aConsomme : vendu sur au moins une des 8 dernières périodes", () => {
  assert.equal(prevoir(hebdo(5, 0, 0, 0, 0, 0, 0, 0, 0)).aConsomme, false);
  assert.equal(prevoir(hebdo(0, 0, 0, 0, 0, 0, 0, 3)).aConsomme, true);
});

test("Cledor : chaque créneau ne se compare qu'à lui-même dès 3 périodes", () => {
  // Dimanche → mardi : 3 jours à 2 par jour ; mercredi → vendredi : 4 jours à 5 par jour.
  const serie: Point[] = [];
  for (let i = 0; i < 4; i++) {
    serie.push({ date: `d${i}`, conso: 6, jours: 3, creneau: "dimanche" });
    serie.push({ date: `m${i}`, conso: 20, jours: 4, creneau: "mercredi" });
  }
  proche(prevoir(serie, 6, undefined, "mercredi").consoParJour, 5);
  proche(prevoir(serie, 5, undefined, "dimanche").consoParJour, 2);
});

test("délai de livraison : médiane des réceptions, 2 jours par défaut", () => {
  assert.equal(delaiHabituel([3, 3, 4, 3, 2]), 3);
  assert.equal(delaiHabituel([]), 2);
  assert.equal(delaiHabituel([NaN, -1]), 2);
});

test("intervalle habituel entre relevés : médiane des 6 derniers", () => {
  assert.equal(horizonHabituel(hebdo(1, 1, 1)), 7);
  assert.equal(horizonHabituel([]), 7);
});

// ---------------------------------------------------------------------------
// Relevé du jour, produits nouveaux
// ---------------------------------------------------------------------------

test("relevé du jour (19/10/2026) : la semaine qui s'achève compte tout de suite", () => {
  const base = { serie: hebdo(7, 7, 7, 7), nbPoints: 4, joursHorizon: 10 };
  const r = prevoirAvecReleveDuJour(base, undefined, {
    plafond: 30, stock: 2, perte: 0, jours: 7, creneau: null, verifie: false,
  });
  assert.ok(r);
  assert.ok(r.consoPrevue > 10, "la forte semaine en cours doit relever la prévision");
});

test("produit nouveau (17/10/2026) : la sortie depuis le dernier relevé sert de rythme", () => {
  // Mélange champignons-cèpes : aucun historique, 6 sacs sortis en 7 jours.
  const r = prevoirAvecReleveDuJour({ serie: [], nbPoints: 0, joursHorizon: 10 }, undefined, {
    plafond: 6, stock: 0, perte: 0, jours: 7, creneau: null, verifie: false,
  });
  assert.ok(r);
  proche(r.consoPrevue, (6 / 7) * 10);
  assert.equal(r.aConsomme, true);
});

test("stock impossible non tranché : le relevé du jour est ignoré", () => {
  const base = { serie: hebdo(7, 7, 7, 7), nbPoints: 4, joursHorizon: 10 };
  const enCours = { plafond: 10, stock: 15, perte: 0, jours: 7, creneau: null };
  assert.equal(prevoirAvecReleveDuJour(base, undefined, { ...enCours, verifie: false }), null);
  assert.notEqual(prevoirAvecReleveDuJour(base, undefined, { ...enCours, verifie: true }), null);
});

// ---------------------------------------------------------------------------
// Échanges Del Arte, alertes, contrôles
// ---------------------------------------------------------------------------

test("stock disponible : réservé retiré, retour attendu ajouté (11/10/2026)", () => {
  assert.equal(stockDisponible(10, 2, 3), 11);
  assert.equal(stockDisponible(10, 2, null), 8);
  assert.equal(stockDisponible(null, 2, 3), null);
});

test("alertes : rupture, surstock, nouveau", () => {
  const p = prevoir(hebdo(10, 10, 10, 10), 7);
  assert.equal(alerte(p, 0), "rupture");
  assert.equal(alerte(p, 4), "rupture"); // moins de la moitié de 10
  assert.equal(alerte(p, 10), null);
  assert.equal(alerte(p, 31), "surstock"); // plus de 3 fois
  assert.equal(alerte(prevoir(hebdo(10), 7), 10), "nouveau");
  assert.equal(alerte(prevoir(hebdo(10), 7), 0), "rupture"); // la rupture passe avant « nouveau »
  assert.equal(couverture(p, 25), 2.5);
});

test("à recompter (08/11/2026) : cartons livrés comptés pleins", () => {
  // Sauce bolognaise : ~20 par semaine, livraison reçue, 4 seulement comptés consommés.
  const serie = hebdo(20, 22, 18, 21, 19, 20, 23, 20);
  const r = consoAnormalementBasse(serie, { plafond: 45, stock: 41, perte: 0, jours: 7, stockPrecedent: 9 });
  assert.ok(r);
  assert.equal(r.conso, 4);
  // Consommation normale : pas d'alerte.
  assert.equal(consoAnormalementBasse(serie, { plafond: 45, stock: 25, perte: 0, jours: 7, stockPrecedent: 9 }), null);
  // Rien d'entré depuis le dernier relevé : pas d'alerte.
  assert.equal(consoAnormalementBasse(serie, { plafond: 9, stock: 8, perte: 0, jours: 7, stockPrecedent: 9 }), null);
});

test("jours entre deux dates", () => {
  assert.equal(joursEntre("2026-11-02", "2026-11-09"), 7);
  assert.equal(joursEntre(null, "2026-11-09"), null);
});

test("la version du calcul est renseignée", () => {
  assert.match(VERSION_CALCUL, /^\d{4}-\d{2}-\d{2}/);
});
