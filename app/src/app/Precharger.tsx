"use client";

import { useEffect } from "react";

/**
 * Met des pages en cache pour qu'elles s'ouvrent sans réseau. Même cache que
 * le service worker (public/sw.js), qui les servira s'il ne joint pas le
 * serveur.
 */
export default function Precharger({ urls }: { urls: string[] }) {
  const cle = urls.join("|");
  useEffect(() => {
    if (!("caches" in window) || !navigator.onLine) return;
    const minuteur = setTimeout(async () => {
      try {
        const cache = await caches.open("cmd-pages-v1");
        for (const url of cle.split("|").filter(Boolean)) {
          const r = await fetch(url, { credentials: "same-origin", cache: "no-store" });
          if (r.ok && !r.redirected) await cache.put(url, r);
        }
      } catch {
        /* le préchargement est un bonus */
      }
    }, 1500);
    return () => clearTimeout(minuteur);
  }, [cle]);
  return null;
}
