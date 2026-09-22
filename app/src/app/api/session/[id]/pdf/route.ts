import { getCommande, getFournisseurs, quantiteRetenue } from "@/lib/model";
import { dateLongue, qte } from "@/lib/format";

// pdfkit lit normalement ses métriques de police sur le disque, ce qui ne
// survit pas à l'empaquetage serverless. La version « standalone » embarque
// les polices standard : c'est celle qu'il faut ici.
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";

export const runtime = "nodejs";

const MARGE = 48;

/**
 * Bon de commande, avec le stock relevé en regard de chaque quantité : sans
 * lui, le papier ne disait pas pourquoi on commandait autant.
 *
 * `?complet=1` rend le relevé entier — tous les produits comptés, commandés ou
 * non — pour garder une trace papier de l'inventaire.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return new Response("Commande inconnue", { status: 400 });
  }
  const commande = await getCommande(id);
  if (!commande) return new Response("Commande inconnue", { status: 404 });

  const fournisseur = (await getFournisseurs()).find(
    (f) => f.id === commande.session.fournisseur_id,
  )!;

  const complet = new URL(req.url).searchParams.get("complet") === "1";
  const aCommander = commande.lignes
    .map((l) => ({ ...l, colis: quantiteRetenue(l) }))
    .filter((l) => (complet ? l.ligne.stock !== null || l.colis > 0 : l.colis > 0));

  const doc = new PDFDocument({ size: "A4", margin: MARGE });
  const morceaux: Buffer[] = [];
  doc.on("data", (c: Buffer) => morceaux.push(c));
  const fini = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(morceaux))),
  );

  const largeur = doc.page.width - MARGE * 2;

  doc.font("Helvetica-Bold").fontSize(18).text(complet ? "Relevé des stocks" : "Bon de commande");
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(11).fillColor("#4d5668");
  doc.text(
    `${fournisseur.nom} — ${dateLongue(commande.session.date_commande)}` +
      (commande.session.libelle ? ` (${commande.session.libelle})` : ""),
  );
  doc.text(
    commande.session.statut === "validee"
      ? "Commande validée"
      : "Brouillon — non validé",
  );
  doc.fillColor("#171b24");
  doc.moveDown(1);

  if (!aCommander.length) {
    doc.font("Helvetica").fontSize(11).text("Aucune quantité à commander.");
  }

  const colonnes = [
    { titre: "Produit", x: MARGE, w: largeur - 270 },
    { titre: "Cond.", x: MARGE + largeur - 270, w: 60 },
    { titre: "Stock", x: MARGE + largeur - 210, w: 60 },
    { titre: "Colis", x: MARGE + largeur - 150, w: 50 },
    { titre: "Soit", x: MARGE + largeur - 100, w: 100 },
  ];

  const enTeteTableau = () => {
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#8b94a5");
    for (const c of colonnes) {
      doc.text(c.titre.toUpperCase(), c.x, doc.y, {
        width: c.w,
        align: c.titre === "Produit" || c.titre === "Cond." ? "left" : "right",
        continued: false,
      });
      doc.moveUp();
    }
    doc.moveDown(1.2);
    doc.fillColor("#171b24");
  };

  const sautSiBesoin = (hauteur: number) => {
    if (doc.y + hauteur > doc.page.height - MARGE) {
      doc.addPage();
      return true;
    }
    return false;
  };

  for (const zone of commande.zones) {
    const dedans = aCommander.filter((l) => l.zone.id === zone.id);
    if (!dedans.length) continue;

    sautSiBesoin(70);
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(12).text(zone.nom, MARGE, doc.y);
    doc.moveDown(0.4);
    enTeteTableau();

    for (const l of dedans) {
      if (sautSiBesoin(28)) enTeteTableau();
      const y = doc.y;
      doc.font("Helvetica").fontSize(10);
      doc.text(l.produit.nom, colonnes[0].x, y, { width: colonnes[0].w });
      const bas = doc.y;
      doc.text(l.produit.conditionnement ?? "—", colonnes[1].x, y, {
        width: colonnes[1].w,
      });
      doc.text(
        l.ligne.stock === null ? "—" : `${qte(Number(l.ligne.stock))} ${l.produit.unite ?? "u"}`,
        colonnes[2].x,
        y,
        { width: colonnes[2].w, align: "right" },
      );
      doc.font("Helvetica-Bold").text(l.colis > 0 ? qte(l.colis) : "—", colonnes[3].x, y, {
        width: colonnes[3].w,
        align: "right",
      });
      doc.font("Helvetica").fillColor("#4d5668");
      doc.text(
        l.colis > 0 ? `${qte(l.colis * Number(l.produit.fact))} ${l.produit.unite ?? "u"}` : "",
        colonnes[4].x,
        y,
        { width: colonnes[4].w, align: "right" },
      );
      doc.fillColor("#171b24");
      doc.y = Math.max(bas, y + 12);
      doc.moveDown(0.35);
      doc
        .strokeColor("#ebedf1")
        .lineWidth(0.5)
        .moveTo(MARGE, doc.y)
        .lineTo(MARGE + largeur, doc.y)
        .stroke();
      doc.moveDown(0.35);
    }
  }

  doc.moveDown(1);
  doc.font("Helvetica").fontSize(9).fillColor("#8b94a5");
  doc.text(
    `${aCommander.length} références — édité le ${dateLongue(
      new Date().toISOString().slice(0, 10),
    )} par Praedic Commandes.`,
    MARGE,
    doc.y,
    { width: largeur },
  );

  doc.end();
  const pdf = await fini;

  const nom = `${complet ? "releve" : "commande"}-${fournisseur.slug}-${commande.session.date_commande}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nom}"`,
      "Cache-Control": "no-store",
    },
  });
}
