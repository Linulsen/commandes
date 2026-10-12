import type { SupabaseClient } from "@supabase/supabase-js";
import { sb, selectAll } from "./db";
import { alphabetique } from "./tri-commun";

/**
 * Ordre de rangement : la place de chaque article dans chaque lieu
 * d'inventaire, pour afficher l'inventaire et le relevé dans l'ordre où l'on
 * passe devant les étagères.
 *
 * Il se règle depuis l'inventaire seulement (choix de Nicolas, 11/10/2026),
 * sur la liste de l'inventaire : articles actifs, articles retirés encore en
 * stock, emplacements secondaires. Le relevé fournisseur suit le rang du
 * lieu principal sans pouvoir le modifier.
 *
 * rang = (ordre du lieu + 1) × 1000 + position. Lieu principal :
 * cmd_produits.rang ; emplacement secondaire : cmd_produit_emplacements.rang.
 */

const db = () => sb() as unknown as SupabaseClient;

export type LieuRangement = { id: number; nom: string; ordre: number };

export type ProduitRangement = {
  id: number;
  /** Libellé affiché : le libellé court s'il existe. */
  nom: string;
  nomComplet: string;
  conditionnement: string | null;
  unite: string | null;
  rang: number | null;
  /** Fournisseur de commande ; null pour un article hors commande. */
  fournisseur: string | null;
  comptage: boolean;
  /** Retiré de la carte, encore en stock. */
  inactif: boolean;
  /** Rangé ici en plus de son lieu principal. */
  secondaire: boolean;
};

type ProduitBrut = {
  id: number;
  zone_id: number;
  lieu_id: number | null;
  nom: string;
  nom_court: string | null;
  conditionnement: string | null;
  unite: string | null;
  rang: number | null;
  actif: boolean;
  compte_pour: number | null;
};

const PAS = 1000;

/** Les lieux d'inventaire, dans l'ordre de l'inventaire. */
export async function getLieuxRangement(): Promise<LieuRangement[]> {
  const { data, error } = await db()
    .from("cmd_zones")
    .select("id,nom,ordre")
    .eq("est_lieu", true)
    .order("ordre");
  if (error) throw new Error(error.message);
  return (data ?? []) as LieuRangement[];
}

/** Les articles de l'inventaire dans ce lieu, avec leur rang ici. */
async function articlesDuLieu(lieuId: number) {
  const attendus = await selectAll<{ produit_id: number; principal: boolean }>(() =>
    db()
      .from("inv_produits_attendus")
      .select("produit_id,principal")
      .eq("zone_id", lieuId)
      .order("produit_id"),
  );
  const ids = attendus.map((a) => a.produit_id);
  if (!ids.length) return [];
  const [produits, emplacements] = await Promise.all([
    selectAll<ProduitBrut>(() =>
      db()
        .from("cmd_produits")
        .select("id,zone_id,lieu_id,nom,nom_court,conditionnement,unite,rang,actif,compte_pour")
        .in("id", ids)
        .order("id"),
    ),
    selectAll<{ produit_id: number; rang: number | null }>(() =>
      db()
        .from("cmd_produit_emplacements")
        .select("produit_id,rang")
        .eq("zone_id", lieuId)
        .order("produit_id"),
    ),
  ]);
  const rangSecondaire = new Map(emplacements.map((e) => [e.produit_id, e.rang]));
  const principal = new Map(attendus.map((a) => [a.produit_id, a.principal]));
  return produits.map((p) => {
    const ici = principal.get(p.id) ?? true;
    return { ...p, secondaire: !ici, rangIci: ici ? p.rang : (rangSecondaire.get(p.id) ?? null) };
  });
}

/** Tri de la page : les articles placés dans l'ordre, puis les autres de A à Z. */
const parRang = (a: { rang: number | null; nom: string }, b: { rang: number | null; nom: string }) => {
  const ra = a.rang ?? Number.MAX_SAFE_INTEGER;
  const rb = b.rang ?? Number.MAX_SAFE_INTEGER;
  return ra - rb || alphabetique(a.nom, b.nom);
};

/** Les articles d'un lieu, dans leur ordre de rangement actuel. */
export async function getProduitsRangement(lieuId: number): Promise<ProduitRangement[]> {
  const [articles, zones, fournisseurs] = await Promise.all([
    articlesDuLieu(lieuId),
    db()
      .from("cmd_zones")
      .select("id,fournisseur_id")
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: number; fournisseur_id: number | null }[];
      }),
    db()
      .from("cmd_fournisseurs")
      .select("id,nom")
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: number; nom: string }[];
      }),
  ]);
  const fournisseurDeZone = new Map(zones.map((z) => [z.id, z.fournisseur_id]));
  const nomFournisseur = new Map(fournisseurs.map((f) => [f.id, f.nom]));
  return articles
    .map((p) => {
      const f = fournisseurDeZone.get(p.zone_id) ?? null;
      return {
        id: p.id,
        nom: p.nom_court || p.nom,
        nomComplet: p.nom,
        conditionnement: p.conditionnement,
        unite: p.unite,
        rang: p.rangIci,
        fournisseur: f !== null ? (nomFournisseur.get(f) ?? null) : null,
        comptage: p.compte_pour !== null,
        inactif: !p.actif,
        secondaire: p.secondaire,
      };
    })
    .sort(parRang);
}

/**
 * Enregistre l'ordre d'un lieu. `ids` : les articles de l'inventaire dans ce
 * lieu, dans l'ordre voulu.
 */
export async function enregistrerRangement(
  lieuId: number,
  ids: number[],
  qui: { prenom: string | null; appareilId: string | null },
) {
  const lieux = await getLieuxRangement();
  const lieu = lieux.find((l) => l.id === lieuId);
  if (!lieu) throw new Error("Lieu inconnu");

  const articles = await articlesDuLieu(lieuId);
  const connus = new Map(articles.map((a) => [a.id, a]));
  if (new Set(ids).size !== ids.length || ids.some((id) => !connus.has(id))) {
    throw new Error("Liste d'articles invalide : rechargez la page.");
  }
  // Un article arrivé dans ce lieu depuis l'ouverture de la page, absent de la
  // liste envoyée, garde sa place à la suite plutôt que d'être oublié.
  const envoyes = new Set(ids);
  const restants = articles
    .filter((a) => !envoyes.has(a.id))
    .map((a) => ({ ...a, rang: a.rangIci }))
    .sort(parRang)
    .map((a) => a.id);

  const base = (lieu.ordre + 1) * PAS;
  const aChanger = [...ids, ...restants]
    .map((id, i) => ({ article: connus.get(id)!, rang: base + i + 1 }))
    .filter((x) => x.article.rangIci !== x.rang);

  for (let i = 0; i < aChanger.length; i += 20) {
    const resultats = await Promise.all(
      aChanger.slice(i, i + 20).map(({ article, rang }) =>
        article.secondaire
          ? db()
              .from("cmd_produit_emplacements")
              .update({ rang })
              .eq("produit_id", article.id)
              .eq("zone_id", lieuId)
          : db().from("cmd_produits").update({ rang }).eq("id", article.id),
      ),
    );
    const echec = resultats.find((r) => r.error);
    if (echec?.error) throw new Error(echec.error.message);
  }

  await db().from("app_journal").insert({
    action: "rangement_modifie",
    objet: "lieu",
    objet_id: String(lieuId),
    details: { lieu: lieu.nom, articles: ids.length, modifies: aChanger.length },
    prenom: qui.prenom,
    appareil_id: qui.appareilId,
  });
  return { modifies: aChanger.length };
}
