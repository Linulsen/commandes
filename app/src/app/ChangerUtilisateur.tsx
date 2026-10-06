"use client";

import Link from "next/link";
import { EVENEMENT_VERROUILLER } from "./Verrou";

/**
 * « Connecté : prénom — Changer ». Quand les codes personnels sont en service,
 * changer de personne passe par l'écran de verrouillage (prénom + code) ;
 * sinon, par la page de présentation de l'appareil, comme avant.
 */
export default function ChangerUtilisateur({ prenom }: { prenom: string }) {
  return (
    <Link
      href="/appareil?suite=/"
      onClick={(e) => {
        try {
          const etat = JSON.parse(localStorage.getItem("praedic_verrou_etat") ?? "null");
          if (etat?.actif && etat.personnes?.length) {
            e.preventDefault();
            window.dispatchEvent(new Event(EVENEMENT_VERROUILLER));
          }
        } catch {
          // stockage illisible : page de présentation
        }
      }}
      className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-1 text-sm text-neutre-500"
    >
      <span>
        Connecté : <span className="font-semibold text-neutre-700">{prenom}</span>
      </span>
      <span className="text-rouge-700 underline decoration-rouge-200 underline-offset-4">Changer</span>
    </Link>
  );
}
