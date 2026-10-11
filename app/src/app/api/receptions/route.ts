import { NextResponse } from "next/server";
import { creerDepannage, ouvrirReception } from "@/lib/model";
import { RESTAURANTS_DEL_ARTE } from "@/lib/del-arte";

const TYPES = ["depannage", "perte", "pret", "rendu", "retour"] as const;

/**
 * Ouvre une réception et y envoie l'utilisateur : celle d'une commande
 * (reprise si elle existe déjà), un dépannage ou une perte.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  try {
    const type = form.get("type");
    if (TYPES.includes(type as (typeof TYPES)[number])) {
      const t = type as (typeof TYPES)[number];
      const provenance = String(form.get("provenance") ?? "").trim() || null;
      // Échange avec un autre Del Arte : le restaurant doit être l'un des leurs.
      const brut = String(form.get("delArte") ?? "").trim();
      const delArte = (RESTAURANTS_DEL_ARTE as readonly string[]).includes(brut) ? brut : null;
      if ((t === "pret" || t === "rendu" || t === "retour") && !delArte) {
        return NextResponse.json({ erreur: "Restaurant Del Arte inconnu" }, { status: 400 });
      }
      const r = await creerDepannage(provenance, t, t === "perte" ? null : delArte);
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
