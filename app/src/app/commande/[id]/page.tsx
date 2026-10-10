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
          rang: l.produit.rang ?? null,
          conditionnement: l.produit.conditionnement,
          unite: l.produit.unite,
          fact: Number(l.produit.fact),
          comptePour: l.produit.compte_pour ?? null,
          equivalence:
            l.produit.equivalence == null ? null : Number(l.produit.equivalence),
          nomRattache:
            l.produit.compte_pour == null
              ? null
              : (commande.lignes.find((m) => m.produit.id === l.produit.compte_pour)
                  ?.produit.nom ?? null),
          stock: l.ligne.stock === null ? null : Number(l.ligne.stock),
          colis: l.ligne.colis === null ? null : Number(l.ligne.colis),
          perte: l.ligne.perte === null ? null : Number(l.ligne.perte),
          stockColis: l.ligne.stock_colis == null ? null : Number(l.ligne.stock_colis),
          parCarton:
            l.zone.saisie_colis === true &&
            l.produit.compte_pour == null &&
            Number(l.produit.fact) > 1,
          majLe: l.ligne.maj_le ? Date.parse(l.ligne.maj_le) : 0,
          suggestionEnregistree:
            l.ligne.suggestion === null ? null : Number(l.ligne.suggestion),
          consoPrevue: l.prevision.consoPrevue,
          fiabilite: l.prevision.fiabilite,
          nbPoints: l.prevision.nbPoints,
          stockPrecedent: l.stockPrecedent,
          joursHorizon: l.prevision.joursHorizon,
          releves: l.releves.map((r) => ({
            date: r.date,
            stock: r.stock === null ? null : Number(r.stock),
            colis: r.colis === null ? null : Number(r.colis),
            livre: r.livre === null ? null : Number(r.livre),
            perte: r.perte === null ? null : Number(r.perte),
            conso: r.conso === null ? null : Number(r.conso),
          })),
        }))}
      />
    </main>
  );
}
