import { NextResponse } from "next/server";
import { appareilCourant } from "@/lib/appareil";
import { enregistrerRangement } from "@/lib/rangement";

/** Enregistre l'ordre de rangement d'un lieu : { lieuId, ids: [produits dans l'ordre] }. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { lieuId?: unknown; ids?: unknown } | null;
  const lieuId = Number(body?.lieuId);
  const brut: unknown = body?.ids;
  const ids: number[] | null = Array.isArray(brut) ? brut.map((v) => Number(v)) : null;
  if (!Number.isInteger(lieuId) || !ids || ids.some((id) => !Number.isInteger(id)) || ids.length > 500) {
    return NextResponse.json({ erreur: "Requête invalide" }, { status: 400 });
  }
  try {
    const appareil = await appareilCourant();
    const resultat = await enregistrerRangement(lieuId, ids, {
      prenom: appareil?.prenom ?? null,
      appareilId: appareil?.id ?? null,
    });
    return NextResponse.json({ resultat });
  } catch (e) {
    return NextResponse.json(
      { erreur: e instanceof Error ? e.message : "Échec" },
      { status: 500 },
    );
  }
}
