import { redirect } from "next/navigation";
import { appareilCourant } from "@/lib/appareil";
import { changerStatut, codeAdminExiste, ficheAppareil, verifierCodeAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Un appareil qui connaît le code d'accès mais que l'administrateur n'a pas
 * (encore) autorisé, ou qu'il a retiré. On peut l'autoriser ici en tapant le
 * code Administrateur, ou depuis la page Appareils d'un autre appareil.
 */
export default async function PageAttente({
  searchParams,
}: {
  searchParams: Promise<{ suite?: string; erreur?: string }>;
}) {
  const { suite, erreur } = await searchParams;
  const destination = suite && suite.startsWith("/") && !suite.startsWith("/appareil") ? suite : "/";
  const moi = await appareilCourant();
  if (!moi) redirect(`/appareil?suite=${encodeURIComponent(destination)}`);
  const fiche = await ficheAppareil(moi.id);
  if (!fiche) redirect(`/appareil?suite=${encodeURIComponent(destination)}`);
  if (fiche.statut === "autorise") redirect(destination);
  const codeCree = await codeAdminExiste();

  async function autoriser(formData: FormData) {
    "use server";
    const code = String(formData.get("code") ?? "");
    const retour = String(formData.get("suite") ?? "/");
    const resultat = await verifierCodeAdmin(code);
    if (resultat !== "ok") {
      redirect(`/appareil/attente?erreur=${resultat}&suite=${encodeURIComponent(retour)}`);
    }
    const qui = await appareilCourant();
    if (!qui) redirect("/appareil");
    await changerStatut(qui.id, "autorise", `${qui.prenom ?? "?"}, code Administrateur sur l’appareil`);
    redirect(retour);
  }

  const retire = fiche.statut === "retire";

  return (
    <main className="flex min-h-screen flex-col bg-rouge-700 text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <p className="font-titre text-xs font-bold uppercase tracking-[0.22em] text-rouge-50">
          Del Arte
        </p>
        <h1 className="mt-2 font-titre text-3xl font-semibold leading-tight tracking-tight">
          {retire ? "Appareil retiré" : "Appareil en attente"}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-rouge-50">
          « {fiche.nom} »{" "}
          {retire
            ? "a été retiré de la liste des appareils autorisés."
            : "doit être autorisé par l’administrateur avant de pouvoir utiliser l’appli."}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-rouge-50">
          L’administrateur peut l’autoriser depuis la page « Appareils » de son téléphone,
          ou taper ici le code Administrateur.
        </p>

        {codeCree ? (
          <form action={autoriser} className="mt-6">
            <input type="hidden" name="suite" value={destination} />
            <label htmlFor="code" className="block text-sm font-semibold">
              Code Administrateur
            </label>
            <input
              id="code"
              name="code"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              className="mt-2 min-h-13 w-full rounded-xl border border-rouge-800 bg-rouge-800 px-4 py-3 text-base text-white outline-none focus:border-white"
            />
            {erreur === "refuse" ? (
              <p className="mt-2 text-sm font-semibold text-rouge-50">Code incorrect.</p>
            ) : erreur === "bloque" ? (
              <p className="mt-2 text-sm font-semibold text-rouge-50">
                Trop d’essais : réessayez dans 15 minutes.
              </p>
            ) : null}
            <button
              type="submit"
              className="mt-4 min-h-13 w-full rounded-xl bg-white px-4 py-3 font-titre text-base font-semibold text-rouge-700"
            >
              Autoriser cet appareil
            </button>
          </form>
        ) : (
          <p className="mt-6 rounded-xl bg-rouge-800 px-4 py-3 text-sm leading-relaxed">
            Le code Administrateur n’a pas encore été créé : le responsable le crée depuis la
            page « Appareils » d’un appareil déjà autorisé.
          </p>
        )}

        <a
          href={`/appareil/attente?suite=${encodeURIComponent(destination)}`}
          className="mt-6 text-center text-sm text-rouge-50 underline underline-offset-4"
        >
          Déjà autorisé ? Actualiser
        </a>
      </div>
    </main>
  );
}
