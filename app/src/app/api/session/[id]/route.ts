import { NextResponse } from "next/server";
import { sb } from "@/lib/db";

/**
 * Règle la marge de sécurité d'une commande. C'est le seul curseur qui change
 * vraiment les quantités : plus elle est haute, moins on risque de manquer,
 * plus on immobilise de stock en chambre.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  const body = await req.json().catch(() => null);
  const marge = Number(body?.marge);
  if (!Number.isInteger(id) || !Number.isFinite(marge) || marge < 0 || marge > 3) {
    return NextResponse.json({ erreur: "Marge invalide" }, { status: 400 });
  }
  const { error } = await sb()
    .from("cmd_sessions")
    .update({ marge })
    .eq("id", id)
    .eq("statut", "brouillon");
  if (error) {
    return NextResponse.json({ erreur: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
