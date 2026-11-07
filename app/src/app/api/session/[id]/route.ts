import { NextResponse } from "next/server";
import { sb } from "@/lib/db";

/**
 * Règle la marge de sécurité d'une commande. C'est le seul curseur qui change
 * vraiment les quantités : plus elle est haute, moins on risque de manquer,
 * plus on immobilise de stock en chambre.
 *
 * Règle aussi la date de livraison prévue (`livraison_prevue`), quand elle
 * s'écarte du délai habituel (jour férié, relevé avancé).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  const body = await req.json().catch(() => null);
  if (!Number.isInteger(id) || !body) {
    return NextResponse.json({ erreur: "Requête invalide" }, { status: 400 });
  }
  const maj: { marge?: number; livraison_prevue?: string | null } = {};
  if (body.marge !== undefined) {
    const marge = Number(body.marge);
    if (!Number.isFinite(marge) || marge < 0 || marge > 3) {
      return NextResponse.json({ erreur: "Marge invalide" }, { status: 400 });
    }
    maj.marge = marge;
  }
  // Date de livraison prévue (jour férié, relevé avancé) ; null = délai habituel.
  if (body.livraison_prevue !== undefined) {
    const d = body.livraison_prevue;
    if (d !== null && (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
      return NextResponse.json({ erreur: "Date invalide" }, { status: 400 });
    }
    if (d !== null) {
      const { data: s } = await sb()
        .from("cmd_sessions")
        .select("date_commande")
        .eq("id", id)
        .maybeSingle();
      const releve = (s as { date_commande: string } | null)?.date_commande;
      if (releve && d < releve.slice(0, 10)) {
        return NextResponse.json(
          { erreur: "La livraison ne peut pas précéder le relevé" },
          { status: 400 },
        );
      }
    }
    maj.livraison_prevue = d;
  }
  if (!Object.keys(maj).length) {
    return NextResponse.json({ erreur: "Rien à modifier" }, { status: 400 });
  }
  const { error } = await sb()
    .from("cmd_sessions")
    .update(maj)
    .eq("id", id)
    .eq("statut", "brouillon");
  if (error) {
    return NextResponse.json({ erreur: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
