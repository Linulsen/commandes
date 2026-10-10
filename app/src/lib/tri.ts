"use client";

import { useCallback, useEffect, useState } from "react";
import type { Tri } from "./tri-commun";

/*
 * Choix du tri (alphabétique ou rangement), gardé dans le téléphone : chacun
 * garde le sien.
 */

const CLE = "tri-produits";
const EVENEMENT = "tri-produits-change";

const lire = (): Tri => {
  try {
    return localStorage.getItem(CLE) === "rangement" ? "rangement" : "alpha";
  } catch {
    return "alpha";
  }
};

/** Le choix de tri de cet appareil, partagé entre les écrans ouverts. */
export function useTri(): [Tri, (t: Tri) => void] {
  // Le serveur ne connaît pas le choix du téléphone : on part de l'ordre
  // alphabétique, puis on applique le choix gardé dès l'affichage.
  const [tri, setTriEtat] = useState<Tri>("alpha");
  useEffect(() => {
    setTriEtat(lire());
    const suivre = () => setTriEtat(lire());
    window.addEventListener(EVENEMENT, suivre);
    window.addEventListener("storage", suivre);
    return () => {
      window.removeEventListener(EVENEMENT, suivre);
      window.removeEventListener("storage", suivre);
    };
  }, []);
  const setTri = useCallback((t: Tri) => {
    setTriEtat(t);
    try {
      localStorage.setItem(CLE, t);
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour la page.
    }
    window.dispatchEvent(new Event(EVENEMENT));
  }, []);
  return [tri, setTri];
}
