"use client";

import { useEffect, useRef } from "react";
import { lireNombre } from "@/lib/file-attente";
import { qte } from "@/lib/format";

/**
 * Pavé numérique de l'application, à la place du clavier du téléphone.
 *
 * Le clavier système couvrait la moitié de l'écran et, en s'ouvrant,
 * redimensionnait la page : la liste sautait sous le doigt, surtout sur
 * iPhone. Ses touches sont aussi trop petites pour des gants. Ce pavé-ci reste
 * à hauteur fixe, en bas, avec des touches larges et deux raccourcis
 * (« comme la dernière fois », « aucun ») qui passent au produit suivant.
 */

/** Texte en cours de frappe ; `neuf` : la prochaine touche remplace la valeur. */
export type Frappe = { texte: string; neuf: boolean };

export function frappeDe(valeur: number | null): Frappe {
  return { texte: valeur === null ? "" : qte(valeur), neuf: true };
}

export function frapper(f: Frappe, touche: string): Frappe {
  if (touche === "⌫") return { texte: f.neuf ? "" : f.texte.slice(0, -1), neuf: false };
  const base = f.neuf ? "" : f.texte;
  const texte =
    touche === ","
      ? base.includes(",")
        ? base
        : `${base || "0"},`
      : base === "0"
        ? touche
        : base + touche;
  if (lireNombre(texte) === undefined || /,\d{3}/.test(texte) || texte.length > 7) return f;
  return { texte, neuf: false };
}

export type Raccourci = { libelle: string; detail?: string; action: () => void };

/**
 * Amène une ligne dans la partie visible de l'écran, entre la barre du haut et
 * le pavé : au tiers supérieur, là où le regard revient après chaque frappe.
 */
export function montrerLigne(el: Element | null, haut: number, bas: number) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const debut = haut + 8;
  const fin = window.innerHeight - bas - 8;
  if (r.top >= debut && r.bottom <= fin) return;
  const cible = debut + Math.max(0, (fin - debut - r.height) / 3);
  window.scrollBy({ top: r.top - cible, behavior: "smooth" });
}

function vibrer() {
  // Android seulement ; un retour au doigt quand on tape avec des gants.
  try {
    navigator.vibrate?.(8);
  } catch {
    /* sans effet */
  }
}

export default function Pave({
  titre,
  detail,
  frappe,
  raccourcis,
  libelleSuivant,
  onTouche,
  onSuivant,
  onFermer,
  onHauteur,
}: {
  titre: string;
  detail?: string;
  frappe: Frappe;
  raccourcis: [Raccourci | null, Raccourci | null];
  libelleSuivant: string;
  onTouche: (touche: string) => void;
  onSuivant: () => void;
  onFermer: () => void;
  onHauteur: (h: number) => void;
}) {
  const racine = useRef<HTMLDivElement>(null);
  const rappels = useRef({ onTouche, onSuivant, onFermer });
  rappels.current = { onTouche, onSuivant, onFermer };

  useEffect(() => {
    const el = racine.current;
    if (!el) return;
    const obs = new ResizeObserver(() => onHauteur(el.offsetHeight));
    obs.observe(el);
    return () => {
      obs.disconnect();
      onHauteur(0);
    };
  }, [onHauteur]);

  // Un clavier physique marche aussi (tablette, ordinateur).
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const r = rappels.current;
      if (/^[0-9]$/.test(e.key)) r.onTouche(e.key);
      else if (e.key === "," || e.key === ".") r.onTouche(",");
      else if (e.key === "Backspace") r.onTouche("⌫");
      else if (e.key === "Enter" || e.key === "Tab") r.onSuivant();
      else if (e.key === "Escape") r.onFermer();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  const chiffre = (c: string) => (
    <button
      key={c}
      type="button"
      onClick={() => {
        vibrer();
        onTouche(c);
      }}
      className="h-14 rounded-xl bg-white font-titre text-2xl font-semibold text-neutre-950 shadow-sm active:bg-neutre-200"
    >
      {c}
    </button>
  );
  const raccourci = (r: Raccourci | null, i: number) =>
    r ? (
      <button
        key={`r${i}`}
        type="button"
        onClick={() => {
          vibrer();
          r.action();
        }}
        className="flex h-14 flex-col items-center justify-center rounded-xl bg-vert-50 px-1 leading-tight text-vert-800 active:bg-vert-100"
      >
        <span className="font-titre text-base font-semibold">{r.libelle}</span>
        {r.detail ? (
          <span className="max-w-full truncate text-[11px] tabular-nums">{r.detail}</span>
        ) : null}
      </button>
    ) : (
      <span key={`r${i}`} aria-hidden="true" />
    );

  return (
    <div
      ref={racine}
      className="sans-impression fixed inset-x-0 bottom-0 z-20 select-none border-t border-neutre-200 bg-neutre-100 shadow-[0_-6px_20px_rgba(0,0,0,0.08)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3 bg-white px-4 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-titre text-sm font-semibold">{titre}</p>
            {detail ? <p className="truncate text-xs text-neutre-500">{detail}</p> : null}
          </div>
          <span
            aria-live="polite"
            className="min-w-20 rounded-xl border-2 border-rouge-700 px-3 py-1 text-right text-xl font-semibold tabular-nums"
          >
            <span className={frappe.neuf && frappe.texte ? "rounded bg-rouge-100" : ""}>
              {frappe.texte}
            </span>
            <span className="curseur" aria-hidden="true" />
          </span>
          <button
            type="button"
            onClick={onFermer}
            className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-neutre-700"
          >
            Fermer
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1.5 p-1.5">
          {chiffre("7")}
          {chiffre("8")}
          {chiffre("9")}
          <button
            type="button"
            aria-label="Effacer le dernier chiffre"
            onClick={() => {
              vibrer();
              onTouche("⌫");
            }}
            className="h-14 rounded-xl bg-neutre-200 text-2xl text-neutre-900 active:bg-neutre-300"
          >
            ⌫
          </button>
          {chiffre("4")}
          {chiffre("5")}
          {chiffre("6")}
          {raccourci(raccourcis[0], 0)}
          {chiffre("1")}
          {chiffre("2")}
          {chiffre("3")}
          <button
            type="button"
            onClick={() => {
              vibrer();
              onSuivant();
            }}
            className="row-span-2 rounded-xl bg-rouge-700 px-1 font-titre text-base font-semibold text-white active:bg-rouge-800"
          >
            {libelleSuivant}
          </button>
          {chiffre(",")}
          {chiffre("0")}
          {raccourci(raccourcis[1], 1)}
        </div>
      </div>
    </div>
  );
}
