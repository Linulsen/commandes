"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { normaliser, qte } from "@/lib/format";
import {
  lireNombre,
  mettreEnFile,
  saisiesLocales,
  useFileAttente,
  vider,
} from "@/lib/file-attente";
import type { ProduitCatalogue } from "@/lib/model";
import type { Reception } from "@/lib/types";
import { useEcranAllume } from "@/lib/ecran";
import EtatEnvoi from "../../EtatEnvoi";
import Pave, { frappeDe, frapper, montrerLigne, type Frappe, type Raccourci } from "../../Pave";

export type LigneRec = {
  produitId: number;
  /** Colis commandés ; null pour un produit ajouté hors commande. */
  commandes: number | null;
  /** Colis reçus pour une livraison, unités pour un dépannage. */
  quantite: number | null;
  recu: boolean;
  majLe: number;
};

type Etat = { commandes: number | null; quantite: number | null; recu: boolean };

/**
 * Réception d'une livraison ou d'un dépannage.
 *
 * Pour une livraison, la liste part de ce qui a été commandé, quantités
 * préremplies. Cocher un produit dit « reçu » ; changer sa quantité aussi — on
 * ne corrige pas la quantité d'un produit qui n'est pas arrivé. Ce qui reste
 * décoché à la validation est compté comme non livré.
 *
 * On peut ajouter un produit qui n'était pas sur la commande (un appel au
 * fournisseur, un geste du livreur) : il suffit de le chercher, ou de
 * décocher « commandés seulement ».
 */
