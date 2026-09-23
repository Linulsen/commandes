import Link from "next/link";
import Entete from "../Entete";
import { getReceptionsAccueil } from "@/lib/model";
import { dateMoyenne } from "@/lib/format";
import BarreNav from "../BarreNav";

export const dynamic = "force-dynamic";

/**
 * Ce qui a été commandé et doit être réceptionné, et les dépannages. Deux
 * écrans complémentaires : le relevé dit ce qu'il faut commander, la réception
 * dit ce qui est vraiment arrivé.
 */
export default async function Receptions() {
  const { aReceptionner, enCours, recentes, fournisseurs } = await getReceptionsAccueil();
  const nom = new Map(fournisseurs.map((f) => [f.id, f.nom]));
  const depannagesEnCours = enCours.filter((r) => r.type === "depannage");

  return (
    <main style={{ paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}>
      <Entete
        titre="Réceptions"
        sousTitre="Ce qui est vraiment arrivé en chambre"
      />

      <div className="mx-auto max-w-2xl space-y-5 px-4 py-4">
        <section>
          <h2 className="mb-1.5 px-1 font-titre text-xs font-bold uppercase tracking-[0.14em] text-neutre-500">
            Commandes à réceptionner
          </h2>
          {aReceptionner.length === 0 ? (
            <p className="rounded-2xl border border-neutre-100 bg-white p-4 text-sm text-neutre-500">
              Aucune commande en attente de livraison. Une commande apparaît ici
              dès qu’elle est validée.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
              {aReceptionner.map(({ session, reception }) => (
                <li key={session.id} className="border-b border-neutre-100 last:border-b-0">
                  <form action="/api/receptions" method="post">
                    <input type="hidden" name="session" value={session.id} />
                    <button
                      type="submit"
                      className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block font-titre text-sm font-semibold">
                          {nom.get(session.fournisseur_id)}
                        </span>
                        <span className="mt-0.5 block text-xs text-neutre-500">
                          commande du {dateMoyenne(session.date_commande)}
                          {session.libelle ? ` · ${session.libelle}` : ""}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                          reception
                            ? "bg-ambre-50 text-ambre-700"
                            : "bg-rouge-700 text-white"
                        }`}
                      >
                        {reception ? "reprendre" : "réceptionner"}
                      </span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-1.5 px-1 font-titre text-xs font-bold uppercase tracking-[0.14em] text-neutre-500">
            Dépannage
          </h2>
          <div className="rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm">
            <p className="text-sm leading-relaxed text-neutre-700">
              Un achat en urgence, hors commande — chez Metro, un confrère… Le
              déclarer évite que la prévision le prenne pour du stock sorti de
              nulle part, et qu’elle vous laisse manquer la semaine suivante.
            </p>
            <form action="/api/receptions" method="post" className="mt-3 flex gap-2">
              <input type="hidden" name="type" value="depannage" />
              <input
                name="provenance"
                placeholder="Où ? (Metro…)"
                className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-neutre-200 px-3 text-base outline-none focus:border-rouge-700"
              />
              <button
                type="submit"
                className="min-h-12 shrink-0 rounded-xl bg-rouge-700 px-4 font-titre text-sm font-semibold text-white"
              >
                Déclarer
              </button>
            </form>
          </div>
          {depannagesEnCours.length ? (
            <ul className="mt-2 overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
              {depannagesEnCours.map((r) => (
                <li key={r.id} className="border-b border-neutre-100 last:border-b-0">
                  <Link
                    href={`/reception/${r.id}`}
                    className="flex min-h-14 items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block font-titre text-sm font-semibold">
                        Dépannage{r.provenance ? ` · ${r.provenance}` : ""}
                      </span>
                      <span className="mt-0.5 block text-xs text-neutre-500">
                        {dateMoyenne(r.date_reception)}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-ambre-50 px-2.5 py-1 text-xs font-semibold text-ambre-700">
                      en cours
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {recentes.length ? (
          <section>
            <h2 className="mb-1.5 px-1 font-titre text-xs font-bold uppercase tracking-[0.14em] text-neutre-500">
              Réceptions validées
            </h2>
            <ul className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
              {recentes.map((r) => (
                <li key={r.id} className="border-b border-neutre-100 last:border-b-0">
                  <Link
                    href={`/reception/${r.id}`}
                    className="flex min-h-14 items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block font-titre text-sm font-semibold">
                        {r.type === "depannage"
                          ? `Dépannage${r.provenance ? ` · ${r.provenance}` : ""}`
                          : nom.get(r.fournisseur_id ?? 0)}
                      </span>
                      <span className="mt-0.5 block text-xs text-neutre-500">
                        reçu le {dateMoyenne(r.date_reception)}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-vert-100 px-2.5 py-1 text-xs font-semibold text-vert-800">
                      validée
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <BarreNav actif="/receptions" />
    </main>
  );
}
