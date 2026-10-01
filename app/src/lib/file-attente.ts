"use client";

import { useSyncExternalStore } from "react";

/**
 * File d'attente des saisies, tenue dans le téléphone.
 *
 * En chambre négative il n'y a souvent pas de réseau. Les saisies partaient
 * auparavant directement au serveur, 500 ms après la frappe : un envoi raté
 * n'était jamais retenté, et quitter l'écran (un balayage « retour » en
 * faisant défiler la liste suffisait) annulait ceux qui n'étaient pas encore
 * partis. Au retour, une partie des produits réapparaissait vide.
 *
 * Désormais chaque saisie est d'abord écrite dans le stockage du téléphone,
 * de façon synchrone, avant toute tentative d'envoi. Elle n'en sort que quand
 * le serveur a confirmé l'avoir enregistrée. L'envoi est retenté tant qu'il en
 * reste : au retour du réseau, au retour sur l'application, et à intervalle
 * régulier.
 *
 * Une entrée porte l'état complet de sa ligne, pas un écart : rejouer deux
 * fois la même entrée est sans effet, et une saisie plus récente sur la même
 * ligne remplace simplement la précédente.
 */

export type Canal = "releve" | "reception" | "inventaire";

export type Entree = {
  /** Identifie la ligne : une seule entrée par ligne dans la file. */
  cle: string;
  canal: Canal;
  corps: Record<string, unknown>;
  /** Moment de la saisie, horloge du téléphone. */
  t: number;
};

const CLE_FILE = "cmd:file:v1";
const CLE_JOURNAL = "cmd:journal:v1";
const URL_CANAL: Record<Canal, string> = {
  releve: "/api/lignes",
  reception: "/api/receptions/lignes",
  inventaire: "/api/inventaire/saisies",
};

type Etat = {
  enAttente: number;
  /** Lignes pas encore confirmées par le serveur, pour les repérer à l'écran. */
  cles: ReadonlySet<string>;
  envoi: boolean;
  erreur: string | null;
  /** Le serveur a refusé l'accès : il faut ressaisir le code. */
  deconnecte: boolean;
};

let etat: Etat = {
  enAttente: 0,
  cles: new Set(),
  envoi: false,
  erreur: null,
  deconnecte: false,
};
const abonnes = new Set<() => void>();

function publier(patch: Partial<Omit<Etat, "cles">>) {
  etat = { ...etat, ...patch };
  if (patch.enAttente !== undefined) etat.cles = new Set(lireFile().map((e) => e.cle));
  abonnes.forEach((f) => f());
}

function lire<T>(cle: string, defaut: T): T {
  try {
    const brut = localStorage.getItem(cle);
    return brut ? (JSON.parse(brut) as T) : defaut;
  } catch {
    return defaut;
  }
}

function ecrire(cle: string, valeur: unknown) {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur));
  } catch {
    // Stockage plein ou refusé (navigation privée) : l'envoi direct reste
    // tenté, on perd seulement la reprise après fermeture.
  }
}

function lireFile(): Entree[] {
  return lire<Entree[]>(CLE_FILE, []);
}

/* ------------------------------------------------------------------------ */
/* Journal : la dernière valeur saisie sur ce téléphone, ligne par ligne.   */
/* ------------------------------------------------------------------------ */

/**
 * La file se vide dès que le serveur a confirmé. Le journal, lui, garde ce qui
 * a été saisi, pour qu'une page rouverte sans réseau — donc servie depuis le
 * cache, avec les valeurs du dernier chargement — affiche malgré tout ce qui a
 * été tapé depuis. Il est purgé au bout de quelques jours.
 */
type Journal = Record<string, { corps: Record<string, unknown>; t: number }>;
const DUREE_JOURNAL = 5 * 864e5;

export function saisiesLocales(prefixe: string) {
  const journal = lire<Journal>(CLE_JOURNAL, {});
  const out: Record<string, { corps: Record<string, unknown>; t: number }> = {};
  for (const [cle, v] of Object.entries(journal)) {
    if (cle.startsWith(prefixe)) out[cle] = v;
  }
  return out;
}

function journaliser(e: Entree) {
  const journal = lire<Journal>(CLE_JOURNAL, {});
  const limite = Date.now() - DUREE_JOURNAL;
  for (const [cle, v] of Object.entries(journal)) if (v.t < limite) delete journal[cle];
  journal[e.cle] = { corps: e.corps, t: e.t };
  ecrire(CLE_JOURNAL, journal);
}

/* ------------------------------------------------------------------------ */
/* Envoi                                                                    */
/* ------------------------------------------------------------------------ */

