import { NextResponse } from "next/server";
import { appareilCourant } from "@/lib/appareil";
import { deplacerProduit } from "@/lib/rangement";
import { ouvrirResponsable, responsableActif } from "@/lib/responsable";

/**
 * Change un article de lieu : { produitId, deLieu, versLieu } (versLieu null :
 * retirer un emplacement secondaire). Réservé à la session responsable.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { produitId?: unknown; deLieu?: unknown; versLieu?: unknown }
    | null;
  const produitId = Number(body?.produitId);
  const deLieu = Number(body?.deLieu);
  const versLieu = body?.versLieu === null ? null : Number(body?.versLieu);
  if (
    !Number.isInteger(produitId) ||
    !Number.isInteger(deLieu) ||
    (versLieu !== null && !Number.isInteger(versLieu))
  ) {
    return NextResponse.json({ erreur: "Requête invalide" }, { status: 400 });
  }
  if (!(await responsableActif())) {
    return NextResponse.json(
      { erreur: "Code responsable demandé.", besoinCode: true },
      { status: 403 },
    );
  }
  try {
    const appareil = await appareilCourant();
    const resultat = await deplacerProduit(produitId, deLieu, versLieu, {
      prenom: appareil?.prenom ?? null,
      appareilId: appareil?.id ?? null,
    });
    await ouvrirResponsable();
    return NextResponse.json({ resultat });
  } catch (e) {
    return NextResponse.json(
      { erreur: e instanceof Error ? e.message : "Échec" },
      { status: 500 },
    );
  }
}
