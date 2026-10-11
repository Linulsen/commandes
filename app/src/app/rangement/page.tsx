import Entete from "../Entete";
import { getLieuxRangement, getProduitsRangement } from "@/lib/rangement";
import { responsableActif } from "@/lib/responsable";
import Rangement from "./Rangement";

export const dynamic = "force-dynamic";

/** Réglage de l'ordre de rangement, lieu par lieu, depuis l'inventaire. */
export default async function PageRangement({
  searchParams,
}: {
  searchParams: Promise<{ lieu?: string; inventaire?: string }>;
}) {
  const { lieu, inventaire } = await searchParams;
  const inventaireId = Number(inventaire);
  const retour =
    Number.isInteger(inventaireId) && inventaireId > 0
      ? { href: `/inventaire/${inventaireId}`, libelle: "Inventaire" }
      : { href: "/", libelle: "Accueil" };
  const lieux = await getLieuxRangement();
  // Un lieu inconnu ramène au premier lieu.
  const lieuId = lieux.find((l) => l.id === Number(lieu))?.id ?? lieux[0]?.id ?? 0;
  const [produits, deverrouille] = await Promise.all([
    lieuId ? getProduitsRangement(lieuId) : Promise.resolve([]),
    responsableActif(),
  ]);

  return (
    <main>
      <Entete
        titre="Ordre de rangement"
        sousTitre="Celui de l’inventaire, suivi aussi par les relevés"
        retour={retour}
      />
      <Rangement
        key={lieuId}
        lieux={lieux}
        lieuId={lieuId}
        inventaireId={retour.href === "/" ? null : inventaireId}
        produits={produits}
        deverrouille={deverrouille}
      />
    </main>
  );
}
