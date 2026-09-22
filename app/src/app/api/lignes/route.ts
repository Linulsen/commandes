import { NextResponse } from "next/server";
import { sb } from "@/lib/db";

/**
 * Enregistre les lignes de relevé saisies sur le téléphone.
 *
 * Elles arrivent par paquets : le téléphone les garde en file tant qu'il n'a
 * pas de réseau — en chambre négative, c'est la règle plus que l'exception —
 * puis envoie tout ce qui attend d'un coup. Chaque ligne porte son état
 * complet, si bien que rejouer un paquet déjà reçu ne change rien.
 *
 * Une ligne refusée n'empêche pas les autres de passer : elle est signalée
 * dans la réponse, et le téléphone la retire de sa file.
 */
type Brute = Record<string, unknown>;

const nombre = (v: unknown) =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v))
    ? null
    : Number(v);

async function enregistrer(lignes: Brute[]) {
  const refusees: { index: number; erreur: string }[] = [];
  const ids = [...new Set(lignes.map((l) => l.sessionId).filter(Number.isInteger))] as number[];
  const { data: sessions, error } = await sb()
    .from("cmd_sessions")
    .select("id,statut")
    .in("id", ids.length ? ids : [-1]);
  if (error) throw new Error(error.message);
  const statut = new Map((sessions ?? []).map((s) => [s.id, s.statut]));

  const maintenant = new Date().toISOString();
  const aEcrire = new Map<string, Record<string, unknown>>();
  lignes.forEach((l, index) => {
    const { sessionId, produitId } = l;
    if (!Number.isInteger(sessionId) || !Number.isInteger(produitId)) {
      refusees.push({ index, erreur: "ligne inconnue" });
      return;
    }
    const st = statut.get(sessionId as number);
    if (!st) return void refusees.push({ index, erreur: "commande inconnue" });
    if (st === "validee") return void refusees.push({ index, erreur: "commande déjà validée" });
    const ligne: Record<string, unknown> = {
      session_id: sessionId,
      produit_id: produitId,
      stock: nombre(l.stock),
      colis: nombre(l.colis),
      suggestion: nombre(l.suggestion),
      conso_prevue: nombre(l.consoPrevue),
      maj_le: maintenant,
    };
    // Un téléphone resté sur l'ancienne version n'envoie pas la perte : ne
    // pas l'effacer pour autant.
    if ("perte" in l) ligne.perte = nombre(l.perte);
    aEcrire.set(`${sessionId}:${produitId}`, ligne);
  });

  // PostgREST exige des objets de même forme dans un upsert groupé.
  const groupes = new Map<string, Record<string, unknown>[]>();
  for (const l of aEcrire.values()) {
    const forme = Object.keys(l).sort().join(",");
    groupes.set(forme, [...(groupes.get(forme) ?? []), l]);
  }
  for (const lot of groupes.values()) {
    const { error: e } = await sb()
      .from("cmd_lignes")
      .upsert(lot as never, { onConflict: "session_id,produit_id" });
    if (e) throw new Error(e.message);
  }
  return refusees;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const lignes = Array.isArray(body?.lignes) ? (body.lignes as Brute[]) : null;
  if (!lignes) {
    return NextResponse.json({ erreur: "Requête invalide" }, { status: 400 });
  }
  try {
    const refusees = await enregistrer(lignes);
    return NextResponse.json({ ok: true, refusees });
  } catch (e) {
    return NextResponse.json(
      { erreur: e instanceof Error ? e.message : "Échec" },
      { status: 500 },
    );
  }
}

/** Ancien format, une ligne à la fois : gardé pour les pages déjà ouvertes. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ erreur: "Requête invalide" }, { status: 400 });
  }
  try {
    const refusees = await enregistrer([body]);
    if (refusees.length) {
      return NextResponse.json({ erreur: refusees[0].erreur }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { erreur: e instanceof Error ? e.message : "Échec" },
      { status: 500 },
    );
  }
}
