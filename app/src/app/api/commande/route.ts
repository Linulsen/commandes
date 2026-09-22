import { NextResponse } from "next/server";
import { getFournisseurs, libelleCreneau, ouvrirSession } from "@/lib/model";

/**
 * Ouvre le relevé suivant d'un fournisseur et y envoie l'utilisateur.
 * Réponse en redirection : le formulaire de l'accueil poste directement ici.
 *
 * Le créneau d'un fournisseur bi-hebdomadaire se déduit de la date, côté
 * serveur : il départage les deux livraisons de la semaine dans la prévision,
 * il ne doit pas dépendre de ce que la page a envoyé.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const fournisseurId = Number(form.get("fournisseur"));
  const date = String(form.get("date") ?? "");

  if (!Number.isInteger(fournisseurId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ erreur: "Paramètres invalides" }, { status: 400 });
  }
  const fournisseur = (await getFournisseurs()).find((f) => f.id === fournisseurId);
  if (!fournisseur) {
    return NextResponse.json({ erreur: "Fournisseur inconnu" }, { status: 404 });
  }

  const session = await ouvrirSession(
    fournisseurId,
    date,
    libelleCreneau(date, fournisseur.frequence),
  );
  return NextResponse.redirect(new URL(`/commande/${session.id}`, req.url), 303);
}