let minuteur: ReturnType<typeof setTimeout> | null = null;
let enVol = false;
let delaiReprise = 2000;

export function mettreEnFile(cle: string, canal: Canal, corps: Record<string, unknown>) {
  const e: Entree = { cle, canal, corps, t: Date.now() };
  const file = lireFile().filter((x) => x.cle !== cle);
  file.push(e);
  ecrire(CLE_FILE, file);
  journaliser(e);
  publier({ enAttente: file.length });
  planifier(400);
}

function planifier(delai: number) {
  if (typeof window === "undefined") return;
  if (minuteur) clearTimeout(minuteur);
  minuteur = setTimeout(() => void vider(), delai);
}

/**
 * Envoie tout ce qui attend, par paquets d'un même canal. Une entrée n'est
 * retirée que si elle n'a pas été remplacée pendant l'envoi : sinon la saisie
 * plus récente partirait à la trappe.
 */
export async function vider(): Promise<boolean> {
  if (enVol) return false;
  const file = lireFile();
  publier({ enAttente: file.length });
  if (!file.length) {
    publier({ erreur: null });
    return true;
  }
  enVol = true;
  publier({ envoi: true });
  let toutEnvoye = true;
  try {
    for (const canal of Object.keys(URL_CANAL) as Canal[]) {
      const paquet = file.filter((e) => e.canal === canal);
      for (let i = 0; i < paquet.length; i += 100) {
        const tranche = paquet.slice(i, i + 100);
        const r = await fetch(URL_CANAL[canal], {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lignes: tranche.map((e) => e.corps) }),
          cache: "no-store",
        });
        if (r.status === 401) {
          publier({ deconnecte: true, erreur: "Reconnectez-vous pour envoyer" });
          toutEnvoye = false;
          break;
        }
        if (!r.ok) throw new Error(`Serveur ${r.status}`);
        const { refusees = [] } = (await r.json().catch(() => ({}))) as {
          refusees?: { index: number; erreur: string }[];
        };
        const envoyees = new Map(tranche.map((e) => [e.cle, e.t]));
        const actuelle = lireFile().filter((e) => envoyees.get(e.cle) !== e.t);
        ecrire(CLE_FILE, actuelle);
        publier({
          enAttente: actuelle.length,
          deconnecte: false,
          // Une ligne refusée (commande déjà validée, produit inconnu) ne
          // passera pas davantage au prochain essai : on la retire, mais on le
          // dit.
          erreur: refusees.length
            ? `${refusees.length} saisie(s) refusée(s) : ${refusees[0].erreur}`
            : null,
        });
      }
      if (!toutEnvoye) break;
    }
    delaiReprise = 2000;
  } catch {
    toutEnvoye = false;
    publier({ erreur: "Hors ligne — les saisies sont gardées sur le téléphone" });
    delaiReprise = Math.min(delaiReprise * 2, 30000);
  } finally {
    enVol = false;
    publier({ envoi: false, enAttente: lireFile().length });
  }
  if (lireFile().length) planifier(delaiReprise);
  return toutEnvoye && lireFile().length === 0;
}

/**
 * Dernier recours quand la page se ferme : un envoi `keepalive` survit à la
 * fermeture de l'onglet. S'il échoue, la file est toujours là au retour.
 */
function envoyerEnPartant() {
  const file = lireFile();
  for (const canal of Object.keys(URL_CANAL) as Canal[]) {
    const paquet = file.filter((e) => e.canal === canal).slice(0, 100);
    if (!paquet.length) continue;
    try {
      void fetch(URL_CANAL[canal], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lignes: paquet.map((e) => e.corps) }),
        keepalive: true,
      });
    } catch {
      /* rien à faire : la file reste */
    }
  }
}

let installe = false;
function installer() {
  if (installe || typeof window === "undefined") return;
  installe = true;
  window.addEventListener("online", () => planifier(0));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") planifier(0);
    else envoyerEnPartant();
  });
  window.addEventListener("pagehide", envoyerEnPartant);
  // Un autre onglet a pu écrire dans la file.
  window.addEventListener("storage", (e) => {
    if (e.key === CLE_FILE) publier({ enAttente: lireFile().length });
  });
  publier({ enAttente: lireFile().length });
  planifier(0);
}

export function useFileAttente(): Etat {
  return useSyncExternalStore(
    (f) => {
      installer();
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    () => etat,
    () => etat,
  );
}

/** Nombre saisi au doigt : accepte la virgule, rend null pour un champ vide. */
export function lireNombre(texte: string): number | null | undefined {
  const t = texte.trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return undefined;
  return Number(t);
}
