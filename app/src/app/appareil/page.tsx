import { redirect } from "next/navigation";
import { appareilCourant, nettoyer, nomAppareil, presenterAppareil } from "@/lib/appareil";
import { ChampsAppareil } from "./ChampsAppareil";

export const dynamic = "force-dynamic";

/**
 * Présentation de l'appareil : demandée une fois aux appareils déjà connectés
 * avant l'arrivée de l'inventaire, et ouverte depuis l'accueil pour changer de
 * prénom (tablette partagée) ou renommer l'appareil.
 */
export default async function PageAppareil({
  searchParams,
}: {
  searchParams: Promise<{ suite?: string; erreur?: string }>;
}) {
  const { suite, erreur } = await searchParams;
  const appareil = await appareilCourant();
  const nom = appareil ? await nomAppareil(appareil.id).catch(() => null) : null;

  async function enregistrer(formData: FormData) {
    "use server";
    const destination = String(formData.get("suite") ?? "/") || "/";
    const prenom = nettoyer(formData.get("prenom"));
    const nomSaisi = nettoyer(formData.get("nom"));
    if (!prenom || !nomSaisi) {
      redirect(`/appareil?erreur=1&suite=${encodeURIComponent(destination)}`);
    }
    const deja = await appareilCourant();
    await presenterAppareil(nomSaisi, prenom, deja ? "appareil_modifie" : "appareil_enregistre");
    redirect(destination.startsWith("/") ? destination : "/");
  }

  return (
    <main className="flex min-h-screen flex-col bg-rouge-700 text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <p className="font-titre text-xs font-bold uppercase tracking-[0.22em] text-rouge-50">
          Del Arte
        </p>
        <h1 className="mt-2 font-titre text-3xl font-semibold leading-tight tracking-tight">
          {appareil ? "Qui utilise cet appareil ?" : "Présentez cet appareil"}
        </h1>
        <p className="mt-2 text-sm text-rouge-50">
          {appareil
            ? "Changez de prénom quand vous prenez l’appareil d’un collègue."
            : "Une seule fois : l’appli en a besoin pour l’inventaire."}
        </p>

        <form action={enregistrer} className="mt-6">
          <input type="hidden" name="suite" value={suite ?? "/"} />
          <ChampsAppareil prenom={appareil?.prenom ?? ""} nom={nom ?? ""} />
          {erreur ? (
            <p className="mt-2 text-sm font-semibold text-rouge-50">
              Indiquez votre prénom et le nom de cet appareil.
            </p>
          ) : null}
          <button
            type="submit"
            className="mt-6 min-h-13 w-full rounded-xl bg-white px-4 py-3 font-titre text-base font-semibold text-rouge-700"
          >
            Enregistrer
          </button>
        </form>
      </div>
    </main>
  );
}
