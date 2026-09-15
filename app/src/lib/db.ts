import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./schema";

let client: SupabaseClient<Database> | null = null;

/**
 * Client Supabase à clé de service. Les tables sont en RLS sans policy : rien
 * n'est lisible depuis le navigateur, tout passe par les composants serveur et
 * les routes d'API de cette application.
 *
 * Il est créé au premier appel, pas au chargement du module : la compilation
 * Next importe les routes pour les analyser, sans jamais disposer des secrets.
 */
export function sb() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !cle) {
      throw new Error(
        "SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis.",
      );
    }
    client = createClient<Database>(url, cle, {
      auth: { persistSession: false },
    });
  }
  return client;
}

type Paginable<T> = {
  range(
    de: number,
    a: number,
  ): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
};

/**
 * Lit une requête en entier, page par page, PostgREST plafonnant une réponse à
 * 1000 lignes.
 *
 * La requête DOIT porter un tri sur une colonne unique — `id` en pratique. Sans
 * tri total, deux pages successives ne voient pas le même ordre : des lignes
 * reviennent deux fois et d'autres jamais. Trier sur la seule date d'une
 * commande avait fait lire 3 571 relevés dont 45 en double et 45 absents.
 *
 * La requête est reconstruite à chaque page parce qu'un constructeur PostgREST
 * ne se rejoue pas : une fois attendu, il est consommé.
 */
export async function selectAll<T>(
  construire: () => Paginable<T>,
): Promise<T[]> {
  const out: T[] = [];
  const taille = 1000;
  for (let de = 0; ; de += taille) {
    const { data, error } = await construire().range(de, de + taille - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < taille) return out;
  }
}
