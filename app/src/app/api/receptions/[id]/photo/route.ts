import { NextResponse } from "next/server";
import { sb } from "@/lib/db";
import { getReception } from "@/lib/model";
import { appareilCourant } from "@/lib/appareil";
import { ErreurLecture, lireBonDeLivraison, MODELE_LECTURE, type ImageBL } from "@/lib/lecture-bl";

// La lecture d'un bon de plusieurs pages peut prendre une trentaine de secondes.
export const maxDuration = 120;

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Photos du bon de livraison → quantités lues, produit par produit. Rien n'est
 * enregistré dans la réception : l'écran préremplit, la personne valide.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  const body = await req.json().catch(() => null);
  const images = (Array.isArray(body?.images) ? body.images : []) as ImageBL[];
  if (
    !Number.isInteger(id) ||
    images.length === 0 ||
    images.length > 6 ||
    images.some((i) => !TYPES.has(i?.type) || typeof i?.data !== "string" || !i.data)
  ) {
    return NextResponse.json({ erreur: "Requête invalide" }, { status: 400 });
  }

  try {
    const donnees = await getReception(id);
    if (!donnees) return NextResponse.json({ erreur: "Réception inconnue" }, { status: 404 });
    const { reception, lignes, catalogue, fournisseur } = donnees;
    if (reception.type === "perte") {
      return NextResponse.json({ erreur: "Pas de lecture pour une perte" }, { status: 400 });
    }
    const mode = reception.type === "livraison" ? "livraison" : "depannage";
    const commandes = new Map(
      lignes.map((l) => [l.produit_id, l.colis_commandes === null ? null : Number(l.colis_commandes)]),
    );
    const produits = catalogue
      .filter((p) => p.comptePour === null)
      .map((p) => ({
        id: p.id,
        nom: p.nom,
        conditionnement: p.conditionnement,
        unite: p.unite,
        fact: p.fact,
        commandes: commandes.get(p.id) ?? null,
      }));

    const lecture = await lireBonDeLivraison(
      images,
      produits,
      fournisseur?.nom ?? reception.provenance ?? "inconnu",
      mode,
    );

    const moi = await appareilCourant().catch(() => null);
    await sb()
      .from("app_journal")
      .insert({
        action: "photo_bl_lue",
        objet: "reception",
        objet_id: String(id),
        details: {
          modele: MODELE_LECTURE,
          type: mode,
          pages: images.length,
          lignes: lecture.lignes.length,
          reconnues: lecture.lignes.filter((l) => l.produit_id !== null).length,
          a_confirmer: lecture.lignes.filter((l) => l.candidats?.length).length,
          jetons_entree: lecture.usage?.entree ?? null,
          jetons_sortie: lecture.usage?.sortie ?? null,
        },
        prenom: moi?.prenom ?? null,
        appareil_id: moi?.id ?? null,
      })
      .then(
        () => undefined,
        () => undefined,
      );

    return NextResponse.json(lecture);
  } catch (e) {
    if (e instanceof ErreurLecture) {
      return NextResponse.json({ erreur: e.message }, { status: e.statut });
    }
    console.error("Lecture du BL :", e);
    return NextResponse.json(
      { erreur: `La lecture a échoué (${e instanceof Error ? e.message.slice(0, 200) : "erreur inconnue"})` },
      { status: 500 },
    );
  }
}
