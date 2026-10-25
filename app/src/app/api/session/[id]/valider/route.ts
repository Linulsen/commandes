import { NextResponse } from "next/server";
import { sb } from "@/lib/db";
import { getCommande, quantiteRetenue } from "@/lib/model";

/** Fige la commande. Les relevés servent ensuite de base à la prévision. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ erreur: "Commande inconnue" }, { status: 400 });
  }
  // Avant de figer : les quantités que le chef n'a pas touchées prennent la
  // proposition du moment. Celle enregistrée à la saisie peut être en retard
  // (calcul modifié depuis, dépannage saisi après le comptage…) ; l'écran,
  // lui, montre la proposition à jour, et c'est elle qui doit partir.
  try {
    const commande = await getCommande(id);
    if (commande && commande.session.statut === "brouillon") {
      const aJour = commande.lignes
        .filter((l) => l.ligne.stock !== null || l.ligne.colis !== null)
        .map((l) => ({ l, colis: quantiteRetenue(l) }))
        .filter(
          ({ l, colis }) =>
            l.ligne.colis === null || Math.abs(Number(l.ligne.colis) - colis) > 0.0005,
        );
      for (const { l, colis } of aJour) {
        const { error: e } = await sb()
          .from("cmd_lignes")
          .update({ colis, suggestion: colis })
          .eq("session_id", id)
          .eq("produit_id", l.produit.id);
        if (e) throw new Error(e.message);
      }
    }
  } catch (e) {
    return NextResponse.json(
      { erreur: e instanceof Error ? e.message : "Échec" },
      { status: 500 },
    );
  }
  const { error } = await sb()
    .from("cmd_sessions")
    .update({ statut: "validee", validee_le: new Date().toISOString() })
    .eq("id", id)
    .eq("statut", "brouillon");
  if (error) {
    return NextResponse.json({ erreur: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** Rouvrir une commande validée, tant que rien n'est parti chez le fournisseur. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  const { error } = await sb()
    .from("cmd_sessions")
    .update({ statut: "brouillon", validee_le: null })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ erreur: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
