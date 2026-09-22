import { NextResponse } from "next/server";
import { sb } from "@/lib/db";

/**
 * Valide une réception : ce qui est coché entre en stock, et la consommation
 * de la période se calcule dès lors sur ce qui a vraiment été livré plutôt que
 * sur ce qui avait été commandé.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ erreur: "Réception inconnue" }, { status: 400 });
  }
  const { error } = await sb()
    .from("cmd_receptions")
    .update({ statut: "validee", validee_le: new Date().toISOString() })
    .eq("id", id)
    .eq("statut", "brouillon");
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  const { error } = await sb()
    .from("cmd_receptions")
    .update({ statut: "brouillon", validee_le: null })
    .eq("id", id);
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
