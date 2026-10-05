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

/**
 * Identité de l'appareil : un identifiant créé à la première connexion, gardé
 * bien plus longtemps que la session (un appareil reste le même quand le code
 * est redemandé). Le prénom de la personne qui l'utilise est à part : sur une
 * tablette partagée, il change sans que l'appareil change.
 */
export const COOKIE_APPAREIL = "praedic_appareil";
export const COOKIE_PRENOM = "praedic_prenom";
export const COOKIE_APPAREIL_DUREE = 400 * 86400;

/**
 * Valeur signée, sans date d'expiration propre : « valeur.signature ». Sert aux
 * cookies qui portent l'identifiant de l'appareil et l'heure d'émission (accès
 * autorisé, session administrateur) : la signature empêche de les fabriquer.
 */
export async function signerValeur(valeur: string): Promise<string> {
  return `${valeur}.${await signer(valeur)}`;
}

/** La valeur d'un jeton signé, ou null si la signature ne correspond pas. */
export async function valeurSignee(jeton: string | undefined): Promise<string | null> {
  if (!jeton) return null;
  const i = jeton.lastIndexOf(".");
  if (i <= 0) return null;
  const valeur = jeton.slice(0, i);
  const sig = jeton.slice(i + 1);
  const attendu = await signer(valeur);
  if (sig.length !== attendu.length) return null;
  let ecart = 0;
  for (let k = 0; k < sig.length; k++) ecart |= sig.charCodeAt(k) ^ attendu.charCodeAt(k);
  return ecart === 0 ? valeur : null;
}

/**
 * Jeton « appareil:heure » valide pour cet appareil et pas plus vieux que
 * `dureeMs`. Utilisé pour l'autorisation de l'appareil et la session
 * administrateur.
 */
export async function jetonAppareilValide(
  jeton: string | undefined,
  appareil: string | undefined,
  dureeMs: number,
): Promise<boolean> {
  if (!appareil) return false;
  const valeur = await valeurSignee(jeton);
  if (!valeur) return false;
  const [id, quand] = valeur.split(":");
  const age = Date.now() - Number(quand);
  return id === appareil && Number.isFinite(age) && age >= 0 && age < dureeMs;
}

export async function creerJetonAppareil(appareil: string): Promise<string> {
  return signerValeur(`${appareil}:${Date.now()}`);
}

/**
 * Appareil autorisé : le statut est relu dans la base au plus toutes les
 * 5 minutes ; entre deux lectures, ce cookie signé suffit. Un appareil retiré
 * par l'administrateur est donc bloqué dans les 5 minutes.
 */
export const COOKIE_AUTORISE = "praedic_autorise";
export const AUTORISE_DUREE_MS = 5 * 60 * 1000;

/** Session administrateur (page Appareils) : 10 minutes, puis le code est redemandé. */
export const COOKIE_ADMIN = "praedic_admin";
export const ADMIN_DUREE_MS = 10 * 60 * 1000;
