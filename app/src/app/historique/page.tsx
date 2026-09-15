import Link from "next/link";
import Entete from "../Entete";
import { getFournisseurs, getSessions } from "@/lib/model";
import { dateMoyenne } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Historique() {
  const [sessions, fournisseurs] = await Promise.all([
    getSessions(80),
    getFournisseurs(),
  ]);
  const nom = new Map(fournisseurs.map((f) => [f.id, f.nom]));

  return (
    <main className="pb-12">
      <Entete
        titre="Historique"
        sousTitre="Chaque relevé validé affine la prévision des commandes suivantes"
        retour={{ href: "/", libelle: "Commandes" }}
      />

      <div className="mx-auto max-w-2xl px-4 py-4">
        <ul className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
          {sessions.map((s) => (
            <li key={s.id} className="border-b border-neutre-100 last:border-b-0">
              <Link
                href={`/commande/${s.id}`}
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-titre text-sm font-semibold">
                    {nom.get(s.fournisseur_id)}
                  </p>
                  <p className="mt-0.5 text-xs text-neutre-500">
                    {dateMoyenne(s.date_commande)}
                    {s.libelle ? ` · ${s.libelle}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    s.statut === "validee"
                      ? "bg-vert-100 text-vert-800"
                      : "bg-ambre-50 text-ambre-700"
                  }`}
                >
                  {s.statut === "validee" ? "validée" : "en cours"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
