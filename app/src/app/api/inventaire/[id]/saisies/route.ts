import { NextResponse } from "next/server";
import { getSaisiesDepuis } from "@/lib/inventaire";

export const dynamic = "force-dynamic";

/** Comptages enregistrés depuis un instant : ceux des collègues, en cours d'inventaire. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const depuis = new URL(req.url).searchParams.get("depuis") ?? "1970-01-01T00:00:00Z";
  if (!Number.isInteger(id) || Number.isNaN(Date.parse(depuis))) {
    return NextResponse.json({ erreur: "Paramètres invalides" }, { status: 400 });
  }
  try {
    const saisies = await getSaisiesDepuis(id, new Date(depuis).toISOString());
    return NextResponse.json({ saisies, maintenant: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { erreur: e instanceof Error ? e.message : "Échec" },
      { status: 500 },
    );
  }
}
