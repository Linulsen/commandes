import { redirect } from "next/navigation";
import Entete from "../../Entete";
import { appareilCourant } from "@/lib/appareil";
import {
  adminActif,
  changerCodeAdmin,
  changerStatut,
  codeAdminExiste,
  creerCodeAdmin,
  fermerAdmin,
  listeAppareils,
  ouvrirAdmin,
  redefinirCodeResponsable,
  verifierCodeAdmin,
  type FicheAppareil,
} from "@/lib/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGES: Record<string, string> = {
  refuse: "Code incorrect.",
  bloque: "Trop d’essais : réessayez dans 15 minutes.",
  trop_court: "Le code doit faire au moins 4 caractères.",
  differents: "Les deux saisies du nouveau code ne sont pas identiques.",
  deja_cree: "Le code Administrateur existe déjà.",
  soi: "Vous ne pouvez pas retirer l’appareil que vous utilisez.",
  code_change: "Code Administrateur changé.",
  code_cree: "Code Administrateur créé.",
  responsable_change: "Code responsable changé.",
};

function quand(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * Appareils autorisés à utiliser l'appli, réservée à l'administrateur.
 */
export default async function PageAppareils({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  const moi = await appareilCourant();
  const actif = await adminActif();
  const codeCree = await codeAdminExiste();

  async function entrer(formData: FormData) {
    "use server";
    const r = await verifierCodeAdmin(String(formData.get("code") ?? ""));
    if (r !== "ok") redirect(`/admin/appareils?message=${r}`);
    await ouvrirAdmin();
    redirect("/admin/appareils");
  }

  async function creer(formData: FormData) {
    "use server";
    const nouveau = String(formData.get("nouveau") ?? "");
    if (nouveau !== String(formData.get("confirmation") ?? "")) {
      redirect("/admin/appareils?message=differents");
    }
    const r = await creerCodeAdmin(String(formData.get("responsable") ?? ""), nouveau);
    if (r !== "ok") redirect(`/admin/appareils?message=${r}`);
    await ouvrirAdmin();
    redirect("/admin/appareils?message=code_cree");
  }

  async function statut(formData: FormData) {
    "use server";
    if (!(await adminActif())) redirect("/admin/appareils");
    const id = String(formData.get("id") ?? "");
    const action = String(formData.get("action") ?? "");
    if (!UUID.test(id)) redirect("/admin/appareils");
    const qui = await appareilCourant();
    if (action === "retirer" && qui?.id === id) redirect("/admin/appareils?message=soi");
    await changerStatut(
      id,
      action === "retirer" ? "retire" : "autorise",
      `${qui?.prenom ?? "?"}, page Appareils`,
    );
    await ouvrirAdmin(); // chaque action prolonge la session de 10 minutes
    redirect("/admin/appareils");
  }

  async function changerCode(formData: FormData) {
    "use server";
    if (!(await adminActif())) redirect("/admin/appareils");
    const nouveau = String(formData.get("nouveau") ?? "");
    if (nouveau !== String(formData.get("confirmation") ?? "")) {
      redirect("/admin/appareils?message=differents");
    }
    const r = await changerCodeAdmin(String(formData.get("ancien") ?? ""), nouveau);
    redirect(`/admin/appareils?message=${r === "ok" ? "code_change" : r}`);
  }

  async function changerResponsable(formData: FormData) {
    "use server";
    if (!(await adminActif())) redirect("/admin/appareils");
    const nouveau = String(formData.get("nouveau") ?? "");
    if (nouveau !== String(formData.get("confirmation") ?? "")) {
      redirect("/admin/appareils?message=differents");
    }
    const r = await redefinirCodeResponsable(nouveau);
    await ouvrirAdmin();
    redirect(`/admin/appareils?message=${r === "ok" ? "responsable_change" : r}`);
  }

  async function quitter() {
    "use server";
    await fermerAdmin();
    redirect("/");
  }

  const texte = message ? MESSAGES[message] : null;
  const champ =
    "mt-1 min-h-12 w-full rounded-xl border-2 border-neutre-200 bg-white px-3 text-base outline-none focus:border-rouge-700";

  if (!actif) {
    return (
      <main>
        <Entete
          titre="Appareils"
          sousTitre="Réservé à l’administrateur"
          retour={{ href: "/", libelle: "Accueil" }}
        />
        <div className="mx-auto max-w-md space-y-3 px-4 py-6">
          {texte ? (
            <p className="rounded-xl bg-ambre-50 px-4 py-3 text-sm font-semibold text-ambre-700">{texte}</p>
          ) : null}
          {codeCree ? (
            <form action={entrer} className="rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm">
              <label className="block text-sm font-semibold">
                Code Administrateur
                <input name="code" type="password" inputMode="numeric" autoComplete="off" autoFocus className={champ} />
              </label>
              <button className="mt-4 min-h-12 w-full rounded-xl bg-rouge-700 font-titre text-sm font-semibold text-white">
                Entrer
              </button>
            </form>
          ) : (
            <form action={creer} className="rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm">
              <h2 className="font-titre text-base font-semibold">Créer le code Administrateur</h2>
              <p className="mt-1 text-sm leading-relaxed text-neutre-500">
                Une seule fois. Le code responsable est demandé pour prouver que c’est bien
                vous ; le code Administrateur reste ensuite distinct.
              </p>
              <label className="mt-3 block text-sm font-semibold">
                Code responsable
                <input name="responsable" type="password" autoComplete="off" className={champ} />
              </label>
              <label className="mt-3 block text-sm font-semibold">
                Nouveau code Administrateur (4 caractères au moins)
                <input name="nouveau" type="password" autoComplete="new-password" className={champ} />
              </label>
              <label className="mt-3 block text-sm font-semibold">
                Retapez le nouveau code
                <input name="confirmation" type="password" autoComplete="new-password" className={champ} />
              </label>
              <button className="mt-4 min-h-12 w-full rounded-xl bg-rouge-700 font-titre text-sm font-semibold text-white">
                Créer le code
              </button>
            </form>
          )}
        </div>
      </main>
    );
  }

  const appareils = await listeAppareils();
  const enAttente = appareils.filter((a) => a.statut === "en_attente").length;

  return (
    <main style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}>
      <Entete
        titre="Appareils"
        sousTitre={`${appareils.filter((a) => a.statut === "autorise").length} autorisé(s)${enAttente ? ` · ${enAttente} en attente` : ""}`}
        retour={{ href: "/", libelle: "Accueil" }}
      />
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        {texte ? (
          <p className="rounded-xl bg-ambre-50 px-4 py-3 text-sm font-semibold text-ambre-700">{texte}</p>
        ) : null}

        <ul className="overflow-hidden rounded-2xl border border-neutre-100 bg-white shadow-sm">
          {appareils.map((a) => (
            <LigneAppareil key={a.id} a={a} moi={a.id === moi?.id} action={statut} />
          ))}
        </ul>

        <details className="rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-titre text-sm font-semibold">
            Changer le code Administrateur
          </summary>
          <form action={changerCode} className="mt-3">
            <label className="block text-sm font-semibold">
              Code actuel
              <input name="ancien" type="password" autoComplete="off" className={champ} />
            </label>
            <label className="mt-3 block text-sm font-semibold">
              Nouveau code (4 caractères au moins)
              <input name="nouveau" type="password" autoComplete="new-password" className={champ} />
            </label>
            <label className="mt-3 block text-sm font-semibold">
              Retapez le nouveau code
              <input name="confirmation" type="password" autoComplete="new-password" className={champ} />
            </label>
            <button className="mt-4 min-h-12 w-full rounded-xl bg-neutre-900 font-titre text-sm font-semibold text-white">
              Changer le code
            </button>
          </form>
        </details>

        <details className="rounded-2xl border border-neutre-100 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-titre text-sm font-semibold">
            Changer le code responsable
          </summary>
          <p className="mt-2 text-sm leading-relaxed text-neutre-500">
            Le code responsable protège l’inventaire. En tant qu’administrateur, vous le
            remplacez sans avoir à connaître l’ancien.
          </p>
          <form action={changerResponsable} className="mt-3">
            <label className="block text-sm font-semibold">
              Nouveau code responsable (4 caractères au moins)
              <input name="nouveau" type="password" autoComplete="new-password" className={champ} />
            </label>
            <label className="mt-3 block text-sm font-semibold">
              Retapez le nouveau code
              <input name="confirmation" type="password" autoComplete="new-password" className={champ} />
            </label>
            <button className="mt-4 min-h-12 w-full rounded-xl bg-neutre-900 font-titre text-sm font-semibold text-white">
              Changer le code responsable
            </button>
          </form>
        </details>

        <form action={quitter}>
          <button className="min-h-12 w-full rounded-xl border border-neutre-200 bg-white text-sm font-semibold text-neutre-700">
            Quitter le mode administrateur
          </button>
        </form>
        <p className="px-1 text-xs leading-relaxed text-neutre-500">
          Un appareil retiré est bloqué dans les 5 minutes. Le mode administrateur se ferme
          seul après 10 minutes sans action.
        </p>
      </div>
    </main>
  );
}

function LigneAppareil({
  a,
  moi,
  action,
}: {
  a: FicheAppareil;
  moi: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  const pastille =
    a.statut === "autorise"
      ? "bg-vert-100 text-vert-800"
      : a.statut === "en_attente"
        ? "bg-ambre-50 text-ambre-700"
        : "bg-neutre-100 text-neutre-500";
  const libelle = a.statut === "autorise" ? "autorisé" : a.statut === "en_attente" ? "en attente" : "retiré";
  return (
    <li className="border-b border-neutre-100 px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-titre text-sm font-semibold leading-snug">
            {a.nom}
            {moi ? <span className="font-normal text-neutre-500"> · cet appareil</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-neutre-500">
            {a.type ?? "type inconnu"} · {a.prenom ?? "?"} · vu {quand(a.derniere_connexion)}
          </p>
          <p className="mt-0.5 text-xs text-neutre-500">
            {a.statut === "autorise"
              ? `autorisé ${quand(a.autorise_le)}${a.autorise_par ? ` (${a.autorise_par})` : ""}`
              : a.statut === "retire"
                ? `retiré ${quand(a.retire_le)}`
                : `apparu ${quand(a.premiere_connexion)}`}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${pastille}`}>{libelle}</span>
      </div>
      <form action={action} className="mt-2 flex justify-end">
        <input type="hidden" name="id" value={a.id} />
        {a.statut === "autorise" ? (
          moi ? null : (
            <button
              name="action"
              value="retirer"
              className="min-h-10 rounded-xl border border-rouge-200 px-3 text-sm font-semibold text-rouge-700"
            >
              Retirer
            </button>
          )
        ) : (
          <button
            name="action"
            value="autoriser"
            className="min-h-10 rounded-xl bg-vert-700 px-3 text-sm font-semibold text-white"
          >
            Autoriser
          </button>
        )}
      </form>
    </li>
  );
}
