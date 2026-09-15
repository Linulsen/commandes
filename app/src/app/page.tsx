import Link from "next/link";
import Entete from "./Entete";
import { getAccueil } from "@/lib/model";
import { dateMoyenne } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Accueil() {
  const resumes = await getAccueil();

  return (
    <main className="pb-12">
      <Entete
        titre="Commandes"
        sousTitre="Relevé des chambres et quantités à commander"
        lien={{ href: "/historique", libelle: "Historique" }}
      />

      <div className="mx-auto max-w-2xl space-y-3 px-4 py-4">
        {resumes.map(
          ({ fournisseur, nbProduits, derniereValidee, brouillon, prochaineDate }) => (
            <section
              key={fournisseur.id}
              className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm"
            >
              <div className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <h2 className="font-titre text-lg font-semibold leading-tight">
                    {fournisseur.nom}
                  </h2>
                  <p className="mt-1 text-sm text-neutre-500">
                    {nbProduits} produits
                    {fournisseur.rythme ? ` · ${fournisseur.rythme}` : ""}
                  </p>
                  <p className="mt-2 text-sm text-neutre-500">
                    {derniereValidee
                      ? `Dernière commande : ${dateMoyenne(derniereValidee.date_commande)}`
                      : "Aucune commande validée pour l’instant"}
                  </p>
                </div>
                {brouillon ? (
                  <span className="shrink-0 rounded-full bg-ambre-50 px-2.5 py-1 text-xs font-semibold text-ambre-700">
                    en cours
                  </span>
                ) : null}
              </div>

              {brouillon ? (
                <Link
                  href={`/commande/${brouillon.id}`}
                  className="flex min-h-14 items-center justify-between gap-3 bg-rouge-700 px-4 py-3 text-white"
                >
                  <span className="min-w-0">
                    <span className="block font-titre text-base font-semibold">
                      Reprendre le relevé
                    </span>
                    <span className="mt-0.5 block text-sm text-rouge-50">
                      commande du {dateMoyenne(brouillon.date_commande)}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-rouge-800 px-2.5 py-1 text-sm tabular-nums">
                    {brouillon.saisis}/{brouillon.total}
                  </span>
                </Link>
              ) : (
                <form action="/api/commande" method="post">
                  <input type="hidden" name="fournisseur" value={fournisseur.id} />
                  <input type="hidden" name="date" value={prochaineDate} />
                  <input
                    type="hidden"
                    name="libelle"
                    value={
                      fournisseur.frequence === "bi-hebdo" ? "Dimanche pour mardi" : ""
                    }
                  />
                  <button
                    type="submit"
                    className="w-full border-t border-neutre-100 px-4 py-3 text-left"
                  >
                    <span className="block font-titre text-base font-semibold text-rouge-700">
                      Commencer le relevé
                    </span>
                    <span className="mt-0.5 block text-sm text-neutre-500">
                      pour la commande du {dateMoyenne(prochaineDate)}
                    </span>
                  </button>
                </form>
              )}
            </section>
          ),
        )}
      </div>
    </main>
  );
}
