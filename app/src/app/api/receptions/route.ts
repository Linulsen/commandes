import { NextResponse } from "next/server";
import { creerDepannage, ouvrirReception } from "@/lib/model";

/**
 * Ouvre une réception et y envoie l'utilisateur : celle d'une commande
 * (reprise si elle existe déjà), un dépannage ou une perte.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  try {
    const type = form.get("type");
    if (type === "depannage" || type === "perte") {
      const provenance = String(form.get("provenance") ?? "").trim() || null;
      const r = await creerDepannage(provenance, type);
      return NextResponse.redirect(new URL(`/reception/${r.id}`, req.url), 303);
    }
    const sessionId = Number(form.get("session"));
    if (!Number.isInteger(sessionId)) {
      return NextResponse.json({ erreur: "Commande inconnue" }, { status: 400 });
    }
    const r = await ouvrirReception(sessionId);
    return NextResponse.redirect(new URL(`/reception/${r.id}`, req.url), 303);
  } catch (e) {
    return NextResponse.json(
      { erreur: e instanceof Error ? e.message : "Échec" },
      { status: 500 },
    );
  }
}
