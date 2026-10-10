import { cookies } from "next/headers";
import { sb } from "./db";
import { appareilCourant } from "./appareil";
import { signerValeur, valeurSignee } from "./auth";

/**
 * Session responsable : après le code responsable (connu de Nicolas seul),
 * les actions qu'il protège sont ouvertes sur cet appareil pendant 15 minutes.
 * Chaque action réussie relance le délai. Le jeton porte le préfixe « resp »
 * pour ne pas pouvoir servir à autre chose (session administrateur…).
 */
export const COOKIE_RESPONSABLE = "praedic_responsable";
export const RESPONSABLE_DUREE_MS = 15 * 60 * 1000;

/** 'ok', 'refuse' (code faux) ou 'bloque' (trop d'essais : 15 minutes d'attente). */
export async function verifierCodeResponsable(code: string): Promise<string> {
  const moi = await appareilCourant();
  const { data, error } = await sb().rpc("app_verifier_code_responsable", {
    p_code: code,
    p_appareil: moi?.id ?? null,
    p_prenom: moi?.prenom ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

/** La session responsable est-elle ouverte sur cet appareil ? */
export async function responsableActif(): Promise<boolean> {
  const moi = await appareilCourant();
  if (!moi) return false;
  const valeur = await valeurSignee((await cookies()).get(COOKIE_RESPONSABLE)?.value);
  if (!valeur) return false;
  const [prefixe, id, quand] = valeur.split(":");
  const age = Date.now() - Number(quand);
  return (
    prefixe === "resp" &&
    id === moi.id &&
    Number.isFinite(age) &&
    age >= 0 &&
    age < RESPONSABLE_DUREE_MS
  );
}

/** Ouvre (ou prolonge) la session responsable sur cet appareil. */
export async function ouvrirResponsable() {
  const moi = await appareilCourant();
  if (!moi) return;
  (await cookies()).set(COOKIE_RESPONSABLE, await signerValeur(`resp:${moi.id}:${Date.now()}`), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: RESPONSABLE_DUREE_MS / 1000,
  });
}
