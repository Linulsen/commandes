/**
 * Lecture d'un bon de livraison photographié, par Claude (API Anthropic).
 *
 * On envoie les photos et la liste des produits du fournisseur (avec ce qui a
 * été commandé) ; Claude rend, pour chaque ligne du bon, le produit de l'appli
 * qui lui correspond et le nombre de colis livrés. Rien n'est enregistré ici :
 * l'écran de réception préremplit les quantités, la personne vérifie et valide.
 *
 * La clé est lue dans la variable d'environnement ANTHROPIC_API_KEY (Vercel).
 */

export const MODELE_LECTURE = "claude-sonnet-5-5";

export type ImageBL = { type: "image/jpeg" | "image/png" | "image/webp"; data: string };

export type ProduitALire = {
  id: number;
  nom: string;
  conditionnement: string | null;
  unite: string | null;
  fact: number;
  /** Colis commandés, ou null si le produit n'est pas sur la commande. */
  commandes: number | null;
};

export type LigneLue = {
  /** Produit de l'appli, ou null si la ligne du bon n'a pas été reconnue. */
  produit_id: number | null;
  libelle_bon: string;
  /** Colis pour une livraison, unités de stock pour un dépannage. */
  quantite: number;
  remarque?: string;
};

export type LectureBL = {
  lisible: boolean;
  fournisseur?: string;
  date?: string;
  numero?: string;
  lignes: LigneLue[];
  commentaire?: string;
  /** Jetons consommés, pour suivre le coût. */
  usage?: { entree: number; sortie: number };
};

export type ModeLecture = "livraison" | "depannage";

const outil = (mode: ModeLecture) => ({
  name: "bon_de_livraison",
  description: "Enregistre le contenu lu sur le bon de livraison ou la facture.",
  input_schema: {
    type: "object",
    properties: {
      lisible: {
        type: "boolean",
        description: "false si la photo est trop floue, coupée ou n'est pas un bon/une facture.",
      },
      fournisseur: { type: "string", description: "Nom du fournisseur écrit sur le document." },
      date: { type: "string", description: "Date de livraison au format AAAA-MM-JJ si lisible." },
      numero: { type: "string", description: "Numéro du bon ou de la facture." },
      lignes: {
        type: "array",
        description: "Une entrée par ligne de produit du document, dans l'ordre du document.",
        items: {
          type: "object",
          properties: {
            produit_id: {
              type: ["integer", "null"],
              description:
                "id du produit de la liste qui correspond à cette ligne, ou null si aucun ne correspond avec certitude.",
            },
            libelle_bon: { type: "string", description: "Libellé tel qu'écrit sur le document." },
            quantite: {
              type: "number",
              description:
                mode === "livraison"
                  ? "Quantité livrée exprimée en colis de l'appli (voir « 1 colis = … »). 0 si la ligne indique explicitement une rupture ou un produit non livré."
                  : "Quantité achetée exprimée dans l'unité de stock du produit de l'appli (voir « compté en … »).",
            },
            remarque: {
              type: "string",
              description:
                "Courte remarque en français si doute, conversion faite, rupture, avoir… Sinon omettre.",
            },
          },
          required: ["produit_id", "libelle_bon", "quantite"],
        },
      },
      commentaire: {
        type: "string",
        description: "Remarque générale courte en français (pages manquantes, totaux, etc.), ou omettre.",
      },
    },
    required: ["lisible", "lignes"],
  },
});

function listeProduits(produits: ProduitALire[], mode: ModeLecture) {
  return produits
    .map((p) => {
      if (mode === "depannage")
        return `${p.id} | ${p.nom} | compté en ${p.unite ?? "unités"}${p.conditionnement ? ` (chez le fournisseur habituel : ${p.conditionnement})` : ""}`;
      const colis = `1 colis = ${p.fact} ${p.unite ?? "u"}${p.conditionnement ? ` (${p.conditionnement})` : ""}`;
      const cde = p.commandes != null ? ` · COMMANDÉ : ${p.commandes} colis` : "";
      return `${p.id} | ${p.nom} | ${colis}${cde}`;
    })
    .join("\n");
}

