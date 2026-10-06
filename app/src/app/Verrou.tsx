"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { empreinteCode, memeEmpreinte, type EtatVerrou } from "@/lib/empreinte-code";

/**
 * Écran de verrouillage : quand l'appli n'a pas servi depuis plus de
 * 10 minutes, chacun redonne son prénom et son code personnel.
 *
 * Tout se vérifie sur l'appareil, pour ne jamais bloquer un relevé en chambre
 * froide sans réseau : la liste des personnes et l'empreinte de leur code sont
 * gardées dans le téléphone et rafraîchies dès que le réseau le permet. Les
 * saisies en cours et les envois en attente continuent derrière l'écran.
 *
 * Tant que l'administrateur n'a pas activé le verrou (page Appareils), ou que
 * l'appareil n'a jamais reçu la liste, rien n'est verrouillé.
 */

const DELAI_MS = 10 * 60 * 1000;
const CLE_ETAT = "praedic_verrou_etat";
const CLE_ACTIVITE = "praedic_derniere_activite";
const CLE_VERROUILLE = "praedic_verrouille";
const CLE_ECHECS = "praedic_verrou_echecs";
const CLE_A_ENVOYER = "praedic_deverrouillage_a_envoyer";
const ESSAIS = 5;
const ATTENTE_MS = 60 * 1000;

/** Pages où l'on n'est pas encore entré dans l'appli. */
const PAGES_LIBRES = ["/connexion", "/appareil", "/appareil/attente"];

export const EVENEMENT_VERROUILLER = "praedic:verrouiller";

