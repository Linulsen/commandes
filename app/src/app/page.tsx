import Link from "next/link";
import { getAccueil } from "@/lib/model";
import { dateLongue } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Accueil() {
  const resumes = await getAccueil();

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Commandes</h1>
        <Link href="/historique" className="text-sm text-ardoise-600 underline">
          Historique
        </Link>
      </header>

      <div className="mt-6 space-y-4">
        {resumes.map(({ fournisseur, nbProduits, derniereValidee, brouillon, prochaineDate }) => (
          <section
            key={fournisseur.id}
            className="rounded-xl border border-ardoise-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{fournisseur.nom}</h2>
                <p className="mt-0.5 text-sm text-ardoise-600">
                  {nbProduits} produits
                  {fournisseur.rythme ? ` · ${fournisseur.rythme}` : ""}
                </p>
              </div>
              {brouillon ? (
                <span className="shrink-0 rounded-full bg-braise-500/10 px-2.5 py-1 text-xs font-medium text-braise-600">
                  en cours
                </span>
              ) : null}
            </div>

            <p className="mt-3 text-sm text-ardoise-600">
              {derniereValidee
                ? `Dernière commande validée le ${dateLongue(derniereValidee.date_commande)}.`
                : "Aucune commande validée pour l’instant."}
            </p>

            {brouillon ? (
              <Link
                href={`/commande/${brouillon.id}`}
                className="mt-4 flex items-center justify-between rounded-lg bg-ardoise-900 px-4 py-3 font-medium text-white"
              >
                <span>Reprendre le relevé</span>
                <span className="text-sm font-normal text-ardoise-200">
                  {brouillon.saisis}/{brouillon.total}
                </span>
              </Link>
            ) : (
              <form action="/api/commande" method="post" className="mt-4">
                <input type="hidden" name="fournisseur" value={fournisseur.id} />
                <input type="hidden" name="date" value={prochaineDate} />
                <input
                  type="hidden"
                  name="libelle"
                  value={fournisseur.frequence === "bi-hebdo" ? "Dimanche pour mardi" : ""}
                />
                <button
                  type="submit"
                  className="flex w-full items-center justify-between rounded-lg border border-ardoise-900 px-4 py-3 font-medium text-ardoise-900"
                >
                  <span>Commencer le relevé</span>
                  <span className="text-sm font-normal text-ardoise-600">
                    {dateLongue(prochaineDate)}
                  </span>
                </button>
              </form>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
