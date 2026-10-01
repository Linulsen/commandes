import { cookies, headers } from "next/headers";
import { sb } from "./db";
import {
  COOKIE_APPAREIL,
  COOKIE_APPAREIL_DUREE,
  COOKIE_PRENOM,
} from "./auth";

/**
 * Qui saisit, sur quel appareil. Tout est déclaratif (prénom et nom donnés
 * par l'utilisateur) : cela sert à retrouver qui a créé ou modifié quoi, pas à
 * prouver une identité.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Appareil = { id: string; prenom: string | null };

/** L'appareil courant, d'après ses cookies ; null s'il ne s'est jamais présenté. */
export async function appareilCourant(): Promise<Appareil | null> {
  const jar = await cookies();
  const id = jar.get(COOKIE_APPAREIL)?.value;
  if (!id || !UUID.test(id)) return null;
  const prenom = jar.get(COOKIE_PRENOM)?.value;
  return { id, prenom: prenom ? decodeURIComponent(prenom) : null };
}

/** Le nom déjà donné à cet appareil, pour pré-remplir le formulaire. */
export async function nomAppareil(id: string): Promise<string | null> {
  const { data } = await sb()
    .from("app_appareils")
    .select("nom")
    .eq("id", id)
    .maybeSingle();
  return data?.nom ?? null;
}

/** « iPhone · Safari », « Android · Chrome », « Ordinateur · Firefox »… */
export function typeAppareil(ua: string): string {
  const systeme = /iPad/.test(ua)
    ? "iPad"
    : /iPhone|iPod/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua) && /Mobile/.test(ua)
          ? "iPad"
          : /Windows|Macintosh|Linux|CrOS/.test(ua)
            ? "Ordinateur"
            : "Appareil";
  const navigateur = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome|CriOS/.test(ua)
          ? "Chrome"
          : /Safari/.test(ua)
            ? "Safari"
            : "navigateur inconnu";
  return `${systeme} · ${navigateur}`;
}

export function nettoyer(texte: FormDataEntryValue | null, max = 40): string {
  return String(texte ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Enregistre (ou met à jour) l'appareil et la personne qui l'utilise, pose
 * les cookies correspondants et note l'événement dans le journal.
 */
export async function presenterAppareil(nom: string, prenom: string, action: string) {
  const jar = await cookies();
  const ua = (await headers()).get("user-agent") ?? "";
  const existant = await appareilCourant();
  const id = existant?.id ?? crypto.randomUUID();
  const maintenant = new Date().toISOString();

  const { error } = await sb()
    .from("app_appareils")
    .upsert(
      {
        id,
        nom,
        prenom,
        type: typeAppareil(ua),
        derniere_connexion: maintenant,
        ...(existant ? {} : { premiere_connexion: maintenant }),
      },
      { onConflict: "id" },
    );
  if (error) throw new Error(error.message);

  await sb().from("app_journal").insert({
    action,
    objet: "appareil",
    objet_id: id,
    details: { nom, type: typeAppareil(ua) },
    prenom,
    appareil_id: id,
  });

  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_APPAREIL_DUREE,
  };
  jar.set(COOKIE_APPAREIL, id, options);
  jar.set(COOKIE_PRENOM, encodeURIComponent(prenom), options);
}
