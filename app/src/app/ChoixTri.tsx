"use client";

import Link from "next/link";
import type { Tri } from "@/lib/tri-commun";

/**
 * Bascule entre l'ordre alphabétique et l'ordre de rangement, au-dessus de la
 * liste des produits d'une chambre. L'ordre lui-même ne se règle que depuis
 * l'inventaire : seul l'écran d'inventaire passe `lienReglage`.
 */
export default function ChoixTri({
  tri,
  onTri,
  lienReglage,
}: {
  tri: Tri;
  onTri: (t: Tri) => void;
  /** Page de réglage de l'ordre, sur le lieu ouvert (inventaire seulement). */
  lienReglage?: string;
}) {
  const options: { valeur: Tri; libelle: string }[] = [
    { valeur: "alpha", libelle: "A → Z" },
    { valeur: "rangement", libelle: "Rangement" },
  ];
  return (
    <div className="sans-impression mb-2 flex items-center justify-between gap-2 px-1">
      <div
        role="radiogroup"
        aria-label="Ordre d’affichage"
        className="flex rounded-full border border-neutre-200 bg-white p-0.5"
      >
        {options.map((o) => (
          <button
            key={o.valeur}
            role="radio"
            aria-checked={tri === o.valeur}
            onClick={() => onTri(o.valeur)}
            className={`min-h-9 rounded-full px-3 text-sm font-semibold ${
              tri === o.valeur ? "bg-neutre-900 text-white" : "text-neutre-700"
            }`}
          >
            {o.libelle}
          </button>
        ))}
      </div>
      {tri === "rangement" && lienReglage ? (
        <Link
          href={lienReglage}
          className="flex min-h-9 items-center rounded-lg px-1 text-sm text-neutre-500 underline decoration-neutre-200 underline-offset-4"
        >
          Modifier l’ordre
        </Link>
      ) : null}
    </div>
  );
}
