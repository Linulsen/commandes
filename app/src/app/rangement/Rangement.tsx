"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LieuRangement, ProduitRangement } from "@/lib/rangement";
import { normaliser } from "@/lib/format";
import { alphabetique } from "@/lib/tri-commun";
import CodeResponsable from "../CodeResponsable";

/**
 * Réglage de l'ordre de rangement d'un lieu d'inventaire (articles actifs,
 * retirés encore en stock, emplacements secondaires), en parcourant les étagères
 * (méthode demandée par Nicolas le 11/10/2026) : on se place sur une
 * position (la 1 au départ), on cherche un article par son nom, on le
 * touche. Il prend cette place, les suivants se décalent d'un cran, et le
 * curseur passe tout seul à la place suivante. Toucher une ligne de la liste
 * y replace le curseur. Rien n'est enregistré avant « Enregistrer ».
 *
 * L'ordre est le même pour tout le monde : le modifier demande le code
 * responsable. Sans lui, la liste se consulte seulement.
 */
export default function Rangement({
  lieux,
  lieuId,
  inventaireId,
  produits,
  deverrouille: deverrouilleInitial,
}: {
  lieux: LieuRangement[];
  lieuId: number;
  /** Inventaire d'où l'on vient, pour y revenir en changeant de lieu. */
  inventaireId: number | null;
  produits: ProduitRangement[];
  /** Session responsable déjà ouverte sur cet appareil. */
  deverrouille: boolean;
}) {
  const router = useRouter();
  const [liste, setListe] = useState(produits);
  const [enregistre, setEnregistre] = useState(() => produits.map((p) => p.id).join(","));
  const [etat, setEtat] = useState<"" | "envoi" | "ok" | string>("");
  const [deverrouille, setDeverrouille] = useState(deverrouilleInitial);
  // La session responsable a expiré pendant le réglage : les changements sont
  // gardés, on redemande le code avant d'enregistrer.
  const [expire, setExpire] = useState(false);

  // Curseur : le prochain article choisi se met juste avant la ligne n°
  // curseur + 1 (curseur = liste.length : en fin de liste).
  const [curseur, setCurseur] = useState(0);
  const [recherche, setRecherche] = useState("");
  // Dernier article placé, surligné un instant pour suivre ce qui bouge.
  const [dernier, setDernier] = useState<number | null>(null);
  const champ = useRef<HTMLInputElement>(null);
  const repere = useRef<HTMLLIElement>(null);
  const suivreCurseur = useRef(false);
  // Article dont on change le lieu (fenêtre ouverte).
  const [aDeplacer, setADeplacer] = useState<ProduitRangement | null>(null);

  const modifie = liste.map((p) => p.id).join(",") !== enregistre;
  const nonPlaces = useMemo(() => liste.filter((p) => p.rang === null).length, [liste]);

  // Quitter la page sans enregistrer : le navigateur demande confirmation.
  useEffect(() => {
    if (!modifie) return;
    const retenir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", retenir);
    return () => window.removeEventListener("beforeunload", retenir);
  }, [modifie]);

  // Après un placement, le repère du curseur reste visible sous la recherche.
  useEffect(() => {
    if (!suivreCurseur.current) return;
    suivreCurseur.current = false;
    repere.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [curseur, liste]);

  const terme = normaliser(recherche.trim());
  const position = useMemo(() => new Map(liste.map((p, i) => [p.id, i])), [liste]);
  const resultats = useMemo(
    () =>
      terme
        ? liste
            .filter((p) => normaliser(`${p.nom} ${p.nomComplet}`).includes(terme))
            .sort((a, b) => alphabetique(a.nom, b.nom))
            .slice(0, 8)
        : [],
    [liste, terme],
  );

  /** Met l'article à la place du curseur ; les suivants se décalent d'un cran. */
  const placer = (id: number) => {
    const de = position.get(id);
    if (de === undefined) return;
    // Un article situé avant le curseur libère sa place : le curseur recule d'un cran.
    const vers = de < curseur ? curseur - 1 : curseur;
    if (de !== vers) {
      const copie = [...liste];
      const [p] = copie.splice(de, 1);
      copie.splice(vers, 0, p);
      setListe(copie);
    }
    suivreCurseur.current = true;
    setCurseur(Math.min(vers + 1, liste.length));
    setDernier(id);
    setRecherche("");
    setEtat("");
    champ.current?.focus();
  };

  const positionner = (i: number) => {
    if (!deverrouille) return;
    setCurseur(i);
    setDernier(null);
    champ.current?.focus({ preventScroll: true });
  };

  const changerLieu = (id: number) => {
    if (id === lieuId) return;
    if (modifie && !window.confirm("L’ordre de ce lieu n’est pas enregistré. Changer de lieu quand même ?")) {
      return;
    }
    router.push(`/rangement?lieu=${id}${inventaireId ? `&inventaire=${inventaireId}` : ""}`);
  };

  const enregistrer = async () => {
    setEtat("envoi");
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
      const corps = (await r?.json().catch(() => null)) as
        | { erreur?: string; besoinCode?: boolean }
        | null;
      if (corps?.besoinCode) {
        setDeverrouille(false);
        setExpire(true);
        setEtat("");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setEtat(corps?.erreur ?? "Non enregistré : vérifiez le réseau et réessayez.");
    }
  };

  const annuler = () => {
    const parId = new Map(produits.map((p) => [p.id, p]));
    setListe(
      enregistre
        .split(",")
        .map((id) => parId.get(Number(id)))
        .filter((p): p is ProduitRangement => !!p),
    );
    setCurseur(0);
    setDernier(null);
    setRecherche("");
    setEtat("");
  };

  /**
   * Change l'article de lieu (ou retire un emplacement secondaire). Il quitte
   * la liste de ce lieu tout de suite ; l'ordre en cours de réglage est gardé.
   */
  const deplacer = async (p: ProduitRangement, versLieu: number | null) => {
    setEtat("envoi");
    const r = await fetch("/api/rangement/lieu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ produitId: p.id, deLieu: lieuId, versLieu }),
    }).catch(() => null);
    if (r?.ok) {
      const i = position.get(p.id) ?? liste.length;
      setListe((l) => l.filter((x) => x.id !== p.id));
      setEnregistre((e) =>
        e
          .split(",")
          .filter((id) => id && Number(id) !== p.id)
          .join(","),
      );
      if (i < curseur) setCurseur((c) => c - 1);
      setDernier(null);
      setADeplacer(null);
      const vers = lieux.find((l) => l.id === versLieu)?.nom;
      setEtat(vers ? `« ${p.nom} » est maintenant en ${vers}.` : `« ${p.nom} » retiré de ce lieu.`);
      return;
    }
    const corps = (await r?.json().catch(() => null)) as
      | { erreur?: string; besoinCode?: boolean }
      | null;
    setADeplacer(null);
    if (corps?.besoinCode) {
      setDeverrouille(false);
      setExpire(true);
      setEtat("");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setEtat(corps?.erreur ?? "Lieu non changé : vérifiez le réseau et réessayez.");
  };

  const nomLieu = lieux.find((l) => l.id === lieuId)?.nom ?? "";

  /** Repère du curseur, glissé dans la liste à l'endroit où ira le prochain article. */
  const repereCurseur = (
    <li
      ref={repere}
      key="curseur"
      className="flex items-center gap-2 border-b border-rouge-200 bg-rouge-50 px-3 py-2 text-sm font-semibold text-rouge-700"
    >
      <span aria-hidden="true">▸</span>
      Place n° {curseur + 1} : le prochain article choisi se met ici
    </li>
  );

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

        {deverrouille && liste.length ? (
          <div className="mx-auto max-w-2xl px-4 pb-2">
            <label className="mb-1 block px-1 font-titre text-sm font-semibold text-rouge-700">
              Place n° {curseur + 1}
              {curseur >= liste.length ? " (fin de liste)" : ""} : quel article ?
            </label>
            <input
              ref={champ}
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Tapez une partie du nom"
              enterKeyHint="search"
              autoComplete="off"
              className="min-h-11 w-full rounded-xl border-2 border-neutre-200 bg-white px-3 text-base outline-none focus:border-rouge-700"
            />
            {terme ? (
              <ul className="mt-1.5 max-h-[45vh] overflow-y-auto rounded-xl border border-neutre-100 bg-white shadow-sm">
                {resultats.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-neutre-500">
                    Aucun article de {nomLieu} ne porte ce nom.
                  </li>
                ) : (
                  resultats.map((p) => (
                    <li key={p.id} className="border-b border-neutre-100 last:border-b-0">
                      <button
                        onClick={() => placer(p.id)}
                        className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left"
                      >
                        <span className="min-w-0 flex-1 font-titre text-[15px] font-semibold leading-snug">
                          {p.nom}
                        </span>
                        <span className="shrink-0 text-xs text-neutre-500 tabular-nums">
                          n° {(position.get(p.id) ?? 0) + 1}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        ) : null}
      </nav>

      <div
        className="mx-auto max-w-2xl px-4 py-3"
        style={{ paddingBottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
      >
        {deverrouille ? (
          <p className="mb-2 px-1 text-sm text-neutre-700">
            Cherchez l’article qui va à la place indiquée et touchez-le : il s’y met, les suivants
            se décalent, et on passe à la place d’après. Touchez une ligne pour vous placer
            ailleurs. Pensez à enregistrer.
          </p>
        ) : (
          <CodeResponsable
            message={
              expire
                ? "La session responsable a expiré. Vos changements sont gardés : retapez le code, puis enregistrez."
                : "L’ordre de rangement est le même pour tout le monde. Pour le modifier, tapez le code responsable."
            }
            onOk={() => {
              setDeverrouille(true);
              setExpire(false);
            }}
          />
        )}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-sm">
          <span className="text-neutre-500">
            {liste.length} produit{liste.length > 1 ? "s" : ""} · {nomLieu}
            {nonPlaces ? ` · ${nonPlaces} à placer` : ""}
          </span>
          {deverrouille ? (
            <button
              onClick={() => {
                setListe((l) => [...l].sort((a, b) => alphabetique(a.nom, b.nom)));
                setCurseur(0);
                setDernier(null);
                setEtat("");
              }}
              className="min-h-9 rounded-lg px-1 text-neutre-500 underline decoration-neutre-200 underline-offset-4"
            >
              Repartir de A → Z
            </button>
          ) : null}
        </div>

        {liste.length === 0 ? (
          <p className="rounded-2xl border border-neutre-100 bg-white p-4 text-sm text-neutre-500">
            Aucun article de l’inventaire dans ce lieu.
          </p>
        ) : (
          <ol className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
            {liste.flatMap((p, i) => {
              const ligne = (
                <li
                  key={p.id}
                  className={`border-b border-neutre-100 last:border-b-0 ${
                    dernier === p.id ? "bg-vert-50" : ""
                  }`}
                >
                  <div className="flex items-stretch">
                  <button
                    onClick={() => positionner(i)}
                    disabled={!deverrouille}
                    className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-3 pr-3 text-left disabled:cursor-default"
                  >
                    <span
                      className={`w-7 shrink-0 text-right text-sm tabular-nums ${
                        dernier === p.id ? "font-bold text-vert-700" : "text-neutre-400"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 font-titre text-[15px] font-semibold leading-snug">
                        {p.nom}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-neutre-500">
                        {p.unite ? <span>{p.unite}</span> : null}
                        {p.fournisseur ? <span>{p.fournisseur}</span> : null}
                        {p.comptage ? <span>comptage seul</span> : null}
                        {p.secondaire ? <span>aussi rangé ailleurs</span> : null}
                        {p.inactif ? (
                          <span className="rounded-full bg-ambre-50 px-1.5 text-[11px] font-semibold text-ambre-700">
                            retiré de la carte
                          </span>
                        ) : null}
                        {p.rang === null ? (
                          <span className="rounded-full bg-neutre-100 px-1.5 text-[11px] font-semibold text-neutre-700">
                            à placer
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                  {deverrouille ? (
                    <button
                      onClick={() => setADeplacer(p)}
                      aria-label={`Changer « ${p.nom} » de lieu`}
                      className="flex min-h-14 shrink-0 items-center px-3 text-xs font-semibold text-rouge-700 underline decoration-rouge-200 underline-offset-4"
                    >
                      Changer de lieu
                    </button>
                  ) : null}
                  </div>
                </li>
              );
              return deverrouille && i === curseur ? [repereCurseur, ligne] : [ligne];
            })}
            {deverrouille ? (
              curseur >= liste.length ? (
                repereCurseur
              ) : (
                <li key="fin">
                  <button
                    onClick={() => positionner(liste.length)}
                    className="flex min-h-12 w-full items-center px-3 text-sm text-neutre-500 underline decoration-neutre-200 underline-offset-4"
                  >
                    Se placer en fin de liste
                  </button>
                </li>
              )
            ) : null}
          </ol>
        )}
      </div>

      {deverrouille || modifie ? (
        <footer
          className="fixed inset-x-0 bottom-0 z-10 border-t border-neutre-100 bg-white/95 backdrop-blur"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2.5">
            <p className="min-w-0 flex-1 text-sm text-neutre-700">
              {etat === "envoi" ? (
                "Enregistrement…"
              ) : etat === "ok" ? (
                "Ordre enregistré."
              ) : etat.startsWith("« ") ? (
                <span className="text-vert-700">{etat}</span>
              ) : etat ? (
                <span className="text-rouge-700">{etat}</span>
              ) : modifie ? (
                "Modifications non enregistrées"
              ) : nonPlaces ? (
                "Pas encore enregistré pour ce lieu"
              ) : (
                "Aucune modification"
              )}
            </p>
            {modifie ? (
              <button
                onClick={annuler}
                className="min-h-12 shrink-0 rounded-xl border border-neutre-200 px-3 font-titre text-sm font-semibold text-neutre-700"
              >
                Annuler
              </button>
            ) : null}
            <button
              onClick={enregistrer}
              disabled={!deverrouille || (!modifie && nonPlaces === 0) || etat === "envoi"}
              className="min-h-12 shrink-0 rounded-xl bg-rouge-700 px-4 font-titre text-sm font-semibold text-white disabled:bg-neutre-200 disabled:text-neutre-500"
            >
              Enregistrer
            </button>
          </div>
        </footer>
      ) : null}

      {aDeplacer ? (
        <ChoixLieu
          produit={aDeplacer}
          lieux={lieux.filter((l) => l.id !== lieuId)}
          nomLieu={nomLieu}
          envoi={etat === "envoi"}
          onChoisir={(versLieu) => deplacer(aDeplacer, versLieu)}
          onFermer={() => setADeplacer(null)}
        />
      ) : null}
    </>
  );
}

/** Fenêtre « Changer de lieu » : le nouveau lieu de l'article. */
function ChoixLieu({
  produit,
  lieux,
  nomLieu,
  envoi,
  onChoisir,
  onFermer,
}: {
  produit: ProduitRangement;
  lieux: LieuRangement[];
  nomLieu: string;
  envoi: boolean;
  onChoisir: (versLieu: number | null) => void;
  onFermer: () => void;
}) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onFermer]);

  return (
    <div className="fixed inset-0 z-30" role="dialog" aria-modal="true" aria-label="Changer de lieu">
      <button
        aria-label="Fermer"
        onClick={onFermer}
        className="absolute inset-0 h-full w-full bg-neutre-950/40"
      />
      <div
        className="absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] max-w-2xl overflow-y-auto overscroll-contain rounded-t-3xl bg-white shadow-xl"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      >
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-neutre-100 bg-white px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutre-400">
              Changer de lieu
            </p>
            <h2 className="font-titre text-lg font-semibold leading-snug">{produit.nom}</h2>
            <p className="text-xs text-neutre-500">
              Aujourd’hui en {nomLieu}
              {produit.secondaire ? " (en plus de son lieu principal)" : ""}
            </p>
          </div>
          <button
            onClick={onFermer}
            className="min-h-12 shrink-0 rounded-xl bg-neutre-50 px-4 text-sm font-semibold text-neutre-700"
          >
            Fermer
          </button>
        </div>

        <div className="space-y-2 px-4 pt-4">
          <p className="px-1 text-sm text-neutre-700">
            Où est-il rangé maintenant ? Il sera compté là aux prochains inventaires. La commande
            ne change pas : même fournisseur, même chambre au relevé.
          </p>
          {lieux.map((l) => (
            <button
              key={l.id}
              onClick={() => onChoisir(l.id)}
              disabled={envoi}
              className="flex min-h-14 w-full items-center rounded-2xl border-2 border-neutre-200 px-4 text-left font-titre text-base font-semibold disabled:opacity-50"
            >
              {l.nom}
            </button>
          ))}
          {produit.secondaire ? (
            <button
              onClick={() => {
                if (window.confirm(`Ne plus compter « ${produit.nom} » en ${nomLieu} ?`)) onChoisir(null);
              }}
              disabled={envoi}
              className="mt-2 flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-sm font-semibold text-rouge-700 underline decoration-rouge-200 underline-offset-4 disabled:opacity-50"
            >
              Il n’est plus rangé ici : retirer ce lieu
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
