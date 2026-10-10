"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { LieuRangement, ProduitRangement } from "@/lib/rangement";
import { alphabetique } from "@/lib/tri-commun";

/**
 * Réglage de l'ordre de rangement d'un lieu, au téléphone : on touche un
 * produit pour le prendre, puis l'endroit où le poser ; les flèches l'ajustent
 * d'une place. Rien n'est enregistré avant « Enregistrer ».
 */
export default function Rangement({
  lieux,
  lieuId,
  produits,
}: {
  lieux: LieuRangement[];
  lieuId: number;
  produits: ProduitRangement[];
}) {
  const router = useRouter();
  const [liste, setListe] = useState(produits);
  const [enregistre, setEnregistre] = useState(() => produits.map((p) => p.id).join(","));
  const [pris, setPris] = useState<number | null>(null);
  const [etat, setEtat] = useState<"" | "envoi" | "ok" | string>("");

  const modifie = liste.map((p) => p.id).join(",") !== enregistre;
  const nonPlaces = useMemo(() => liste.filter((p) => p.rang === null).length, [liste]);

  // Quitter la page sans enregistrer : le navigateur demande confirmation.
  useEffect(() => {
    if (!modifie) return;
    const retenir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", retenir);
    return () => window.removeEventListener("beforeunload", retenir);
  }, [modifie]);

  const deplacer = (id: number, vers: number) => {
    setListe((l) => {
      const de = l.findIndex((p) => p.id === id);
      if (de < 0 || vers < 0 || vers >= l.length || vers === de) return l;
      const copie = [...l];
      const [p] = copie.splice(de, 1);
      copie.splice(vers, 0, p);
      return copie;
    });
    setEtat("");
  };

  const toucher = (id: number, index: number) => {
    if (pris === null) setPris(id);
    else if (pris === id) setPris(null);
    else deplacer(pris, index);
  };

  const changerLieu = (id: number) => {
    if (id === lieuId) return;
    if (modifie && !window.confirm("L’ordre de ce lieu n’est pas enregistré. Changer de lieu quand même ?")) {
      return;
    }
    router.push(`/rangement?lieu=${id}`);
  };

  const enregistrer = async () => {
    setEtat("envoi");
    setPris(null);
    const ids = liste.map((p) => p.id);
    const r = await fetch("/api/rangement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lieuId, ids }),
    }).catch(() => null);
    if (r?.ok) {
      setEnregistre(ids.join(","));
      // Tous les produits de la liste ont maintenant une place.
      setListe((l) => l.map((p, i) => ({ ...p, rang: i + 1 })));
      setEtat("ok");
      router.refresh();
    } else {
      const corps = (await r?.json().catch(() => null)) as { erreur?: string } | null;
      setEtat(corps?.erreur ?? "Non enregistré : vérifiez le réseau et réessayez.");
    }
  };

  const nomLieu = lieux.find((l) => l.id === lieuId)?.nom ?? "";

  return (
    <>
      <nav className="sticky top-0 z-10 border-b border-neutre-100 bg-neutre-50/95 backdrop-blur">
        <div className="defile-x mx-auto max-w-2xl px-4 py-2">
          <div className="flex gap-2">
            {lieux.map((l) => (
              <button
                key={l.id}
                onClick={() => changerLieu(l.id)}
                className={`flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold ${
                  l.id === lieuId
                    ? "bg-rouge-700 text-white"
                    : "border border-neutre-100 bg-white text-neutre-700"
                }`}
              >
                {l.nom}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div
        className="mx-auto max-w-2xl px-4 py-3"
        style={{ paddingBottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
      >
        <p className="mb-2 px-1 text-sm text-neutre-700">
          Touchez un produit pour le prendre, puis touchez la ligne où le poser. Les flèches le
          déplacent d’une place. Pensez à enregistrer.
        </p>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-sm">
          <span className="text-neutre-500">
            {liste.length} produit{liste.length > 1 ? "s" : ""} · {nomLieu}
            {nonPlaces ? ` · ${nonPlaces} à placer` : ""}
          </span>
          <button
            onClick={() => {
              setListe((l) => [...l].sort((a, b) => alphabetique(a.nom, b.nom)));
              setPris(null);
              setEtat("");
            }}
            className="min-h-9 rounded-lg px-1 text-neutre-500 underline decoration-neutre-200 underline-offset-4"
          >
            Repartir de A → Z
          </button>
        </div>

        {liste.length === 0 ? (
          <p className="rounded-2xl border border-neutre-100 bg-white p-4 text-sm text-neutre-500">
            Aucun produit actif dans ce lieu.
          </p>
        ) : (
          <ol className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
            {liste.map((p, i) => {
              const estPris = pris === p.id;
              const cible = pris !== null && !estPris;
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-2 border-b border-neutre-100 last:border-b-0 ${
                    estPris ? "bg-rouge-50" : ""
                  }`}
                >
                  <button
                    onClick={() => toucher(p.id, i)}
                    aria-pressed={estPris}
                    className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-3 text-left"
                  >
                    <span
                      className={`w-7 shrink-0 text-right text-sm tabular-nums ${
                        estPris ? "font-bold text-rouge-700" : "text-neutre-400"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`line-clamp-2 font-titre text-[15px] font-semibold leading-snug ${
                          estPris ? "text-rouge-800" : ""
                        }`}
                      >
                        {p.nom}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-neutre-500">
                        {p.unite ? <span>{p.unite}</span> : null}
                        {p.fournisseur ? <span>{p.fournisseur}</span> : null}
                        {p.comptage ? <span>comptage seul</span> : null}
                        {p.rang === null ? (
                          <span className="rounded-full bg-neutre-100 px-1.5 text-[11px] font-semibold text-neutre-700">
                            à placer
                          </span>
                        ) : null}
                        {cible ? <span className="text-rouge-700">poser ici</span> : null}
                      </span>
                    </span>
                  </button>
                  {estPris ? (
                    <span className="flex shrink-0 gap-1 pr-2">
                      <button
                        onClick={() => deplacer(p.id, i - 1)}
                        disabled={i === 0}
                        aria-label="Monter d’une place"
                        className="flex min-h-11 w-11 items-center justify-center rounded-xl border border-neutre-200 bg-white text-lg disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => deplacer(p.id, i + 1)}
                        disabled={i === liste.length - 1}
                        aria-label="Descendre d’une place"
                        className="flex min-h-11 w-11 items-center justify-center rounded-xl border border-neutre-200 bg-white text-lg disabled:opacity-30"
                      >
                        ↓
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <footer
        className="fixed inset-x-0 bottom-0 z-10 border-t border-neutre-100 bg-white/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2.5">
          <p className="min-w-0 flex-1 text-sm text-neutre-700">
            {etat === "envoi"
              ? "Enregistrement…"
              : etat === "ok"
                ? "Ordre enregistré."
                : etat
                  ? <span className="text-rouge-700">{etat}</span>
                  : modifie
                    ? "Modifications non enregistrées"
                    : nonPlaces
                      ? "Pas encore enregistré pour ce lieu"
                      : "Aucune modification"}
          </p>
          {modifie ? (
            <button
              onClick={() => {
                const parId = new Map(produits.map((p) => [p.id, p]));
                setListe(
                  enregistre
                    .split(",")
                    .map((id) => parId.get(Number(id)))
                    .filter((p): p is ProduitRangement => !!p),
                );
                setPris(null);
                setEtat("");
              }}
              className="min-h-12 shrink-0 rounded-xl border border-neutre-200 px-3 font-titre text-sm font-semibold text-neutre-700"
            >
              Annuler
            </button>
          ) : null}
          <button
            onClick={enregistrer}
            disabled={(!modifie && nonPlaces === 0) || etat === "envoi"}
            className="min-h-12 shrink-0 rounded-xl bg-rouge-700 px-4 font-titre text-sm font-semibold text-white disabled:bg-neutre-200 disabled:text-neutre-500"
          >
            Enregistrer
          </button>
        </div>
      </footer>
    </>
  );
}
