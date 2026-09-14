import { NextResponse } from "next/server";
import { sb } from "@/lib/db";

/** Fige la commande. Les relevés servent ensuite de base à la prévision. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ erreur: "Commande inconnue" }, { status: 400 });
  }
  const { error } = await sb()
    .from("cmd_sessions")
    .update({ statut: "validee", validee_le: new Date().toISOString() })
    .eq("id", id)
    .eq("statut", "brouillon");
  if (error) {
    return NextResponse.json({ erreur: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** Rouvrir une commande validée, tant que rien n'est parti chez le fournisseur. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  const { error } = await sb()
    .from("cmd_sessions")
    .update({ statut: "brouillon", validee_le: null })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ erreur: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
