-- Code responsable (étape 2 du cahier des charges « Inventaire »).
--
-- Un second code, connu du responsable seul, protège la validation des
-- articles créés depuis l'inventaire, la clôture d'un inventaire, la
-- modification d'une fiche produit et la gestion des appareils.
--
-- Le code n'est jamais stocké en clair : seule son empreinte (bcrypt, via
-- pgcrypto) est gardée dans `app_parametres`. L'empreinte elle-même est
-- enregistrée à part, jamais dans ce dépôt.
--
-- Un code court se devine en essayant toutes les combinaisons : après
-- 5 essais faux en 15 minutes, toute vérification est refusée pendant
-- 15 minutes. Chaque essai est noté dans `app_journal`.

create table if not exists app_parametres (
  cle        text primary key,
  valeur     text not null,
  modifie_le timestamptz not null default now()
);
comment on table app_parametres is
  'Réglages de l''appli réservés au serveur (ex. empreinte du code responsable).';
alter table app_parametres enable row level security;

-- Renvoie 'ok', 'refuse' ou 'bloque'.
create or replace function app_verifier_code_responsable(
  p_code text, p_appareil uuid default null, p_prenom text default null
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_empreinte text;
  v_echecs int;
begin
  select count(*) into v_echecs from app_journal
  where action = 'code_responsable_refuse' and quand > now() - interval '15 minutes';
  if v_echecs >= 5 then
    insert into app_journal (action, objet, prenom, appareil_id)
    values ('code_responsable_bloque', 'code_responsable', p_prenom, p_appareil);
    return 'bloque';
  end if;

  select valeur into v_empreinte from app_parametres where cle = 'code_responsable';
  if v_empreinte is not null and crypt(coalesce(p_code, ''), v_empreinte) = v_empreinte then
    insert into app_journal (action, objet, prenom, appareil_id)
    values ('code_responsable_accepte', 'code_responsable', p_prenom, p_appareil);
    return 'ok';
  end if;

  insert into app_journal (action, objet, prenom, appareil_id)
  values ('code_responsable_refuse', 'code_responsable', p_prenom, p_appareil);
  return 'refuse';
end;
$$;

-- Change le code (il faut connaître l'ancien). Renvoie comme la vérification.
create or replace function app_changer_code_responsable(
  p_ancien text, p_nouveau text, p_appareil uuid default null, p_prenom text default null
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_resultat text;
begin
  if p_nouveau is null or length(p_nouveau) < 4 then
    return 'trop_court';
  end if;
  v_resultat := app_verifier_code_responsable(p_ancien, p_appareil, p_prenom);
  if v_resultat <> 'ok' then
    return v_resultat;
  end if;
  update app_parametres set valeur = crypt(p_nouveau, gen_salt('bf')), modifie_le = now()
  where cle = 'code_responsable';
  insert into app_journal (action, objet, prenom, appareil_id)
  values ('code_responsable_change', 'code_responsable', p_prenom, p_appareil);
  return 'ok';
end;
$$;

revoke all on function app_verifier_code_responsable(text, uuid, text) from public, anon, authenticated;
revoke all on function app_changer_code_responsable(text, text, uuid, text) from public, anon, authenticated;
grant execute on function app_verifier_code_responsable(text, uuid, text) to service_role;
grant execute on function app_changer_code_responsable(text, text, uuid, text) to service_role;
