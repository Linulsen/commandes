"use client";

import type { useFileAttente } from "@/lib/file-attente";

/**
 * Ce que devient la saisie, en une ligne : c'est la question que se posait
 * Nicolas en sortant de la chambre (« est-ce que c'est enregistré ? »).
 */
export default function EtatEnvoi({ etat }: { etat: ReturnType<typeof useFileAttente> }) {
  if (etat.deconnecte) {
    return (
      <span className="font-semibold text-rouge-700">
        {etat.enAttente} en attente · <a href="/connexion" className="underline">reconnectez-vous</a>
      </span>
    );
  }
  if (etat.enAttente > 0) {
    return (
      <span className="font-semibold text-ambre-700">
        {etat.enAttente} saisie{etat.enAttente > 1 ? "s" : ""} gardée
        {etat.enAttente > 1 ? "s" : ""} sur le téléphone
        {etat.envoi ? " · envoi…" : etat.erreur ? " · hors ligne" : ""}
      </span>
    );
  }
  if (etat.erreur) return <span className="text-rouge-700">{etat.erreur}</span>;
  return <span className="text-vert-700">Tout est enregistré</span>;
}
