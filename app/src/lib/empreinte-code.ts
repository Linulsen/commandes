/**
 * Empreinte des codes personnels (écran de verrouillage).
 *
 * Le code doit pouvoir se vérifier sur le téléphone même sans réseau : le
 * serveur calcule l'empreinte, chaque appareil autorisé en garde une copie,
 * et la page recalcule l'empreinte du code tapé pour la comparer. Le même
 * calcul (PBKDF2-SHA256, sel propre à chaque personne) tourne donc dans le
 * navigateur et sur le serveur, avec l'API WebCrypto disponible des deux côtés.
 *
 * Limite assumée : une empreinte de code à 4 chiffres gardée sur l'appareil
 * peut être retrouvée par quelqu'un qui saurait l'extraire et tester les
 * 10 000 combinaisons. Le verrou protège d'un usage par la mauvaise personne
 * sur un appareil laissé ouvert, pas d'une attaque informatique.
 */

export const ITERATIONS = 100_000;

export const CODE_VALIDE = /^\d{4,8}$/;

function hex(octets: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(octets))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function depuisHex(texte: string) {
  const out = new Uint8Array(new ArrayBuffer(texte.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(texte.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function nouveauSel(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function empreinteCode(code: string, sel: string, iterations = ITERATIONS): Promise<string> {
  const cle = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: depuisHex(sel), iterations },
    cle,
    256,
  );
  return hex(bits);
}

/** Comparaison à temps constant. */
export function memeEmpreinte(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i++) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

/** Ce que chaque appareil autorisé reçoit pour vérifier les codes. */
export type CodePersonnel = {
  prenom: string;
  sel: string;
  empreinte: string;
  iterations: number;
};

export type EtatVerrou = { actif: boolean; personnes: CodePersonnel[] };
