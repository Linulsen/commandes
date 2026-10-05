import { NextResponse, type NextRequest } from "next/server";
import {
  AUTORISE_DUREE_MS,
  COOKIE_APPAREIL,
  COOKIE_AUTORISE,
  COOKIE_NOM,
  creerJetonAppareil,
  jetonAppareilValide,
  jetonValide,
} from "@/lib/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Statut de l'appareil dans la base : 'autorise', 'en_attente', 'retire',
 * 'inconnu' (jamais enregistré), ou null si la base n'a pas répondu.
 */
async function statutAppareil(id: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cle) return null;
  try {
    const r = await fetch(
      `${url}/rest/v1/app_appareils?id=eq.${id}&select=statut`,
      { headers: { apikey: cle, Authorization: `Bearer ${cle}` }, cache: "no-store" },
    );
    if (!r.ok) return null;
    const lignes = (await r.json()) as { statut: string }[];
    return lignes[0]?.statut ?? "inconnu";
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/connexion" || pathname === "/api/connexion") {
    return NextResponse.next();
  }
  if (await jetonValide(req.cookies.get(COOKIE_NOM)?.value)) {
    const appareil = req.cookies.get(COOKIE_APPAREIL)?.value;
    // Un appareil connecté avant l'inventaire n'a jamais donné son nom ni le
    // prénom de son utilisateur : on le lui demande une fois, à l'ouverture
    // d'une page. Les envois en attente (routes d'API) passent toujours, pour
    // ne perdre aucune saisie faite hors ligne.
    if (!appareil || !UUID.test(appareil)) {
      if (pathname.startsWith("/api/") || pathname === "/appareil") return NextResponse.next();
      return rediriger(req, "/appareil");
    }

    // Présentation de l'appareil et page d'attente : toujours accessibles.
    if (pathname === "/appareil" || pathname === "/appareil/attente") {
      return NextResponse.next();
    }

    // Appareil autorisé ? Le cookie signé dispense de relire la base.
    if (
      await jetonAppareilValide(req.cookies.get(COOKIE_AUTORISE)?.value, appareil, AUTORISE_DUREE_MS)
    ) {
      return NextResponse.next();
    }
    const statut = await statutAppareil(appareil);
    if (statut === "autorise") {
      const res = NextResponse.next();
      res.cookies.set(COOKIE_AUTORISE, await creerJetonAppareil(appareil), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 3600,
      });
      return res;
    }
    // Base injoignable : on laisse passer plutôt que de bloquer toute l'équipe
    // pendant un service. L'appareil sera revérifié à la requête suivante.
    if (statut === null) {
      console.error("Statut de l'appareil illisible, accès laissé ouvert :", appareil);
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { erreur: "Appareil non autorisé" },
        { status: 403 },
      );
    }
    return rediriger(req, statut === "inconnu" ? "/appareil" : "/appareil/attente");
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ erreur: "Accès refusé" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/connexion";
  url.searchParams.set("suite", pathname);
  return NextResponse.redirect(url);
}

function rediriger(req: NextRequest, vers: string) {
  const url = req.nextUrl.clone();
  url.pathname = vers;
  url.search = "";
  url.searchParams.set("suite", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Le service worker, le manifeste et les icônes doivent se charger avant
  // toute connexion : le navigateur les demande sans cookie.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icone.svg|icone-192.png|icone-512.png|icone-masquable-512.png|apple-touch-icon.png).*)"],
};
