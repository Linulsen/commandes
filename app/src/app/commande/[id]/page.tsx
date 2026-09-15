import { notFound } from "next/navigation";
import Entete from "../../Entete";
import { getCommande, getFournisseurs } from "@/lib/model";
import { dateLongue } from "@/lib/format";
import Saisie from "./Saisie";

export const dynamic = "force-dynamic";

export default async function Commande({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const commande = await getCommande(id);
  if (!commande) notFound();
  const fournisseurs = await getFournisseurs();
  const fournisseur = fournisseurs.find(
    (f) => f.id === commande.session.fournisseur_id,
  )!;

  const sousTitre = [
    dateLongue(commande.session.date_commande),
    commande.session.libelle,
    commande.session.statut === "validee" ? "validée" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main>
      <div className="sans-impression">
        <Entete
          titre={fournisseur.nom}
          sousTitre={sousTitre}
          retour={{ href: "/", libelle: "Commandes" }}
        />
      </div>

      <Saisie
        session={commande.session}
        zones={commande.zones}
        lignes={commande.lignes.map((l) => ({
          produitId: l.produit.id,
          zoneId: l.zone.id,
          nom: l.produit.nom,
          conditionnement: l.produit.conditionnement,
          unite: l.produit.unite,
          fact: Number(l.produit.fact),
          stock: l.ligne.stock === null ? null : Number(l.ligne.stock),
          colis: l.ligne.colis === null ? null : Number(l.ligne.colis),
          suggestionEnregistree:
            l.ligne.suggestion === null ? null : Number(l.ligne.suggestion),
          consoPrevue: l.prevision.consoPrevue,
          fiabilite: l.prevision.fiabilite,
          nbPoints: l.prevision.nbPoints,
          derniereConso: l.prevision.derniere,
          stockPrecedent: l.stockPrecedent,
          joursHorizon: l.prevision.joursHorizon,
          serie: l.prevision.serie.slice(-8),
        }))}
      />
    </main>
  );
}
