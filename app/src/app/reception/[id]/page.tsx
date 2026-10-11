import { notFound } from "next/navigation";
import Entete from "../../Entete";
import { getReception } from "@/lib/model";
import { dateMoyenne, libelleHorsCommande } from "@/lib/format";
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
  const { reception, session, lignes, catalogue, fournisseur, echanges } = donnees;

  // Dépannage et perte se saisissent de la même façon : en unités de stock,
  // sans commande de référence.
  const depannage = reception.type !== "livraison";
  const titre = depannage
    ? libelleHorsCommande(reception)
    : `Réception ${fournisseur?.nom ?? ""}`;
  const sousTitre = depannage
    ? reception.type === "perte"
      ? "Produits jetés"
      : reception.del_arte
        ? reception.type === "depannage"
          ? "Marchandise prêtée, à leur rendre"
          : reception.type === "pret"
            ? "Marchandise prêtée, qu’ils nous rendront"
            : reception.type === "rendu"
              ? "Ce que nous leur rendons"
              : "Ce qu’ils nous rendent"
        : "Achat hors commande"
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
        echanges={echanges.map((e) => ({
          delArte: e.delArte,
          produitId: e.produitId,
          nom: e.nom,
          unite: e.unite,
          nousDevons: e.nousDevons,
          ilsDoivent: e.ilsDoivent,
        }))}
      />
    </main>
  );
}
