import { NextResponse } from "next/server";
import { ouvrirSession } from "@/lib/model";

/**
 * Ouvre le relevé suivant d'un fournisseur et y envoie l'utilisateur.
 * Réponse en redirection : le formulaire de l'accueil poste directement ici.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const fournisseurId = Number(form.get("fournisseur"));
  const date = String(form.get("date") ?? "");
  const libelle = String(form.get("libelle") ?? "");

  if (!Number.isInteger(fournisseurId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ erreur: "Paramètres invalides" }, { status: 400 });
  }

  const session = await ouvrirSession(fournisseurId, date, libelle);
  return NextResponse.redirect(new URL(`/commande/${session.id}`, req.url), 303);
}
