import { NextResponse } from "next/server";
import { sb } from "@/lib/db";

/**
 * Lignes de réception saisies sur le téléphone, par paquets, comme les
 * relevés. Chaque ligne porte son état complet : reçue ou non, et la quantité.
 *
 * La quantité s'entend en colis pour une livraison — c'est ce qui est écrit sur
 * le bon — et en unités de stock pour un dépannage, acheté chez Metro dans un
 * conditionnement qui n'a rien à voir avec celui du fournisseur. `unites` est
 * calculé ici, pour que la consommation n'ait qu'une colonne à lire.
 */
type Brute = Record<string, unknown>;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const lignes = Array.isArray(body?.lignes) ? (body.lignes as Brute[]) : null;
  if (!lignes) return NextResponse.json({ erreur: "Requête invalide" }, { status: 400 });

  try {
    const ids = [...new Set(lignes.map((l) => l.receptionId).filter(Number.isInteger))] as number[];
    const pids = [...new Set(lignes.map((l) => l.produitId).filter(Number.isInteger))] as number[];
    const [rec, prod] = await Promise.all([
      sb().from("cmd_receptions").select("id,type,statut").in("id", ids.length ? ids : [-1]),
      sb().from("cmd_produits").select("id,fact").in("id", pids.length ? pids : [-1]),
    ]);
    if (rec.error) throw new Error(rec.error.message);
    if (prod.error) throw new Error(prod.error.message);
    const reception = new Map((rec.data ?? []).map((r) => [r.id, r]));
    const fact = new Map((prod.data ?? []).map((p) => [p.id, Number(p.fact) || 1]));

    const refusees: { index: number; erreur: string }[] = [];
    const aEcrire = new Map<string, Record<string, unknown>>();
    const aRetirer: { reception_id: number; produit_id: number }[] = [];
    const maintenant = new Date().toISOString();

    lignes.forEach((l, index) => {
      const r = reception.get(l.receptionId as number);
      const pid = l.produitId as number;
      if (!r) return void refusees.push({ index, erreur: "réception inconnue" });
      if (!fact.has(pid)) return void refusees.push({ index, erreur: "produit inconnu" });
      if (r.statut === "validee") {
        return void refusees.push({ index, erreur: "réception déjà validée" });
      }
      if (l.retirer === true) {
        aRetirer.push({ reception_id: r.id, produit_id: pid });
        aEcrire.delete(`${r.id}:${pid}`);
        return;
      }
      const q = Number(l.quantite);
      const quantite = Number.isFinite(q) && q >= 0 ? q : 0;
      const livraison = r.type === "livraison";
      aEcrire.set(`${r.id}:${pid}`, {
        reception_id: r.id,
        produit_id: pid,
        colis_recus: livraison ? quantite : null,
        unites: livraison ? quantite * fact.get(pid)! : quantite,
        recu: l.recu === true,
        maj_le: maintenant,
      });
    });

    if (aEcrire.size) {
      const { error } = await sb()
        .from("cmd_reception_lignes")
        .upsert([...aEcrire.values()] as never, { onConflict: "reception_id,produit_id" });
      if (error) throw new Error(error.message);
    }
    for (const r of aRetirer) {
      // On ne retire que ce qui a été ajouté à la main : une ligne commandée
      // reste, décochée, pour garder la trace de ce qui n'est pas arrivé.
      const { error } = await sb()
        .from("cmd_reception_lignes")
        .delete()
        .eq("reception_id", r.reception_id)
        .eq("produit_id", r.produit_id)
        .is("colis_commandes", null);
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, refusees });
  } catch (e) {
    return NextResponse.json(
      { erreur: e instanceof Error ? e.message : "Échec" },
      { status: 500 },
    );
  }
}
