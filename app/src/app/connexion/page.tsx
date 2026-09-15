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
      redirect(`/connexion?erreur=1&suite=${encodeURIComponent(destination)}`);
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
    <main className="flex min-h-screen flex-col bg-rouge-700 text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <p className="font-titre text-xs font-bold uppercase tracking-[0.22em] text-rouge-50">
          Del Arte
        </p>
        <h1 className="mt-2 font-titre text-3xl font-semibold leading-tight tracking-tight">
          Commandes
        </h1>
        <p className="mt-2 text-sm text-rouge-50">
          Relevé des chambres et quantités à commander.
        </p>

        <form action={entrer} className="mt-8">
          <input type="hidden" name="suite" value={suite ?? "/"} />
          <label htmlFor="code" className="block text-sm font-semibold">
            Code d’accès
          </label>
          <input
            id="code"
            name="code"
            type="password"
            autoFocus
            autoComplete="current-password"
            className="mt-2 min-h-13 w-full rounded-xl border border-rouge-800 bg-rouge-800 px-4 py-3 text-base text-white placeholder:text-rouge-200 outline-none focus:border-white"
          />
          {erreur ? (
            <p className="mt-2 text-sm font-semibold text-rouge-50">
              Code incorrect.
            </p>
          ) : null}
          <button
            type="submit"
            className="mt-4 min-h-13 w-full rounded-xl bg-white px-4 py-3 font-titre text-base font-semibold text-rouge-700"
          >
            Entrer
          </button>
        </form>
      </div>
    </main>
  );
}
