/**
 * Accès par code partagé, comme les autres outils internes : une seule équipe,
 * pas de comptes à administrer. Le cookie porte une date d'émission signée, ce
 * qui permet de le faire expirer sans stocker de session côté serveur.
 */
const COOKIE = "praedic_commandes";
const DUREE_JOURS = 60;

const encoder = new TextEncoder();

async function signer(charge: string): Promise<string> {
  const cle = await crypto.subtle.importKey(
    "raw",
    encoder.encode(process.env.SESSION_SECRET ?? ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cle, encoder.encode(charge));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function creerJeton(): Promise<string> {
  const charge = String(Date.now());
  return `${charge}.${await signer(charge)}`;
}

export async function jetonValide(jeton: string | undefined): Promise<boolean> {
  if (!jeton) return false;
  const [charge, sig] = jeton.split(".");
  if (!charge || !sig) return false;
  const attendu = await signer(charge);
  if (sig.length !== attendu.length) return false;
  // Comparaison à temps constant : la durée d'une réponse ne doit pas révéler
  // combien de caractères de la signature sont corrects.
  let ecart = 0;
  for (let i = 0; i < sig.length; i++) ecart |= sig.charCodeAt(i) ^ attendu.charCodeAt(i);
  if (ecart !== 0) return false;
  const age = Date.now() - Number(charge);
  return Number.isFinite(age) && age >= 0 && age < DUREE_JOURS * 864e5;
}

export const COOKIE_NOM = COOKIE;
export const COOKIE_DUREE = DUREE_JOURS * 86400;
