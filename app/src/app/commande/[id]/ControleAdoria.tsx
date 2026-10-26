"use client";

import { useState } from "react";
import { inflateNavigateur, lireBonAdoria, type BonAdoria } from "@/lib/adoria";
import { qte } from "@/lib/format";
import type { LigneSaisie } from "./Saisie";

type Ecart = {
  cle: string;
  nom: string;
  appli: number;
  adoria: number;
  detail?: string;
};

/**
 * Contrôle d'une commande saisie dans Adoria (26/10/2026) : on dépose le ou
 * les bons PDF, l'appli les compare aux quantités affichées ici, colis par
 * colis. Les articles sont reconnus par leur code Adoria (`code_adoria`).
 */
export default function ControleAdoria({
  lignes,
  aCommander,
}: {
  lignes: LigneSaisie[];
  /** Quantités affichées dans le récapitulatif (celles du bon de commande). */
  aCommander: { l: LigneSaisie; colis: number }[];
}) {
  const [bons, setBons] = useState<{ nom: string; bon: BonAdoria }[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [lecture, setLecture] = useState(false);

  const ajouter = async (fichiers: FileList | null) => {
    if (!fichiers?.length) return;
    setErreur(null);
    setLecture(true);
    const lus: { nom: string; bon: BonAdoria }[] = [];
    try {
      for (const f of Array.from(fichiers)) {
        try {
          const bon = await lireBonAdoria(new Uint8Array(await f.arrayBuffer()), inflateNavigateur);
          lus.push({ nom: f.name, bon });
        } catch (e) {
          setErreur(`${f.name} : ${e instanceof Error ? e.message : "lecture impossible"}`);
        }
      }
      setBons((avant) => {
        // Un même bon déposé deux fois ne compte qu'une fois.
        const deja = new Set(avant.map((b) => b.bon.numero ?? b.nom));
        return [...avant, ...lus.filter((b) => !deja.has(b.bon.numero ?? b.nom))];
      });
    } finally {
      setLecture(false);
    }
  };

  const parCode = new Map<string, LigneSaisie>();
  for (const l of lignes) if (l.codeAdoria) parCode.set(l.codeAdoria, l);

  // Quantités Adoria par produit, et lignes non reconnues.
  const adoria = new Map<number, number>();
  const inconnus: Ecart[] = [];
  for (const { bon } of bons) {
    for (const a of bon.lignes) {
      const l = parCode.get(a.code);
      if (!l) {
        inconnus.push({
          cle: `${bon.numero}-${a.code}`,
          nom: a.designation,
          appli: 0,
          adoria: a.qt,
          detail: `code ${a.code} · ${a.conditionnement}`,
        });
        continue;
      }
      adoria.set(l.produitId, (adoria.get(l.produitId) ?? 0) + a.qt);
    }
  }

  const appli = new Map(aCommander.map((x) => [x.l.produitId, x]));
  const oublis: Ecart[] = [];
  const sansCode: Ecart[] = [];
  const differents: Ecart[] = [];
  let identiques = 0;
  for (const { l, colis } of aCommander) {
    const q = adoria.get(l.produitId) ?? 0;
    const e = { cle: String(l.produitId), nom: l.nom, appli: colis, adoria: q };
    if (q === 0) (l.codeAdoria ? oublis : sansCode).push(e);
    else if (Math.abs(q - colis) > 0.0005) differents.push(e);
    else identiques++;
  }
  const enPlus: Ecart[] = [];
  for (const [produitId, q] of adoria) {
    if (appli.has(produitId)) continue;
    const l = lignes.find((x) => x.produitId === produitId)!;
    enPlus.push({ cle: String(produitId), nom: l.nom, appli: 0, adoria: q });
  }

  const nbEcarts = oublis.length + differents.length + enPlus.length + inconnus.length;

  return (
    <section className="sans-impression mb-3 rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm">
      <h2 className="font-titre text-sm font-semibold">Contrôler la commande Adoria</h2>
      <p className="mt-1 text-xs leading-relaxed text-neutre-500">
        Déposez le ou les bons de commande PDF d’Adoria (commande principale et
        Economat) : l’appli les compare aux quantités ci-dessus.
      </p>
      <label className="mt-3 flex min-h-12 w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-neutre-300 px-4 text-sm font-semibold text-neutre-700">
        {lecture ? "Lecture…" : bons.length ? "Ajouter un autre bon PDF" : "Choisir le ou les bons PDF"}
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={(e) => {
            void ajouter(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {erreur ? <p className="mt-2 text-xs font-semibold text-rouge-700">{erreur}</p> : null}

      {bons.length ? (
        <div className="mt-3">
          <p className="text-xs text-neutre-500">
            {bons
              .map(({ bon }) =>
                `Bon ${bon.numero ?? "?"} (${bon.lignes.length} articles${bon.livraison ? `, livraison ${bon.livraison}` : ""})`,
              )
              .join(" · ")}
            {" · "}
            <button onClick={() => setBons([])} className="font-semibold underline underline-offset-2">
              effacer
            </button>
          </p>
          <p
            className={`mt-2 rounded-xl px-3 py-2 text-sm font-semibold ${
              nbEcarts ? "bg-ambre-50 text-ambre-700" : "bg-vert-50 text-vert-800"
            }`}
          >
            {nbEcarts
              ? `${nbEcarts} écart${nbEcarts > 1 ? "s" : ""} à regarder · ${identiques} article${identiques > 1 ? "s" : ""} identique${identiques > 1 ? "s" : ""}`
              : `Tout correspond : ${identiques} article${identiques > 1 ? "s" : ""} identique${identiques > 1 ? "s" : ""}.`}
          </p>
          <Liste titre="Oubliés dans Adoria" aide="Commandés dans l’appli, absents des bons Adoria." ecarts={oublis} />
          <Liste titre="Quantités différentes" ecarts={differents} />
          <Liste titre="En plus dans Adoria" aide="Sur les bons Adoria, mais rien à commander dans l’appli." ecarts={enPlus} />
          <Liste
            titre="Articles Adoria non reconnus"
            aide="Code Adoria encore inconnu de l’appli : à vérifier à la main."
            ecarts={inconnus}
          />
          <Liste
            titre="À vérifier à la main"
            aide="Commandés dans l’appli, mais jamais vus sur un bon Adoria : l’appli ne connaît pas leur code."
            ecarts={sansCode}
          />
        </div>
      ) : null}
    </section>
  );
}

function Liste({ titre, aide, ecarts }: { titre: string; aide?: string; ecarts: Ecart[] }) {
  if (!ecarts.length) return null;
  return (
    <div className="mt-3">
      <h3 className="px-1 font-titre text-xs font-bold uppercase tracking-[0.14em] text-neutre-500">
        {titre} ({ecarts.length})
      </h3>
      {aide ? <p className="px-1 text-xs text-neutre-500">{aide}</p> : null}
      <ul className="mt-1.5 overflow-hidden rounded-xl border border-neutre-100">
        {ecarts.map((e) => (
          <li
            key={e.cle}
            className="flex items-center justify-between gap-3 border-b border-neutre-100 px-3 py-2 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold">{e.nom}</p>
              {e.detail ? <p className="text-xs text-neutre-500">{e.detail}</p> : null}
            </div>
            <p className="shrink-0 text-right text-xs tabular-nums text-neutre-500">
              appli <span className="font-titre text-sm font-semibold text-neutre-900">{qte(e.appli)}</span>
              {" · "}
              Adoria <span className="font-titre text-sm font-semibold text-neutre-900">{qte(e.adoria)}</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
