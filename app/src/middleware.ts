import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NOM, jetonValide } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/connexion" || pathname === "/api/connexion") {
    return NextResponse.next();
  }
  if (await jetonValide(req.cookies.get(COOKIE_NOM)?.value)) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ erreur: "Accès refusé" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/connexion";
  url.searchParams.set("suite", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Le service worker, le manifeste et les icônes doivent se charger avant
  // toute connexion : le navigateur les demande sans cookie.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icone.svg|icone-192.png|icone-512.png|icone-masquable-512.png|apple-touch-icon.png).*)"],
};
