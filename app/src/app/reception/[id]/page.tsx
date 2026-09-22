import { notFound } from "next/navigation";
import Entete from "../../Entete";
import { getReception } from "@/lib/model";
import { dateMoyenne } from "@/lib/format";
import SaisieReception from "./SaisieReception";

export const dynamic = "force-dynamic";

export default async function PageReception({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const donnees = await getReception(id);
  if (!donnees) notFound();
  const { reception, session, lignes, catalogue, fournisseur } = donnees;

  const depannage = reception.type === "depannage";
  const titre = depannage
    ? `Dépannage${reception.provenance ? ` · ${reception.provenance}` : ""}`
    : `Réception ${fournisseur?.nom ?? ""}`;
  const sousTitre = depannage
    ? "Achat hors commande"
    : session
      ? `commande du ${dateMoyenne(session.date_commande)}${session.libelle ? ` · ${session.libelle}` : ""}`
      : undefined;

  return (
    <main>
      <Entete
        titre={titre}
        sousTitre={sousTitre}
        retour={{ href: "/receptions", libelle: "Réceptions" }}
      />
      <SaisieReception
        reception={reception}
        lignes={lignes.map((l) => ({
          produitId: l.produit_id,
          commandes: l.colis_commandes === null ? null : Number(l.colis_commandes),
          quantite: depannage
            ? l.unites === null ? null : Number(l.unites)
            : l.colis_recus === null ? null : Number(l.colis_recus),
          recu: l.recu,
          majLe: Date.parse(l.maj_le),
        }))}
        catalogue={catalogue}
      />
    </main>
  );
}
