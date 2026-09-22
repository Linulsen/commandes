import type { Metadata, Viewport } from "next";
import { Jost, Nunito_Sans } from "next/font/google";
import "./globals.css";
import HorsLigne from "./HorsLigne";

// Les deux polices de Del Arte disponibles librement. Leur police de titrage
// maison, Bely Display, est sous licence commerciale : Jost en tient lieu.
const titre = Jost({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--police-titre",
  display: "swap",
});

const texte = Nunito_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--police-texte",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Commandes — Del Arte",
  description:
    "Relevé des chambres, prévision des consommations et bons de commande du restaurant.",
  appleWebApp: { capable: true, title: "Commandes", statusBarStyle: "default" },
  icons: { icon: "/icone.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // L'application occupe toute la dalle ; les encoches et la barre gestuelle
  // sont gérées au cas par cas avec env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: "#d50032",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={`${titre.variable} ${texte.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        {children}
        <HorsLigne />
      </body>
    </html>
  );
}
