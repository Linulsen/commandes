import Link from "next/link";

/**
 * Navigation entre les trois écrans d'accueil, en bas, sous le pouce : les
 * liens du bandeau rouge sont hors de portée d'un téléphone tenu d'une main.
 * Les écrans de saisie ont leur propre barre basse, avec un retour.
 */
const ENTREES = [
  {
    href: "/",
    libelle: "Commandes",
    icone: "M4 6h16M4 12h16M4 18h10",
  },
  {
    href: "/receptions",
    libelle: "Réceptions",
    icone: "M3 7l9-4 9 4v10l-9 4-9-4V7zm0 0l9 4 9-4M12 11v10",
  },
  {
    href: "/historique",
    libelle: "Historique",
    icone: "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
] as const;

export default function BarreNav({ actif }: { actif: (typeof ENTREES)[number]["href"] }) {
  return (
    <nav
      className="sans-impression fixed inset-x-0 bottom-0 z-10 border-t border-neutre-100 bg-white/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-2xl">
        {ENTREES.map((e) => {
          const courant = e.href === actif;
          return (
            <li key={e.href} className="flex-1">
              <Link
                href={e.href}
                aria-current={courant ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold ${
                  courant ? "text-rouge-700" : "text-neutre-500"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={courant ? 2.2 : 1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={e.icone} />
                </svg>
                {e.libelle}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
