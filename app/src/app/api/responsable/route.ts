import { NextResponse } from "next/server";
import { ouvrirResponsable, verifierCodeResponsable } from "@/lib/responsable";

/** Vérifie le code responsable et ouvre la session responsable (15 minutes). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code) return NextResponse.json({ erreur: "Tapez le code responsable." }, { status: 400 });
  try {
    const r = await verifierCodeResponsable(code);
    if (r === "ok") {
      await ouvrirResponsable();
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(
      {
        erreur:
          r === "bloque"
            ? "Trop d’essais. Réessayez dans 15 minutes."
            : "Code responsable incorrect.",
      },
      { status: 403 },
    );
  } catch (e) {
    return NextResponse.json(
      { erreur: e instanceof Error ? e.message : "Échec" },
      { status: 500 },
    );
  }
}
