import { NextResponse } from "next/server";
import { sb } from "@/lib/db";
import type { Reception } from "@/lib/types";

/** Date, provenance et note d'une réception encore ouverte. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  const body = await req.json().catch(() => null);
  if (!Number.isInteger(id) || !body) {
    return NextResponse.json({ erreur: "Requête invalide" }, { status: 400 });
  }
  const maj: Partial<Reception> = {};
  if (typeof body.date === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ erreur: "Date invalide" }, { status: 400 });
    }
    maj.date_reception = body.date;
  }
  if ("provenance" in body) maj.provenance = String(body.provenance ?? "").trim() || null;
  if ("note" in body) maj.note = String(body.note ?? "").trim() || null;
  const { error } = await sb()
    .from("cmd_receptions")
    .update(maj)
    .eq("id", id)
    .eq("statut", "brouillon");
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Abandonner une réception ouverte par erreur. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  const { error } = await sb()
    .from("cmd_receptions")
    .delete()
    .eq("id", id)
    .eq("statut", "brouillon");
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