export async function lireBonDeLivraison(
  images: ImageBL[],
  produits: ProduitALire[],
  fournisseur: string,
  mode: ModeLecture = "livraison",
): Promise<LectureBL> {
  const OUTIL = outil(mode);
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) throw new ErreurLecture("La clé API Anthropic n'est pas configurée.", 503);

  const pages =
    images.length > 1
      ? `Il y a ${images.length} photos : ce sont les pages successives du même document.`
      : "";
  const consigne =
    mode === "livraison"
      ? `Tu lis le bon de livraison (ou la facture) d'un restaurant Del Arte, fournisseur attendu : ${fournisseur}.
${pages}

Produits de ce fournisseur dans l'appli (id | nom | taille d'un colis · quantité commandée) :
${listeProduits(produits, mode)}

Consignes :
- Relève chaque ligne de produit du document (pas les totaux, la TVA, les consignes de palettes, les frais de port).
- Associe chaque ligne au produit de la liste qui correspond, d'après le libellé, la marque, le poids ou le format. Les libellés du fournisseur sont souvent abrégés. Privilégie les produits commandés en cas d'hésitation. Si aucun ne correspond avec une bonne certitude, mets produit_id à null.
- Donne la quantité LIVRÉE en colis de l'appli. Si le document compte autrement (pièces, kg, cartons de taille différente), convertis avec « 1 colis = … » et explique la conversion dans « remarque ».
- Si la quantité livrée diffère de la quantité commandée, ne la corrige pas : écris ce qui est sur le document.
- Si un même produit apparaît sur plusieurs lignes, fais une entrée par ligne.
- N'invente rien : si un chiffre est illisible, mets ta meilleure lecture et signale-le dans « remarque ».`
      : `Tu lis le ticket de caisse ou la facture d'un achat de dépannage (Metro, supermarché, autre restaurant…) fait par un restaurant Del Arte.
${pages}

Produits du restaurant dans l'appli (id | nom | unité de stock) :
${listeProduits(produits, mode)}

Consignes :
- Relève chaque article acheté (pas les totaux, la TVA, les consignes, les remises, les sacs).
- Associe chaque article au produit de la liste qui correspond, d'après le libellé, la marque, le poids ou le format. Les libellés des tickets sont très abrégés. Si aucun ne correspond avec une bonne certitude, mets produit_id à null.
- Donne la quantité achetée dans l'UNITÉ DE STOCK du produit de l'appli (« compté en … ») : par exemple 2 cartons de 6 bouteilles comptées en bouteilles = 12 ; 3 barquettes de 500 g comptées en kg = 1,5. Explique toute conversion dans « remarque ».
- Si la quantité est un poids ou un nombre de pièces impossible à convertir avec certitude, mets ta meilleure estimation et signale-le dans « remarque ».
- Dans « fournisseur », mets l'enseigne ou le vendeur (ex. « Metro »).
- N'invente rien : si un chiffre est illisible, mets ta meilleure lecture et signale-le dans « remarque ».`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cle,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODELE_LECTURE,
      max_tokens: 8000,
      tools: [OUTIL],
      tool_choice: { type: "tool", name: OUTIL.name },
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image",
              source: { type: "base64", media_type: img.type, data: img.data },
            })),
            { type: "text", text: consigne },
          ],
        },
      ],
    }),
  });

  const corps = (await r.json().catch(() => null)) as {
    content?: { type: string; name?: string; input?: unknown }[];
    usage?: { input_tokens: number; output_tokens: number };
    error?: { type?: string; message?: string };
  } | null;
  if (!r.ok) {
    const msg = corps?.error?.message ?? `HTTP ${r.status}`;
    console.error("Lecture du BL : échec de l'API Anthropic :", r.status, msg);
    if (r.status === 401) throw new ErreurLecture("Clé API refusée : vérifiez-la dans Vercel.", 502);
    if (/credit|billing/i.test(msg))
      throw new ErreurLecture("Crédit API épuisé : rechargez-le sur platform.claude.com.", 502);
    if (r.status === 429 || r.status === 529)
      throw new ErreurLecture("Service occupé : réessayez dans une minute.", 503);
    throw new ErreurLecture("La lecture du bon a échoué. Réessayez.", 502);
  }

  const bloc = corps?.content?.find((c) => c.type === "tool_use" && c.name === OUTIL.name);
  const brut = (bloc?.input ?? null) as Partial<LectureBL> | null;
  if (!brut) throw new ErreurLecture("La lecture du bon n'a rien donné. Réessayez.", 502);

  const ids = new Set(produits.map((p) => p.id));
  const lignes: LigneLue[] = (Array.isArray(brut.lignes) ? brut.lignes : [])
    .map((l) => {
      const quantite = Number(l?.quantite);
      const pid = Number(l?.produit_id);
      return {
        produit_id: Number.isInteger(pid) && ids.has(pid) ? pid : null,
        libelle_bon: String(l?.libelle_bon ?? "").slice(0, 200),
        quantite:
          Number.isFinite(quantite) && quantite >= 0 ? Math.round(quantite * 1000) / 1000 : 0,
        ...(l?.remarque ? { remarque: String(l.remarque).slice(0, 300) } : {}),
      };
    })
    .filter((l) => l.libelle_bon || l.produit_id !== null);

  return {
    lisible: brut.lisible !== false,
    fournisseur: brut.fournisseur ? String(brut.fournisseur) : undefined,
    date: brut.date && /^\d{4}-\d{2}-\d{2}$/.test(String(brut.date)) ? String(brut.date) : undefined,
    numero: brut.numero ? String(brut.numero) : undefined,
    lignes,
    commentaire: brut.commentaire ? String(brut.commentaire).slice(0, 500) : undefined,
    usage: corps?.usage
      ? { entree: corps.usage.input_tokens, sortie: corps.usage.output_tokens }
      : undefined,
  };
}

export class ErreurLecture extends Error {
  constructor(
    message: string,
    public statut: number,
  ) {
    super(message);
  }
}
