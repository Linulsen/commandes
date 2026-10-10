import { NextResponse } from "next/server";
import { appareilCourant } from "@/lib/appareil";
import { enregistrerRangement } from "@/lib/rangement";
import { ouvrirResponsable, responsableActif } from "@/lib/responsable";

/**
 * Enregistre l'ordre de rangement d'un lieu : { lieuId, ids: [produits dans
 * l'ordre] }. Réservé à la session responsable.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { lieuId?: unknown; ids?: unknown } | null;
  const lieuId = Number(body?.lieuId);
  const brut: unknown = body?.ids;
  const ids: number[] | null = Array.isArray(brut) ? brut.map((v) => Number(v)) : null;
  if (!Number.isInteger(lieuId) || !ids || ids.some((id) => !Number.isInteger(id)) || ids.length > 500) {
    return NextResponse.json({ erreur: "Requête invalide" }, { status: 400 });
  }
  // L'ordre de rangement est le même pour tout le monde : le changer demande
  // le code responsable.
  if (!(await responsableActif())) {
    return NextResponse.json(
      { erreur: "Code responsable demandé.", besoinCode: true },
      { status: 403 },
    );
  }
  try {
    const appareil = await appareilCourant();
    const resultat = await enregistrerRangement(lieuId, ids, {
      prenom: appareil?.prenom ?? null,
      appareilId: appareil?.id ?? null,
    });
    // Chaque enregistrement relance les 15 minutes de la session responsable.
    await ouvrirResponsable();
    return NextResponse.json({ resultat });
  } catch (e) {
    return NextResponse.json(
      { erreur: e instanceof Error ? e.message : "Échec" },
      { status: 500 },
    );
  }
}
