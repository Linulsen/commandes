import { NextResponse } from "next/server";
import { appareilCourant } from "@/lib/appareil";
import { ajouterEmplacement } from "@/lib/inventaire";

/** Garde un produit dans un lieu pour les prochains inventaires. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { produitId?: unknown; zoneId?: unknown } | null;
  const produitId = Number(body?.produitId);
  const zoneId = Number(body?.zoneId);
  if (!Number.isInteger(produitId) || !Number.isInteger(zoneId)) {
    return NextResponse.json({ erreur: "Requête invalide" }, { status: 400 });
  }
  try {
    const appareil = await appareilCourant();
    const resultat = await ajouterEmplacement(produitId, zoneId, {
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
