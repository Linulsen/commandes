"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { normaliser, qte } from "@/lib/format";
import { lireNombre, mettreEnFile, saisiesLocales, useFileAttente } from "@/lib/file-attente";
import { useEcranAllume } from "@/lib/ecran";
import type { Lieu, LigneInventaire, ProduitCatalogue, SaisieServeur } from "@/lib/inventaire";
import EtatEnvoi from "../../EtatEnvoi";
import Pave, { frapper, montrerLigne, type Frappe, type Raccourci } from "../../Pave";

/**
 * Écran de comptage de l'inventaire, lieu par lieu.
 *
 * Chaque produit a jusqu'à trois cases : colis (quand il y a plusieurs unités
 * par colis), unités (Btl, sachet, fût… fraction acceptée) et, pour les
 * produits qu'on finit au poids, un reste en kg ou en L. L'appli fait le
 * total : 1 carton de 6 + 3 sachets + 1,600 kg = 10,6 sachets = 10,6 kg.
 *
 * Plusieurs personnes comptent en même temps : chaque comptage est rangé par
 * produit et par lieu, et l'écran va chercher régulièrement ceux des collègues.
 */

type Champ = "colis" | "unites" | "detail";
type Etat = {
  colis: number | null;
  unites: number | null;
  detail: number | null;
  prenom: string | null;
  majLe: number;
};
type Cible = { cle: string; champ: Champ };

const cleDe = (l: { produitId: number; zoneId: number }) => `${l.produitId}:${l.zoneId}`;

/** Les cases que montre un produit, dans l'ordre de saisie. */
function champsDe(l: LigneInventaire): Champ[] {
  const c: Champ[] = [];
  if (l.fact > 1) c.push("colis");
  c.push("unites");
  if (l.saisieDetail && l.contenance) c.push("detail");
  return c;
}

function totalDe(l: LigneInventaire, e: Etat): number | null {
  if (e.colis === null && e.unites === null && e.detail === null) return null;
  const detail = e.detail !== null && l.contenance ? e.detail / l.contenance : 0;
  return (e.colis ?? 0) * l.fact + (e.unites ?? 0) + detail;
}

/** Nombre au millième, sans zéros inutiles : 1,6 · 1,625 · 10. */
function qte3(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "";
  const a = Math.round(n * 1000) / 1000;
  return Number.isInteger(a) ? String(a) : String(a).replace(".", ",");
}

/** « 10,6 kg », « 5,625 L », « 35 cl » (moins d'un litre). */
function volume(total: number, l: LigneInventaire) {
  if (!l.contenance || !l.uniteContenance) return null;
  const v = total * l.contenance;
  if (l.uniteContenance === "L" && v > 0 && v < 1) return `${qte3(v * 100)} cl`;
  return `${qte3(v)} ${l.uniteContenance}`;
}

function libelleChamp(l: LigneInventaire, c: Champ) {
  if (c === "colis") return "colis";
  if (c === "detail") return l.uniteContenance ?? "kg";
  return l.unite ?? "u";
}