export default function SaisieReception({
  reception,
  lignes,
  catalogue,
}: {
  reception: Reception;
  lignes: LigneRec[];
  catalogue: ProduitCatalogue[];
}) {
  const router = useRouter();
  const envoi = useFileAttente();
  const fige = reception.statut === "validee";
  const depannage = reception.type === "depannage";

  const [etats, setEtats] = useState<Record<number, Etat>>(() =>
    Object.fromEntries(
      lignes.map((l) => [
        l.produitId,
        { commandes: l.commandes, quantite: l.quantite, recu: l.recu },
      ]),
    ),
  );
  const etatsRef = useRef(etats);
  const [commandesSeules, setCommandesSeules] = useState(true);
  const [recherche, setRecherche] = useState("");
  const [date, setDate] = useState(reception.date_reception);
  const [provenance, setProvenance] = useState(reception.provenance ?? "");
  const [echec, setEchec] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  useEcranAllume(!fige);

  const produit = useMemo(() => new Map(catalogue.map((p) => [p.id, p])), [catalogue]);

  // Reprise des saisies gardées sur le téléphone, plus récentes que la page.
  useEffect(() => {
    const majServeur = new Map(lignes.map((l) => [l.produitId, l.majLe]));
    const suivant = { ...etatsRef.current };
    let change = false;
    for (const { corps, t } of Object.values(saisiesLocales(`reception:${reception.id}:`))) {
      const pid = Number(corps.produitId);
      if (!produit.has(pid) || t <= (majServeur.get(pid) ?? 0)) continue;
      if (corps.retirer === true) delete suivant[pid];
      else
        suivant[pid] = {
          commandes: suivant[pid]?.commandes ?? null,
          quantite: (corps.quantite as number | null) ?? null,
          recu: corps.recu === true,
        };
      change = true;
    }
    if (change) {
      etatsRef.current = suivant;
      setEtats(suivant);
    }
  }, [lignes, produit, reception.id]);

  const modifier = useCallback(
    (pid: number, patch: Partial<Etat> | "retirer") => {
      if (fige) return;
      const suivant = { ...etatsRef.current };
      const cle = `reception:${reception.id}:${pid}`;
      if (patch === "retirer") {
        delete suivant[pid];
        mettreEnFile(cle, "reception", { receptionId: reception.id, produitId: pid, retirer: true });
      } else {
        const etat = {
          ...(suivant[pid] ?? { commandes: null, quantite: null, recu: false }),
          ...patch,
        };
        suivant[pid] = etat;
        mettreEnFile(cle, "reception", {
          receptionId: reception.id,
          produitId: pid,
          recu: etat.recu,
          quantite: etat.quantite ?? 0,
        });
      }
      etatsRef.current = suivant;
      setEtats(suivant);
    },
    [fige, reception.id],
  );

  const majEntete = async (patch: Record<string, string>) => {
    const r = await fetch(`/api/receptions/${reception.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    setEchec(r?.ok ? null : "Date non enregistrée (réseau ?)");
  };

  const terme = normaliser(recherche.trim());
  const affiches = catalogue.filter((p) => {
    if (terme) return normaliser(p.nom).includes(terme);
    if (depannage || commandesSeules || fige) {
      // Une ligne de comptage (sucrines en sachet de 6) s'affiche sous le
      // produit commandé qu'elle complète : le fournisseur peut livrer l'autre
      // format.
      return p.id in etats || (!fige && !depannage && p.comptePour !== null && p.comptePour in etats);
    }
    return true;
  });
  const zones = [...new Set(affiches.map((p) => p.zone))];
  // Ordre d'affichage, pour que « Suivant » descende la liste comme l'œil.
  const ordre = zones.flatMap((z) => affiches.filter((p) => p.zone === z));

  /* Pavé numérique : même saisie qu'au relevé. */
  const [cible, setCible] = useState<number | null>(null);
  const [frappe, setFrappe] = useState<Frappe>({ texte: "", neuf: true });
  const frappeRef = useRef(frappe);
  const [hauteurPave, setHauteurPave] = useState(0);

  const ouvrirPave = useCallback(
    (pid: number) => {
      if (fige) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      const f = frappeDe(etatsRef.current[pid]?.quantite ?? null);
      frappeRef.current = f;
      setFrappe(f);
      setCible(pid);
    },
    [fige],
  );
  const toucher = (t: string) => {
    if (cible === null) return;
    const f = frapper(frappeRef.current, t);
    frappeRef.current = f;
    setFrappe(f);
    const v = lireNombre(f.texte) ?? null;
    // Saisir une quantité, c'est dire que le produit est arrivé.
    if (v !== (etatsRef.current[cible]?.quantite ?? null))
      modifier(cible, { quantite: v, recu: v !== null && v > 0 });
  };
  const suivant = () => {
    const i = ordre.findIndex((p) => p.id === cible);
    const prochain = i >= 0 ? ordre[i + 1] : undefined;
    if (prochain) ouvrirPave(prochain.id);
    else setCible(null);
  };
  useEffect(() => {
    if (cible === null || !hauteurPave) return;
    montrerLigne(document.querySelector(`[data-ligne="${cible}"]`), 0, hauteurPave);
  }, [cible, hauteurPave]);

  const produitCible = cible !== null ? produit.get(cible) : undefined;
  const etatCible = cible !== null ? etats[cible] : undefined;
  const raccourcis: [Raccourci | null, Raccourci | null] =
    cible === null
      ? [null, null]
      : [
          etatCible?.commandes != null
            ? {
                libelle: "Idem",
                detail: `commandé ${qte(etatCible.commandes)}`,
                action: () => {
                  modifier(cible, { quantite: etatCible.commandes, recu: true });
                  suivant();
                },
              }
            : null,
          {
            libelle: depannage ? "Aucun" : "Pas livré",
            detail: "0 et suivant",
            action: () => {
              modifier(cible, { quantite: 0, recu: false });
              suivant();
            },
          },
        ];

  const commandes = Object.values(etats).filter((e) => (e.commandes ?? 0) > 0);
  const recus = Object.values(etats).filter((e) => e.recu).length;
  const manquants = commandes.filter((e) => !e.recu).length;

  const valider = async () => {
    setEchec(null);
    if (!(await vider())) {
      setEchec("Des saisies n’ont pas pu partir. Retentez avec du réseau.");
      return;
    }
    const r = await fetch(`/api/receptions/${reception.id}/valider`, { method: "POST" }).catch(
      () => null,
    );
    if (r?.ok) {
      setConfirmer(false);
      router.refresh();
    } else setEchec("Validation impossible (réseau ?)");
  };

  return (
    <>
      <div
        className="mx-auto max-w-2xl space-y-3 px-4 py-3"
        style={{
          paddingBottom:
            cible !== null
              ? `${hauteurPave + 16}px`
              : "calc(var(--barre-basse) + env(safe-area-inset-bottom) + 1rem)",
        }}
      >
        <div className="rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm">
          <div className="flex items-end gap-3">
            <label className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutre-500">
                {depannage ? "Date du dépannage" : "Date de réception"}
              </span>
              <input
                type="date"
                value={date}
                disabled={fige}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (e.target.value) void majEntete({ date: e.target.value });
                }}
                className="mt-1 min-h-12 w-full rounded-xl border-2 border-neutre-200 bg-white px-3 text-base outline-none focus:border-rouge-700 disabled:bg-neutre-50"
              />
            </label>
            {depannage ? (
              <label className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutre-500">
                  Où
                </span>
                <input
                  value={provenance}
                  disabled={fige}
                  placeholder="Metro…"
                  onChange={(e) => setProvenance(e.target.value)}
                  onBlur={() => void majEntete({ provenance })}
                  className="mt-1 min-h-12 w-full rounded-xl border-2 border-neutre-200 bg-white px-3 text-base outline-none focus:border-rouge-700 disabled:bg-neutre-50"
                />
              </label>
            ) : null}
          </div>
          {depannage ? (
            <p className="mt-2 text-xs leading-relaxed text-neutre-500">
              Quantités en unités de stock (kg, pièces…), comme au relevé. Le
              dépannage compte dans la période où il a eu lieu.
            </p>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-neutre-500">
              Cochez ce qui est arrivé. Changer une quantité coche le produit.
              Ce qui reste décoché sera compté comme non livré.
            </p>
          )}
        </div>

        {!fige ? (
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              onFocus={() => setCible(null)}
              placeholder={depannage ? "Chercher le produit acheté" : "Chercher ou ajouter un produit"}
              enterKeyHint="search"
              className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-neutre-200 bg-white px-3 text-base outline-none focus:border-rouge-700"
            />
            {!depannage ? (
              <button
                onClick={() => setCommandesSeules((v) => !v)}
                className={`min-h-11 shrink-0 rounded-xl px-3 text-xs font-semibold ${
                  commandesSeules
                    ? "bg-neutre-900 text-white"
                    : "border border-neutre-200 bg-white text-neutre-700"
                }`}
              >
                {commandesSeules ? "Commandés" : "Tous"}
              </button>
            ) : null}
          </div>
        ) : null}

        {!fige && !depannage && !terme && manquants > 0 ? (
          <button
            onClick={() => {
              for (const [pid, e] of Object.entries(etatsRef.current)) {
                if (!e.recu && (e.commandes ?? 0) > 0) modifier(Number(pid), { recu: true });
              }
            }}
            className="min-h-11 w-full rounded-xl border border-vert-200 bg-vert-50 px-4 text-sm font-semibold text-vert-800"
          >
            Tout est arrivé comme commandé
          </button>
        ) : null}

        {affiches.length === 0 ? (
          <p className="rounded-2xl border border-neutre-100 bg-white p-4 text-sm text-neutre-500">
            {terme
              ? "Aucun produit ne porte ce nom."
              : depannage
                ? "Cherchez les produits achetés pour les ajouter."
                : "Rien sur cette commande."}
          </p>
        ) : (
          zones.map((zone) => (
            <section key={zone}>
              <h2 className="mb-1.5 px-1 font-titre text-xs font-bold uppercase tracking-[0.14em] text-neutre-500">
                {zone}
              </h2>
              <ul className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
                {affiches
                  .filter((p) => p.zone === zone)
                  .map((p) => (
                    <LigneProduit
                      key={p.id}
                      produit={p}
                      etat={etats[p.id]}
                      depannage={depannage}
                      fige={fige}
                      enAttente={envoi.cles.has(`reception:${reception.id}:${p.id}`)}
                      frappe={cible === p.id ? frappe : null}
                      onModifier={modifier}
                      onQuantite={ouvrirPave}
                    />
                  ))}
              </ul>
            </section>
          ))
        )}

        {confirmer ? (
          <div className="rounded-2xl border border-ambre-100 bg-ambre-50 p-4">
            <p className="text-sm text-ambre-700">
              {manquants} produit{manquants > 1 ? "s" : ""} commandé
              {manquants > 1 ? "s ne sont" : " n’est"} pas coché
              {manquants > 1 ? "s" : ""} : {manquants > 1 ? "ils seront comptés" : "il sera compté"}{" "}
              comme non livré{manquants > 1 ? "s" : ""}.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setConfirmer(false)}
                className="min-h-12 flex-1 rounded-xl border border-neutre-200 bg-white text-sm font-semibold text-neutre-700"
              >
                Revoir
              </button>
              <button
                onClick={valider}
                className="min-h-12 flex-1 rounded-xl bg-vert-700 text-sm font-semibold text-white"
              >
                Valider quand même
              </button>
            </div>
          </div>
        ) : null}

        {fige ? (
          <div className="space-y-2">
            <p className="rounded-xl bg-vert-50 px-4 py-3 text-sm text-vert-800">
              Réception validée. Les prochaines propositions de commande se
              fondent sur ce qui a été reçu.
            </p>
            <button
              onClick={async () => {
                const r = await fetch(`/api/receptions/${reception.id}/valider`, {
                  method: "DELETE",
                }).catch(() => null);
                if (r?.ok) router.refresh();
                else setEchec("Réouverture impossible (réseau ?)");
              }}
              className="min-h-13 w-full rounded-xl border border-neutre-200 px-4 text-sm font-semibold text-neutre-700"
            >
              Rouvrir pour corriger
            </button>
          </div>
        ) : null}
      </div>

      {cible !== null && produitCible ? (
        <Pave
          titre={produitCible.nom}
          detail={
            depannage
              ? `En ${produitCible.unite ?? "unités"}`
              : etatCible?.commandes != null
                ? `commandé ${qte(etatCible.commandes)} colis · en colis`
                : "hors commande · en colis"
          }
          frappe={frappe}
          raccourcis={raccourcis}
          libelleSuivant="Suivant"
          onTouche={toucher}
          onSuivant={suivant}
          onFermer={() => setCible(null)}
          onHauteur={setHauteurPave}
        />
      ) : null}

      <footer
        hidden={cible !== null}
        className="fixed inset-x-0 bottom-0 z-10 border-t border-neutre-100 bg-white/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2.5">
          <Link
            href="/receptions"
            aria-label="Retour aux réceptions"
            className="-ml-1 flex min-h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-neutre-200 text-xl text-neutre-700"
          >
            ←
          </Link>
          <div className="min-h-11 min-w-0 flex-1 px-1">
            <p className="font-titre text-sm font-semibold tabular-nums">
              {depannage
                ? `${recus} produit${recus > 1 ? "s" : ""}`
                : `${recus} reçu${recus > 1 ? "s" : ""} · ${manquants} manquant${manquants > 1 ? "s" : ""}`}
            </p>
            <p className="truncate text-xs text-neutre-500">
              {echec ?? <EtatEnvoi etat={envoi} />}
            </p>
          </div>
          {!fige ? (
            <button
              onClick={() => (manquants > 0 && !depannage ? setConfirmer(true) : valider())}
              disabled={recus === 0}
              className="min-h-12 shrink-0 rounded-xl bg-vert-700 px-4 font-titre text-sm font-semibold text-white disabled:opacity-35"
            >
              Valider
            </button>
          ) : null}
        </div>
      </footer>
    </>
  );
}

const LigneProduit = memo(function LigneProduit({
  produit,
  etat,
  depannage,
  fige,
  enAttente,
  frappe,
  onModifier,
  onQuantite,
}: {
  produit: ProduitCatalogue;
  etat: Etat | undefined;
  depannage: boolean;
  fige: boolean;
  enAttente: boolean;
  frappe: Frappe | null;
  onModifier: (pid: number, patch: Partial<Etat> | "retirer") => void;
  onQuantite: (pid: number) => void;
}) {
  const recu = etat?.recu ?? false;
  const u = produit.unite ?? "u";
  const actif = frappe !== null;
  const comptage = produit.comptePour !== null;
  const ecart =
    !depannage && recu && etat?.commandes != null && etat.quantite !== etat.commandes;

  return (
    <li
      data-ligne={produit.id}
      className={`flex items-center gap-3 border-b border-neutre-100 px-3 py-2 last:border-b-0 ${
        actif ? "bg-rouge-50" : ""
      }`}
    >
      <button
        role="checkbox"
        aria-checked={recu}
        aria-label={`${produit.nom} reçu`}
        disabled={fige}
        onClick={() =>
          onModifier(produit.id, {
            recu: !recu,
            quantite: etat?.quantite ?? etat?.commandes ?? (depannage ? null : 1),
          })
        }
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 text-lg font-bold ${
          recu ? "border-vert-600 bg-vert-600 text-white" : "border-neutre-200 bg-white text-transparent"
        }`}
      >
        ✓
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug">{produit.nom}</p>
        <p className="text-xs text-neutre-500">
          {comptage ? (
            <>
              en {u} · 1 = {qte(produit.equivalence ?? 1)}
              {produit.nomRattache ? ` « ${produit.nomRattache} »` : ""}
            </>
          ) : (
            <>
              {etat?.commandes != null
                ? `commandé ${qte(etat.commandes)} colis`
                : etat
                  ? "hors commande"
                  : (produit.conditionnement ?? "")}
              {!depannage ? ` · ${qte(produit.fact)} ${u}/colis` : ""}
            </>
          )}
          {ecart ? <span className="font-semibold text-ambre-700"> · écart</span> : null}
          {enAttente ? <span className="text-ambre-700"> · sur le téléphone</span> : null}
        </p>
        {etat && etat.commandes == null && !fige ? (
          <button
            onClick={() => onModifier(produit.id, "retirer")}
            className="min-h-10 text-xs font-semibold text-neutre-500 underline underline-offset-4"
          >
            retirer
          </button>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutre-500">
          {depannage || comptage ? u : "colis"}
        </span>
        <button
          type="button"
          disabled={fige}
          onClick={() => onQuantite(produit.id)}
          aria-label={`Quantité reçue de ${produit.nom}`}
          className={`flex min-h-12 w-20 items-center justify-end rounded-xl border-2 px-2.5 text-lg font-semibold tabular-nums disabled:border-neutre-100 disabled:bg-neutre-50 ${
            actif ? "border-rouge-700 bg-white" : "border-neutre-200 bg-white"
          }`}
        >
          {actif ? (
            <>
              <span className={frappe.neuf && frappe.texte ? "rounded bg-rouge-100" : ""}>
                {frappe.texte}
              </span>
              <span className="curseur" aria-hidden="true" />
            </>
          ) : etat?.quantite != null ? (
            qte(etat.quantite)
          ) : (
            <span className="text-neutre-300">
              {etat?.commandes != null ? qte(etat.commandes) : "0"}
            </span>
          )}
        </button>
      </div>
    </li>
  );
});
