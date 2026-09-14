const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

export function dateCourte(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`;
}

export function dateLongue(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Les quantités sont parfois au dixième (kilos, bidons entamés). */
export function qte(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const arrondi = Math.round(n * 100) / 100;
  return Number.isInteger(arrondi)
    ? String(arrondi)
    : arrondi.toFixed(2).replace(/0$/, "").replace(".", ",");
}
