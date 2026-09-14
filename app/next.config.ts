import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit lit ses métriques de police depuis le disque : il ne doit pas être
  // embarqué par le bundler, sinon la génération du bon de commande échoue.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
