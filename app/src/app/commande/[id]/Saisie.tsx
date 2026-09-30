"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import { useEcranAllume } from "@/lib/ecran";
import type { ReleveResume, Session, Zone } from "@/lib/types";
import EtatEnvoi from "../../EtatEnvoi";
import Pave, { frappeDe, frapper, montrerLigne, type Frappe, type Raccourci } from "../../Pave";

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

/** Ce que le pavé est en train de remplir. */
type Cible = { produitId: number; champ: "stock" | "perte" };

// La fiabilité qualifie la régularité de la consommation, pas la quantité
// d'historique : un produit relevé quinze fois peut rester imprévisible. Le
// nombre de relevés est affiché à côté, il n'a pas à être répété ici.
const LIBELLE_FIABILITE: Record<Fiabilite, string> = {
  bonne: "Régulière",
  moyenne: "Variable",
  faible: "Irrégulière",
  aucune: "Jamais relevée",
};

const estTendu = (l: LigneSaisie, e: Etat) =>
  e.stock !== null && l.consoPrevue > 0 && e.stock < l.consoPrevue * 0.5;

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
  useEcranAllume(!fige);

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

  /* ---------------------------------------------------------------------- */
  /* Pavé numérique et fiche produit                                        */
  /* ---------------------------------------------------------------------- */

  const [cible, setCible] = useState<Cible | null>(null);
  const [frappe, setFrappe] = useState<Frappe>({ texte: "", neuf: true });
  const frappeRef = useRef(frappe);
  const [hauteurPave, setHauteurPave] = useState(0);
  const [fiche, setFiche] = useState<number | null>(null);

  const ouvrirPave = useCallback(
    (produitId: number, champ: Cible["champ"] = "stock") => {
      if (fige) return;
      const e = etatsRef.current[produitId];
      const l = parProduit.get(produitId);
      if (!l) return;
      // Une recherche en cours garde le clavier du téléphone ouvert : on le ferme.
      (document.activeElement as HTMLElement | null)?.blur?.();
      const f = frappeDe((e ?? etatInitial(l))[champ]);
      frappeRef.current = f;
      setFrappe(f);
      setFiche(null);
      setCible({ produitId, champ });
    },
    [etatInitial, fige, parProduit],
  );
  const ouvrirFiche = useCallback((produitId: number) => {
    setCible(null);
    setFiche(produitId);
  }, []);

  const toucher = (t: string) => {
    if (!cible) return;
    const f = frapper(frappeRef.current, t);
    frappeRef.current = f;
    setFrappe(f);
    const v = lireNombre(f.texte) ?? null;
    const l = parProduit.get(cible.produitId)!;
    if (v !== (etatsRef.current[cible.produitId] ?? etatInitial(l))[cible.champ]) {
      modifier(cible.produitId, { [cible.champ]: v });
    }
  };

  const nav = useRef<HTMLElement>(null);

  // La ligne en cours de saisie reste visible au-dessus du pavé.
  useEffect(() => {
    if (!cible || cible.champ !== "stock" || !hauteurPave) return;
    montrerLigne(
      document.querySelector(`[data-ligne="${cible.produitId}"]`),
      nav.current?.getBoundingClientRect().bottom ?? 0,
      hauteurPave,
    );
  }, [cible, hauteurPave]);

  // Fiche ouverte : la liste derrière ne défile pas sous le doigt.
  useEffect(() => {
    if (fiche === null) return;
    const html = document.documentElement;
    const avant = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = avant;
    };
  }, [fiche]);

  const changerOnglet = (o: number | "recap") => {
    setOnglet(o);
    setRecherche(null);
    setCible(null);
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

  const indexZone = zones.findIndex((z) => z.id === onglet);
  const zoneSuivante = indexZone >= 0 ? (zones[indexZone + 1] ?? null) : null;

  /** Produit suivant de la liste affichée, comme le suivant sur l'étagère. */
  const suivant = () => {
    if (!cible) return;
    if (cible.champ === "perte") {
      // Retour à la fiche d'où l'on venait.
      setCible(null);
      setFiche(cible.produitId);
      return;
    }
    const i = visibles.findIndex((l) => l.produitId === cible.produitId);
    const prochain = i >= 0 ? visibles[i + 1] : undefined;
    if (prochain) ouvrirPave(prochain.produitId);
    else setCible(null);
  };

  const ligneCible = cible ? parProduit.get(cible.produitId) : undefined;
  const raccourcis: [Raccourci | null, Raccourci | null] = !ligneCible
    ? [null, null]
    : cible?.champ === "perte"
      ? [
          null,
          {
            libelle: "Rien",
            detail: "rien jeté",
            action: () => {
              modifier(ligneCible.produitId, { perte: null });
              setCible(null);
              setFiche(ligneCible.produitId);
            },
          },
        ]
      : [
          ligneCible.stockPrecedent !== null
            ? {
                libelle: "Idem",
                detail: `${qte(ligneCible.stockPrecedent)} ${ligneCible.unite ?? "u"}`,
                action: () => {
                  modifier(ligneCible.produitId, { stock: ligneCible.stockPrecedent });
                  suivant();
                },
              }
            : null,
          {
            libelle: "Aucun",
            detail: "0 et suivant",
            action: () => {
              modifier(ligneCible.produitId, { stock: 0 });
              suivant();
            },
          },
        ];

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

  const ligneFiche = fiche !== null ? parProduit.get(fiche) : undefined;

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
                setCible(null);
                if (onglet === "recap") setOnglet(zones[0]?.id ?? "recap");
              }}
              aria-label="Chercher un produit"
              className={`flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold ${
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
                  className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ${
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
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ${
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
              onFocus={() => setCible(null)}
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
          paddingBottom: cible
            ? `${hauteurPave + 16}px`
            : "calc(var(--barre-basse) + env(safe-area-inset-bottom) + 1rem)",
        }}
      >
        {onglet === "recap" ? (
          <Recapitulatif
            session={session}
            zones={zones}
            aCommander={aCommander}
            saisis={saisis}
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
          <ul className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
            <li
              aria-hidden="true"
              className="flex items-center gap-2 border-b border-neutre-100 bg-neutre-50 py-1.5 pl-4.5 pr-2 text-[11px] font-semibold uppercase tracking-wide text-neutre-400"
            >
              <span className="flex-1">Produit</span>
              <span className="w-[7.75rem] text-center">Stock</span>
              <span className="w-12 text-center">Colis</span>
            </li>
            {visibles.map((l) => {
              const etat = etatDe(l);
              const actif = cible?.produitId === l.produitId && cible.champ === "stock";
              return (
                <LigneProduit
                  key={l.produitId}
                  ligne={l}
                  etat={etat}
                  colis={colisRetenu(l, etat)}
                  fige={fige}
                  zone={terme ? nomZone.get(l.zoneId) : undefined}
                  enAttente={envoi.cles.has(`releve:${session.id}:${l.produitId}`)}
                  frappe={actif ? frappe : null}
                  onStock={ouvrirPave}
                  onFiche={ouvrirFiche}
                />
              );
            })}
          </ul>
        )}

        {onglet !== "recap" && !terme ? (
          <button
            onClick={() => changerOnglet(zoneSuivante?.id ?? "recap")}
            className="sans-impression mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-neutre-200 bg-white px-4 py-2 text-left font-titre text-base font-semibold text-neutre-900 shadow-sm"
          >
            <span className="min-w-0">
              {zoneSuivante ? `Chambre suivante : ${zoneSuivante.nom}` : "Voir le récapitulatif"}
            </span>
            <span aria-hidden="true">→</span>
          </button>
        ) : null}
      </div>

      {!cible ? (
        <footer
          className="sans-impression fixed inset-x-0 bottom-0 z-10 border-t border-neutre-100 bg-white/95 backdrop-blur"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2.5">
            <Link
              href="/"
              aria-label="Retour aux commandes"
              className="-ml-1 flex min-h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-neutre-200 text-xl text-neutre-700"
            >
              ←
            </Link>
            <button
              onClick={() => {
                if (!resteSeul) figerMasques();
                setResteSeul((v) => !v);
              }}
              className="min-h-12 min-w-0 flex-1 rounded-xl px-2 text-left"
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
              className="flex min-h-12 shrink-0 items-center rounded-xl border border-neutre-200 px-4 font-titre text-sm font-semibold text-neutre-700"
            >
              PDF
            </a>
          </div>
        </footer>
      ) : null}

      {cible && ligneCible ? (
        <Pave
          titre={cible.champ === "perte" ? `Jeté · ${ligneCible.nom}` : ligneCible.nom}
          detail={
            cible.champ === "perte"
              ? `En ${ligneCible.unite ?? "unités"}, depuis le dernier relevé`
              : [
                  `Stock en ${ligneCible.unite ?? "unités"}`,
                  ligneCible.stockPrecedent !== null
                    ? `dernier relevé ${qte(ligneCible.stockPrecedent)} ${ligneCible.unite ?? "u"}`
                    : null,
                  ligneCible.consoPrevue > 0
                    ? `besoin ${qte(ligneCible.consoPrevue)} ${ligneCible.unite ?? "u"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || (ligneCible.conditionnement ?? undefined)
          }
          frappe={frappe}
          raccourcis={raccourcis}
          libelleSuivant={cible.champ === "perte" ? "OK" : "Suivant"}
          onTouche={toucher}
          onSuivant={suivant}
          onFermer={() => setCible(null)}
          onHauteur={setHauteurPave}
        />
      ) : null}

      {ligneFiche ? (
        <Fiche
          ligne={ligneFiche}
          etat={etatDe(ligneFiche)}
          colis={colisRetenu(ligneFiche, etatDe(ligneFiche))}
          proposition={
            etatDe(ligneFiche).stock === null
              ? null
              : suggerer(
                  ligneFiche.consoPrevue,
                  etatDe(ligneFiche).stock,
                  ligneFiche.fact,
                  Number(session.marge),
                )
          }
          zone={nomZone.get(ligneFiche.zoneId)}
          fige={fige}
          enAttente={envoi.cles.has(`releve:${session.id}:${ligneFiche.produitId}`)}
          onModifier={modifier}
          onStock={() => ouvrirPave(ligneFiche.produitId, "stock")}
          onPerte={() => ouvrirPave(ligneFiche.produitId, "perte")}
          onFermer={() => setFiche(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Une ligne par produit : le nom, le stock compté, les colis proposés. Tout le
 * reste (historique, pertes, correction de la commande) est dans la fiche qui
 * s'ouvre en touchant le nom ou les colis. Les anciennes cartes faisaient
 * trois fois cette hauteur : quatre produits par écran, pour des chambres
 * qui en comptent des dizaines.
 */
const LigneProduit = memo(function LigneProduit({
  ligne,
  etat,
  colis,
  fige,
  zone,
  enAttente,
  frappe,
  onStock,
  onFiche,
}: {
  ligne: LigneSaisie;
  etat: Etat;
  colis: number;
  fige: boolean;
  zone?: string;
  enAttente: boolean;
  /** Frappe en cours quand le pavé remplit cette ligne. */
  frappe: Frappe | null;
  onStock: (produitId: number) => void;
  onFiche: (produitId: number) => void;
}) {
  const compte = etat.stock !== null;
  const u = ligne.unite ?? "u";
  const tendu = estTendu(ligne, etat);
  const actif = frappe !== null;

  return (
    <li
      data-ligne={ligne.produitId}
      className={`flex items-stretch border-b border-neutre-100 last:border-b-0 ${
        actif ? "bg-rouge-50" : ""
      }`}
    >
      {/* Vert : enregistré. Orange : gardé dans le téléphone, pas encore envoyé. */}
      <div
        className={`w-1.5 shrink-0 ${
          !compte && !enAttente ? "bg-transparent" : enAttente ? "bg-ambre-400" : "bg-vert-600"
        }`}
        aria-hidden="true"
      />
      <button
        onClick={() => onFiche(ligne.produitId)}
        className="min-w-0 flex-1 py-2 pl-3 pr-2 text-left"
      >
        {zone ? (
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutre-400">
            {zone}
          </span>
        ) : null}
        <span className="line-clamp-2 font-titre text-[15px] font-semibold leading-snug">
          {ligne.nom}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutre-500">
          <span>
            {ligne.stockPrecedent !== null
              ? `dernier ${qte(ligne.stockPrecedent)} ${u}`
              : (ligne.conditionnement ?? `${qte(ligne.fact)} ${u}/colis`)}
          </span>
          {etat.perte ? (
            <span className="font-semibold text-ambre-700">jeté {qte(etat.perte)}</span>
          ) : null}
          {tendu ? (
            <span className="rounded-full bg-rouge-50 px-1.5 text-[11px] font-semibold text-rouge-700">
              tendu
            </span>
          ) : null}
          {enAttente ? <span className="text-ambre-700">sur le téléphone</span> : null}
        </span>
      </button>
      {/* L'unité de comptage, juste devant le champ : kg, main, BTL… */}
      <span
        onClick={fige ? undefined : () => onStock(ligne.produitId)}
        aria-hidden="true"
        className={`flex w-12 shrink-0 items-center justify-end truncate pr-1.5 text-xs font-semibold ${
          ligne.unite ? "text-neutre-600" : "text-neutre-300"
        }`}
      >
        {ligne.unite ?? "u"}
      </span>
      <button
        onClick={() => onStock(ligne.produitId)}
        disabled={fige}
        aria-label={`Stock de ${ligne.nom} en ${ligne.unite ?? "unités"} : ${compte ? qte(etat.stock) : "à relever"}`}
        className={`my-1.5 flex min-h-12 w-[4.75rem] shrink-0 items-center justify-end rounded-xl border-2 px-2.5 text-lg font-semibold tabular-nums ${
          actif
            ? "border-rouge-700 bg-white"
            : compte
              ? "border-neutre-200 bg-white"
              : "border-dashed border-neutre-300 bg-neutre-50 text-neutre-400"
        } disabled:border-neutre-100 disabled:bg-neutre-50`}
      >
        {actif ? (
          <>
            <span className={frappe.neuf && frappe.texte ? "rounded bg-rouge-100" : ""}>
              {frappe.texte}
            </span>
            <span className="curseur" aria-hidden="true" />
          </>
        ) : compte ? (
          qte(etat.stock)
        ) : (
          "—"
        )}
      </button>
      <button
        onClick={() => onFiche(ligne.produitId)}
        aria-label={`Commande de ${ligne.nom} : ${colis} colis`}
        className={`my-1.5 ml-1.5 mr-2 flex min-h-12 w-12 shrink-0 items-center justify-center rounded-xl border font-titre text-lg font-semibold tabular-nums ${
          etat.force
            ? "border-ambre-400 bg-ambre-50 text-ambre-700"
            : colis > 0
              ? "border-vert-200 bg-vert-50 text-vert-800"
              : "border-neutre-100 text-neutre-300"
        }`}
      >
        {colis > 0 || etat.force ? colis : "·"}
      </button>
    </li>
  );
});

/**
 * Tout ce qui concerne un produit, au pouce : stock, commande, pertes,
 * historique. Des boutons pleins plutôt que les petits liens soulignés des
 * anciennes cartes, trop fins pour des gants.
 */
function Fiche({
  ligne,
  etat,
  colis,
  proposition,
  zone,
  fige,
  enAttente,
  onModifier,
  onStock,
  onPerte,
  onFermer,
}: {
  ligne: LigneSaisie;
  etat: Etat;
  colis: number;
  proposition: number | null;
  zone?: string;
  fige: boolean;
  enAttente: boolean;
  onModifier: (produitId: number, patch: Partial<Etat>) => void;
  onStock: () => void;
  onPerte: () => void;
  onFermer: () => void;
}) {
  const u = ligne.unite ?? "u";
  const derniereCommande = ligne.releves.find((r) => (r.colis ?? 0) > 0);

  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onFermer]);

  return (
    <div className="sans-impression fixed inset-0 z-30" role="dialog" aria-modal="true" aria-label={ligne.nom}>
      <button
        aria-label="Fermer la fiche"
        onClick={onFermer}
        className="absolute inset-0 h-full w-full bg-neutre-950/40"
      />
      <div
        className="absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] max-w-2xl overflow-y-auto overscroll-contain rounded-t-3xl bg-white shadow-xl"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      >
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-neutre-100 bg-white px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            {zone ? (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutre-400">
                {zone}
              </p>
            ) : null}
            <h2 className="font-titre text-lg font-semibold leading-snug">{ligne.nom}</h2>
            <p className="text-xs text-neutre-500">
              {ligne.conditionnement ?? "—"} · {qte(ligne.fact)} {u} par colis
            </p>
          </div>
          <button
            onClick={onFermer}
            className="min-h-12 shrink-0 rounded-xl bg-neutre-50 px-4 text-sm font-semibold text-neutre-700"
          >
            Fermer
          </button>
        </div>

        <div className="space-y-3 px-4 pt-4">
          <button
            onClick={onStock}
            disabled={fige}
            className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border-2 border-neutre-200 px-4 py-2 text-left disabled:border-neutre-100 disabled:bg-neutre-50"
          >
            <span className="min-w-0">
              <span className="block font-titre text-base font-semibold">Stock en chambre</span>
              <span className="block text-xs text-neutre-500">
                {ligne.stockPrecedent !== null
                  ? `dernier relevé : ${qte(ligne.stockPrecedent)} ${u}`
                  : "jamais relevé"}
                {enAttente ? " · gardé sur le téléphone" : ""}
              </span>
            </span>
            <span className="shrink-0 font-titre text-2xl font-semibold tabular-nums">
              {etat.stock === null ? "—" : `${qte(etat.stock)} ${u}`}
            </span>
          </button>

          <div className="rounded-2xl border border-neutre-100 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-titre text-base font-semibold">À commander</p>
                <p className="text-xs text-neutre-500">
                  {colis} colis · soit {qte(colis * ligne.fact)} {u}
                </p>
              </div>
              <div className="flex shrink-0 items-center overflow-hidden rounded-xl border border-neutre-200">
                <button
                  disabled={fige || colis <= 0}
                  onClick={() =>
                    onModifier(ligne.produitId, { colis: Math.max(0, colis - 1), force: true })
                  }
                  className="h-14 w-14 text-2xl leading-none text-neutre-700 active:bg-neutre-100 disabled:opacity-25"
                  aria-label="Retirer un colis"
                >
                  −
                </button>
                <span className="min-w-12 border-x border-neutre-200 py-3 text-center font-titre text-2xl font-semibold tabular-nums">
                  {colis}
                </span>
                <button
                  disabled={fige}
                  onClick={() => onModifier(ligne.produitId, { colis: colis + 1, force: true })}
                  className="h-14 w-14 text-2xl leading-none text-neutre-700 active:bg-neutre-100 disabled:opacity-25"
                  aria-label="Ajouter un colis"
                >
                  +
                </button>
              </div>
            </div>
            <div className="mt-2 space-y-0.5 text-xs leading-relaxed text-neutre-500">
              <p>
                {ligne.consoPrevue > 0
                  ? `Besoin estimé ${qte(ligne.consoPrevue)} ${u} sur ${ligne.joursHorizon} j`
                  : "Pas de consommation mesurée"}
              </p>
              {derniereCommande ? (
                <p>
                  Commandé {qte(derniereCommande.colis)} colis le {dateCourte(derniereCommande.date)}
                </p>
              ) : null}
            </div>
            {estTendu(ligne, etat) ? (
              <p className="mt-2 rounded-lg bg-rouge-50 px-3 py-2 text-xs text-rouge-700">
                <span className="font-semibold">Stock tendu</span> : moins de la moitié du
                besoin estimé d’ici la prochaine livraison.
              </p>
            ) : null}
            {etat.force && !fige ? (
              <button
                onClick={() => onModifier(ligne.produitId, { colis: null, force: false })}
                className="mt-3 min-h-12 w-full rounded-xl border border-neutre-200 px-3 text-sm font-semibold text-neutre-700"
              >
                {proposition === null
                  ? "Annuler la correction"
                  : `Revenir à la proposition (${proposition} colis)`}
              </button>
            ) : null}
          </div>

          <button
            onClick={onPerte}
            disabled={fige}
            className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl bg-ambre-50 px-4 py-2 text-left"
          >
            <span className="min-w-0 text-ambre-700">
              <span className="block font-titre text-base font-semibold">Jeté depuis le dernier relevé</span>
              <span className="block text-xs">DLC dépassée : ne compte pas comme consommé</span>
            </span>
            <span className="shrink-0 font-titre text-lg font-semibold tabular-nums text-ambre-700">
              {etat.perte ? `${qte(etat.perte)} ${u}` : fige ? "—" : "Déclarer"}
            </span>
          </button>

          <div className="pt-1">
            <h3 className="px-1 font-titre text-xs font-bold uppercase tracking-[0.14em] text-neutre-500">
              Historique
            </h3>
            <Historique ligne={ligne} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Les quatre derniers relevés, datés. L'ancien affichage alignait des
 * consommations sans date (« 3 · 5 · 2 ») : impossible de savoir de quelle
 * semaine on parlait.
 */
function Historique({ ligne }: { ligne: LigneSaisie }) {
  const u = ligne.unite ?? "u";
  return (
    <div className="mt-1.5 px-1 text-xs text-neutre-500">
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
  saisis,
  fige,
  onMarge,
  onValider,
  onRouvrir,
}: {
  session: Session;
  zones: Zone[];
  aCommander: { l: LigneSaisie; colis: number; etat: Etat }[];
  /** Nombre de produits dont le stock a été relevé. */
  saisis: number;
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
          {saisis === 0
            ? "Rien à commander pour l’instant. Relevez les stocks chambre par chambre : les quantités se remplissent au fur et à mesure."
            : fige
              ? "Aucune commande passée pour ce relevé."
              : "Rien à commander cette fois. Validez quand même : le relevé des stocks sera enregistré et servira au calcul des consommations de la semaine suivante."}
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
            {aCommander.length > 0 ? (
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
              </>
            ) : (
              <p className="rounded-xl bg-vert-50 px-4 py-3 text-sm text-vert-800">
                Relevé validé, sans commande : rien ne sera livré.
              </p>
            )}
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
            disabled={saisis === 0}
            className="min-h-13 w-full rounded-xl bg-vert-700 px-4 font-titre text-base font-semibold text-white disabled:opacity-35"
          >
            {aCommander.length === 0 ? "Valider sans commande" : "Valider la commande"}
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
