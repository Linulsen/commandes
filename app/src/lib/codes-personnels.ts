import { sb } from "./db";
import { appareilCourant } from "./appareil";
import {
  CODE_VALIDE,
  ITERATIONS,
  empreinteCode,
  nouveauSel,
  type CodePersonnel,
  type EtatVerrou,
} from "./empreinte-code";

/**
 * Codes personnels de l'écran de verrouillage, gardés dans `app_parametres`
 * (une ligne par personne, clé « code_perso:<prénom en minuscules> »), plus
 * l'interrupteur « verrou_actif ». Jamais de code en clair : sel et empreinte.
 */

const PREFIXE = "code_perso:";
const CLE_ACTIF = "verrou_actif";

const cleDe = (prenom: string) => PREFIXE + prenom.trim().toLocaleLowerCase("fr-FR");

export async function etatVerrou(): Promise<EtatVerrou> {
  const { data, error } = await sb()
    .from("app_parametres")
    .select("cle,valeur");
  if (error) throw new Error(error.message);
  const personnes: CodePersonnel[] = [];
  let actif = false;
  // Filtré ici, côté serveur : les autres réglages (empreintes des codes
  // responsable et Administrateur) ne sortent jamais de cette fonction.
  for (const ligne of data ?? []) {
    if (ligne.cle === CLE_ACTIF) {
      actif = ligne.valeur === "oui";
      continue;
    }
    if (!ligne.cle.startsWith(PREFIXE)) continue;
    try {
      const v = JSON.parse(ligne.valeur) as CodePersonnel;
      if (v.prenom && v.sel && v.empreinte) {
        personnes.push({ prenom: v.prenom, sel: v.sel, empreinte: v.empreinte, iterations: v.iterations || ITERATIONS });
      }
    } catch {
      // ligne illisible : ignorée
    }
  }
  personnes.sort((a, b) => a.prenom.localeCompare(b.prenom, "fr"));
  // Sans aucun code, rien ne pourrait déverrouiller : le verrou reste éteint.
  return { actif: actif && personnes.length > 0, personnes };
}

/** L'interrupteur seul (le verrou n'agit qu'avec au moins un code). */
export async function interrupteurVerrou(): Promise<boolean> {
  const { data, error } = await sb()
    .from("app_parametres")
    .select("valeur")
    .eq("cle", CLE_ACTIF)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.valeur === "oui";
}

async function noter(action: string, details: Record<string, unknown>) {
  const moi = await appareilCourant();
  await sb().from("app_journal").insert({
    action,
    objet: "code_personnel",
    details,
    prenom: moi?.prenom ?? null,
    appareil_id: moi?.id ?? null,
  });
}

/** Crée ou remplace le code d'une personne. Renvoie 'ok' ou 'invalide'. */
export async function definirCodePersonnel(prenomBrut: string, code: string): Promise<string> {
  const prenom = prenomBrut.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!prenom || !CODE_VALIDE.test(code)) return "invalide";
  const sel = nouveauSel();
  const valeur: CodePersonnel & { cree_le: string } = {
    prenom,
    sel,
    empreinte: await empreinteCode(code, sel),
    iterations: ITERATIONS,
    cree_le: new Date().toISOString(),
  };
  const { error } = await sb()
    .from("app_parametres")
    .upsert(
      { cle: cleDe(prenom), valeur: JSON.stringify(valeur), modifie_le: new Date().toISOString() },
      { onConflict: "cle" },
    );
  if (error) throw new Error(error.message);
  await noter("code_personnel_defini", { pour: prenom });
  return "ok";
}

export async function supprimerCodePersonnel(prenom: string) {
  const { error } = await sb().from("app_parametres").delete().eq("cle", cleDe(prenom));
  if (error) throw new Error(error.message);
  await noter("code_personnel_supprime", { pour: prenom });
}

export async function changerVerrou(actif: boolean) {
  const { error } = await sb()
    .from("app_parametres")
    .upsert(
      { cle: CLE_ACTIF, valeur: actif ? "oui" : "non", modifie_le: new Date().toISOString() },
      { onConflict: "cle" },
    );
  if (error) throw new Error(error.message);
  await noter(actif ? "verrou_active" : "verrou_desactive", {});
}
