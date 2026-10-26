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
    .map((l) => ({ ...l, colis: quantiteRetenue(l, commande.session.statut === "validee") }))
    .filter((l) => (complet ? l.ligne.stock !== null || l.colis > 0 : l.colis > 0));

  const doc = new PDFDocument({ size: "A4", margin: MARGE, bufferPages: true });
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
    { titre: "Produit", x: MARGE, w: largeur - 310 },
    { titre: "Cond.", x: MARGE + largeur - 300, w: 85 },
    { titre: "Stock", x: MARGE + largeur - 212, w: 72 },
    { titre: "Colis", x: MARGE + largeur - 140, w: 40 },
    { titre: "Soit", x: MARGE + largeur - 100, w: 100 },
  ];

  const enTeteTableau = () => {
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#4d5668");
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

  // Titre d'emplacement : bandeau foncé, texte blanc, bien visible à
  // l'impression, pour voir d'un coup d'œil où commence chaque chambre.
  const bandeau = (titre: string, droite: string) => {
    const h = 24;
    const y = doc.y;
    doc.rect(MARGE, y, largeur, h).fill("#2b3445");
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff");
    doc.text(titre.toUpperCase(), MARGE + 10, y + 6, {
      width: largeur - 100,
      lineBreak: false,
    });
    if (droite) {
      doc.font("Helvetica").fontSize(10);
      doc.text(droite, MARGE + largeur - 90, y + 8, {
        width: 80,
        align: "right",
        lineBreak: false,
      });
    }
    doc.fillColor("#171b24");
    doc.x = MARGE;
    doc.y = y + h + 6;
  };

  const sautSiBesoin = (hauteur: number) => {
    if (doc.y + hauteur > doc.page.height - MARGE) {
      doc.addPage();
      return true;
    }
    return false;
  };

  // À l'impression, l'Economat passe en dernier (demandé le 26/10/2026) ;
  // à l'écran, l'ordre des zones ne change pas.
  const zonesImprimees = [...commande.zones].sort(
    (a, b) => Number(a.slug === "gld-economat") - Number(b.slug === "gld-economat"),
  );

  // Logistimax : deux grands titres, « Tout sauf Economat » puis « Economat »
  // (demandé le 26/10/2026), au-dessus des bandeaux d'emplacement.
  const estEconomat = (z: { slug: string }) => z.slug === "gld-economat";
  const avecGrandsTitres = fournisseur.id === 1;
  let groupeCourant: string | null = null;
  const grandTitre = (titre: string) => {
    sautSiBesoin(130);
    if (groupeCourant !== null) doc.moveDown(1.5);
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#171b24");
    doc.text(titre.toUpperCase(), MARGE, y, { width: largeur });
    const bas = doc.y + 4;
    doc.rect(MARGE, bas, largeur, 3).fill("#171b24");
    doc.x = MARGE;
    doc.y = bas + 8;
  };

  for (const zone of zonesImprimees) {
    // Un article peut être imprimé dans une autre rubrique que celle du relevé
    // (crème pâtissière en Economat, 26/10/2026).
    const dedans = aCommander.filter(
      (l) => (l.produit.zone_impression_id ?? l.zone.id) === zone.id,
    );
    if (!dedans.length) continue;

    if (avecGrandsTitres) {
      const groupe = estEconomat(zone) ? "Logistimax Economat" : "Logistimax Tout sauf Economat";
      if (groupe !== groupeCourant) {
        grandTitre(groupe);
        groupeCourant = groupe;
      }
    }

    sautSiBesoin(90);
    doc.moveDown(0.8);
    bandeau(zone.nom, `${dedans.length} réf.`);
    enTeteTableau();

    // Lignes plus lisibles (demandé par Nicolas le 19/10/2026) : texte en 11,
    // une ligne sur deux sur fond gris clair pour suivre la ligne jusqu'au
    // stock et aux colis. La hauteur est calculée avant d'écrire pour poser
    // le fond sous toute la ligne, même si le nom tient sur deux lignes.
    const TAILLE = 11;
    const PETIT = 9;
    const PAD = 5;
    dedans.forEach((l, i) => {
      const unite = l.produit.unite ?? "u";
      const fact = Number(l.produit.fact);
      const cond = l.produit.conditionnement ?? "colis";
      // Nombre d'unités par colis : aide à pointer la livraison et le stock.
      const texteCond =
        fact > 0 && fact !== 1 ? `${cond} de ${qte(fact)} ${unite}` : l.produit.conditionnement ?? "—";
      // Emprunté à un autre Del Arte : la commande comprend de quoi le rendre.
      const aRendre = l.echanges
        .filter((e) => e.nousDevons > 0)
        .map((e) => `dont ${qte(e.nousDevons)} ${unite} à rendre à ${e.delArte}`)
        .join(" · ");

      doc.font("Helvetica").fontSize(TAILLE);
      let hNom = doc.heightOfString(l.produit.nom, { width: colonnes[0].w });
      if (aRendre) {
        doc.fontSize(PETIT);
        hNom += doc.heightOfString(aRendre, { width: colonnes[0].w });
        doc.fontSize(TAILLE);
      }
      const hCond = doc.heightOfString(texteCond, { width: colonnes[1].w });
      const h = Math.max(hNom, hCond, TAILLE * 1.2) + PAD * 2;

      if (sautSiBesoin(h + 4)) {
        bandeau(`${zone.nom} (suite)`, "");
        enTeteTableau();
      }
      const haut = doc.y;
      if (i % 2 === 1) doc.rect(MARGE, haut, largeur, h).fill("#eef0f4");
      const y = haut + PAD;

      doc.font("Helvetica").fontSize(TAILLE).fillColor("#171b24");
      doc.text(l.produit.nom, colonnes[0].x, y, { width: colonnes[0].w });
      if (aRendre) {
        doc.fontSize(PETIT).fillColor("#b45309");
        doc.text(aRendre, colonnes[0].x, doc.y, { width: colonnes[0].w });
        doc.fontSize(TAILLE).fillColor("#171b24");
      }
      doc.text(texteCond, colonnes[1].x, y, { width: colonnes[1].w });
      doc.text(
        l.ligne.stock === null ? "—" : `${qte(Number(l.ligne.stock))} ${unite}`,
        colonnes[2].x,
        y,
        { width: colonnes[2].w, align: "right", lineBreak: false },
      );
      doc.font("Helvetica-Bold").text(l.colis > 0 ? qte(l.colis) : "—", colonnes[3].x, y, {
        width: colonnes[3].w,
        align: "right",
        lineBreak: false,
      });
      doc.font("Helvetica").fillColor("#4d5668");
      doc.text(
        l.colis > 0 ? `${qte(l.colis * fact)} ${unite}` : "",
        colonnes[4].x,
        y,
        { width: colonnes[4].w, align: "right", lineBreak: false },
      );
      doc.fillColor("#171b24");
      doc.x = MARGE;
      doc.y = haut + h;
    });
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

  // Numéros de page, posés une fois toutes les pages connues. La marge du bas
  // est levée le temps d'écrire : sinon pdfkit ouvrirait une page de plus.
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(pages.start + i);
    const basOriginal = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(9).fillColor("#8b94a5");
    doc.text(`Page ${i + 1} / ${pages.count}`, MARGE, doc.page.height - MARGE + 16, {
      width: largeur,
      align: "right",
      lineBreak: false,
    });
    doc.page.margins.bottom = basOriginal;
  }

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
