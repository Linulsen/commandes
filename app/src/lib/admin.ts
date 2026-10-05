import { cookies } from "next/headers";
import { sb } from "./db";
import { appareilCourant } from "./appareil";
import {
  ADMIN_DUREE_MS,
  COOKIE_ADMIN,
  COOKIE_AUTORISE,
  creerJetonAppareil,
  jetonAppareilValide,
} from "./auth";

/**
 * Gestion des appareils, réservée à l'administrateur (code Administrateur,
 * distinct du code responsable). Après le code, la session administrateur
 * dure 10 minutes sur cet appareil seulement.
 */

export type StatutAppareil = "en_attente" | "autorise" | "retire";

export type FicheAppareil = {
  id: string;
  nom: string;
  type: string | null;
  prenom: string | null;
  premiere_connexion: string;
  derniere_connexion: string;
  statut: StatutAppareil;
  autorise_le: string | null;
  autorise_par: string | null;
  retire_le: string | null;
};

export async function ficheAppareil(id: string): Promise<FicheAppareil | null> {
  const { data, error } = await sb()
    .from("app_appareils")
    .select("id,nom,type,prenom,premiere_connexion,derniere_connexion,statut,autorise_le,autorise_par,retire_le")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FicheAppareil | null) ?? null;
}

/** Tous les appareils : en attente d'abord, puis autorisés, puis retirés. */
export async function listeAppareils(): Promise<FicheAppareil[]> {
  const { data, error } = await sb()
    .from("app_appareils")
    .select("id,nom,type,prenom,premiere_connexion,derniere_connexion,statut,autorise_le,autorise_par,retire_le")
    .order("derniere_connexion", { ascending: false });
  if (error) throw new Error(error.message);
  const rang: Record<StatutAppareil, number> = { en_attente: 0, autorise: 1, retire: 2 };
  return ((data ?? []) as FicheAppareil[]).sort((a, b) => rang[a.statut] - rang[b.statut]);
}

export async function codeAdminExiste(): Promise<boolean> {
  const { data, error } = await sb()
    .from("app_parametres")
    .select("cle")
    .eq("cle", "code_admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

/** 'ok', 'refuse', 'bloque' ou 'absent' (code pas encore créé). */
export async function verifierCodeAdmin(code: string): Promise<string> {
  const moi = await appareilCourant();
  const { data, error } = await sb().rpc("app_verifier_code_admin", {
    p_code: code,
    p_appareil: moi?.id ?? null,
    p_prenom: moi?.prenom ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function creerCodeAdmin(codeResponsable: string, nouveau: string): Promise<string> {
  const moi = await appareilCourant();
  const { data, error } = await sb().rpc("app_creer_code_admin", {
    p_code_responsable: codeResponsable,
    p_nouveau: nouveau,
    p_appareil: moi?.id ?? null,
    p_prenom: moi?.prenom ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function changerCodeAdmin(ancien: string, nouveau: string): Promise<string> {
  const moi = await appareilCourant();
  const { data, error } = await sb().rpc("app_changer_code_admin", {
    p_ancien: ancien,
    p_nouveau: nouveau,
    p_appareil: moi?.id ?? null,
    p_prenom: moi?.prenom ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

/** Nouveau code responsable, décidé par l'administrateur (l'ancien n'est pas demandé). */
export async function redefinirCodeResponsable(nouveau: string): Promise<string> {
  const moi = await appareilCourant();
  const { data, error } = await sb().rpc("app_redefinir_code_responsable", {
    p_nouveau: nouveau,
    p_appareil: moi?.id ?? null,
    p_prenom: moi?.prenom ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

const optionsCookie = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge,
});

/** La session administrateur est-elle ouverte sur cet appareil ? */
export async function adminActif(): Promise<boolean> {
  const moi = await appareilCourant();
  const jar = await cookies();
  return jetonAppareilValide(jar.get(COOKIE_ADMIN)?.value, moi?.id, ADMIN_DUREE_MS);
}

export async function ouvrirAdmin() {
  const moi = await appareilCourant();
  if (!moi) return;
  (await cookies()).set(COOKIE_ADMIN, await creerJetonAppareil(moi.id), optionsCookie(ADMIN_DUREE_MS / 1000));
}

export async function fermerAdmin() {
  (await cookies()).delete(COOKIE_ADMIN);
}

/**
 * Change le statut d'un appareil et le note au journal. `par` dit qui l'a
 * décidé (« Nicolas, page Appareils »).
 */
export async function changerStatut(id: string, statut: StatutAppareil, par: string) {
  const maintenant = new Date().toISOString();
  const maj =
    statut === "autorise"
      ? { statut, autorise_le: maintenant, autorise_par: par, retire_le: null }
      : statut === "retire"
        ? { statut, retire_le: maintenant }
        : { statut };
  const { error } = await sb().from("app_appareils").update(maj).eq("id", id);
  if (error) throw new Error(error.message);
  const moi = await appareilCourant();
  await sb().from("app_journal").insert({
    action: statut === "autorise" ? "appareil_autorise" : statut === "retire" ? "appareil_retire" : "appareil_statut",
    objet: "appareil",
    objet_id: id,
    details: { par },
    prenom: moi?.prenom ?? null,
    appareil_id: moi?.id ?? null,
  });
  // L'appareil courant vient d'être autorisé : inutile d'attendre la relecture.
  if (statut === "autorise" && moi?.id === id) {
    (await cookies()).set(COOKIE_AUTORISE, await creerJetonAppareil(id), optionsCookie(3600));
  }
}
