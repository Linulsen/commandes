/**
 * Prénom et nom de l'appareil, demandés à la connexion et sur /appareil.
 * Sur fond rouge (écrans de connexion), comme le champ du code.
 */
export function ChampsAppareil({ prenom, nom }: { prenom: string; nom: string }) {
  const champ =
    "mt-2 min-h-13 w-full rounded-xl border border-rouge-800 bg-rouge-800 px-4 py-3 text-base text-white placeholder:text-rouge-200 outline-none focus:border-white";
  return (
    <>
      <label htmlFor="prenom" className="mt-5 block text-sm font-semibold">
        Votre prénom
      </label>
      <input
        id="prenom"
        name="prenom"
        required
        maxLength={40}
        defaultValue={prenom}
        autoComplete="given-name"
        autoCapitalize="words"
        className={champ}
      />

      <label htmlFor="nom" className="mt-5 block text-sm font-semibold">
        Nom de cet appareil
      </label>
      <input
        id="nom"
        name="nom"
        required
        maxLength={40}
        defaultValue={nom}
        placeholder="ex. Tablette cuisine, iPhone Nicolas"
        autoComplete="off"
        autoCapitalize="sentences"
        className={champ}
      />
      <p className="mt-2 text-xs text-rouge-50">
        Sert à savoir qui a saisi quoi, et depuis quel appareil.
      </p>
    </>
  );
}
