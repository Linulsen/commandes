"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { stockDisponible, suggerer, type Fiabilite } from "@/lib/forecast";
import { dateCourte, normaliser, qte } from "@/lib/format";
import {
  lireNombre,
  mettreEnFile,
  saisiesLocales,
  useFileAttente,
  vider,
} from "@/lib/file-attente";
import { useEcranAllume } from "@/lib/ecran";
import { useTri } from "@/lib/tri";
import { comparer } from "@/lib/tri-commun";
import type { ReleveResume, Session, Zone } from "@/lib/types";
import EtatEnvoi from "../../EtatEnvoi";
import ChoixTri from "../../ChoixTri";
import Pave, { frappeDe, frapper, montrerLigne, type Frappe, type Raccourci } from "../../Pave";

export type LigneSaisie = {
  produitId: number;
  zoneId: number;
  /** Libellé affiché : le libellé court s'il existe. */
  nom: string;
  /** Nom complet du produit, pour la recherche. */
  nomComplet: string;
  /** Place dans l'ordre de rangement ; null : pas encore placé. */
  rang: number | null;
  conditionnement: string | null;
  unite: string | null;
  fact: number;
  /**
   * Ligne de comptage seulement : le produit qu'elle complète. Elle ne se
   * commande jamais ; son stock × `equivalence` s'ajoute à celui du produit.
   */
  comptePour: number | null;
  equivalence: number | null;
  /** Nom du produit complété, pour l'afficher sous la ligne de comptage. */
  nomRattache: string | null;
  stock: number | null;
  colis: number | null;
  perte: number | null;
  /** Cartons saisis (déjà inclus dans `stock`). */
  stockColis: number | null;
  /** Le stock se saisit en deux cases : cartons et unités. */
  parCarton: boolean;
  /** Dernière écriture côté serveur, en millisecondes. */
  majLe: number;
  /** Quantité que l'application proposait lors de la saisie précédente. */
  suggestionEnregistree: number | null;
  consoPrevue: number;
  fiabilite: Fiabilite;
  nbPoints: number;
  stockPrecedent: number | null;
  /**
   * Ce qui pouvait rester en chambre (relevé précédent + entrées − sorties
   * enregistrées). Compter plus serait une consommation négative.
   */
  plafond: number | null;
  /** Stock confirmé malgré tout la dernière fois qu'il dépassait le plafond. */
  stockVerifie: number | null;
  /** Vendu sur au moins une des 8 dernières périodes. */
  aConsomme: boolean;
  joursHorizon: number;
  releves: ReleveResume[];
  /** Emprunté à un autre Del Arte, pas encore rendu : réservé, hors stock disponible. */
  reserve: number;
  /** Prêté à un autre Del Arte, pas encore revenu. */
  duNous: number;
  echanges: { delArte: string; nousDevons: number; ilsDoivent: number }[];
  /** Choix enregistré : quantité dont on attend le retour (0 : non ; null : à décider). */
  retourAttendu: number | null;
};

type Etat = {
  /** Stock total, en unités de comptage : c'est lui qui sert au calcul. */
  stock: number | null;
  /** Saisie en cartons + unités : les deux cases telles que tapées. */
  cartons: number | null;
  unites: number | null;
  colis: number | null;
  force: boolean;
  perte: number | null;
  /**
   * Ce qu'un autre Del Arte nous doit et dont on attend le retour cette
   * semaine : ajouté au stock pour la proposition. 0 : commander selon la
   * préconisation ; null : question pas encore tranchée.
   */
  retour: number | null;
  /** Stock confirmé alors qu'il dépassait ce qui pouvait rester. */
  verifie: number | null;
};

/** Ce que le pavé est en train de remplir. */
type Cible = { produitId: number; champ: "stock" | "cartons" | "unites" | "perte" };

/** Cartons et unités tirés d'un stock enregistré. */
const decouper = (l: LigneSaisie, stock: number | null, stockColis: number | null) => {
  if (!l.parCarton || stock === null) return { cartons: null, unites: null };
  if (stockColis === null) return { cartons: null, unites: stock };
  const unites = Math.round((stock - stockColis * l.fact) * 1000) / 1000;
  return { cartons: stockColis, unites };
};

/** Stock total d'une saisie en cartons + unités ; null si rien n'est tapé. */
const totalCartons = (l: LigneSaisie, cartons: number | null, unites: number | null) =>
  cartons === null && unites === null
    ? null
    : Math.round(((cartons ?? 0) * l.fact + (unites ?? 0)) * 1000) / 1000;

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
  e.stock !== null &&
  ((l.consoPrevue > 0 && e.stock < l.consoPrevue * 0.5) || (e.stock <= 0 && l.aConsomme));

