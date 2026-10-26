/**
 * Lecture d'un bon de commande Adoria (PDF), pour le contrôler par rapport à
 * la commande de l'appli (demandé le 26/10/2026 : l'adjoint saisit la
 * commande dans Adoria, l'appli vérifie qu'il n'a rien oublié).
 *
 * Les bons Adoria sont produits par iTextSharp avec les polices standard
 * (Helvetica, WinAnsi) : chaque case du tableau est une chaîne posée à une
 * position. On lit donc le PDF directement, sans bibliothèque ni appel à
 * Claude : décompression des flux, chaînes et positions, puis regroupement
 * des chaînes qui partagent la même ligne.
 *
 * La décompression est fournie par l'appelant (DecompressionStream dans le
 * navigateur, zlib pour les essais), pour que ce module tourne partout.
 */

export type LigneAdoria = {
  code: string;
  designation: string;
  /** Quantité commandée, en conditionnements (colonne « Qt »). */
  qt: number;
  /** Conditionnement Adoria (« carton x 6 », « sachet x 1 »…). */
  conditionnement: string;
};

export type BonAdoria = {
  numero: string | null;
  livraison: string | null;
  lignes: LigneAdoria[];
};

type Morceau = { x: number; y: number; texte: string };

export type Inflate = (donnees: Uint8Array) => Promise<Uint8Array>;

const latin = new TextDecoder("windows-1252");

/** Chaîne PDF littérale `( … )` à partir de `debut` (sur la parenthèse). */
function lireLitterale(b: Uint8Array, debut: number): { octets: number[]; fin: number } {
  const octets: number[] = [];
  let profondeur = 0;
  let i = debut;
  for (; i < b.length; i++) {
    const c = b[i];
    if (c === 0x28) {
      if (profondeur++ === 0) continue;
    } else if (c === 0x29) {
      if (--profondeur === 0) break;
    } else if (c === 0x5c) {
      const n = b[++i];
      const echappes: Record<number, number> = {
        0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c,
      };
      if (n in echappes) {
        octets.push(echappes[n]);
      } else if (n >= 0x30 && n <= 0x37) {
        let v = n - 0x30;
        for (let k = 0; k < 2 && b[i + 1] >= 0x30 && b[i + 1] <= 0x37; k++) v = v * 8 + (b[++i] - 0x30);
        octets.push(v & 0xff);
      } else if (n === 0x0d || n === 0x0a) {
        if (n === 0x0d && b[i + 1] === 0x0a) i++;
      } else {
        octets.push(n);
      }
      continue;
    }
    octets.push(c);
  }
  return { octets, fin: i };
}

/** Chaînes et positions d'un flux de contenu de page. */
function morceauxDuFlux(b: Uint8Array): Morceau[] {
  const res: Morceau[] = [];
  const pile: (number | string)[] = [];
  let x = 0;
  let y = 0;
  let debutX = 0;
  let debutY = 0;
  let i = 0;
  const estBlanc = (c: number) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
  const estDelim = (c: number) => estBlanc(c) || c === 0x28 || c === 0x3c || c === 0x5b || c === 0x5d || c === 0x2f;
  const poser = (texte: string) => {
    if (texte.trim()) res.push({ x, y, texte });
  };
  while (i < b.length) {
    const c = b[i];
    if (estBlanc(c)) { i++; continue; }
    if (c === 0x25) { while (i < b.length && b[i] !== 10 && b[i] !== 13) i++; continue; }
    if (c === 0x28) {
      const { octets, fin } = lireLitterale(b, i);
      pile.push("\u0000" + latin.decode(new Uint8Array(octets)));
      i = fin + 1;
      continue;
    }
    if (c === 0x3c && b[i + 1] !== 0x3c) {
      let j = i + 1;
      let hex = "";
      while (j < b.length && b[j] !== 0x3e) { hex += String.fromCharCode(b[j]); j++; }
      hex = hex.replace(/\s/g, "");
      if (hex.length % 2) hex += "0";
      const o = new Uint8Array(hex.length / 2);
      for (let k = 0; k < o.length; k++) o[k] = parseInt(hex.slice(2 * k, 2 * k + 2), 16);
      pile.push("\u0000" + latin.decode(o));
      i = j + 1;
      continue;
    }
    if (c === 0x5b || c === 0x5d) { pile.push(c === 0x5b ? "[" : "]"); i++; continue; }
    // Jeton : nombre, nom ou opérateur.
    let j = i;
    if (c === 0x2f) j++;
    while (j < b.length && !estDelim(b[j])) j++;
    if (j === i) { i++; continue; }
    const jeton = latin.decode(b.subarray(i, j));
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(jeton)) { pile.push(Number(jeton)); continue; }
    if (jeton.startsWith("/")) { pile.push(jeton); continue; }
    const nombres = () => pile.filter((v): v is number => typeof v === "number");
    switch (jeton) {
      case "BT":
        x = y = debutX = debutY = 0;
        break;
      case "Tm": {
        const n = nombres();
        x = debutX = n[n.length - 2] ?? 0;
        y = debutY = n[n.length - 1] ?? 0;
        break;
      }
      case "Td":
      case "TD": {
        const n = nombres();
        x = debutX = debutX + (n[n.length - 2] ?? 0);
        y = debutY = debutY + (n[n.length - 1] ?? 0);
        break;
      }
      case "Tj":
      case "'":
      case '"': {
        const s = pile.filter((v): v is string => typeof v === "string" && v.startsWith("\u0000"));
        if (s.length) poser(s[s.length - 1].slice(1));
        break;
      }
      case "TJ": {
        const texte = pile
          .filter((v): v is string => typeof v === "string" && v.startsWith("\u0000"))
          .map((v) => v.slice(1))
          .join("");
        poser(texte);
        break;
      }
    }
    pile.length = 0;
  }
  return res;
}