function lire<T>(cle: string): T | null {
  try {
    const v = localStorage.getItem(cle);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function ecrire(cle: string, valeur: unknown) {
  try {
    if (valeur === null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, JSON.stringify(valeur));
  } catch {
    // stockage indisponible : le verrou se comporte comme s'il était éteint
  }
}

function etatGarde(): EtatVerrou | null {
  const e = lire<EtatVerrou>(CLE_ETAT);
  return e && e.actif && e.personnes?.length ? e : null;
}

export default function Verrou() {
  const pathname = usePathname();
  const router = useRouter();
  const [verrouille, setVerrouille] = useState(false);
  const [etat, setEtat] = useState<EtatVerrou | null>(null);
  const [choisi, setChoisi] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [calcul, setCalcul] = useState(false);
  const dernierEcrit = useRef(0);
  const dejaVerrouille = useRef(false);
  const libre = PAGES_LIBRES.includes(pathname);

  const noterActivite = useCallback((force = false) => {
    const maintenant = Date.now();
    if (!force && maintenant - dernierEcrit.current < 15_000) return;
    dernierEcrit.current = maintenant;
    ecrire(CLE_ACTIVITE, maintenant);
  }, []);

  const verrouiller = useCallback(() => {
    const e = etatGarde();
    if (!e) return;
    // Déjà affiché : ne pas effacer le prénom choisi ni le code en cours.
    if (dejaVerrouille.current) return;
    dejaVerrouille.current = true;
    ecrire(CLE_VERROUILLE, true);
    setEtat(e);
    setChoisi(null);
    setCode("");
    setMessage(null);
    setVerrouille(true);
  }, []);

  /** Verrouille si l'appli a dormi trop longtemps (ou l'était déjà). */
  const verifier = useCallback(() => {
    if (!etatGarde()) {
      ecrire(CLE_VERROUILLE, null);
      dejaVerrouille.current = false;
      setVerrouille(false);
      return;
    }
    if (lire<boolean>(CLE_VERROUILLE)) {
      verrouiller();
      return;
    }
    const derniere = lire<number>(CLE_ACTIVITE);
    if (derniere === null) {
      noterActivite(true);
    } else if (Date.now() - derniere > DELAI_MS) {
      verrouiller();
    }
  }, [noterActivite, verrouiller]);

  /** Rafraîchit la liste des codes quand le réseau est là. */
  const rafraichir = useCallback(async () => {
    try {
      const r = await fetch("/api/verrou", { cache: "no-store" });
      if (!r.ok) return;
      const e = (await r.json()) as EtatVerrou;
      ecrire(CLE_ETAT, e);
      if (!e.actif) {
        ecrire(CLE_VERROUILLE, null);
        dejaVerrouille.current = false;
        setVerrouille(false);
      } else {
        setEtat((avant) => (avant ? e : avant));
      }
    } catch {
      // hors ligne : on garde la copie
    }
  }, []);

  /** Envoie au serveur un déverrouillage fait sans réseau. */
  const envoyerEnAttente = useCallback(async () => {
    const enAttente = lire<{ prenom: string; quand: string }>(CLE_A_ENVOYER);
    if (!enAttente) return;
    try {
      const r = await fetch("/api/verrou", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prenom: enAttente.prenom, horsLigne: true, quand: enAttente.quand }),
      });
      if (r.ok || r.status === 404) ecrire(CLE_A_ENVOYER, null);
      if (r.ok) router.refresh();
    } catch {
      // toujours hors ligne
    }
  }, [router]);

  useEffect(() => {
    if (libre) return;
    verifier();
    rafraichir().then(verifier);
    envoyerEnAttente();

    const auRetour = () => {
      if (document.visibilityState === "visible") {
        verifier();
        rafraichir();
        envoyerEnAttente();
      } else {
        noterActivite(true);
      }
    };
    const activite = () => {
      if (dejaVerrouille.current) return;
      // Une touche après un long sommeil sans changement de visibilité
      // (écran resté allumé) verrouille d'abord.
      const derniere = lire<number>(CLE_ACTIVITE);
      if (derniere !== null && Date.now() - derniere > DELAI_MS) verifier();
      else noterActivite();
    };
    const enLigne = () => {
      rafraichir();
      envoyerEnAttente();
    };
    const demande = () => verrouiller();

    document.addEventListener("visibilitychange", auRetour);
    window.addEventListener("pageshow", auRetour);
    const depart = () => noterActivite(true);
    window.addEventListener("pagehide", depart);
    window.addEventListener("pointerdown", activite, { capture: true });
    window.addEventListener("keydown", activite, { capture: true });
    window.addEventListener("online", enLigne);
    window.addEventListener(EVENEMENT_VERROUILLER, demande);
    const minuterie = window.setInterval(verifier, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", auRetour);
      window.removeEventListener("pageshow", auRetour);
      window.removeEventListener("pagehide", depart);
      window.removeEventListener("pointerdown", activite, { capture: true });
      window.removeEventListener("keydown", activite, { capture: true });
      window.removeEventListener("online", enLigne);
      window.removeEventListener(EVENEMENT_VERROUILLER, demande);
      window.clearInterval(minuterie);
    };
  }, [libre, verifier, rafraichir, envoyerEnAttente, noterActivite, verrouiller]);

  const valider = useCallback(
    async (saisi: string) => {
      if (!etat || !choisi) return;
      const echecs = lire<{ n: number; dernier: number }>(CLE_ECHECS) ?? { n: 0, dernier: 0 };
      if (echecs.n >= ESSAIS && Date.now() - echecs.dernier < ATTENTE_MS) {
        setMessage("Trop d’essais : patientez une minute.");
        setCode("");
        return;
      }
      const personne = etat.personnes.find((p) => p.prenom === choisi);
      if (!personne) return;
      setCalcul(true);
      const bon = memeEmpreinte(await empreinteCode(saisi, personne.sel, personne.iterations), personne.empreinte);
      setCalcul(false);
      if (!bon) {
        const n = echecs.n >= ESSAIS ? 1 : echecs.n + 1;
        ecrire(CLE_ECHECS, { n, dernier: Date.now() });
        setMessage(n >= ESSAIS ? "Trop d’essais : patientez une minute." : "Code incorrect.");
        setCode("");
        return;
      }
      ecrire(CLE_ECHECS, null);
      ecrire(CLE_VERROUILLE, null);
      dejaVerrouille.current = false;
      noterActivite(true);
      setVerrouille(false);
      setCode("");
      setMessage(null);
      ecrire(CLE_A_ENVOYER, { prenom: personne.prenom, quand: new Date().toISOString() });
      try {
        const r = await fetch("/api/verrou", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prenom: personne.prenom }),
        });
        if (r.ok || r.status === 404) ecrire(CLE_A_ENVOYER, null);
        if (r.ok) router.refresh();
      } catch {
        // hors ligne : envoyé au retour du réseau
      }
    },
    [etat, choisi, noterActivite, router],
  );

  if (libre || !verrouille || !etat) return null;

  const touche = (chiffre: string) => {
    if (calcul) return;
    setMessage(null);
    setCode((c) => (c.length >= 8 ? c : c + chiffre));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Appli verrouillée"
      className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-rouge-700 text-white"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-8">
        <p className="font-titre text-xs font-bold uppercase tracking-[0.22em] text-rouge-50">Del Arte</p>
        {!choisi ? (
          <>
            <h1 className="mt-2 font-titre text-3xl font-semibold leading-tight tracking-tight">Qui êtes-vous ?</h1>
            <p className="mt-2 text-sm text-rouge-50">L’appli n’a pas servi depuis plus de 10 minutes.</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {etat.personnes.map((p) => (
                <button
                  key={p.prenom}
                  type="button"
                  onClick={() => {
                    setChoisi(p.prenom);
                    setCode("");
                    setMessage(null);
                  }}
                  className="min-h-14 rounded-xl bg-white px-3 font-titre text-base font-semibold text-rouge-700"
                >
                  {p.prenom}
                </button>
              ))}
            </div>
            <p className="mt-6 text-xs leading-relaxed text-rouge-50">
              Pas de code ? Demandez-le à l’administrateur.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-2 font-titre text-3xl font-semibold leading-tight tracking-tight">{choisi}</h1>
            <p className="mt-2 text-sm text-rouge-50">Votre code personnel</p>
            <div className="mt-5 flex h-8 items-center justify-center gap-3" aria-live="polite">
              {code.length === 0 ? (
                <span className="text-sm text-rouge-200">—</span>
              ) : (
                Array.from(code).map((_, i) => <span key={i} className="h-3.5 w-3.5 rounded-full bg-white" />)
              )}
            </div>
            <p className="mt-1 h-5 text-center text-sm font-semibold text-rouge-50">
              {calcul ? "Vérification…" : message}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => touche(c)}
                  className="min-h-15 rounded-xl bg-rouge-800 font-titre text-2xl font-semibold"
                >
                  {c}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCode((c) => c.slice(0, -1))}
                className="min-h-15 rounded-xl text-sm font-semibold text-rouge-50"
                aria-label="Effacer"
              >
                Effacer
              </button>
              <button
                type="button"
                onClick={() => touche("0")}
                className="min-h-15 rounded-xl bg-rouge-800 font-titre text-2xl font-semibold"
              >
                0
              </button>
              <button
                type="button"
                disabled={code.length < 4 || calcul}
                onClick={() => valider(code)}
                className="min-h-15 rounded-xl bg-white font-titre text-base font-semibold text-rouge-700 disabled:opacity-40"
              >
                OK
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setChoisi(null);
                setCode("");
                setMessage(null);
              }}
              className="mt-6 min-h-11 text-sm text-rouge-50 underline decoration-rouge-200 underline-offset-4"
            >
              Ce n’est pas moi
            </button>
          </>
        )}
      </div>
    </div>
  );
}
