/*
 * Service worker de Praedic Commandes : l'application doit s'ouvrir sans
 * réseau, en chambre froide comme en réserve.
 *
 * - Pages : réseau d'abord, avec un délai court ; à défaut, la dernière copie
 *   gardée. Les saisies faites hors ligne sont conservées à part par la page
 *   (localStorage) et reprennent leur place par-dessus cette copie.
 * - Fichiers de l'application (/_next/static) : cache d'abord. Leur nom change
 *   à chaque version, une copie gardée n'est donc jamais périmée.
 * - API : jamais mises en cache. Les envois de saisies ont leur propre file
 *   d'attente, qui retente.
 */
const PAGES = "cmd-pages-v1";
const STATIQUES = "cmd-statiques-v1";
const DELAI_RESEAU = 4000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const HORS_LIGNE = `<!doctype html><html lang="fr"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hors ligne</title>
<body style="font-family:system-ui,sans-serif;background:#f6f6f6;color:#1d1d1d;margin:0;padding:48px 24px">
<p style="font-weight:700;color:#d50032;letter-spacing:.2em;font-size:12px">DEL ARTE</p>
<h1 style="font-size:24px;margin:.2em 0">Pas de réseau</h1>
<p>Cette page n’a pas encore été ouverte sur ce téléphone, elle n’est donc pas
disponible hors ligne. Les relevés déjà ouverts le sont : revenez en arrière.</p>
<p>Vos saisies sont gardées sur le téléphone et partiront au retour du réseau.</p>
<p><a href="/" style="color:#d50032">Réessayer</a></p></body></html>`;

function avecDelai(promesse, ms) {
  return new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error("délai")), ms);
    promesse.then((r) => { clearTimeout(t); ok(r); }, (e) => { clearTimeout(t); ko(e); });
  });
}

async function page(requete) {
  const cache = await caches.open(PAGES);
  const url = new URL(requete.url);
  const cle = url.pathname;
  try {
    const reponse = await avecDelai(fetch(requete), DELAI_RESEAU);
    // Une redirection vers /connexion n'est pas la page demandée.
    if (reponse.ok && !reponse.redirected) await cache.put(cle, reponse.clone());
    return reponse;
  } catch {
    const garde = await cache.match(cle, { ignoreVary: true, ignoreSearch: true });
    return (
      garde ||
      new Response(HORS_LIGNE, {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );
  }
}

async function statique(requete) {
  const cache = await caches.open(STATIQUES);
  const garde = await cache.match(requete);
  if (garde) return garde;
  const reponse = await fetch(requete);
  if (reponse.ok) await cache.put(requete, reponse.clone());
  return reponse;
}

self.addEventListener("fetch", (e) => {
  const requete = e.request;
  if (requete.method !== "GET") return;
  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(statique(requete));
    return;
  }
  if (requete.mode === "navigate") {
    e.respondWith(page(requete));
  }
});
