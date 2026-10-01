import { notFound } from "next/navigation";
import Entete from "../../Entete";
import { getInventaire } from "@/lib/inventaire";
import { appareilCourant } from "@/lib/appareil";
import { dateLongue } from "@/lib/format";
import Comptage from "./Comptage";

export const dynamic = "force-dynamic";

export default async function PageInventaire({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const chargeLe = new Date().toISOString();
  const [donnees, appareil] = await Promise.all([getInventaire(id), appareilCourant()]);
  if (!donnees) notFound();
  const { inventaire, lieux, lignes } = donnees;
  const fige = inventaire.statut === "cloture";

  return (
    <main>
      <div className="sans-impression">
        <Entete
          titre="Inventaire"
          sousTitre={[
            dateLongue(inventaire.date_inventaire),
            fige ? "clôturé" : inventaire.cree_par ? `démarré par ${inventaire.cree_par}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          retour={{ href: "/", libelle: "Accueil" }}
        />
      </div>
      <Comptage
        inventaireId={inventaire.id}
        fige={fige}
        lieux={lieux}
        lignes={lignes}
        chargeLe={chargeLe}
        prenom={appareil?.prenom ?? null}
      />
    </main>
  );
}
