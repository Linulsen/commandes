import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sb } from "@/lib/db";
import { appareilCourant } from "@/lib/appareil";
import { etatVerrou } from "@/lib/codes-personnels";
import { COOKIE_APPAREIL_DUREE, COOKIE_PRENOM } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Écran de verrouillage. Le middleware ne laisse arriver ici que les appareils
 * autorisés.
 *
 * GET : interrupteur et empreintes des codes personnels, gardés par l'appareil
 * pour vérifier un code sans réseau.
 * POST { prenom, horsLigne?, quand? } : l'appareil vient d'être déverrouillé
 * par cette personne (code vérifié sur l'appareil). Elle devient le prénom
 * « Connecté » de l'appareil, et c'est noté au journal.
 */
export async function GET() {
  try {
    return NextResponse.json(await etatVerrou(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ erreur: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const demande = String(body?.prenom ?? "").trim();
  const moi = await appareilCourant();
  if (!demande || !moi) return NextResponse.json({ erreur: "Prénom manquant" }, { status: 400 });

  const { personnes } = await etatVerrou();
  const personne = personnes.find(
    (p) => p.prenom.toLocaleLowerCase("fr-FR") === demande.toLocaleLowerCase("fr-FR"),
  );
  if (!personne) return NextResponse.json({ erreur: "Prénom inconnu" }, { status: 404 });

  await sb()
    .from("app_appareils")
    .update({ prenom: personne.prenom, derniere_connexion: new Date().toISOString() })
    .eq("id", moi.id);
  await sb().from("app_journal").insert({
    action: "deverrouillage",
    objet: "appareil",
    objet_id: moi.id,
    details: body?.horsLigne ? { hors_ligne: true, quand: String(body?.quand ?? "") } : {},
    prenom: personne.prenom,
    appareil_id: moi.id,
  });

  (await cookies()).set(COOKIE_PRENOM, encodeURIComponent(personne.prenom), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_APPAREIL_DUREE,
  });
  return NextResponse.json({ ok: true, prenom: personne.prenom });
}
