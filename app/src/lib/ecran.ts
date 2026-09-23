"use client";

import { useEffect } from "react";

/**
 * Garde l'écran allumé tant que la saisie est ouverte. En chambre froide, un
 * écran qui s'éteint entre deux étagères oblige à déverrouiller avec des gants
 * et à retrouver sa place dans la liste.
 *
 * Le verrou tombe de lui-même quand l'application passe en arrière-plan : on
 * le reprend au retour. Sans prise en charge (anciens navigateurs), rien ne se
 * passe.
 */
export function useEcranAllume(actif: boolean) {
  useEffect(() => {
    if (!actif || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let verrou: WakeLockSentinel | null = null;
    let fini = false;
    const prendre = async () => {
      if (document.visibilityState !== "visible" || (verrou && !verrou.released)) return;
      try {
        const v = await navigator.wakeLock.request("screen");
        if (fini) void v.release();
        else verrou = v;
      } catch {
        /* refusé (économie d'énergie) : tant pis */
      }
    };
    void prendre();
    document.addEventListener("visibilitychange", prendre);
    return () => {
      fini = true;
      document.removeEventListener("visibilitychange", prendre);
      void verrou?.release();
    };
  }, [actif]);
}
