import Link from "next/link";

/**
 * Bandeau de tête, aux couleurs de l'enseigne.
 *
 * Il ne reste pas collé en haut : sur un téléphone tenu d'une main dans une
 * chambre froide, la hauteur d'écran est la ressource rare. Ce qui doit rester
 * atteignable en permanence — les onglets de chambre, la barre de progression —
 * l'est par ses propres moyens.
 */
export default function Entete({
  titre,
  sousTitre,
  retour,
  lien,
}: {
  titre: string;
  sousTitre?: string;
  retour?: { href: string; libelle: string };
  lien?: { href: string; libelle: string };
}) {
  return (
    <header className="bg-rouge-700 text-white">
      <div
        className="mx-auto max-w-2xl px-4 pb-4"
        style={{ paddingTop: "calc(1rem + env(safe-area-inset-top))" }}
      >
        <div className="flex items-center justify-between gap-3">
          {retour ? (
            <Link
              href={retour.href}
              className="-ml-2 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-rouge-50"
            >
              <span aria-hidden="true">←</span>
              {retour.libelle}
            </Link>
          ) : (
            <p className="font-titre text-xs font-bold uppercase tracking-[0.22em] text-rouge-50">
              Del Arte
            </p>
          )}
          {lien ? (
            <Link
              href={lien.href}
              className="-mr-2 flex min-h-11 items-center rounded-lg px-2 text-sm text-rouge-50 underline decoration-rouge-400 underline-offset-4"
            >
              {lien.libelle}
            </Link>
          ) : null}
        </div>

        <h1 className="mt-1 font-titre text-2xl font-semibold leading-tight tracking-tight">
          {titre}
        </h1>
        {sousTitre ? (
          <p className="mt-0.5 text-sm text-rouge-50">{sousTitre}</p>
        ) : null}
      </div>
    </header>
  );
}