const arrondi = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Stock compté supérieur à ce qui pouvait rester : la consommation serait
 * négative, ce qui n'existe pas. `total` : stock avec lignes de comptage.
 */
const depassePlafond = (l: LigneSaisie, e: Etat, total: number | null) =>
  l.comptePour === null &&
  l.plafond !== null &&
  total !== null &&
  arrondi(total + (e.perte ?? 0)) > arrondi(l.plafond);

export default function Saisie({
  session,
  zones,
  lignes,
  chargeLe,
}: {
  session: Session;
  zones: Zone[];
  lignes: LigneSaisie[];
  /** Heure du serveur (ms) quand la page a été calculée. */
  chargeLe: number;
}) {
  const router = useRouter();

  // Un relevé rouvert par le bouton retour, ou laissé ouvert pendant qu'on
  // changeait l'ordre de rangement depuis l'inventaire, réaffichait la liste
  // de son premier chargement. Revenu à l'écran, il se recharge (les saisies
  // en cours ne sont pas touchées : elles vivent dans `etats`).
  const dernierChargement = useRef(chargeLe);
  useEffect(() => {
    dernierChargement.current = Math.max(dernierChargement.current, chargeLe);
  }, [chargeLe]);
  useEffect(() => {
    const rafraichir = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (Date.now() - dernierChargement.current < 30_000) return;
      dernierChargement.current = Date.now();
      router.refresh();
    };
    rafraichir();
    document.addEventListener("visibilitychange", rafraichir);
    window.addEventListener("pageshow", rafraichir);
    return () => {
      document.removeEventListener("visibilitychange", rafraichir);
      window.removeEventListener("pageshow", rafraichir);
    };
  }, [router]);
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
      ...decouper(l, l.stock, l.stockColis),
      colis: l.colis,
      // Une quantité n'est tenue pour un choix du chef que si elle diffère de
      // ce que l'application proposait alors. Sans cette comparaison, rouvrir
      // un relevé figeait toutes les quantités : corriger un stock ne mettait
      // plus la proposition à jour.
      force: l.colis !== null && l.colis !== l.suggestionEnregistree,
      perte: l.perte,
      retour: l.retourAttendu,
      verifie: l.stockVerifie,
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
      const stock = (corps.stock as number | null) ?? null;
      suivant[l.produitId] = {
        stock,
        ...decouper(l, stock, (corps.stockColis as number | null) ?? null),
        colis: (corps.colis as number | null) ?? null,
        force: corps.force === true,
        perte: (corps.perte as number | null) ?? null,
        retour:
          "retourAttendu" in corps
            ? ((corps.retourAttendu as number | null) ?? null)
            : (suivant[l.produitId]?.retour ?? l.retourAttendu),
        verifie:
          "stockVerifie" in corps
            ? ((corps.stockVerifie as number | null) ?? null)
            : (suivant[l.produitId]?.verifie ?? l.stockVerifie),
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
  // Lignes de comptage rattachées à chaque produit (ex. sucrines en sachet de
  // 6 pour les sucrines en sachet de 3).
  const rattachees = useMemo(() => {
    const m = new Map<number, LigneSaisie[]>();
    for (const l of lignes) {
      if (l.comptePour === null) continue;
      m.set(l.comptePour, [...(m.get(l.comptePour) ?? []), l]);
    }
    return m;
  }, [lignes]);

  /**
   * Stock qui sert au calcul : celui de la ligne, plus celui de ses lignes de
   * comptage converti. Lu dans `etatsRef`, tenu à jour avant chaque rendu.
   */
  const stockTotal = useCallback(
    (l: LigneSaisie, e: Etat): number | null => {
      const enfants = rattachees.get(l.produitId);
      if (!enfants?.length) return e.stock;
      let ajout = 0;
      let compte = false;
      for (const c of enfants) {
        const ec = etatsRef.current[c.produitId] ?? etatInitial(c);
        if (ec.stock === null) continue;
        ajout += ec.stock * (c.equivalence ?? 1);
        compte = true;
      }
      if (e.stock === null && !compte) return null;
      return (e.stock ?? 0) + ajout;
    },
    [etatInitial, rattachees],
  );

  /**
   * Stock pour la proposition : sans ce que nous devons à un autre Del Arte,
   * avec ce qu'on nous doit si l'on compte sur son retour.
   */
  const stockDispo = useCallback(
    (l: LigneSaisie, e: Etat, retour = e.retour) =>
      stockDisponible(stockTotal(l, e), l.reserve, l.duNous > 0 ? retour : null),
    [stockTotal],
  );

  const propositionDe = useCallback(
    (l: LigneSaisie, e: Etat, retour = e.retour) =>
      l.comptePour !== null
        ? 0
        : suggerer(
            l.consoPrevue,
            stockDispo(l, e, retour),
            l.fact,
            Number(session.marge),
            l.aConsomme,
          ),
    [session.marge, stockDispo],
  );

  /**
   * Un autre Del Arte nous doit ce produit et la préconisation en demande :
   * faut-il commander, ou compter sur leur retour cette semaine ?
   */
  const questionOuverte = useCallback(
    (l: LigneSaisie, e: Etat) =>
      l.comptePour === null &&
      l.duNous > 0 &&
      e.retour === null &&
      stockTotal(l, e) !== null &&
      propositionDe(l, e, 0) > 0,
    [propositionDe, stockTotal],
  );

  /**
   * Stock plus élevé que ce qui pouvait rester, pas encore confirmé : à
   * corriger ou à confirmer avant de valider.
   */
  const stockAVerifier = useCallback(
    (l: LigneSaisie, e: Etat) => {
      const total = stockTotal(l, e);
      return (
        depassePlafond(l, e, total) &&
        (e.verifie === null || arrondi(e.verifie) !== arrondi(total!))
      );
    },
    [stockTotal],
  );

  const colisRetenu = useCallback(
    (l: LigneSaisie, e: Etat) => {
      // Une ligne de comptage ne se commande jamais.
      if (l.comptePour !== null) return 0;
      if (e.force) return e.colis ?? 0;
      if (stockTotal(l, e) === null) return 0;
      return propositionDe(l, e);
    },
    [propositionDe, stockTotal],
  );

  // Écrit dans le téléphone tout de suite, envoyé dès que possible.
  const envoyer = useCallback(
    (l: LigneSaisie, etat: Etat) =>
      mettreEnFile(`releve:${session.id}:${l.produitId}`, "releve", {
        sessionId: session.id,
        produitId: l.produitId,
        stock: etat.stock,
        colis: colisRetenu(l, etat),
        suggestion: propositionDe(l, etat),
        consoPrevue: l.consoPrevue,
        perte: etat.perte,
        force: etat.force,
        ...(l.duNous > 0 ? { retourAttendu: etat.retour } : {}),
        stockVerifie: etat.verifie,
        ...(l.parCarton ? { stockColis: etat.stock === null ? null : etat.cartons } : {}),
      }),
    [colisRetenu, propositionDe, session.id],
  );

  const modifier = useCallback(
    (produitId: number, patch: Partial<Etat>) => {
      const l = parProduit.get(produitId);
      if (!l || fige) return;
      const etat = { ...(etatsRef.current[produitId] ?? etatInitial(l)), ...patch };
      if (l.parCarton) {
        if ("cartons" in patch || "unites" in patch) {
          etat.stock = totalCartons(l, etat.cartons, etat.unites);
        } else if ("stock" in patch) {
          // « Idem », « Aucun » : le stock se répartit en cartons pleins et reste.
          if (etat.stock === null) {
            etat.cartons = null;
            etat.unites = null;
          } else {
            etat.cartons = Math.floor(etat.stock / l.fact);
            etat.unites = Math.round((etat.stock - etat.cartons * l.fact) * 1000) / 1000;
          }
        }
      }
      if (l.comptePour !== null) {
        etat.colis = null;
        etat.force = false;
      }
      etatsRef.current = { ...etatsRef.current, [produitId]: etat };
      setEtats(etatsRef.current);
      envoyer(l, etat);
      // Le stock d'une ligne de comptage change la quantité proposée pour le
      // produit qu'elle complète : on renvoie celui-ci aussi.
      const principal = l.comptePour !== null ? parProduit.get(l.comptePour) : undefined;
      if (principal) {
        envoyer(principal, etatsRef.current[principal.produitId] ?? etatInitial(principal));
      }
    },
    [envoyer, etatInitial, fige, parProduit],
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
    (produitId: number, demande: Cible["champ"] = "stock") => {
      if (fige) return;
      const e = etatsRef.current[produitId];
      const l = parProduit.get(produitId);
      if (!l) return;
      // Saisie en cartons + unités : on commence par les cartons.
      const champ = l.parCarton && demande === "stock" ? "cartons" : demande;
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
    if (!cible || cible.champ === "perte" || !hauteurPave) return;
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
  const questions = lignes.filter((l) => questionOuverte(l, etatDe(l)));
  const aVerifier = lignes.filter((l) => stockAVerifier(l, etatDe(l)));
  const aCommander = lignes
    .map((l) => ({ l, colis: colisRetenu(l, etatDe(l)), etat: etatDe(l) }))
    .filter((x) => x.colis > 0);

  const [tri, setTri] = useTri();
  const lignesTriees = useMemo(() => [...lignes].sort(comparer(tri)), [lignes, tri]);

  const terme = recherche ? normaliser(recherche.trim()) : "";
  const visibles = terme
    ? lignesTriees.filter((l) => normaliser(`${l.nom} ${l.nomComplet}`).includes(terme))
    : lignesTriees.filter(
        (l) => l.zoneId === onglet && (!resteSeul || !masques.has(l.produitId)),
      );

  const indexZone = zones.findIndex((z) => z.id === onglet);
  const zoneSuivante = indexZone >= 0 ? (zones[indexZone + 1] ?? null) : null;

  /** Produit suivant de la liste affichée, comme le suivant sur l'étagère. */
  const suivant = (produitSuivant = false) => {
    if (!cible) return;
    if (cible.champ === "perte") {
      // Retour à la fiche d'où l'on venait.
      setCible(null);
      setFiche(cible.produitId);
      return;
    }
    // Des cartons on passe aux unités du même produit.
    if (cible.champ === "cartons" && !produitSuivant) {
      ouvrirPave(cible.produitId, "unites");
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
                  suivant(true);
                },
              }
            : null,
          {
            libelle: "Aucun",
            detail: "0 et suivant",
            action: () => {
              modifier(ligneCible.produitId, { stock: 0 });
              suivant(true);
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
            questions={questions.map((l) => ({
              l,
              selon: propositionDe(l, etatDe(l), 0),
              avecRetour: propositionDe(l, etatDe(l), l.duNous),
            }))}
            onRetour={(produitId, retour) => modifier(produitId, { retour })}
            aVerifier={aVerifier.map((l) => ({
              l,
              total: stockTotal(l, etatDe(l))!,
            }))}
            onConfirmer={(produitId, total) => modifier(produitId, { verifie: total })}
            onCorriger={(produitId) => ouvrirPave(produitId, "stock")}
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
        ) : null}

        {onglet !== "recap" && !terme ? (
          <ChoixTri tri={tri} onTri={setTri} />
        ) : null}

        {onglet === "recap" ? null : visibles.length === 0 ? (
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
              const actif =
                cible?.produitId === l.produitId && cible.champ !== "perte"
                  ? cible.champ
                  : null;
              return (
                <LigneProduit
                  key={l.produitId}
                  ligne={l}
                  etat={etat}
                  colis={colisRetenu(l, etat)}
                  stockTotal={stockTotal(l, etat)}
                  question={questionOuverte(l, etat)}
                  aVerifier={stockAVerifier(l, etat)}
                  fige={fige}
                  zone={terme ? nomZone.get(l.zoneId) : undefined}
                  enAttente={envoi.cles.has(`releve:${session.id}:${l.produitId}`)}
                  frappe={actif ? frappe : null}
                  champActif={actif}
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
              : cible.champ === "cartons"
                ? `Cartons pleins · 1 carton = ${qte(ligneCible.fact)} ${ligneCible.unite ?? "u"}`
                : cible.champ === "unites"
                  ? [
                      `${ligneCible.unite ?? "Unités"} hors cartons`,
                      `${qte(etatDe(ligneCible).cartons ?? 0)} carton${(etatDe(ligneCible).cartons ?? 0) > 1 ? "s" : ""} déjà saisi${(etatDe(ligneCible).cartons ?? 0) > 1 ? "s" : ""}`,
                    ].join(" · ")
              : [
                  `Stock en ${ligneCible.unite ?? "unités"}`,
                  ligneCible.stockPrecedent !== null
                    ? `dernier relevé ${qte(ligneCible.stockPrecedent)} ${ligneCible.unite ?? "u"}`
                    : null,
                  ligneCible.consoPrevue > 0
                    ? `besoin ${qte(ligneCible.consoPrevue)} ${ligneCible.unite ?? "u"}`
                    : null,
                  stockAVerifier(ligneCible, etatDe(ligneCible))
                    ? `⚠ plus que possible (max ${qte(ligneCible.plafond!)})`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || (ligneCible.conditionnement ?? undefined)
          }
          frappe={frappe}
          raccourcis={raccourcis}
          libelleSuivant={cible.champ === "perte" ? "OK" : "Suivant"}
          onTouche={toucher}
          onSuivant={() => suivant()}
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
            stockTotal(ligneFiche, etatDe(ligneFiche)) === null
              ? null
              : propositionDe(ligneFiche, etatDe(ligneFiche))
          }
          stockTotal={stockTotal(ligneFiche, etatDe(ligneFiche))}
          stockDispo={stockDispo(ligneFiche, etatDe(ligneFiche))}
          selon={propositionDe(ligneFiche, etatDe(ligneFiche), 0)}
          avecRetour={propositionDe(ligneFiche, etatDe(ligneFiche), ligneFiche.duNous)}
          aVerifier={stockAVerifier(ligneFiche, etatDe(ligneFiche))}
          depasse={depassePlafond(
            ligneFiche,
            etatDe(ligneFiche),
            stockTotal(ligneFiche, etatDe(ligneFiche)),
          )}
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
  stockTotal,
  question,
  aVerifier,
  fige,
  zone,
  enAttente,
  frappe,
  champActif,
  onStock,
  onFiche,
}: {
  ligne: LigneSaisie;
  etat: Etat;
  colis: number;
  /** Stock de la ligne et de ses lignes de comptage, converti. */
  stockTotal: number | null;
  /** Un autre Del Arte nous doit ce produit : commander ou attendre ? */
  question: boolean;
  /** Stock plus élevé que ce qui pouvait rester, pas encore confirmé. */
  aVerifier: boolean;
  fige: boolean;
  zone?: string;
  enAttente: boolean;
  /** Frappe en cours quand le pavé remplit cette ligne. */
  frappe: Frappe | null;
  /** Case que le pavé remplit sur cette ligne. */
  champActif: Cible["champ"] | null;
  onStock: (produitId: number, champ?: Cible["champ"]) => void;
  onFiche: (produitId: number) => void;
}) {
  const compte = etat.stock !== null;
  const u = ligne.unite ?? "u";
  const comptage = ligne.comptePour !== null;
  const tendu = !comptage && estTendu(ligne, { ...etat, stock: stockTotal });
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
          {comptage ? (
            <span>
              comptage seul · 1 = {qte(ligne.equivalence ?? 1)}{" "}
              {ligne.nomRattache ? `« ${ligne.nomRattache} »` : ""}
            </span>
          ) : (
            <span>
              {ligne.stockPrecedent !== null
                ? `dernier ${qte(ligne.stockPrecedent)} ${u}`
                : (ligne.conditionnement ?? `${qte(ligne.fact)} ${u}/colis`)}
            </span>
          )}
          {!comptage && stockTotal !== null && stockTotal !== etat.stock ? (
            <span className="font-semibold text-neutre-700">
              total {qte(stockTotal)} {u}
            </span>
          ) : null}
          {etat.perte ? (
            <span className="font-semibold text-ambre-700">jeté {qte(etat.perte)}</span>
          ) : null}
          {tendu ? (
            <span className="rounded-full bg-rouge-50 px-1.5 text-[11px] font-semibold text-rouge-700">
              tendu
            </span>
          ) : null}
          {ligne.reserve > 0 ? (
            <span className="font-semibold text-ambre-700">
              dont {qte(ligne.reserve)} à rendre
            </span>
          ) : null}
          {ligne.duNous > 0 ? (
            <span className="font-semibold text-vert-800">on nous doit {qte(ligne.duNous)}</span>
          ) : null}
          {question ? (
            <span className="rounded-full bg-rouge-700 px-1.5 text-[11px] font-semibold text-white">
              à décider
            </span>
          ) : null}
          {aVerifier ? (
            <span className="rounded-full bg-rouge-700 px-1.5 text-[11px] font-semibold text-white">
              stock impossible
            </span>
          ) : null}
          {enAttente ? <span className="text-ambre-700">sur le téléphone</span> : null}
        </span>
      </button>
      {ligne.parCarton ? (
        // Deux cases : cartons pleins, puis unités entamées.
        <div className="my-1.5 flex w-[7.75rem] shrink-0 gap-1">
          <CaseStock
            libelle="CRT"
            valeur={etat.cartons}
            compte={compte}
            frappe={champActif === "cartons" ? frappe : null}
            fige={fige}
            aria={`Cartons de ${ligne.nom}`}
            onClick={() => onStock(ligne.produitId, "cartons")}
          />
          <CaseStock
            libelle={u}
            valeur={etat.unites}
            compte={compte}
            frappe={champActif === "unites" ? frappe : null}
            fige={fige}
            aria={`${ligne.nom}, ${ligne.unite ?? "unités"} hors cartons`}
            onClick={() => onStock(ligne.produitId, "unites")}
          />
        </div>
      ) : (
        <>
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
        </>
      )}
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
        {comptage ? "—" : colis > 0 || etat.force ? colis : "·"}
      </button>
    </li>
  );
});

/** Une des deux cases d'une saisie en cartons + unités. */
function CaseStock({
  libelle,
  valeur,
  compte,
  frappe,
  fige,
  aria,
  onClick,
}: {
  libelle: string;
  valeur: number | null;
  /** Le produit est relevé (l'autre case peut être restée vide : elle vaut 0). */
  compte: boolean;
  frappe: Frappe | null;
  fige: boolean;
  aria: string;
  onClick: () => void;
}) {
  const actif = frappe !== null;
  return (
    <button
      onClick={onClick}
      disabled={fige}
      aria-label={`${aria} : ${compte ? qte(valeur ?? 0) : "à relever"}`}
      className={`flex min-h-12 min-w-0 flex-1 flex-col items-end justify-center rounded-xl border-2 px-1.5 leading-none tabular-nums ${
        actif
          ? "border-rouge-700 bg-white"
          : compte
            ? "border-neutre-200 bg-white"
            : "border-dashed border-neutre-300 bg-neutre-50 text-neutre-400"
      } disabled:border-neutre-100 disabled:bg-neutre-50`}
    >
      <span className="max-w-full truncate text-[10px] font-semibold uppercase text-neutre-500">
        {libelle}
      </span>
      <span className="mt-1 text-lg font-semibold">
        {actif ? (
          <>
            <span className={frappe.neuf && frappe.texte ? "rounded bg-rouge-100" : ""}>
              {frappe.texte}
            </span>
            <span className="curseur" aria-hidden="true" />
          </>
        ) : compte ? (
          qte(valeur ?? 0)
        ) : (
          "—"
        )}
      </span>
    </button>
  );
}

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
  stockTotal,
  stockDispo,
  selon,
  avecRetour,
  aVerifier,
  depasse,
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
  stockTotal: number | null;
  /** Stock retenu pour la proposition, échanges Del Arte compris. */
  stockDispo: number | null;
  /** Proposition sans compter sur un retour, et en comptant dessus. */
  selon: number;
  avecRetour: number;
  /** Stock au-dessus de ce qui pouvait rester, pas encore confirmé. */
  aVerifier: boolean;
  /** Stock au-dessus de ce qui pouvait rester (confirmé ou non). */
  depasse: boolean;
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

          {ligne.comptePour === null && stockTotal !== null && stockTotal !== etat.stock ? (
            <p className="rounded-xl bg-neutre-50 px-4 py-2.5 text-sm text-neutre-700">
              Avec les lignes de comptage rattachées :{" "}
              <span className="font-semibold">
                {qte(stockTotal)} {u}
              </span>{" "}
              en tout. C’est ce total qui sert au calcul.
            </p>
          ) : null}

          {depasse && stockTotal !== null && ligne.plafond !== null ? (
            <StockImpossible
              ligne={ligne}
              total={stockTotal}
              ouvert={aVerifier}
              fige={fige}
              onCorriger={onStock}
              onConfirmer={() => onModifier(ligne.produitId, { verifie: stockTotal })}
            />
          ) : null}

          {ligne.comptePour === null && (ligne.reserve > 0 || ligne.duNous > 0) ? (
            <EchangesFiche
              ligne={ligne}
              etat={etat}
              stockTotal={stockTotal}
              stockDispo={stockDispo}
              selon={selon}
              avecRetour={avecRetour}
              fige={fige}
              onRetour={(retour) => onModifier(ligne.produitId, { retour })}
            />
          ) : null}

          {ligne.comptePour !== null ? (
            <p className="rounded-2xl border border-neutre-100 p-4 text-sm leading-relaxed text-neutre-600">
              Ligne de comptage seulement : elle ne se commande pas. Chaque {u}{" "}
              compté ici vaut {qte(ligne.equivalence ?? 1)} sur la ligne
              {ligne.nomRattache ? ` « ${ligne.nomRattache} »` : " principale"}, qui
              calcule et commande pour les deux.
            </p>
          ) : (
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
            {estTendu(ligne, { ...etat, stock: stockTotal }) ? (
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
          )}

          {/* Les pertes se déclarent désormais dans Réceptions → Perte. Le
              cadre ne reste que sur un relevé qui porte une ancienne perte,
              pour pouvoir la voir ou la corriger. */}
          {etat.perte ? (
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
          ) : null}

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
  questions,
  onRetour,
  aVerifier,
  onConfirmer,
  onCorriger,
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
  /** Produits qu'un autre Del Arte nous doit : commander ou attendre ? */
  questions: { l: LigneSaisie; selon: number; avecRetour: number }[];
  onRetour: (produitId: number, retour: number) => void;
  /** Stocks plus élevés que ce qui pouvait rester : à corriger ou confirmer. */
  aVerifier: { l: LigneSaisie; total: number }[];
  onConfirmer: (produitId: number, total: number) => void;
  onCorriger: (produitId: number) => void;
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

      {!fige && aVerifier.length ? (
        <section className="sans-impression mb-3 rounded-2xl border border-rouge-100 bg-rouge-50 p-4">
          <h2 className="font-titre text-sm font-semibold text-rouge-700">
            Stock impossible : à vérifier avant de valider
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-rouge-700">
            Vous avez compté plus qu’il ne pouvait en rester (dernier relevé, plus
            les livraisons et dépannages enregistrés depuis). La consommation
            serait négative.
          </p>
          <ul className="mt-3 space-y-3">
            {aVerifier.map(({ l, total }) => (
              <li key={l.produitId} className="rounded-xl bg-white p-3">
                <StockImpossible
                  ligne={l}
                  total={total}
                  ouvert
                  fige={fige}
                  avecNom
                  onCorriger={() => onCorriger(l.produitId)}
                  onConfirmer={() => onConfirmer(l.produitId, total)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!fige && questions.length ? (
        <section className="sans-impression mb-3 rounded-2xl border border-rouge-100 bg-rouge-50 p-4">
          <h2 className="font-titre text-sm font-semibold text-rouge-700">
            À décider avant de valider
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-rouge-700">
            Un autre Del Arte vous doit ces produits. Commandez-vous selon la
            préconisation, ou comptez-vous sur leur retour cette semaine ?
          </p>
          <ul className="mt-3 space-y-3">
            {questions.map(({ l, selon, avecRetour }) => (
              <li key={l.produitId} className="rounded-xl bg-white p-3">
                <p className="text-sm font-semibold">{l.nom}</p>
                <p className="text-xs text-neutre-500">
                  Préconisation {selon} colis ·{" "}
                  {l.echanges
                    .filter((e) => e.ilsDoivent > 0)
                    .map((e) => `${e.delArte} doit ${qte(e.ilsDoivent)} ${l.unite ?? "u"}`)
                    .join(" · ")}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onRetour(l.produitId, 0)}
                    className="min-h-12 rounded-xl border border-neutre-200 px-2 text-xs font-semibold text-neutre-700"
                  >
                    Commander {selon} colis
                  </button>
                  <button
                    onClick={() => onRetour(l.produitId, l.duNous)}
                    className="min-h-12 rounded-xl bg-vert-700 px-2 text-xs font-semibold text-white"
                  >
                    Compter sur le retour ({avecRetour} colis)
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
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
                        {l.reserve > 0 ? (
                          <span className="font-semibold text-ambre-700">
                            {" "}
                            · dont {qte(l.reserve)} à rendre (
                            {l.echanges
                              .filter((e) => e.nousDevons > 0)
                              .map((e) => e.delArte)
                              .join(", ")}
                            )
                          </span>
                        ) : null}
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
            disabled={saisis === 0 || questions.length > 0 || aVerifier.length > 0}
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

/**
 * Échanges en cours avec les autres Del Arte pour ce produit : ce qui est
 * réservé (à leur rendre) et ce qu'ils nous doivent, avec le choix de
 * commander selon la préconisation ou de compter sur leur retour.
 */
function EchangesFiche({
  ligne,
  etat,
  stockTotal,
  stockDispo,
  selon,
  avecRetour,
  fige,
  onRetour,
}: {
  ligne: LigneSaisie;
  etat: Etat;
  stockTotal: number | null;
  stockDispo: number | null;
  selon: number;
  avecRetour: number;
  fige: boolean;
  onRetour: (retour: number) => void;
}) {
  const u = ligne.unite ?? "u";
  const dus = ligne.echanges.filter((e) => e.nousDevons > 0);
  const attendus = ligne.echanges.filter((e) => e.ilsDoivent > 0);
  const compte = etat.retour !== null && etat.retour > 0;
  return (
    <div className="space-y-2 rounded-2xl border border-neutre-100 p-4 text-sm">
      <p className="font-titre text-base font-semibold">Échanges Del Arte</p>
      {dus.map((e) => (
        <p key={`d${e.delArte}`} className="text-ambre-700">
          <span className="font-semibold">
            {qte(e.nousDevons)} {u} à rendre
          </span>{" "}
          à {e.delArte} : réservé, ne compte pas dans votre stock.
        </p>
      ))}
      {attendus.map((e) => (
        <p key={`a${e.delArte}`} className="text-vert-800">
          <span className="font-semibold">
            {e.delArte} vous doit {qte(e.ilsDoivent)} {u}
          </span>
          .
        </p>
      ))}
      {stockTotal !== null && stockDispo !== null && stockDispo !== stockTotal ? (
        <p className="rounded-xl bg-neutre-50 px-3 py-2 text-neutre-700">
          Stock retenu pour la commande :{" "}
          <span className="font-semibold">
            {qte(stockDispo)} {u}
          </span>{" "}
          (compté {qte(stockTotal)} {u}).
        </p>
      ) : null}
      {attendus.length > 0 && stockTotal !== null ? (
        <div>
          <p className="text-xs text-neutre-500">
            Commander selon la préconisation, ou compter sur leur retour cette semaine ?
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              disabled={fige}
              onClick={() => onRetour(0)}
              className={`min-h-12 rounded-xl px-2 text-xs font-semibold ${
                etat.retour === 0
                  ? "bg-neutre-900 text-white"
                  : "border border-neutre-200 text-neutre-700"
              }`}
            >
              Commander ({selon} colis)
            </button>
            <button
              disabled={fige}
              onClick={() => onRetour(ligne.duNous)}
              className={`min-h-12 rounded-xl px-2 text-xs font-semibold ${
                compte ? "bg-vert-700 text-white" : "border border-neutre-200 text-neutre-700"
              }`}
            >
              Compter sur le retour ({avecRetour} colis)
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Stock compté supérieur à ce qui pouvait rester. On le corrige, ou on le
 * confirme : c'est alors qu'une entrée n'a pas été enregistrée (livraison,
 * dépannage, prêt d'un Del Arte) ou que le relevé précédent était faux.
 */
/** « dernier relevé 5 BAC, rien reçu depuis », « …, 4 BAC reçus depuis ». */
const depuis = (precedent: number, max: number, u: string) => {
  const ecart = arrondi(max - precedent);
  const suite =
    ecart > 0
      ? `${qte(ecart)} ${u} reçu${ecart > 1 ? "s" : ""} depuis`
      : ecart < 0
        ? `${qte(-ecart)} ${u} sorti${-ecart > 1 ? "s" : ""} depuis (perte, prêt, rendu)`
        : "rien reçu depuis";
  return `dernier relevé ${qte(precedent)} ${u}, ${suite}`;
};

function StockImpossible({
  ligne,
  total,
  ouvert,
  fige,
  avecNom = false,
  onCorriger,
  onConfirmer,
}: {
  ligne: LigneSaisie;
  total: number;
  /** Pas encore confirmé : on pose la question. */
  ouvert: boolean;
  fige: boolean;
  avecNom?: boolean;
  onCorriger: () => void;
  onConfirmer: () => void;
}) {
  const u = ligne.unite ?? "u";
  const max = ligne.plafond ?? 0;
  const explication = (
    <p className={avecNom ? "text-xs text-neutre-500" : "text-sm text-rouge-700"}>
      Compté <span className="font-semibold">{qte(total)} {u}</span>, mais il ne
      pouvait pas en rester plus de{" "}
      <span className="font-semibold">
        {qte(max)} {u}
      </span>
      {ligne.stockPrecedent !== null ? ` (${depuis(ligne.stockPrecedent, max, u)})` : ""}
      .
    </p>
  );
  if (!ouvert) {
    return (
      <div className="rounded-2xl border border-ambre-100 bg-ambre-50 p-4 text-sm text-ambre-700">
        <p className="font-semibold">Stock confirmé au-dessus du maximum possible</p>
        <p className="mt-1">
          Si une livraison, un dépannage ou un prêt d’un Del Arte n’a pas été
          enregistré, déclarez-le dans Réceptions : sinon la consommation de la
          semaine sera fausse.
        </p>
      </div>
    );
  }
  return (
    <div className={avecNom ? "" : "rounded-2xl border border-rouge-100 bg-rouge-50 p-4"}>
      {avecNom ? (
        <p className="text-sm font-semibold">{ligne.nom}</p>
      ) : (
        <p className="font-titre text-base font-semibold text-rouge-700">Stock impossible</p>
      )}
      {explication}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          disabled={fige}
          onClick={onCorriger}
          className="min-h-12 rounded-xl bg-rouge-700 px-2 text-xs font-semibold text-white"
        >
          Corriger le stock
        </button>
        <button
          disabled={fige}
          onClick={onConfirmer}
          className="min-h-12 rounded-xl border border-neutre-200 bg-white px-2 text-xs font-semibold text-neutre-700"
        >
          Le compte est juste
        </button>
      </div>
    </div>
  );
}
