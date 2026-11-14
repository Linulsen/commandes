import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit lit ses métriques de police depuis le disque : il ne doit pas être
  // embarqué par le bundler, sinon la génération du bon de commande échoue.
  serverExternalPackages: ["pdfkit"],
  // Outil interne : aucune page ne doit apparaître dans les moteurs de
  // recherche (audit du 14/11/2026).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
