"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { suggerer, type Fiabilite } from "@/lib/forecast";
import { qte } from "@/lib/format";
import type { Session, Zone } from "@/lib/types";

export type LigneSaisie = {
  produitId: number;
  zoneId: number;
  nom: string;
  conditionnement: string | null;
  unite: string | null;
  fact: number;
  stock: number | null;
  colis: number | null;
  /** Quantité que l'application proposait lors de la saisie précédente. */
  suggestionEnregistree: number | null;
  consoPrevue: number;
  fiabilite: Fiabilite;
  nbPoints: number;
  derniereConso: number | null;
  stockPrecedent: number | null;
  joursHorizon: number;
  serie: { date: string; conso: number; jours: number }[];
};

type Etat = { stock: number | null; colis: number | null; force: boolean };

// La fiabilité qualifie la régularité de la consommation, pas la quantité
// d'historique : un produit relevé quinze fois peut rester imprévisible. Le
// nombre de relevés est affiché à côté, il n'a pas à être répété ici.
const LIBELLE_FIABILITE: Record<Fiabilite, string> = {
  bonne: "Régulière",
  moyenne: "Variable",
  faible: "Irrégulière",
  aucune: "Jamais relevée",
};

export default function Saisie({
  session,
  zones,
  lignes,
}: {
  session: Session;
  zones: Zone[];
  lignes: LigneSaisie[];
}) {
  const router = useRouter();
  const fige = session.statut === "validee";
  const [onglet, setOnglet] = useState<number | "recap">(zones[0]?.id ?? "recap");
  const [resteSeul, setResteSeul] = useState(false);
  const [etats, setEtats] = useState<Record<number, Etat>>(() =>
    Object.fromEntries(
      lignes.map((l) => [
        l.produitId,
        // Une quantité n'est tenue pour un choix du chef que si elle diffère de
        // ce que l'application proposait alors. Sans cette comparaison, rouvrir
        // un relevé figeait toutes les quantités : corriger un stock ne mettait
        // plus la proposition à jour.
        {
          stock: l.stock,
          colis: l.colis,
          force: l.colis !== null && l.colis !== l.suggestionEnregistree,
        },
      ]),
    ),
  );
  const [enCours, setEnCours] = useState(0);
  const [echec, setEchec] = useState<string | null>(null);

  const parProduit = useMemo(
    () => new Map(lignes.map((l) => [l.produitId, l])),
    [lignes],
  );

  /**
   * Quantité affichée : la suggestion, sauf si elle a été corrigée à la main.
   *
   * Tant qu'un produit n'est pas compté, on ne propose rien : on ne commande
   * pas ce qu'on n'a pas regardé. Sinon le récapitulatif annoncerait les 257
   * produits du fournisseur dès l'ouverture du relevé.
   */
  const colisRetenu = useCallback(
    (l: LigneSaisie, e: Etat) => {
      if (e.force) return e.colis ?? 0;
      if (e.stock === null) return 0;
      return suggerer(l.consoPrevue, e.stock, l.fact, Number(session.marge));
    },
    [session.marge],
  );

  const enregistrer = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const pousser = useCallback(
    (produitId: number, etat: Etat) => {
      const l = parProduit.get(produitId);
      if (!l || fige) return;
      const minuteur = enregistrer.current.get(produitId);
      if (minuteur) clearTimeout(minuteur);
      enregistrer.current.set(
        produitId,
        setTimeout(async () => {
          setEnCours((n) => n + 1);
          try {
            const r = await fetch("/api/lignes", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: session.id,
                produitId,
                stock: etat.stock,
                colis: colisRetenu(l, etat),
                suggestion: suggerer(
                  l.consoPrevue,
                  etat.stock,
                  l.fact,
                  Number(session.marge),
                ),
                consoPrevue: l.consoPrevue,
              }),
            });
            if (!r.ok) throw new Error((await r.json()).erreur ?? "Échec");
            setEchec(null);
          } catch (e) {
            setEchec(e instanceof Error ? e.message : "Enregistrement impossible");
          } finally {
            setEnCours((n) => n - 1);
          }
        }, 500),
      );
    },
    [colisRetenu, fige, parProduit, session.id, session.marge],
  );

  const majuscule = useCallback(
    (produitId: number, patch: Partial<Etat>) => {
      setEtats((prec) => {
        const etat = { ...prec[produitId], ...patch };
        pousser(produitId, etat);
        return { ...prec, [produitId]: etat };
      });
    },
    [pousser],
  );

  useEffect(() => {
    const en = enregistrer.current;
    return () => en.forEach((m) => clearTimeout(m));
  }, []);

  // Les onglets débordent largement de l'écran d'un téléphone : celui qui est
  // ouvert doit être visible, sinon on ne sait plus dans quelle chambre on est.
  const ongletActif = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ongletActif.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [onglet]);

  const saisis = lignes.filter((l) => etats[l.produitId]?.stock !== null).length;
  const aCommander = lignes
    .map((l) => ({ l, colis: colisRetenu(l, etats[l.produitId]) }))
    .filter((x) => x.colis > 0);

  const visibles = lignes.filter(
    (l) =>
      l.zoneId === onglet && (!resteSeul || etats[l.produitId]?.stock === null),
  );

  return (
    <>
      <nav className="sans-impression sticky top-0 z-10 border-b border-neutre-100 bg-neutre-50/95 backdrop-blur">
        <div className="defile-x mx-auto max-w-2xl px-4 py-2">
          <div className="flex gap-2">
            {zones.map((z) => {
              const dedans = lignes.filter((l) => l.zoneId === z.id);
              const faits = dedans.filter(
                (l) => etats[l.produitId]?.stock !== null,
              ).length;
              const fini = faits === dedans.length && dedans.length > 0;
              return (
                <button
                  key={z.id}
                  ref={onglet === z.id ? ongletActif : undefined}
                  onClick={() => setOnglet(z.id)}
                  className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ${
                    onglet === z.id
                      ? "bg-rouge-700 text-white"
                      : "border border-neutre-100 bg-white text-neutre-700"
                  }`}
                >
                  {z.nom}
                  <span
                    className={`rounded-full px-1.5 text-xs font-normal tabular-nums ${
                      onglet === z.id
                        ? "bg-rouge-800 text-rouge-100"
                        : fini
                          ? "bg-vert-100 text-vert-800"
                          : "bg-neutre-50 text-neutre-500"
                    }`}
                  >
                    {faits}/{dedans.length}
                  </span>
                </button>
              );
            })}
            <button
              ref={onglet === "recap" ? ongletActif : undefined}
              onClick={() => setOnglet("recap")}
              className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ${
                onglet === "recap"
                  ? "bg-vert-700 text-white"
                  : "border border-neutre-100 bg-white text-neutre-700"
              }`}
            >
              Récapitulatif
              <span
                className={`rounded-full px-1.5 text-xs font-normal tabular-nums ${
                  onglet === "recap"
                    ? "bg-vert-800 text-vert-100"
                    : "bg-neutre-50 text-neutre-500"
                }`}
              >
                {aCommander.length}
              </span>
            </button>
          </div>
        </div>
      </nav>

      <div
        className="mx-auto max-w-2xl px-4 py-3"
        style={{
          paddingBottom: "calc(var(--barre-basse) + env(safe-area-inset-bottom) + 1rem)",
        }}
      >
        {onglet === "recap" ? (
          <Recapitulatif
            session={session}
            zones={zones}
            aCommander={aCommander}
            fige={fige}
            onMarge={async (marge) => {
              const r = await fetch(`/api/session/${session.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ marge }),
              });
              if (r.ok) router.refresh();
              else setEchec("Marge non enregistrée");
            }}
            onValider={async () => {
              const r = await fetch(`/api/session/${session.id}/valider`, {
                method: "POST",
              });
              if (r.ok) router.refresh();
              else setEchec("Validation impossible");
            }}
            onRouvrir={async () => {
              const r = await fetch(`/api/session/${session.id}/valider`, {
                method: "DELETE",
              });
              if (r.ok) router.refresh();
              else setEchec("Réouverture impossible");
            }}
          />
        ) : visibles.length === 0 ? (
          <p className="rounded-2xl border border-neutre-100 bg-white p-4 text-sm text-neutre-500">
            Toute la chambre est relevée. Passez à la suivante, ou touchez le
            compteur en bas pour réafficher les produits déjà comptés.
          </p>
        ) : (
          <ul className="space-y-2">
            {visibles.map((l) => {
              const etat = etats[l.produitId];
              return (
                <ProduitCarte
                  key={l.produitId}
                  ligne={l}
                  etat={etat}
                  colis={colisRetenu(l, etat)}
                  fige={fige}
                  onStock={(v) => majuscule(l.produitId, { stock: v })}
                  onColis={(v) =>
                    majuscule(l.produitId, { colis: Math.max(0, v), force: true })
                  }
                  onReprendreSuggestion={() =>
                    majuscule(l.produitId, { colis: null, force: false })
                  }
                />
              );
            })}
          </ul>
        )}
      </div>

      <footer
        className="sans-impression fixed inset-x-0 bottom-0 z-10 border-t border-neutre-100 bg-white/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-2.5">
          <button
            onClick={() => setResteSeul((v) => !v)}
            className="min-h-11 flex-1 rounded-xl px-2 text-left"
          >
            <span className="block font-titre text-sm font-semibold tabular-nums">
              {saisis}/{lignes.length} relevés
              {resteSeul ? " · reste à relever" : ""}
            </span>
            <span className="block text-xs text-neutre-500">
              {aCommander.length} produits à commander
              {enCours > 0 ? " · enregistrement…" : ""}
              {echec ? ` · ${echec}` : ""}
            </span>
          </button>
          <a
            href={`/api/session/${session.id}/pdf`}
            className="flex min-h-11 shrink-0 items-center rounded-xl border border-neutre-200 px-4 font-titre text-sm font-semibold text-neutre-700"
          >
            PDF
          </a>
        </div>
      </footer>
    </>
  );
}

function ProduitCarte({
  ligne,
  etat,
  colis,
  fige,
  onStock,
  onColis,
  onReprendreSuggestion,
}: {
  ligne: LigneSaisie;
  etat: Etat;
  colis: number;
  fige: boolean;
  onStock: (v: number | null) => void;
  onColis: (v: number) => void;
  onReprendreSuggestion: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const compte = etat.stock !== null;
  const tendu =
    compte && ligne.consoPrevue > 0 && etat.stock! < ligne.consoPrevue * 0.5;

  return (
    <li
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
        compte ? "border-vert-200" : "border-neutre-100"
      }`}
    >
      <div className="flex">
        {/* Repère de progression : d'un coup d'œil, où on en est dans la chambre. */}
        <div
          className={`w-1 shrink-0 ${compte ? "bg-vert-600" : "bg-neutre-100"}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 px-3 py-2.5">
          <p className="font-titre text-[15px] font-semibold leading-snug">
            {ligne.nom}
          </p>

          <div className="mt-1.5 flex items-end justify-between gap-3">
            <div className="min-w-0 text-xs leading-relaxed text-neutre-500">
              <p>
                {ligne.conditionnement ?? "—"} · {qte(ligne.fact)}{" "}
                {ligne.unite ?? "u"} par colis
              </p>
              {ligne.consoPrevue > 0 ? (
                <p>
                  Besoin estimé {qte(ligne.consoPrevue)} {ligne.unite ?? "u"} sur{" "}
                  {`${ligne.joursHorizon}\u00a0j`}
                </p>
              ) : (
                <p>Pas de consommation mesurée</p>
              )}
            </div>

            <label className="shrink-0 text-right">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutre-500">
                Stock
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                disabled={fige}
                value={etat.stock ?? ""}
                onChange={(e) =>
                  onStock(e.target.value === "" ? null : Number(e.target.value))
                }
                placeholder={
                  ligne.stockPrecedent !== null ? qte(ligne.stockPrecedent) : "—"
                }
                className="mt-0.5 min-h-11 w-24 rounded-xl border-2 border-neutre-200 px-3 text-right text-lg font-semibold tabular-nums outline-none focus:border-rouge-700 disabled:border-neutre-100 disabled:bg-neutre-50"
              />
            </label>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 border-t border-neutre-100 pt-2">
            <div className="flex min-w-0 items-center gap-2">
              <button
                onClick={() => setOuvert((o) => !o)}
                className="min-h-10 shrink-0 text-xs font-semibold text-neutre-500 underline underline-offset-4"
              >
                {ouvert ? "Masquer" : "Historique"}
              </button>
              {tendu ? (
                <span className="shrink-0 rounded-full bg-rouge-50 px-2 py-0.5 text-[11px] font-semibold text-rouge-700">
                  tendu
                </span>
              ) : null}
              {etat.force && !fige ? (
                <button
                  onClick={onReprendreSuggestion}
                  className="min-h-10 shrink-0 text-xs font-semibold text-neutre-500 underline underline-offset-4"
                >
                  proposition
                </button>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center overflow-hidden rounded-xl border border-neutre-200">
              <button
                disabled={fige || colis <= 0}
                onClick={() => onColis(colis - 1)}
                className="min-h-11 w-11 text-xl leading-none text-neutre-700 disabled:opacity-25"
                aria-label="Retirer un colis"
              >
                −
              </button>
              <span className="min-w-9 border-x border-neutre-200 py-2 text-center font-titre text-lg font-semibold tabular-nums">
                {colis}
              </span>
              <button
                disabled={fige}
                onClick={() => onColis(colis + 1)}
                className="min-h-11 w-11 text-xl leading-none text-neutre-700 disabled:opacity-25"
                aria-label="Ajouter un colis"
              >
                +
              </button>
            </div>
          </div>

          {ouvert ? (
            <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-neutre-100 pt-2.5 text-xs text-neutre-500">
              <dt>Fiabilité</dt>
              <dd className="text-right">
                {LIBELLE_FIABILITE[ligne.fiabilite]} ({ligne.nbPoints} relevés)
              </dd>
              <dt>Dernière consommation</dt>
              <dd className="text-right tabular-nums">{qte(ligne.derniereConso)}</dd>
              <dt>Stock au relevé précédent</dt>
              <dd className="text-right tabular-nums">{qte(ligne.stockPrecedent)}</dd>
              <dt className="col-span-2 pt-1">Consommations récentes</dt>
              <dd className="col-span-2 tabular-nums">
                {ligne.serie.length
                  ? ligne.serie.map((s) => qte(s.conso)).join(" · ")
                  : "aucune"}
              </dd>
            </dl>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Recapitulatif({
  session,
  zones,
  aCommander,
  fige,
  onMarge,
  onValider,
  onRouvrir,
}: {
  session: Session;
  zones: Zone[];
  aCommander: { l: LigneSaisie; colis: number }[];
  fige: boolean;
  onMarge: (marge: number) => void;
  onValider: () => void;
  onRouvrir: () => void;
}) {
  return (
    <div>
      {!fige ? (
        <div className="sans-impression mb-3 rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm">
          <label htmlFor="marge" className="block font-titre text-sm font-semibold">
            Marge de sécurité
          </label>
          <p className="mt-1 text-xs leading-relaxed text-neutre-500">
            Combien commander au-delà de la consommation attendue. Plus la marge
            est basse, moins il reste de stock en chambre — et plus le risque de
            manquer augmente.
          </p>
          <select
            id="marge"
            defaultValue={String(Number(session.marge))}
            onChange={(e) => onMarge(Number(e.target.value))}
            className="mt-3 min-h-12 w-full rounded-xl border border-neutre-200 bg-white px-3 text-base"
          >
            <option value="0.25">Serrée (+25 %)</option>
            <option value="0.5">Équilibrée (+50 %)</option>
            <option value="0.75">Confortable (+75 %)</option>
            <option value="1">Large (+100 %)</option>
          </select>
        </div>
      ) : null}

      {aCommander.length === 0 ? (
        <p className="rounded-2xl border border-neutre-100 bg-white p-4 text-sm text-neutre-500">
          Rien à commander pour l’instant. Relevez les stocks chambre par
          chambre : les quantités se remplissent au fur et à mesure.
        </p>
      ) : (
        zones.map((z) => {
          const dedans = aCommander.filter((x) => x.l.zoneId === z.id);
          if (!dedans.length) return null;
          return (
            <section key={z.id} className="mb-3">
              <h2 className="mb-1.5 px-1 font-titre text-xs font-bold uppercase tracking-[0.14em] text-neutre-500">
                {z.nom}
              </h2>
              <ul className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
                {dedans.map(({ l, colis }) => (
                  <li
                    key={l.produitId}
                    className="flex items-center justify-between gap-3 border-b border-neutre-100 px-3 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{l.nom}</p>
                      <p className="text-xs text-neutre-500">
                        {l.conditionnement ?? "—"} · soit {qte(colis * l.fact)}{" "}
                        {l.unite ?? "u"}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-neutre-50 px-2.5 py-1 font-titre text-base font-semibold tabular-nums">
                      {colis}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      <div className="sans-impression mt-5 space-y-2">
        {fige ? (
          <>
            <p className="rounded-xl bg-vert-50 px-4 py-3 text-sm text-vert-800">
              Commande validée. Elle sert désormais de base à la prévision.
            </p>
            <button
              onClick={onRouvrir}
              className="min-h-13 w-full rounded-xl border border-neutre-200 px-4 text-sm font-semibold text-neutre-700"
            >
              Rouvrir pour corriger
            </button>
          </>
        ) : (
          <button
            onClick={onValider}
            disabled={aCommander.length === 0}
            className="min-h-13 w-full rounded-xl bg-vert-700 px-4 font-titre text-base font-semibold text-white disabled:opacity-35"
          >
            Valider la commande
          </button>
        )}
        <a
          href={`/api/session/${session.id}/pdf`}
          className="flex min-h-13 w-full items-center justify-center rounded-xl border border-neutre-200 px-4 font-titre text-base font-semibold text-neutre-700"
        >
          Télécharger le bon de commande
        </a>
      </div>
    </div>
  );
}
