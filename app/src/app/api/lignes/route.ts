import { NextResponse } from "next/server";
import { sb } from "@/lib/db";

/**
 * Enregistre une ligne de relevé au fil de la saisie. Nicolas parcourt les
 * chambres avec son téléphone : chaque champ quitté est écrit tout de suite,
 * pour qu'une coupure de réseau ou un écran verrouillé ne coûte pas la tournée.
 */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ erreur: "Requête invalide" }, { status: 400 });
  }
  const { sessionId, produitId, stock, colis, suggestion, consoPrevue, note } = body;
  if (!Number.isInteger(sessionId) || !Number.isInteger(produitId)) {
    return NextResponse.json({ erreur: "Ligne inconnue" }, { status: 400 });
  }

  const { data: session } = await sb()
    .from("cmd_sessions")
    .select("statut")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ erreur: "Commande inconnue" }, { status: 404 });
  }
  if (session.statut === "validee") {
    return NextResponse.json(
      { erreur: "Commande déjà validée" },
      { status: 409 },
    );
  }

  const nombre = (v: unknown) =>
    v === null || v === undefined || v === "" ? null : Number(v);

  const { error } = await sb().from("cmd_lignes").upsert(
    {
      session_id: sessionId,
      produit_id: produitId,
      stock: nombre(stock),
      colis: nombre(colis),
      suggestion: nombre(suggestion),
      conso_prevue: nombre(consoPrevue),
      note: typeof note === "string" && note.trim() ? note.trim() : null,
    },
    { onConflict: "session_id,produit_id" },
  );
  if (error) {
    return NextResponse.json({ erreur: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
