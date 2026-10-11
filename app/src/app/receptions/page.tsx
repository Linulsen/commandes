import Link from "next/link";
import Entete from "../Entete";
import { getReceptionsAccueil, type EchangeEnCours } from "@/lib/model";
import { RESTAURANTS_DEL_ARTE } from "@/lib/del-arte";
import { dateMoyenne, libelleHorsCommande, qte } from "@/lib/format";
import type { Reception } from "@/lib/types";
import BarreNav from "../BarreNav";

export const dynamic = "force-dynamic";

/**
 * Ce qui a été commandé et doit être réceptionné, les dépannages et les
 * pertes. Le relevé dit ce qu'il faut commander ; la réception dit ce qui est
 * vraiment arrivé, le dépannage ce qui est entré hors commande, la perte ce
 * qui est parti à la poubelle.
 */
export default async function Receptions() {
  const { aReceptionner, enCours, recentes, fournisseurs, echanges } =
    await getReceptionsAccueil();
  const nom = new Map(fournisseurs.map((f) => [f.id, f.nom]));
  const depannagesEnCours = enCours.filter((r) => r.type === "depannage" && !r.del_arte);
  const pertesEnCours = enCours.filter((r) => r.type === "perte");
  const echangesEnCours = enCours.filter((r) => r.del_arte);

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
              Un achat en urgence, hors commande — chez Metro, Grand Frais… Le
              déclarer évite que la prévision le prenne pour du stock sorti de
              nulle part, et qu’elle vous laisse manquer la semaine suivante.
              Dépannage par un autre Del Arte : voir « Échanges Del Arte »
              ci-dessous.
            </p>
            <form action="/api/receptions" method="post" className="mt-3 flex gap-2">
              <input type="hidden" name="type" value="depannage" />
              <input
                name="provenance"
                placeholder="Où ? (Metro, Grand Frais…)"
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
          <EnCours liste={depannagesEnCours} />
        </section>

        <section>
          <h2 className="mb-1.5 px-1 font-titre text-xs font-bold uppercase tracking-[0.14em] text-neutre-500">
            Échanges Del Arte
          </h2>
          <div className="rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm">
            <p className="text-sm leading-relaxed text-neutre-700">
              Marchandise prêtée entre restaurants. Ce qu’on nous prête reste
              réservé dans notre stock et est recommandé à chaque commande tant
              qu’il n’est pas rendu. Ce que nous prêtons ne compte pas comme
              consommé.
            </p>
            <form action="/api/receptions" method="post" className="mt-3 space-y-2">
              <select
                name="delArte"
                required
                defaultValue=""
                aria-label="Restaurant"
                className="min-h-12 w-full rounded-xl border-2 border-neutre-200 bg-white px-3 text-base outline-none focus:border-rouge-700"
              >
                <option value="" disabled>
                  Quel restaurant ?
                </option>
                {RESTAURANTS_DEL_ARTE.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="submit"
                  name="type"
                  value="depannage"
                  className="min-h-12 rounded-xl bg-rouge-700 px-3 font-titre text-sm font-semibold text-white"
                >
                  Ils nous prêtent
                </button>
                <button
                  type="submit"
                  name="type"
                  value="pret"
                  className="min-h-12 rounded-xl border border-neutre-200 px-3 font-titre text-sm font-semibold text-neutre-700"
                >
                  Nous prêtons
                </button>
                <button
                  type="submit"
                  name="type"
                  value="rendu"
                  className="min-h-12 rounded-xl border border-neutre-200 px-3 font-titre text-sm font-semibold text-neutre-700"
                >
                  Nous rendons
                </button>
                <button
                  type="submit"
                  name="type"
                  value="retour"
                  className="min-h-12 rounded-xl border border-neutre-200 px-3 font-titre text-sm font-semibold text-neutre-700"
                >
                  Ils nous rendent
                </button>
              </div>
            </form>
          </div>
          <EnCours liste={echangesEnCours} />
          <Soldes echanges={echanges} />
        </section>

        <section>
          <h2 className="mb-1.5 px-1 font-titre text-xs font-bold uppercase tracking-[0.14em] text-neutre-500">
            Perte
          </h2>
          <div className="rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm">
            <p className="text-sm leading-relaxed text-neutre-700">
              Un produit jeté — date dépassée, abîmé, renversé… Le déclarer
              évite que la prévision le compte comme vendu, et qu’elle en fasse
              commander davantage la fois suivante.
            </p>
            <form action="/api/receptions" method="post" className="mt-3 flex gap-2">
              <input type="hidden" name="type" value="perte" />
              <input
                name="provenance"
                placeholder="Motif ? (DLC…)"
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
          <EnCours liste={pertesEnCours} />
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
                        {r.type === "livraison"
                          ? nom.get(r.fournisseur_id ?? 0)
                          : libelleHorsCommande(r)}
                      </span>
                      <span className="mt-0.5 block text-xs text-neutre-500">
                        {r.type === "perte"
                          ? "jeté le"
                          : r.type === "pret" || r.type === "rendu"
                            ? "sorti le"
                            : "reçu le"}{" "}
                        {dateMoyenne(r.date_reception)}
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

/** Dépannages ou pertes ouverts et pas encore validés. */
function EnCours({ liste }: { liste: Reception[] }) {
  if (!liste.length) return null;
  return (
    <ul className="mt-2 overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
      {liste.map((r) => (
        <li key={r.id} className="border-b border-neutre-100 last:border-b-0">
          <Link
            href={`/reception/${r.id}`}
            className="flex min-h-14 items-center justify-between gap-3 px-4 py-3"
          >
            <span className="min-w-0">
              <span className="block font-titre text-sm font-semibold">
                {libelleHorsCommande(r)}
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
  );
}

/**
 * Ce qui reste dû, restaurant par restaurant, dans les deux sens. Un bouton
 * ouvre le rendu (ou le retour) prérempli avec tout ce qui est dû : pour un
 * rendu partiel, on corrige les quantités.
 */
function Soldes({ echanges }: { echanges: EchangeEnCours[] }) {
  if (!echanges.length) return null;
  const restaurants = [...new Set(echanges.map((e) => e.delArte))];
  return (
    <div className="mt-2 space-y-2">
      {restaurants.map((resto) => {
        const dus = echanges.filter((e) => e.delArte === resto && e.nousDevons > 0);
        const aRecevoir = echanges.filter((e) => e.delArte === resto && e.ilsDoivent > 0);
        return (
          <div key={resto} className="rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm">
            <p className="font-titre text-sm font-semibold">{resto}</p>
            {dus.length ? (
              <div className="mt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ambre-700">
                  Nous devons
                </p>
                <ul className="mt-1 space-y-0.5 text-sm text-neutre-700">
                  {dus.map((e) => (
                    <li key={e.produitId} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">{e.nom}</span>
                      <span className="shrink-0 tabular-nums font-semibold">
                        {qte(e.nousDevons)} {e.unite ?? "u"}
                      </span>
                    </li>
                  ))}
                </ul>
                <form action="/api/receptions" method="post" className="mt-2">
                  <input type="hidden" name="type" value="rendu" />
                  <input type="hidden" name="delArte" value={resto} />
                  <button
                    type="submit"
                    className="min-h-11 w-full rounded-xl bg-ambre-50 px-3 text-sm font-semibold text-ambre-700"
                  >
                    Enregistrer un rendu
                  </button>
                </form>
              </div>
            ) : null}
            {aRecevoir.length ? (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-vert-800">
                  Ils nous doivent
                </p>
                <ul className="mt-1 space-y-0.5 text-sm text-neutre-700">
                  {aRecevoir.map((e) => (
                    <li key={e.produitId} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">{e.nom}</span>
                      <span className="shrink-0 tabular-nums font-semibold">
                        {qte(e.ilsDoivent)} {e.unite ?? "u"}
                      </span>
                    </li>
                  ))}
                </ul>
                <form action="/api/receptions" method="post" className="mt-2">
                  <input type="hidden" name="type" value="retour" />
                  <input type="hidden" name="delArte" value={resto} />
                  <button
                    type="submit"
                    className="min-h-11 w-full rounded-xl bg-vert-50 px-3 text-sm font-semibold text-vert-800"
                  >
                    Enregistrer leur retour
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
