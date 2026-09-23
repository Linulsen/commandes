"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Invite à mettre l'application sur l'écran d'accueil du téléphone.
 *
 * Installée, elle s'ouvre en plein écran, sans la barre du navigateur ni le
 * balayage « retour » qui faisait quitter le relevé en pleine chambre. Le
 * bandeau ne s'affiche que sur un téléphone, hors application installée, et
 * se laisse écarter une semaine.
 */
const CLE = "cmd:installer:plus-tard";
const UNE_SEMAINE = 7 * 864e5;

type Invite = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function Installer() {
  const [mode, setMode] = useState<null | "ios" | "invite" | "autre">(null);
  const invite = useRef<Invite | null>(null);

  useEffect(() => {
    const installee =
      matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (installee || !matchMedia("(pointer: coarse)").matches) return;
    try {
      if (Number(localStorage.getItem(CLE)) > Date.now()) return;
    } catch {
      /* stockage indisponible : on affiche */
    }
    const ios =
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setMode(ios ? "ios" : "autre");
    // Chrome sur Android propose sa propre boîte d'installation.
    const f = (e: Event) => {
      e.preventDefault();
      invite.current = e as Invite;
      setMode("invite");
    };
    window.addEventListener("beforeinstallprompt", f);
    const installe = () => setMode(null);
    window.addEventListener("appinstalled", installe);
    return () => {
      window.removeEventListener("beforeinstallprompt", f);
      window.removeEventListener("appinstalled", installe);
    };
  }, []);

  if (!mode) return null;

  const plusTard = () => {
    try {
      localStorage.setItem(CLE, String(Date.now() + UNE_SEMAINE));
    } catch {
      /* tant pis, il reviendra */
    }
    setMode(null);
  };

  return (
    <section className="rounded-2xl border border-rouge-100 bg-rouge-50 p-4">
      <p className="font-titre text-base font-semibold text-rouge-950">
        Installez l’application sur le téléphone
      </p>
      <p className="mt-1 text-sm leading-relaxed text-neutre-700">
        Plein écran, pas de retour en arrière par erreur pendant un relevé, et
        elle s’ouvre même sans réseau.
      </p>
      {mode === "ios" ? (
        <p className="mt-2 text-sm leading-relaxed text-neutre-900">
          Dans Safari, touchez{" "}
          <svg
            viewBox="0 0 24 24"
            className="inline h-5 w-5 align-text-bottom text-rouge-700"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-label="Partager"
          >
            <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
          </svg>{" "}
          <span className="font-semibold">Partager</span>, puis{" "}
          <span className="font-semibold">« Sur l’écran d’accueil »</span>.
        </p>
      ) : mode === "autre" ? (
        <p className="mt-2 text-sm leading-relaxed text-neutre-900">
          Dans le menu du navigateur <span className="font-semibold">⋮</span>, choisissez{" "}
          <span className="font-semibold">« Ajouter à l’écran d’accueil »</span> ou{" "}
          <span className="font-semibold">« Installer l’application »</span>.
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        {mode === "invite" ? (
          <button
            onClick={async () => {
              const i = invite.current;
              if (!i) return;
              await i.prompt();
              const { outcome } = await i.userChoice;
              if (outcome === "accepted") setMode(null);
            }}
            className="min-h-12 flex-1 rounded-xl bg-rouge-700 px-4 font-titre text-sm font-semibold text-white"
          >
            Installer
          </button>
        ) : null}
        <button
          onClick={plusTard}
          className="min-h-12 rounded-xl border border-rouge-200 bg-white px-4 text-sm font-semibold text-neutre-700"
        >
          Plus tard
        </button>
      </div>
    </section>
  );
}
