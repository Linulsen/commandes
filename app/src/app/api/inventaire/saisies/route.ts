import { NextResponse } from "next/server";
import { appareilCourant } from "@/lib/appareil";
import { enregistrerSaisies } from "@/lib/inventaire";

/**
 * Enregistre les comptages d'inventaire saisis sur le téléphone, par paquets
 * (même principe que les relevés : file d'attente hors ligne, état complet de
 * chaque ligne, rejouer un paquet ne change rien).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const lignes = Array.isArray(body?.lignes) ? (body.lignes as Record<string, unknown>[]) : null;
  if (!lignes) {
    return NextResponse.json({ erreur: "Requête invalide" }, { status: 400 });
  }
  try {
    const appareil = await appareilCourant();
    const refusees = await enregistrerSaisies(lignes, {
      prenom: appareil?.prenom ?? null,
      appareilId: appareil?.id ?? null,
    });
    return NextResponse.json({ ok: true, refusees });
  } catch (e) {
    return NextResponse.json(
      { erreur: e instanceof Error ? e.message : "Échec" },
      { status: 500 },
    );
  }
}
