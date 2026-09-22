"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { suggerer, type Fiabilite } from "@/lib/forecast";
import { dateCourte, normaliser, qte } from "@/lib/format";
import {
  lireNombre,
  mettreEnFile,
  saisiesLocales,
  useFileAttente,
  vider,
} from "@/lib/file-attente";
import type { ReleveResume, Session, Zone } from "@/lib/types";
import EtatEnvoi from "../../EtatEnvoi";

export type LigneSaisie = {
  produitId: number;
  zoneId: number;
  nom: string;
  conditionnement: string | null;
  unite: string | null;
  fact: number;
  stock: number | null;
  colis: number | null;
  perte: number | null;
  /** Dernière écriture côté serveur, en millisecondes. */
  majLe: number;
  /** Quantité que l'application proposait lors de la saisie précédente. */
  suggestionEnregistree: number | null;
  consoPrevue: number;
  fiabilite: Fiabilite;
  nbPoints: number;
  stockPrecedent: number | null;
  joursHorizon: number;
  releves: ReleveResume[];
};

type Etat = {
  stock: number | null;
  colis: number | null;
  force: boolean;
  perte: number | null;
};

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
  const envoi = useFileAttente();
  const [onglet, setOnglet] = useState<number | "recap">(zones[0]?.id ?? "recap");
  const [resteSeul, setResteSeul] = useState(false);
  const [recherche, setRecherche] = useState<string | null>(null);
  const [echec, setEchec] = useState<string | null>(null);

  const etatInitial = useCallback(
    (l: LigneSaisie): Etat => ({
      stock: l.stock,
      colis: l.colis,
      // Une quantité n'est tenue pour un choix du chef que si elle diffère de
      // ce que l'application proposait alors. Sans cette comparaison, rouvrir
      // un relevé figeait toutes les quantités : corriger un stock ne mettait
      // plus la proposition à jour.
      force: l.colis !== null && l.colis !== l.suggestionEnregistree,
      perte: l.perte,
    }),
    [],
  );
  const [etats, setEtats] = useState<Record<number, Etat>>(() =>
    Object.fromEntries(lignes.map((l) => [l.produitId, etatInitial(l)])),
  );
  const etatsRef = useRef(etats);

  const parProduit = useMemo(
    () => new Map(lignes.map((l) => [l.produitId, l])),
    [lignes],
  );
  const nomZone = useMemo(() => new Map(zones.map((z) => [z.id, z.nom])), [zones]);

  // Une page rouverte sans réseau est servie depuis le cache, avec les valeurs
  // de son dernier chargement : ce qui a été saisi depuis sur ce téléphone est
  // plus récent, et doit reprendre sa place.
  useEffect(() => {
    const locales = saisiesLocales(`releve:${session.id}:`);
    const suivant = { ...etatsRef.current };
    let change = false;
    for (const { corps, t } of Object.values(locales)) {
      const l = parProduit.get(Number(corps.produitId));
      if (!l || t <= l.majLe) continue;
      suivant[l.produitId] = {
        stock: (corps.stock as number | null) ?? null,
        colis: (corps.colis as number | null) ?? null,
        force: corps.force === true,
        perte: (corps.perte as number | null) ?? null,
      };
      change = true;
    }
    if (change) {
      etatsRef.current = suivant;
      setEtats(suivant);
    }
  }, [parProduit, session.id]);

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

  const modifier = useCallback(
    (produitId: number, patch: Partial<Etat>) => {
      const l = parProduit.get(produitId);
      if (!l || fige) return;
      const etat = { ...(etatsRef.current[produitId] ?? etatInitial(l)), ...patch };
      etatsRef.current = { ...etatsRef.current, [produitId]: etat };
      setEtats(etatsRef.current);
      // Écrit dans le téléphone tout de suite, envoyé dès que possible.
      mettreEnFile(`releve:${session.id}:${produitId}`, "releve", {
        sessionId: session.id,
        produitId,
        stock: etat.stock,
        colis: colisRetenu(l, etat),
        suggestion: suggerer(l.consoPrevue, etat.stock, l.fact, Number(session.marge)),
        consoPrevue: l.consoPrevue,
        perte: etat.perte,
        force: etat.force,
      });
    },
    [colisRetenu, etatInitial, fige, parProduit, session.id, session.marge],
  );
  const etatDe = (l: LigneSaisie) => etats[l.produitId] ?? etatInitial(l);

  // Les onglets débordent largement de l'écran d'un téléphone : celui qui est
  // ouvert doit être visible. On fait défiler la barre elle-même, pas la page :
  // `scrollIntoView` déplaçait aussi la liste sur certains iPhone.
  const barre = useRef<HTMLDivElement>(null);
  const ongletActif = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const b = barre.current;
    const o = ongletActif.current;
    if (!b || !o) return;
    b.scrollTo({ left: o.offsetLeft - (b.clientWidth - o.clientWidth) / 2, behavior: "smooth" });
  }, [onglet]);

  const nav = useRef<HTMLElement>(null);
  const changerOnglet = (o: number | "recap") => {
    setOnglet(o);
    setRecherche(null);
    figerMasques();
    // En changeant de chambre on repart du haut de la liste, pas du milieu de
    // la précédente.
    const haut = (nav.current?.offsetTop ?? 0) - 1;
    if (window.scrollY > haut) window.scrollTo({ top: Math.max(0, haut) });
  };

  // « Reste à relever » masque les produits déjà comptés au moment où on
  // l'active. Un produit qu'on vient de compter reste affiché : le faire
  // disparaître au premier chiffre tapé décalait toute la liste sous le doigt.
  const [masques, setMasques] = useState<Set<number>>(new Set());
  const figerMasques = () =>
    setMasques(
      new Set(
        Object.entries(etatsRef.current)
          .filter(([, e]) => e.stock !== null)
          .map(([id]) => Number(id)),
      ),
    );

  const saisis = lignes.filter((l) => etatDe(l).stock !== null).length;
  const aCommander = lignes
    .map((l) => ({ l, colis: colisRetenu(l, etatDe(l)), etat: etatDe(l) }))
    .filter((x) => x.colis > 0);

  const terme = recherche ? normaliser(recherche.trim()) : "";
  const visibles = terme
    ? lignes.filter((l) => normaliser(l.nom).includes(terme))
    : lignes.filter(
        (l) => l.zoneId === onglet && (!resteSeul || !masques.has(l.produitId)),
      );

  const valider = async () => {
    setEchec(null);
    // Rien ne se valide tant que des saisies attendent dans le téléphone :
    // elles manqueraient au bon de commande.
    const ok = await vider();
    if (!ok) {
      setEchec("Des saisies n’ont pas pu partir. Retentez avec du réseau.");
      return;
    }
    const r = await fetch(`/api/session/${session.id}/valider`, { method: "POST" });
    if (r.ok) router.refresh();
    else setEchec("Validation impossible");
  };

  return (
    <>
      <nav
        ref={nav}
        className="sans-impression sticky top-0 z-10 border-b border-neutre-100 bg-neutre-50/95 backdrop-blur"
      >
        <div ref={barre} className="defile-x mx-auto max-w-2xl px-4 py-2">
          <div className="flex gap-2">
            <button
              onClick={() => {
                setRecherche((r) => (r === null ? "" : null));
                if (onglet === "recap") setOnglet(zones[0]?.id ?? "recap");
              }}
              aria-label="Chercher un produit"
              className={`flex min-h-10 shrink-0 items-center rounded-full px-3 text-sm font-semibold ${
                recherche !== null
                  ? "bg-neutre-900 text-white"
                  : "border border-neutre-100 bg-white text-neutre-700"
              }`}
            >
              Chercher
            </button>
            {zones.map((z) => {
              const dedans = lignes.filter((l) => l.zoneId === z.id);
              const faits = dedans.filter(
                (l) => etatDe(l).stock !== null,
              ).length;
              const fini = faits === dedans.length && dedans.length > 0;
              const actif = onglet === z.id && !terme;
              return (
                <button
                  key={z.id}
                  ref={onglet === z.id ? ongletActif : undefined}
                  onClick={() => changerOnglet(z.id)}
                  className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ${
                    actif
                      ? "bg-rouge-700 text-white"
                      : "border border-neutre-100 bg-white text-neutre-700"
                  }`}
                >
                  {z.nom}
                  <span
                    className={`rounded-full px-1.5 text-xs font-normal tabular-nums ${
                      actif
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
              onClick={() => changerOnglet("recap")}
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
        {recherche !== null && onglet !== "recap" ? (
          <div className="mx-auto max-w-2xl px-4 pb-2">
            <input
              type="search"
              autoFocus
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Nom du produit, toutes chambres"
              enterKeyHint="search"
              className="min-h-11 w-full rounded-xl border-2 border-neutre-200 bg-white px-3 text-base outline-none focus:border-rouge-700"
            />
          </div>
        ) : null}
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
              }).catch(() => null);
              if (r?.ok) router.refresh();
              else setEchec("Marge non enregistrée (réseau ?)");
            }}
            onValider={valider}
            onRouvrir={async () => {
              const r = await fetch(`/api/session/${session.id}/valider`, {
                method: "DELETE",
              }).catch(() => null);
              if (r?.ok) router.refresh();
              else setEchec("Réouverture impossible (réseau ?)");
            }}
          />
        ) : visibles.length === 0 ? (
          <p className="rounded-2xl border border-neutre-100 bg-white p-4 text-sm text-neutre-500">
            {terme
              ? "Aucun produit ne porte ce nom."
              : "Toute la chambre est relevée. Passez à la suivante, ou touchez le compteur en bas pour réafficher les produits déjà comptés."}
          </p>
        ) : (
          <ul className="space-y-2">
            {visibles.map((l) => {
              const etat = etatDe(l);
              return (
                <ProduitCarte
                  key={l.produitId}
                  ligne={l}
                  etat={etat}
                  colis={colisRetenu(l, etat)}
                  fige={fige}
                  zone={terme ? nomZone.get(l.zoneId) : undefined}
                  onModifier={modifier}
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
            onClick={() => {
              if (!resteSeul) figerMasques();
              setResteSeul((v) => !v);
            }}
            className="min-h-11 min-w-0 flex-1 rounded-xl px-2 text-left"
          >
            <span className="block font-titre text-sm font-semibold tabular-nums">
              {saisis}/{lignes.length} relevés
              {resteSeul ? " · reste à relever" : ""}
            </span>
            <span className="block truncate text-xs text-neutre-500">
              {echec ?? <EtatEnvoi etat={envoi} />}
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

/** Passe au champ de stock suivant, comme on passe au produit suivant sur l'étagère. */
function champSuivant(courant: HTMLInputElement) {
  const champs = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-stock]"));
  const suivant = champs[champs.indexOf(courant) + 1];
  if (suivant) {
    suivant.focus({ preventScroll: true });
    suivant.scrollIntoView({ block: "center", behavior: "smooth" });
  } else {
    courant.blur();
  }
}

/**
 * Champ numérique en texte : `type="number"` rend une valeur vide dès qu'on
 * tape une virgule sur certains Android — la saisie s'effaçait sans bruit. Le
 * texte tapé est gardé tel quel tant qu'il n'est pas un nombre complet (« 2, »).
 */
function ChampNombre({
  valeur,
  onValeur,
  fige,
  placeholder,
  stock,
  className,
  label,
}: {
  valeur: number | null;
  onValeur: (v: number | null) => void;
  fige: boolean;
  placeholder?: string;
  stock?: boolean;
  className: string;
  label: string;
}) {
  const [texte, setTexte] = useState(valeur === null ? "" : qte(valeur));
  useEffect(() => {
    // Valeur changée d'ailleurs (reprise hors ligne) : on la reprend.
    const lu = lireNombre(texte);
    if (lu !== valeur) setTexte(valeur === null ? "" : qte(valeur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valeur]);
  return (
    <input
      type="text"
      inputMode="decimal"
      enterKeyHint={stock ? "next" : "done"}
      autoComplete="off"
      aria-label={label}
      data-stock={stock ? "" : undefined}
      disabled={fige}
      value={texte}
      onChange={(e) => {
        const v = e.target.value;
        const lu = lireNombre(v);
        if (lu === undefined) return;
        setTexte(v);
        if (lu !== valeur) onValeur(lu);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (stock) champSuivant(e.currentTarget);
          else e.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}

const ProduitCarte = memo(function ProduitCarte({
  ligne,
  etat,
  colis,
  fige,
  zone,
  onModifier,
}: {
  ligne: LigneSaisie;
  etat: Etat;
  colis: number;
  fige: boolean;
  zone?: string;
  onModifier: (produitId: number, patch: Partial<Etat>) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [jete, setJete] = useState(etat.perte !== null && etat.perte > 0);
  const compte = etat.stock !== null;
  const tendu =
    compte && ligne.consoPrevue > 0 && etat.stock! < ligne.consoPrevue * 0.5;
  const u = ligne.unite ?? "u";
  const derniereCommande = ligne.releves.find((r) => (r.colis ?? 0) > 0);

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
          {zone ? (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutre-400">
              {zone}
            </p>
          ) : null}
          <p className="font-titre text-[15px] font-semibold leading-snug">
            {ligne.nom}
          </p>

          <div className="mt-1.5 flex items-end justify-between gap-3">
            <div className="min-w-0 text-xs leading-relaxed text-neutre-500">
              <p>
                {ligne.conditionnement ?? "—"} · {qte(ligne.fact)} {u} par colis
              </p>
              {ligne.consoPrevue > 0 ? (
                <p>
                  Besoin estimé {qte(ligne.consoPrevue)} {u} sur{" "}
                  {`${ligne.joursHorizon} j`}
                </p>
              ) : (
                <p>Pas de consommation mesurée</p>
              )}
              {derniereCommande ? (
                <p>
                  Commandé {qte(derniereCommande.colis)} colis le{" "}
                  {dateCourte(derniereCommande.date)}
                </p>
              ) : null}
            </div>

            <label className="shrink-0 text-right">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutre-500">
                Stock
              </span>
              <ChampNombre
                valeur={etat.stock}
                onValeur={(v) => onModifier(ligne.produitId, { stock: v })}
                fige={fige}
                stock
                label={`Stock de ${ligne.nom}`}
                placeholder={
                  ligne.stockPrecedent !== null ? qte(ligne.stockPrecedent) : "—"
                }
                className="mt-0.5 min-h-11 w-24 rounded-xl border-2 border-neutre-200 px-3 text-right text-lg font-semibold tabular-nums outline-none focus:border-rouge-700 disabled:border-neutre-100 disabled:bg-neutre-50"
              />
            </label>
          </div>

          {jete ? (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-ambre-50 px-3 py-2">
              <p className="min-w-0 text-xs leading-snug text-ambre-700">
                <span className="font-semibold">Jeté depuis le dernier relevé</span>
                <br />
                DLC dépassée : ne compte pas comme consommé
              </p>
              <ChampNombre
                valeur={etat.perte}
                onValeur={(v) => onModifier(ligne.produitId, { perte: v })}
                fige={fige}
                label={`Quantité jetée de ${ligne.nom}`}
                placeholder={u}
                className="min-h-10 w-20 shrink-0 rounded-lg border-2 border-ambre-100 bg-white px-2 text-right text-base font-semibold tabular-nums outline-none focus:border-ambre-700"
              />
            </div>
          ) : null}

          <div className="mt-2 flex items-center justify-between gap-2 border-t border-neutre-100 pt-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0">
              <button
                onClick={() => setOuvert((o) => !o)}
                className="min-h-10 shrink-0 text-xs font-semibold text-neutre-500 underline underline-offset-4"
              >
                {ouvert ? "Masquer" : "Historique"}
              </button>
              {!fige && !jete ? (
                <button
                  onClick={() => setJete(true)}
                  className="min-h-10 shrink-0 text-xs font-semibold text-neutre-500 underline underline-offset-4"
                >
                  Jeté
                </button>
              ) : null}
              {tendu ? (
                <span className="shrink-0 rounded-full bg-rouge-50 px-2 py-0.5 text-[11px] font-semibold text-rouge-700">
                  tendu
                </span>
              ) : null}
              {etat.force && !fige ? (
                <button
                  onClick={() =>
                    onModifier(ligne.produitId, { colis: null, force: false })
                  }
                  className="min-h-10 shrink-0 text-xs font-semibold text-neutre-500 underline underline-offset-4"
                >
                  proposition
                </button>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center overflow-hidden rounded-xl border border-neutre-200">
              <button
                disabled={fige || colis <= 0}
                onClick={() =>
                  onModifier(ligne.produitId, { colis: Math.max(0, colis - 1), force: true })
                }
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
                onClick={() =>
                  onModifier(ligne.produitId, { colis: colis + 1, force: true })
                }
                className="min-h-11 w-11 text-xl leading-none text-neutre-700 disabled:opacity-25"
                aria-label="Ajouter un colis"
              >
                +
              </button>
            </div>
          </div>

          {ouvert ? <Historique ligne={ligne} /> : null}
        </div>
      </div>
    </li>
  );
});

/**
 * Les quatre derniers relevés, datés. L'ancien affichage alignait des
 * consommations sans date (« 3 · 5 · 2 ») : impossible de savoir de quelle
 * semaine on parlait.
 */
function Historique({ ligne }: { ligne: LigneSaisie }) {
  const u = ligne.unite ?? "u";
  return (
    <div className="mt-2.5 border-t border-neutre-100 pt-2.5 text-xs text-neutre-500">
      <p>
        Consommation {LIBELLE_FIABILITE[ligne.fiabilite].toLowerCase()} ·{" "}
        {ligne.nbPoints} relevés
      </p>
      {ligne.releves.length ? (
        <table className="mt-2 w-full tabular-nums">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-neutre-400">
              <th className="pb-1 text-left font-semibold">Relevé</th>
              <th className="pb-1 text-right font-semibold">Stock</th>
              <th className="pb-1 text-right font-semibold">Commandé</th>
              <th className="pb-1 text-right font-semibold">Consommé</th>
            </tr>
          </thead>
          <tbody>
            {ligne.releves.map((r) => (
              <tr key={r.date} className="border-t border-neutre-50">
                <td className="py-1 text-left text-neutre-700">{dateCourte(r.date)}</td>
                <td className="py-1 text-right">{qte(r.stock)}</td>
                <td className="py-1 text-right">
                  {r.colis ? `${qte(r.colis)} colis` : "—"}
                </td>
                <td className="py-1 text-right">
                  {qte(r.conso)}
                  {r.perte ? (
                    <span className="block text-ambre-700">jeté {qte(r.perte)}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-1">Aucun relevé précédent.</p>
      )}
      <p className="mt-1.5 text-[11px] text-neutre-400">
        Quantités en {u}. « Consommé » : ce qui est sorti de la chambre depuis le
        relevé d’avant, pertes déduites.
      </p>
    </div>
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
  aCommander: { l: LigneSaisie; colis: number; etat: Etat }[];
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
                {dedans.map(({ l, colis, etat }) => (
                  <li
                    key={l.produitId}
                    className="flex items-center justify-between gap-3 border-b border-neutre-100 px-3 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{l.nom}</p>
                      <p className="text-xs text-neutre-500">
                        stock {qte(etat.stock)} · {l.conditionnement ?? "—"} · soit{" "}
                        {qte(colis * l.fact)} {l.unite ?? "u"}
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
              Commande validée. À la livraison, cochez ce qui est arrivé : la
              prévision se fondera sur ce qui a vraiment été reçu.
            </p>
            <form action="/api/receptions" method="post">
              <input type="hidden" name="session" value={session.id} />
              <button
                type="submit"
                className="min-h-13 w-full rounded-xl bg-vert-700 px-4 font-titre text-base font-semibold text-white"
              >
                Réceptionner la livraison
              </button>
            </form>
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
        <a
          href={`/api/session/${session.id}/pdf?complet=1`}
          className="flex min-h-11 w-full items-center justify-center px-4 text-sm font-semibold text-neutre-500 underline underline-offset-4"
        >
          Relevé complet des stocks (PDF)
        </a>
      </div>
    </div>
  );
}