export default function Comptage({
  inventaireId,
  fige,
  lieux,
  lignes: lignesInitiales,
  catalogue,
  chargeLe,
  prenom,
  sousTitre,
}: {
  inventaireId: number;
  fige: boolean;
  lieux: Lieu[];
  lignes: LigneInventaire[];
  /** Tout le catalogue, retirés compris : pour ajouter un article à un lieu. */
  catalogue: ProduitCatalogue[];
  /** Heure du serveur au chargement : point de départ des nouvelles des collègues. */
  chargeLe: string;
  prenom: string | null;
  /** Date, heure et état de l'inventaire, sous le titre. */
  sousTitre: string;
}) {
  const envoi = useFileAttente();
  useEcranAllume(!fige);

  // Articles ajoutés à un lieu pendant cette visite (trouvés là sans y être attendus).
  const [ajoutees, setAjoutees] = useState<LigneInventaire[]>([]);
  const lignes = useMemo(
    () =>
      ajoutees.length
        ? [...lignesInitiales, ...ajoutees].sort((a, b) =>
            a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }),
          )
        : lignesInitiales,
    [ajoutees, lignesInitiales],
  );
  const avecLignes = useMemo(
    () => lieux.filter((z) => lignes.some((l) => l.zoneId === z.id)),
    [lieux, lignes],
  );
  const [onglet, setOnglet] = useState<number>(avecLignes[0]?.id ?? lieux[0]?.id ?? 0);
  // Recherche toujours visible dans le bandeau, sur tous les lieux.
  const [recherche, setRecherche] = useState("");
  // Par défaut la recherche reste dans le lieu ouvert : c'est là qu'on ajoute
  // un article trouvé sur place. La case l'étend à tous les lieux.
  const [tousLieux, setTousLieux] = useState(false);

  const parCle = useMemo(() => new Map(lignes.map((l) => [cleDe(l), l])), [lignes]);
  const etatInitial = (l: LigneInventaire): Etat => ({
    colis: l.colis,
    unites: l.unites,
    detail: l.detail,
    prenom: l.prenom,
    majLe: l.majLe,
  });
  const [etats, setEtats] = useState<Record<string, Etat>>(() =>
    Object.fromEntries(lignes.map((l) => [cleDe(l), etatInitial(l)])),
  );
  const etatsRef = useRef(etats);
  const etatDe = (l: LigneInventaire) => etats[cleDe(l)] ?? etatInitial(l);
  const prefixe = `inventaire:${inventaireId}:`;

  // Page rouverte sans réseau : ce qui a été tapé depuis sur ce téléphone
  // reprend sa place.
  useEffect(() => {
    const suivant = { ...etatsRef.current };
    let change = false;
    for (const { corps, t } of Object.values(saisiesLocales(prefixe))) {
      const cle = `${corps.produitId}:${corps.zoneId}`;
      const l = parCle.get(cle);
      if (!l || t <= (suivant[cle]?.majLe ?? 0)) continue;
      suivant[cle] = {
        colis: (corps.colis as number | null) ?? null,
        unites: (corps.unites as number | null) ?? null,
        detail: (corps.detail as number | null) ?? null,
        prenom,
        majLe: t,
      };
      change = true;
    }
    if (change) {
      etatsRef.current = suivant;
      setEtats(suivant);
    }
  }, [parCle, prefixe, prenom]);

  // Les comptages des collègues, toutes les 20 secondes. Une ligne qui attend
  // encore d'être envoyée depuis ce téléphone n'est pas écrasée.
  const clesEnAttente = useRef(envoi.cles);
  clesEnAttente.current = envoi.cles;
  useEffect(() => {
    if (fige) return;
    let depuis = chargeLe;
    let arret = false;
    const tirer = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await fetch(
        `/api/inventaire/${inventaireId}/saisies?depuis=${encodeURIComponent(depuis)}`,
        { cache: "no-store" },
      ).catch(() => null);
      if (!r?.ok || arret) return;
      const { saisies, maintenant } = (await r.json()) as {
        saisies: SaisieServeur[];
        maintenant: string;
      };
      depuis = maintenant;
      if (!saisies.length) return;
      const suivant = { ...etatsRef.current };
      let change = false;
      for (const s of saisies) {
        const cle = `${s.produit_id}:${s.zone_id}`;
        if (!parCle.has(cle) || clesEnAttente.current.has(prefixe + cle)) continue;
        const t = Date.parse(s.saisi_le);
        if (t <= (suivant[cle]?.majLe ?? 0)) continue;
        suivant[cle] = {
          colis: s.colis === null ? null : Number(s.colis),
          unites: s.unites === null ? null : Number(s.unites),
          detail: s.detail === null ? null : Number(s.detail),
          prenom: s.prenom,
          majLe: t,
        };
        change = true;
      }
      if (change) {
        etatsRef.current = suivant;
        setEtats(suivant);
      }
    };
    const minuteur = setInterval(() => void tirer(), 20000);
    return () => {
      arret = true;
      clearInterval(minuteur);
    };
  }, [chargeLe, fige, inventaireId, parCle, prefixe]);

  const modifier = useCallback(
    (cle: string, patch: Partial<Etat>) => {
      const l = parCle.get(cle);
      if (!l || fige) return;
      const e: Etat = {
        ...(etatsRef.current[cle] ?? etatInitial(l)),
        ...patch,
        prenom,
        majLe: Date.now(),
      };
      etatsRef.current = { ...etatsRef.current, [cle]: e };
      setEtats(etatsRef.current);
      mettreEnFile(prefixe + cle, "inventaire", {
        inventaireId,
        produitId: l.produitId,
        zoneId: l.zoneId,
        colis: e.colis,
        unites: e.unites,
        detail: e.detail,
      });
    },
    // etatInitial est pur : il ne dépend que de la ligne.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fige, inventaireId, parCle, prefixe, prenom],
  );

  /* ---------------------------------------------------------------------- */
  /* Pavé numérique                                                         */
  /* ---------------------------------------------------------------------- */

  const [cible, setCible] = useState<Cible | null>(null);
  const [frappe, setFrappe] = useState<Frappe>({ texte: "", neuf: true });
  const frappeRef = useRef(frappe);
  const [hauteurPave, setHauteurPave] = useState(0);
  const nav = useRef<HTMLElement>(null);

  const ouvrir = useCallback(
    (cle: string, champ: Champ) => {
      if (fige) return;
      const l = parCle.get(cle);
      if (!l) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      const v = (etatsRef.current[cle] ?? etatInitial(l))[champ];
      const f = { texte: v === null ? "" : qte3(v), neuf: true };
      frappeRef.current = f;
      setFrappe(f);
      setCible({ cle, champ });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fige, parCle],
  );

  const toucher = (t: string) => {
    if (!cible) return;
    const f = frapper(frappeRef.current, t, cible.champ === "detail" ? 3 : 2);
    frappeRef.current = f;
    setFrappe(f);
    const v = lireNombre(f.texte) ?? null;
    const l = parCle.get(cible.cle)!;
    if (v !== (etatsRef.current[cible.cle] ?? etatInitial(l))[cible.champ]) {
      modifier(cible.cle, { [cible.champ]: v });
    }
  };

  useEffect(() => {
    if (!cible || !hauteurPave) return;
    montrerLigne(
      document.querySelector(`[data-ligne="${cible.cle}"]`),
      nav.current?.getBoundingClientRect().bottom ?? 0,
      hauteurPave,
    );
  }, [cible, hauteurPave]);

  const terme = normaliser(recherche.trim());
  const visibles = lignes.filter(
    (l) =>
      (terme && tousLieux ? true : l.zoneId === onglet) &&
      (!terme || normaliser(l.nom).includes(terme)),
  );
  const nomLieuOuvert = lieux.find((z) => z.id === onglet)?.nom ?? "ce lieu";
  const dejaIci = new Set(lignes.filter((l) => l.zoneId === onglet).map((l) => l.produitId));
  const aAjouter =
    !fige && terme.length >= 2 && !tousLieux
      ? catalogue
          .filter((p) => !dejaIci.has(p.produitId) && normaliser(p.nom).includes(terme))
          .slice(0, 15)
      : [];

  // Ajout d'un article au lieu ouvert : il rejoint la liste, et le pavé s'ouvre
  // dessus. S'il n'est pas rangé ici d'habitude, ce lieu devient un de ses
  // emplacements pour les prochains inventaires.
  const [aOuvrir, setAOuvrir] = useState<string | null>(null);
  const ajouterIci = (p: ProduitCatalogue) => {
    const ligne: LigneInventaire = {
      produitId: p.produitId,
      zoneId: onglet,
      nom: p.nom,
      conditionnement: p.conditionnement,
      unite: p.unite,
      fact: p.fact,
      contenance: p.contenance,
      uniteContenance: p.uniteContenance,
      saisieDetail: p.saisieDetail,
      principal: p.lieuPrincipal === onglet,
      inactif: p.inactif,
      colis: null,
      unites: null,
      detail: null,
      total: null,
      prenom: null,
      majLe: 0,
    };
    setAjoutees((a) => [...a, ligne]);
    setRecherche("");
    setAOuvrir(cleDe(ligne));
    if (!ligne.principal) {
      void fetch("/api/inventaire/emplacements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produitId: p.produitId, zoneId: onglet }),
      }).catch(() => null);
    }
  };
  useEffect(() => {
    if (!aOuvrir || !parCle.has(aOuvrir)) return;
    const l = parCle.get(aOuvrir)!;
    setAOuvrir(null);
    ouvrir(aOuvrir, champsDe(l)[0]);
  }, [aOuvrir, parCle, ouvrir]);
  const nomLieu = useMemo(() => new Map(lieux.map((z) => [z.id, z.nom])), [lieux]);

  /** Case suivante du même produit, puis premier champ du produit suivant. */
  const suivant = (sauterProduit = false) => {
    if (!cible) return;
    const l = parCle.get(cible.cle)!;
    const champs = champsDe(l);
    const j = champs.indexOf(cible.champ);
    if (!sauterProduit && j >= 0 && j < champs.length - 1) {
      ouvrir(cible.cle, champs[j + 1]);
      return;
    }
    const i = visibles.findIndex((x) => cleDe(x) === cible.cle);
    const prochain = i >= 0 ? visibles[i + 1] : undefined;
    if (prochain) ouvrir(cleDe(prochain), champsDe(prochain)[0]);
    else setCible(null);
  };

  const ligneCible = cible ? parCle.get(cible.cle) : undefined;
  const raccourcis: [Raccourci | null, Raccourci | null] = !ligneCible
    ? [null, null]
    : [
        {
          libelle: "Effacer",
          detail: "ce produit",
          action: () => {
            modifier(cible!.cle, { colis: null, unites: null, detail: null });
            const f = { texte: "", neuf: true };
            frappeRef.current = f;
            setFrappe(f);
          },
        },
        {
          libelle: "Aucun",
          detail: "0 et suivant",
          action: () => {
            modifier(cible!.cle, { colis: null, unites: 0, detail: null });
            suivant(true);
          },
        },
      ];

  const changerOnglet = (id: number) => {
    setOnglet(id);
    setRecherche("");
    setCible(null);
    const haut = (nav.current?.offsetTop ?? 0) - 1;
    if (window.scrollY > haut) window.scrollTo({ top: Math.max(0, haut) });
  };

  // L'onglet ouvert reste visible dans la barre qui déborde.
  const barre = useRef<HTMLDivElement>(null);
  const ongletActif = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const b = barre.current;
    const o = ongletActif.current;
    if (!b || !o) return;
    b.scrollTo({ left: o.offsetLeft - (b.clientWidth - o.clientWidth) / 2, behavior: "smooth" });
  }, [onglet]);

  const faits = lignes.filter((l) => totalDe(l, etatDe(l)) !== null).length;
  const index = avecLignes.findIndex((z) => z.id === onglet);
  const lieuSuivant = index >= 0 ? (avecLignes[index + 1] ?? null) : null;

  const detailPave = (l: LigneInventaire, c: Champ) => {
    if (c === "colis") return `Colis de ${qte(l.fact)} ${l.unite ?? "u"}`;
    if (c === "detail") return `Reste à finir, en ${l.uniteContenance} (1 ${l.unite ?? "u"} = ${qte3(l.contenance)} ${l.uniteContenance})`;
    return `En ${l.unite ?? "unités"}${l.contenance ? " · 0,5 pour une entamée" : ""}`;
  };

  return (
    <>
      <header className="sans-impression bg-rouge-700 text-white">
        <div
          className="mx-auto max-w-2xl px-4 pb-3"
          style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
        >
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/"
              className="-ml-2 flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm text-rouge-50"
            >
              <span aria-hidden="true">←</span>
              Accueil
            </Link>
            <div className="min-w-0 text-right">
              <h1 className="font-titre text-2xl font-semibold leading-tight tracking-tight">
                Inventaire
              </h1>
              <p className="truncate text-xs text-rouge-50">{sousTitre}</p>
            </div>
          </div>
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            onFocus={() => setCible(null)}
            placeholder={tousLieux ? "Chercher dans tous les lieux" : `Chercher ou ajouter · ${nomLieuOuvert}`}
            enterKeyHint="search"
            aria-label="Chercher un produit"
            className="mt-2 min-h-11 w-full rounded-xl border border-rouge-800 bg-rouge-800 px-3 text-base text-white placeholder:text-rouge-200 outline-none focus:border-white"
          />
          <label className="mt-1.5 flex min-h-9 w-fit items-center gap-2 text-sm text-rouge-50">
            <input
              type="checkbox"
              checked={tousLieux}
              onChange={(e) => setTousLieux(e.target.checked)}
              className="h-5 w-5 accent-white"
            />
            Tous les lieux
          </label>
        </div>
      </header>
      <nav
        ref={nav}
        className="sans-impression sticky top-0 z-10 border-b border-neutre-100 bg-neutre-50/95 backdrop-blur"
      >
        <div ref={barre} className="defile-x mx-auto max-w-2xl px-4 py-2">
          <div className="flex gap-2">
            {lieux.map((z) => {
              const dedans = lignes.filter((l) => l.zoneId === z.id);
              const n = dedans.filter((l) => totalDe(l, etatDe(l)) !== null).length;
              const fini = n === dedans.length && dedans.length > 0;
              const actif = onglet === z.id && !(terme && tousLieux);
              return (
                <button
                  key={z.id}
                  ref={onglet === z.id ? ongletActif : undefined}
                  onClick={() => changerOnglet(z.id)}
                  className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ${
                    actif
                      ? "bg-rouge-700 text-white"
                      : z.secondaire
                        ? "border border-dashed border-neutre-300 bg-white text-neutre-700"
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
                    {n}/{dedans.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <div
        className="mx-auto max-w-2xl px-4 py-3"
        style={{
          paddingBottom: cible
            ? `${hauteurPave + 16}px`
            : "calc(var(--barre-basse) + env(safe-area-inset-bottom) + 1rem)",
        }}
      >
        {visibles.length === 0 ? (
          <p className="rounded-2xl border border-neutre-100 bg-white p-4 text-sm text-neutre-500">
            {terme
              ? tousLieux
                ? "Aucun produit ne porte ce nom."
                : `Rien de ce nom dans ${nomLieuOuvert} pour l’instant.`
              : "Aucun produit rattaché à ce lieu pour l’instant. Cherchez un article dans le champ en haut pour l’ajouter."}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
            {visibles.map((l) => {
              const cle = cleDe(l);
              return (
                <LigneComptage
                  key={cle}
                  ligne={l}
                  etat={etatDe(l)}
                  fige={fige}
                  lieu={terme && tousLieux ? nomLieu.get(l.zoneId) : undefined}
                  moi={prenom}
                  enAttente={envoi.cles.has(prefixe + cle)}
                  cible={cible?.cle === cle ? cible.champ : null}
                  frappe={cible?.cle === cle ? frappe : null}
                  onCase={ouvrir}
                />
              );
            })}
          </ul>
        )}

        {aAjouter.length ? (
          <section className="mt-3">
            <h2 className="mb-1.5 px-1 font-titre text-xs font-bold uppercase tracking-[0.14em] text-neutre-500">
              Ajouter à {nomLieuOuvert}
            </h2>
            <ul className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
              {aAjouter.map((p) => (
                <li key={p.produitId} className="border-b border-neutre-100 last:border-b-0">
                  <button
                    onClick={() => ajouterIci(p)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 font-titre text-[15px] font-semibold leading-snug">
                        {p.nom}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-neutre-500">
                        <span>d’habitude : {nomLieu.get(p.lieuPrincipal) ?? "—"}</span>
                        {p.inactif ? (
                          <span className="rounded-full bg-neutre-100 px-1.5 text-[11px] font-semibold text-neutre-600">
                            retiré de la carte
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-rouge-700 px-3 py-1.5 text-sm font-semibold text-white">
                      Ajouter
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!terme && lieuSuivant ? (
          <button
            onClick={() => changerOnglet(lieuSuivant.id)}
            className="sans-impression mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-neutre-200 bg-white px-4 py-2 text-left font-titre text-base font-semibold text-neutre-900 shadow-sm"
          >
            <span className="min-w-0">Lieu suivant : {lieuSuivant.nom}</span>
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
              aria-label="Retour à l’accueil"
              className="-ml-1 flex min-h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-neutre-200 text-xl text-neutre-700"
            >
              ←
            </Link>
            <div className="min-h-12 min-w-0 flex-1 px-2">
              <span className="block font-titre text-sm font-semibold tabular-nums">
                {faits}/{lignes.length} comptés{fige ? " · inventaire clôturé" : ""}
              </span>
              <span className="block truncate text-xs text-neutre-500">
                <EtatEnvoi etat={envoi} />
              </span>
            </div>
          </div>
        </footer>
      ) : null}

      {cible && ligneCible ? (
        <Pave
          titre={ligneCible.nom}
          detail={detailPave(ligneCible, cible.champ)}
          frappe={frappe}
          raccourcis={raccourcis}
          libelleSuivant="Suivant"
          onTouche={toucher}
          onSuivant={() => suivant()}
          onFermer={() => setCible(null)}
          onHauteur={setHauteurPave}
        />
      ) : null}
    </>
  );
}

const LigneComptage = memo(function LigneComptage({
  ligne,
  etat,
  fige,
  lieu,
  moi,
  enAttente,
  cible,
  frappe,
  onCase,
}: {
  ligne: LigneInventaire;
  etat: Etat;
  fige: boolean;
  lieu?: string;
  moi: string | null;
  enAttente: boolean;
  cible: Champ | null;
  frappe: Frappe | null;
  onCase: (cle: string, champ: Champ) => void;
}) {
  const cle = cleDe(ligne);
  const total = totalDe(ligne, etat);
  const compte = total !== null;
  const vol = compte ? volume(total, ligne) : null;
  const u = ligne.unite ?? "u";

  return (
    <li
      data-ligne={cle}
      className={`flex items-stretch border-b border-neutre-100 last:border-b-0 ${cible ? "bg-rouge-50" : ""}`}
    >
      {/* Vert : enregistré. Orange : gardé dans le téléphone, pas encore envoyé. */}
      <div
        className={`w-1.5 shrink-0 ${
          !compte && !enAttente ? "bg-transparent" : enAttente ? "bg-ambre-400" : "bg-vert-600"
        }`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 py-2 pl-3 pr-2">
        {lieu ? (
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutre-400">
            {lieu}
          </span>
        ) : null}
        <span className="line-clamp-2 font-titre text-[15px] font-semibold leading-snug">
          {ligne.nom}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutre-500">
          {compte ? (
            <span className="font-semibold text-neutre-800">
              = {qte3(total)} {u}
              {vol ? ` · ${vol}` : ""}
            </span>
          ) : (
            <span>
              {ligne.fact > 1 ? `colis de ${qte(ligne.fact)} ${u}` : u}
              {ligne.contenance && ligne.uniteContenance
                ? ` · ${u} de ${ligne.uniteContenance === "L" && ligne.contenance < 1 ? `${qte3(ligne.contenance * 100)} cl` : `${qte3(ligne.contenance)} ${ligne.uniteContenance}`}`
                : ""}
            </span>
          )}
          {compte && etat.prenom && etat.prenom !== moi ? (
            <span className="text-neutre-500">par {etat.prenom}</span>
          ) : null}
          {ligne.inactif ? (
            <span className="rounded-full bg-neutre-100 px-1.5 text-[11px] font-semibold text-neutre-600">
              retiré de la carte
            </span>
          ) : null}
          {!ligne.principal && !lieu ? (
            <span className="text-neutre-400">aussi rangé ailleurs</span>
          ) : null}
          {enAttente ? <span className="text-ambre-700">sur le téléphone</span> : null}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1 pr-2">
        {champsDe(ligne).map((c) => {
          const v = etat[c];
          const actif = cible === c;
          return (
            <button
              key={c}
              onClick={() => onCase(cle, c)}
              disabled={fige}
              aria-label={`${ligne.nom}, ${libelleChamp(ligne, c)} : ${v === null ? "vide" : qte3(v)}`}
              className={`flex min-h-12 w-14 flex-col items-center justify-center rounded-xl border-2 px-1 leading-none tabular-nums ${
                actif
                  ? "border-rouge-700 bg-white"
                  : v !== null
                    ? "border-neutre-200 bg-white"
                    : "border-dashed border-neutre-300 bg-neutre-50 text-neutre-400"
              } disabled:border-neutre-100 disabled:bg-neutre-50`}
            >
              <span className="text-base font-semibold">
                {actif && frappe ? (
                  <>
                    <span className={frappe.neuf && frappe.texte ? "rounded bg-rouge-100" : ""}>
                      {frappe.texte}
                    </span>
                    <span className="curseur" aria-hidden="true" />
                  </>
                ) : v !== null ? (
                  qte3(v)
                ) : (
                  "—"
                )}
              </span>
              <span className="mt-0.5 max-w-full truncate text-[10px] font-semibold uppercase text-neutre-500">
                {libelleChamp(ligne, c)}
              </span>
            </button>
          );
        })}
      </div>
    </li>
  );
});
