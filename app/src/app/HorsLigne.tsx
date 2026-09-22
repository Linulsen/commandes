"use client";

import { useEffect } from "react";

/**
 * Installe le service worker qui permet de rouvrir l'application sans réseau.
 * Pas en développement : il y mettrait en cache des pages qu'on est en train
 * de modifier.
 */
export default function HorsLigne() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
