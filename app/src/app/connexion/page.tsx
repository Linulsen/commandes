import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_DUREE, COOKIE_NOM, creerJeton } from "@/lib/auth";

export default async function Connexion({
  searchParams,
}: {
  searchParams: Promise<{ suite?: string; erreur?: string }>;
}) {
  const { suite, erreur } = await searchParams;

  async function entrer(formData: FormData) {
    "use server";
    const code = String(formData.get("code") ?? "");
    const destination = String(formData.get("suite") ?? "/") || "/";
    if (code !== process.env.ACCESS_CODE) {
      redirect(
        `/connexion?erreur=1&suite=${encodeURIComponent(destination)}`,
      );
    }
    (await cookies()).set(COOKIE_NOM, await creerJeton(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_DUREE,
    });
    redirect(destination);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Praedic Commandes
      </h1>
      <p className="mt-2 text-sm text-ardoise-600">
        Relevé des chambres et commandes du restaurant.
      </p>
      <form action={entrer} className="mt-8 space-y-4">
        <input type="hidden" name="suite" value={suite ?? "/"} />
        <div>
          <label
            htmlFor="code"
            className="block text-sm font-medium text-ardoise-800"
          >
            Code d’accès
          </label>
          <input
            id="code"
            name="code"
            type="password"
            autoFocus
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-ardoise-200 bg-white px-3 py-3 text-base outline-none focus:border-ardoise-800"
          />
        </div>
        {erreur ? (
          <p className="text-sm text-braise-600">Code incorrect.</p>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-lg bg-ardoise-900 px-4 py-3 font-medium text-white"
        >
          Entrer
        </button>
      </form>
    </main>
  );
}
