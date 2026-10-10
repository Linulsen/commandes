import Entete from "../Entete";
import { getLieuxRangement, getProduitsRangement } from "@/lib/rangement";
import Rangement from "./Rangement";

export const dynamic = "force-dynamic";

/** Réglage de l'ordre de rangement, lieu par lieu. */
export default async function PageRangement({
  searchParams,
}: {
  searchParams: Promise<{ lieu?: string }>;
}) {
  const { lieu } = await searchParams;
  const lieux = await getLieuxRangement();
  // Un lieu inconnu (ex. la chambre « Boissons », qui n'est pas un lieu réel)
  // ramène au premier lieu.
  const lieuId = lieux.find((l) => l.id === Number(lieu))?.id ?? lieux[0]?.id ?? 0;
  const produits = lieuId ? await getProduitsRangement(lieuId) : [];

  return (
    <main>
      <Entete
        titre="Ordre de rangement"
        sousTitre="L’ordre dans lequel on passe devant les produits"
        retour={{ href: "/", libelle: "Commandes" }}
      />
      <Rangement key={lieuId} lieux={lieux} lieuId={lieuId} produits={produits} />
    </main>
  );
}
