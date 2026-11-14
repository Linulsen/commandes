/**
 * Destination après connexion ou présentation de l'appareil (paramètre
 * « suite »). Seuls les chemins de l'appli sont acceptés : « //site.com » ou
 * « /\site.com » seraient compris par le navigateur comme un autre site
 * (redirection ouverte, audit du 14/11/2026).
 */
export function cheminInterne(valeur: unknown, defaut = "/"): string {
  const s = typeof valeur === "string" ? valeur.trim() : "";
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return defaut;
  if (/[\u0000-\u001f]/.test(s)) return defaut;
  return s;
}
