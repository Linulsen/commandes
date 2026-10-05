import Link from "next/link";
import Entete from "../Entete";
import { getFournisseurs, getSessions } from "@/lib/model";
import { sb } from "@/lib/db";
import { dateMoyenne, libelleHorsCommande } from "@/lib/format";
import type { Reception, Session } from "@/lib/types";
import BarreNav from "../BarreNav";

export const dynamic = "force-dynamic";

type Element =
  | { genre: "releve"; date: string; session: Session }
  | { genre: "hors"; date: string; reception: Reception };

/**
 * Relevés, et ce qui entre ou sort du stock hors commande (dépannages,
 * pertes) : tout ce qui pèse sur les prévisions, par date.
 */
async function getHorsCommande(): Promise<Reception[]> {
  const { data, error } = await sb()
    .from("cmd_receptions")
    .select("*")
    .in("type", ["depannage", "perte"])
    .eq("statut", "validee")
    .order("date_reception", { ascending: false })
    .order("id", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  return (data ?? []) as Reception[];
}

export default async function Historique() {
  const [sessions, fournisseurs, horsCommande] = await Promise.all([
    getSessions(80),
    getFournisseurs(),
    getHorsCommande(),
  ]);
  const nom = new Map(fournisseurs.map((f) => [f.id, f.nom]));
  // Les dépannages plus anciens que le plus ancien relevé affiché seraient
  // isolés en bas de liste : on s'arrête à la même date.
  const plusAncien = sessions.length ? sessions[sessions.length - 1].date_commande : "";
  const elements: Element[] = [
    ...sessions.map((s) => ({ genre: "releve" as const, date: s.date_commande, session: s })),
    ...horsCommande
      .filter((r) => r.date_reception >= plusAncien)
      .map((r) => ({ genre: "hors" as const, date: r.date_reception, reception: r })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.genre === "releve" ? -1 : 1));

  return (
    <main style={{ paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}>
      <Entete
        titre="Historique"
        sousTitre="Relevés, dépannages et pertes : tout ce qui affine les prévisions"
      />

      <div className="mx-auto max-w-2xl px-4 py-4">
        <ul className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
          {elements.map((e) =>
            e.genre === "releve" ? (
              <li key={`s${e.session.id}`} className="border-b border-neutre-100 last:border-b-0">
                <Link
                  href={`/commande/${e.session.id}`}
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-titre text-sm font-semibold">
                      {nom.get(e.session.fournisseur_id)}
                    </p>
                    <p className="mt-0.5 text-xs text-neutre-500">
                      {dateMoyenne(e.session.date_commande)}
                      {e.session.libelle ? ` · ${e.session.libelle}` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      e.session.statut === "validee"
                        ? "bg-vert-100 text-vert-800"
                        : "bg-ambre-50 text-ambre-700"
                    }`}
                  >
                    {e.session.statut === "validee" ? "validée" : "en cours"}
                  </span>
                </Link>
              </li>
            ) : (
              <li key={`r${e.reception.id}`} className="border-b border-neutre-100 last:border-b-0">
                <Link
                  href={`/reception/${e.reception.id}`}
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-titre text-sm font-semibold">
                      {libelleHorsCommande(e.reception)}
                    </p>
                    <p className="mt-0.5 text-xs text-neutre-500">
                      {e.reception.type === "perte" ? "jeté le" : "acheté le"}{" "}
                      {dateMoyenne(e.reception.date_reception)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      e.reception.type === "perte"
                        ? "bg-rouge-50 text-rouge-700"
                        : "bg-neutre-100 text-neutre-700"
                    }`}
                  >
                    {e.reception.type === "perte" ? "perte" : "dépannage"}
                  </span>
                </Link>
              </li>
            ),
          )}
        </ul>
      </div>
      <BarreNav actif="/historique" />
    </main>
  );
}
