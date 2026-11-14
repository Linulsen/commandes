import { createHash, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { sb } from "./db";

/**
 * Limite des essais du code d'accès (audit du 14/11/2026) : après 5 codes
 * faux en 15 minutes depuis une même adresse, toute tentative est refusée
 * jusqu'à ce que la fenêtre soit passée, même avec le bon code. Chaque code
 * faux est noté au journal (action « code_acces_faux »).
 *
 * Par adresse et non pour toute l'appli : quelqu'un qui s'acharne ne doit pas
 * pouvoir empêcher l'équipe de se connecter. Base injoignable : la connexion
 * reste possible (même choix que pour les appareils, voir middleware.ts).
 */
export const ESSAIS_MAX = 5;
export const FENETRE_MINUTES = 15;

export async function adresseClient(): Promise<string> {
  const h = await headers();
  const transmise = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return transmise || h.get("x-real-ip") || "inconnue";
}

export async function tropDEssais(ip: string): Promise<boolean> {
  try {
    const depuis = new Date(Date.now() - FENETRE_MINUTES * 60_000).toISOString();
    const { count, error } = await sb()
      .from("app_journal")
      .select("id", { count: "exact", head: true })
      .eq("action", "code_acces_faux")
      .filter("details->>ip", "eq", ip)
      .gte("quand", depuis);
    if (error) throw error;
    return (count ?? 0) >= ESSAIS_MAX;
  } catch (e) {
    console.error("Essais de connexion illisibles, connexion laissée possible :", e);
    return false;
  }
}

export async function noterEssaiFaux(ip: string, prenom: string, appareil: string) {
  try {
    const { error } = await sb()
      .from("app_journal")
      .insert({
        action: "code_acces_faux",
        objet: "connexion",
        details: { ip, appareil: appareil || null },
        prenom: prenom || null,
      });
    if (error) throw error;
  } catch (e) {
    console.error("Essai faux non noté :", e);
  }
}

/** Comparaison en temps constant (empreintes de même longueur). */
export function codeAccesCorrect(code: string): boolean {
  const attendu = process.env.ACCESS_CODE;
  if (!attendu) return false;
  const a = createHash("sha256").update(code).digest();
  const b = createHash("sha256").update(attendu).digest();
  return timingSafeEqual(a, b);
}
