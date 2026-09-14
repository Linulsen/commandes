import Link from "next/link";
import { getFournisseurs, getSessions } from "@/lib/model";
import { dateLongue } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Historique() {
  const [sessions, fournisseurs] = await Promise.all([
    getSessions(80),
    getFournisseurs(),
  ]);
  const nom = new Map(fournisseurs.map((f) => [f.id, f.nom]));

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-8">
      <Link href="/" className="text-sm text-ardoise-600 underline">
        ← Commandes
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Historique</h1>
      <p className="mt-1 text-sm text-ardoise-600">
        Chaque relevé validé nourrit la prévision des commandes suivantes.
      </p>

      <ul className="mt-6 overflow-hidden rounded-xl border border-ardoise-200 bg-white">
        {sessions.map((s) => (
          <li key={s.id} className="border-b border-ardoise-100 last:border-b-0">
            <Link
              href={`/commande/${s.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{nom.get(s.fournisseur_id)}</p>
                <p className="text-xs text-ardoise-600">
                  {dateLongue(s.date_commande)}
                  {s.libelle ? ` · ${s.libelle}` : ""}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                  s.statut === "validee"
                    ? "bg-sauge-100 text-sauge-500"
                    : "bg-braise-500/10 text-braise-600"
                }`}
              >
                {s.statut === "validee" ? "validée" : "en cours"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