function trouver(b: Uint8Array, motif: string, depuis: number): number {
  const m = new TextEncoder().encode(motif);
  outer: for (let i = depuis; i <= b.length - m.length; i++) {
    for (let k = 0; k < m.length; k++) if (b[i + k] !== m[k]) continue outer;
    return i;
  }
  return -1;
}

/** Tous les flux du fichier, décompressés quand ils sont en FlateDecode. */
async function flux(pdf: Uint8Array, inflate: Inflate): Promise<Uint8Array[]> {
  const res: Uint8Array[] = [];
  let i = 0;
  for (;;) {
    const s = trouver(pdf, "stream", i);
    if (s < 0) break;
    // « endstream » contient aussi « stream » : on ne garde que les débuts.
    if (s >= 3 && latin.decode(pdf.subarray(s - 3, s)) === "end") { i = s + 6; continue; }
    const dico = latin.decode(pdf.subarray(Math.max(0, s - 400), s));
    let d = s + 6;
    if (pdf[d] === 13) d++;
    if (pdf[d] === 10) d++;
    const f = trouver(pdf, "endstream", d);
    if (f < 0) break;
    let brut = pdf.subarray(d, f);
    // Longueur exacte si elle est donnée en clair.
    const lg = /\/Length\s+(\d+)(?!\s+\d+\s+R)[^<]*$/.exec(dico.slice(dico.lastIndexOf("<<")));
    if (lg && Number(lg[1]) <= brut.length) brut = pdf.subarray(d, d + Number(lg[1]));
    const dernier = dico.slice(dico.lastIndexOf("<<"));
    try {
      res.push(/FlateDecode/.test(dernier) ? await inflate(brut) : brut);
    } catch {
      // Flux illisible (image, police…) : sans intérêt ici.
    }
    i = f + 9;
  }
  return res;
}

const nombreFr = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));
const CONSERVATION = /^(surgel[ée]|frais|ambiant)$/i;

/** Lit un bon Adoria. Lève une erreur si le fichier n'en est pas un. */
export async function lireBonAdoria(pdf: Uint8Array, inflate: Inflate): Promise<BonAdoria> {
  if (latin.decode(pdf.subarray(0, 5)) !== "%PDF-") throw new Error("Ce fichier n'est pas un PDF.");
  const lignes: LigneAdoria[] = [];
  let numero: string | null = null;
  let livraison: string | null = null;
  for (const contenu of await flux(pdf, inflate)) {
    const morceaux = morceauxDuFlux(contenu);
    if (!morceaux.length) continue;
    // Regroupement par ligne : même ordonnée, à 2 points près.
    const rangees: Morceau[][] = [];
    for (const m of [...morceaux].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const r = rangees.find((r) => Math.abs(r[0].y - m.y) <= 2);
      if (r) r.push(m);
      else rangees.push([m]);
    }
    for (const r of rangees) {
      r.sort((a, b) => a.x - b.x);
      const t = r.map((m) => m.texte.trim());
      const tout = t.join(" ");
      const n = /BON DE COMMANDE N\s*:\s*(\d+)/.exec(tout);
      if (n) numero = n[1];
      const l = /A LIVRER LE\s*:?\s*(\d{2}\/\d{2}\/\d{4})/.exec(tout);
      if (l) livraison = l[1];
      if (!/^\d{5,10}$/.test(t[0] ?? "")) continue;
      const iCons = t.findIndex((v, k) => k > 0 && CONSERVATION.test(v));
      if (iCons < 0) continue;
      const qt = nombreFr(t[iCons + 1] ?? "");
      if (!Number.isFinite(qt)) continue;
      lignes.push({
        code: t[0],
        designation: t.slice(1, iCons).join(" ").replace(/\s+/g, " "),
        qt,
        conditionnement: t[iCons + 2] ?? "",
      });
    }
  }
  if (!lignes.length && !numero) {
    throw new Error("Ce PDF ne ressemble pas à un bon de commande Adoria.");
  }
  return { numero, livraison, lignes };
}

/** Décompression avec l'API du navigateur. */
export const inflateNavigateur: Inflate = async (donnees) => {
  const ds = new DecompressionStream("deflate");
  const flux = new Blob([donnees as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(flux).arrayBuffer());
};
