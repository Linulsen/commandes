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
  consoPrevue: number;
  fiabilite: Fiabilite;
  nbPoints: number;
  derniereConso: number | null;
  stockPrecedent: number | null;
  joursHorizon: number;
  serie: { date: string; conso: number; jours: number }[];
};

type Etat = { stock: number | null; colis: number | null; force: boolean };

const LIBELLE_FIABILITE: Record<Fiabilite, string> = {
  bonne: "Consommation régulière",
  moyenne: "Consommation variable",
  faible: "Peu d’historique",
  aucune: "Produit jamais relevé",
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
  const [etats, setEtats] = useState<Record<number, Etat>>(() =>
    Object.fromEntries(
      lignes.map((l) => [
        l.produitId,
        // Une commande déjà saisie n'est pas rejouée par la prévision : ce qui
        // est en base prime, sinon rouvrir l'écran écraserait les corrections.
        { stock: l.stock, colis: l.colis, force: l.colis !== null },
      ]),
    ),
  );
  const [enCours, setEnCours] = useState(0);
  const [echec, setEchec] = useState<string | null>(null);

  const parProduit = useMemo(
    () => new Map(lignes.map((l) => [l.produitId, l])),
    [lignes],
  );

  /** Quantité affichée : la suggestion, sauf si elle a été corrigée à la main. */
  const colisRetenu = useCallback(
    (l: LigneSaisie, e: Etat) =>
      e.force
        ? (e.colis ?? 0)
        : suggerer(l.consoPrevue, e.stock, l.fact, Number(session.marge)),
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

  const saisis = lignes.filter((l) => etats[l.produitId]?.stock !== null).length;
  const aCommander = lignes
    .map((l) => ({ l, colis: colisRetenu(l, etats[l.produitId]) }))
    .filter((x) => x.colis > 0);

  return (
    <>
      <nav className="sans-impression sticky top-0 z-10 -mx-4 mt-4 overflow-x-auto bg-ardoise-50/95 px-4 py-2 backdrop-blur">
        <div className="flex gap-2">
          {zones.map((z) => {
            const dedans = lignes.filter((l) => l.zoneId === z.id);
            const faits = dedans.filter(
              (l) => etats[l.produitId]?.stock !== null,
            ).length;
            return (
              <button
                key={z.id}
                onClick={() => setOnglet(z.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
                  onglet === z.id
                    ? "bg-ardoise-900 text-white"
                    : "border border-ardoise-200 bg-white text-ardoise-600"
                }`}
              >
                {z.nom}
                <span className="ml-1.5 opacity-60">
                  {faits}/{dedans.length}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => setOnglet("recap")}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
              onglet === "recap"
                ? "bg-ardoise-900 text-white"
                : "border border-ardoise-200 bg-white text-ardoise-600"
            }`}
          >
            Récapitulatif
            <span className="ml-1.5 opacity-60">{aCommander.length}</span>
          </button>
        </div>
      </nav>

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
      ) : (
        <ul className="mt-3 space-y-2">
          {lignes
            .filter((l) => l.zoneId === onglet)
            .map((l) => {
              const etat = etats[l.produitId];
              const colis = colisRetenu(l, etat);
              return (
                <ProduitCarte
                  key={l.produitId}
                  ligne={l}
                  etat={etat}
                  colis={colis}
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

      <footer className="sans-impression fixed inset-x-0 bottom-0 border-t border-ardoise-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="text-sm">
            <p className="font-medium">
              {saisis}/{lignes.length} relevés
            </p>
            <p className="text-ardoise-600">
              {aCommander.length} produits à commander
              {enCours > 0 ? " · enregistrement…" : ""}
              {echec ? ` · ${echec}` : ""}
            </p>
          </div>
          <a
            href={`/api/session/${session.id}/pdf`}
            className="shrink-0 rounded-lg border border-ardoise-900 px-3 py-2 text-sm font-medium"
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
  const manque =
    etat.stock !== null && ligne.consoPrevue > 0 && etat.stock < ligne.consoPrevue * 0.5;

  return (
    <li className="rounded-xl border border-ardoise-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">{ligne.nom}</p>
          <p className="mt-0.5 text-xs text-ardoise-600">
            {ligne.conditionnement ?? "—"} · {qte(ligne.fact)}{" "}
            {ligne.unite ?? "u"}/colis
            {ligne.consoPrevue > 0
              ? ` · besoin estimé ${qte(ligne.consoPrevue)} sur ${ligne.joursHorizon} j`
              : ""}
          </p>
        </div>
        <label className="shrink-0 text-right">
          <span className="block text-[11px] uppercase tracking-wide text-ardoise-400">
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
            className="mt-0.5 w-24 rounded-lg border border-ardoise-200 px-2 py-2 text-right text-base tabular-nums outline-none focus:border-ardoise-800 disabled:bg-ardoise-100"
          />
        </label>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-ardoise-100 pt-3">
        <button
          onClick={() => setOuvert((o) => !o)}
          className="text-xs text-ardoise-600 underline"
        >
          {ouvert ? "Masquer" : "Historique"}
        </button>

        <div className="flex items-center gap-2">
          {manque ? (
            <span className="rounded-full bg-braise-500/10 px-2 py-0.5 text-[11px] font-medium text-braise-600">
              tendu
            </span>
          ) : null}
          {etat.force && !fige ? (
            <button
              onClick={onReprendreSuggestion}
              className="text-xs text-ardoise-600 underline"
            >
              proposition
            </button>
          ) : null}
          <div className="flex items-center overflow-hidden rounded-lg border border-ardoise-200">
            <button
              disabled={fige || colis <= 0}
              onClick={() => onColis(colis - 1)}
              className="px-3 py-2 text-lg leading-none disabled:opacity-30"
              aria-label="Retirer un colis"
            >
              −
            </button>
            <span className="min-w-10 text-center text-base font-semibold tabular-nums">
              {colis}
            </span>
            <button
              disabled={fige}
              onClick={() => onColis(colis + 1)}
              className="px-3 py-2 text-lg leading-none disabled:opacity-30"
              aria-label="Ajouter un colis"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {ouvert ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-ardoise-100 pt-3 text-xs text-ardoise-600">
          <dt>Fiabilité</dt>
          <dd className="text-right">
            {LIBELLE_FIABILITE[ligne.fiabilite]} ({ligne.nbPoints} relevés)
          </dd>
          <dt>Dernière consommation</dt>
          <dd className="text-right">{qte(ligne.derniereConso)}</dd>
          <dt>Stock au relevé précédent</dt>
          <dd className="text-right">{qte(ligne.stockPrecedent)}</dd>
          <dt className="col-span-2 pt-1">Consommations récentes</dt>
          <dd className="col-span-2 tabular-nums">
            {ligne.serie.length
              ? ligne.serie.map((s) => qte(s.conso)).join(" · ")
              : "aucune"}
          </dd>
        </dl>
      ) : null}
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
    <div className="mt-4">
      {!fige ? (
        <div className="sans-impression mb-4 rounded-xl border border-ardoise-200 bg-white p-3">
          <label
            htmlFor="marge"
            className="block text-sm font-medium text-ardoise-800"
          >
            Marge de sécurité
          </label>
          <p className="mt-0.5 text-xs text-ardoise-600">
            Combien commander au-delà de la consommation attendue. Plus la marge
            est basse, moins il reste de stock en chambre — et plus le risque de
            manquer augmente.
          </p>
          <select
            id="marge"
            defaultValue={String(Number(session.marge))}
            onChange={(e) => onMarge(Number(e.target.value))}
            className="mt-2 w-full rounded-lg border border-ardoise-200 bg-white px-3 py-2 text-sm"
          >
            <option value="0.25">Serrée (+25 %)</option>
            <option value="0.5">Équilibrée (+50 %)</option>
            <option value="0.75">Confortable (+75 %)</option>
            <option value="1">Large (+100 %)</option>
          </select>
        </div>
      ) : null}

      {aCommander.length === 0 ? (
        <p className="rounded-xl border border-ardoise-200 bg-white p-4 text-sm text-ardoise-600">
          Rien à commander pour l’instant. Relevez les stocks chambre par
          chambre : les quantités se remplissent au fur et à mesure.
        </p>
      ) : (
        zones.map((z) => {
          const dedans = aCommander.filter((x) => x.l.zoneId === z.id);
          if (!dedans.length) return null;
          return (
            <section key={z.id} className="mb-4">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ardoise-400">
                {z.nom}
              </h2>
              <ul className="overflow-hidden rounded-xl border border-ardoise-200 bg-white">
                {dedans.map(({ l, colis }) => (
                  <li
                    key={l.produitId}
                    className="flex items-center justify-between gap-3 border-b border-ardoise-100 px-3 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">{l.nom}</p>
                      <p className="text-xs text-ardoise-600">
                        {l.conditionnement ?? "—"} · soit {qte(colis * l.fact)}{" "}
                        {l.unite ?? "u"}
                      </p>
                    </div>
                    <span className="shrink-0 text-base font-semibold tabular-nums">
                      {colis}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      <div className="sans-impression mt-6 space-y-2">
        {fige ? (
          <>
            <p className="text-sm text-sauge-500">
              Commande validée. Elle sert désormais de base à la prévision.
            </p>
            <button
              onClick={onRouvrir}
              className="w-full rounded-lg border border-ardoise-200 px-4 py-3 text-sm font-medium text-ardoise-600"
            >
              Rouvrir pour corriger
            </button>
          </>
        ) : (
          <button
            onClick={onValider}
            disabled={aCommander.length === 0}
            className="w-full rounded-lg bg-ardoise-900 px-4 py-3 font-medium text-white disabled:opacity-40"
          >
            Valider la commande
          </button>
        )}
        <a
          href={`/api/session/${session.id}/pdf`}
          className="block w-full rounded-lg border border-ardoise-900 px-4 py-3 text-center font-medium"
        >
          Télécharger le bon de commande
        </a>
      </div>
    </div>
  );
}
