import { NextResponse } from "next/server";
import { appareilCourant } from "@/lib/appareil";
import { demarrerInventaire } from "@/lib/inventaire";

/**
 * Démarre l'inventaire (ou rejoint celui en cours) et y envoie l'utilisateur.
 * Réponse en redirection : le formulaire de l'accueil poste directement ici.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const date = String(form.get("date") ?? "");
  const heureSaisie = String(form.get("heure") ?? "");
  const heure = /^\d{2}:\d{2}$/.test(heureSaisie) ? heureSaisie : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ erreur: "Date invalide" }, { status: 400 });
  }
  const appareil = await appareilCourant();
  const inv = await demarrerInventaire(date, heure, appareil?.prenom ?? null, appareil?.id ?? null);
  return NextResponse.redirect(new URL(`/inventaire/${inv.id}`, req.url), 303);
}
