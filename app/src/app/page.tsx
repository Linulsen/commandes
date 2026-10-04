import Link from "next/link";
import Entete from "./Entete";
import { getAccueil, getReceptionsAccueil } from "@/lib/model";
import Precharger from "./Precharger";
import Installer from "./Installer";
import BarreNav from "./BarreNav";
import { dateMoyenne } from "@/lib/format";
import { appareilCourant } from "@/lib/appareil";
import { getResumeInventaire } from "@/lib/inventaire";

export const dynamic = "force-dynamic";

export default async function Accueil() {
  const [resumes, receptions, appareil, inventaire] = await Promise.all([
    getAccueil(),
    getReceptionsAccueil(),
    appareilCourant(),
    // L'inventaire ne doit jamais empêcher l'accueil des commandes de s'afficher.
    getResumeInventaire().catch(() => null),
  ]);
  const maintenant = new Date();
  const aujourdhui = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(maintenant);
  const heure = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  }).format(maintenant);
  const aReceptionner = receptions.aReceptionner.length;
  // Les relevés en cours sont mis en cache dès l'accueil : si le réseau lâche
  // avant d'avoir ouvert la page, elle s'ouvrira quand même.
  const aPrecharger = [
    "/receptions",
    ...resumes.flatMap((r) => (r.brouillon ? [`/commande/${r.brouillon.id}`] : [])),
  ];

  return (
    <main style={{ paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}>
      <Entete
        titre="Commandes"
        sousTitre="Relevé des chambres et quantités à commander"
      />

      <div className="mx-auto max-w-2xl space-y-3 px-4 py-4">
        <Installer />
        {appareil?.prenom ? (
          <Link
            href="/appareil?suite=/"
            className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-1 text-sm text-neutre-500"
          >
            <span>
              Connecté : <span className="font-semibold text-neutre-700">{appareil.prenom}</span>
            </span>
            <span className="text-rouge-700 underline decoration-rouge-200 underline-offset-4">
              Changer
            </span>
          </Link>
        ) : null}
        {resumes.map(
          ({ fournisseur, nbProduits, derniereValidee, brouillon, prochaineDate, prochainLibelle }) => (
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
                <form
                  action="/api/commande"
                  method="post"
                  className="flex items-center gap-2 border-t border-neutre-100 px-4 py-3"
                >
                  <input type="hidden" name="fournisseur" value={fournisseur.id} />
                  <button type="submit" className="min-w-0 flex-1 text-left">
                    <span className="block font-titre text-base font-semibold text-rouge-700">
                      Commencer le relevé
                    </span>
                    <span className="mt-0.5 block text-sm text-neutre-500">
                      {prochainLibelle || `commande du ${dateMoyenne(prochaineDate)}`}
                    </span>
                  </button>
                  <input
                    type="date"
                    name="date"
                    required
                    defaultValue={prochaineDate}
                    aria-label="Date de la commande"
                    className="min-h-11 shrink-0 rounded-xl border border-neutre-200 bg-white px-2 text-sm"
                  />
                </form>
              )}
            </section>
          ),
        )}

        <Link
          href="/receptions"
          className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm"
        >
          <span className="min-w-0">
            <span className="block font-titre text-lg font-semibold leading-tight">
              Réceptions
            </span>
            <span className="mt-1 block text-sm text-neutre-500">
              Livraisons à cocher, dépannages, pertes
            </span>
          </span>
          {aReceptionner ? (
            <span className="shrink-0 rounded-full bg-rouge-700 px-2.5 py-1 text-xs font-semibold text-white">
              {aReceptionner} à réceptionner
            </span>
          ) : (
            <span aria-hidden="true" className="text-neutre-400">→</span>
          )}
        </Link>

        {inventaire ? (
          <section className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <h2 className="font-titre text-lg font-semibold leading-tight">Inventaire</h2>
                <p className="mt-1 text-sm text-neutre-500">
                  Tous les lieux, à plusieurs si besoin
                </p>
              </div>
              {inventaire.enCours ? (
                <span className="shrink-0 rounded-full bg-ambre-50 px-2.5 py-1 text-xs font-semibold text-ambre-700">
                  en cours
                </span>
              ) : null}
            </div>
            {inventaire.enCours ? (
              <Link
                href={`/inventaire/${inventaire.enCours.id}`}
                className="flex min-h-14 items-center justify-between gap-3 bg-rouge-700 px-4 py-3 text-white"
              >
                <span className="min-w-0">
                  <span className="block font-titre text-base font-semibold">
                    Reprendre l’inventaire
                  </span>
                  <span className="mt-0.5 block text-sm text-rouge-50">
                    du {dateMoyenne(inventaire.enCours.date_inventaire)}
                    {inventaire.enCours.heure_inventaire
                      ? ` à ${inventaire.enCours.heure_inventaire.slice(0, 5).replace(":", " h ")}`
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-rouge-800 px-2.5 py-1 text-sm tabular-nums">
                  {inventaire.faits}/{inventaire.total}
                </span>
              </Link>
            ) : (
              <form
                action="/api/inventaire"
                method="post"
                className="flex items-center gap-2 border-t border-neutre-100 px-4 py-3"
              >
                <button type="submit" className="min-w-0 flex-1 text-left">
                  <span className="block font-titre text-base font-semibold text-rouge-700">
                    Démarrer un inventaire
                  </span>
                  <span className="mt-0.5 block text-sm text-neutre-500">
                    les collègues le rejoignent depuis leur téléphone
                  </span>
                </button>
                <div className="flex shrink-0 flex-col gap-1">
                  <input
                    type="date"
                    name="date"
                    required
                    defaultValue={aujourdhui}
                    aria-label="Date de l’inventaire"
                    className="min-h-11 rounded-xl border border-neutre-200 bg-white px-2 text-sm"
                  />
                  <input
                    type="time"
                    name="heure"
                    required
                    defaultValue={heure}
                    aria-label="Heure de l’inventaire"
                    className="min-h-11 rounded-xl border border-neutre-200 bg-white px-2 text-sm"
                  />
                </div>
              </form>
            )}
          </section>
        ) : null}
      </div>
      <Precharger urls={inventaire?.enCours ? [...aPrecharger, `/inventaire/${inventaire.enCours.id}`] : aPrecharger} />
      <BarreNav actif="/" />
    </main>
  );
}
