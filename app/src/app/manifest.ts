import type { MetadataRoute } from "next";

/** Installable sur l'écran d'accueil du téléphone, sans barre de navigateur. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Commandes — Del Arte",
    short_name: "Commandes",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f6f6",
    theme_color: "#d50032",
    lang: "fr",
    icons: [
      { src: "/icone.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icone-masquable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
