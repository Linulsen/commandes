-- Appareils autorisés et code Administrateur.
--
-- Jusqu'ici, tout appareil qui connaissait le code partagé entrait. Nicolas
-- veut décider lui-même quels appareils utilisent l'appli : un nouvel
-- appareil reste « en attente » jusqu'à ce qu'un administrateur l'autorise,
-- et un appareil perdu ou rendu peut être « retiré » sans changer le code de
-- toute l'équipe.
--
-- La gestion des appareils est protégée par un code Administrateur, distinct
-- du code responsable (qui protège l'inventaire). Il est créé une seule fois
-- depuis l'appli, en donnant le code responsable : personne d'autre que le
-- responsable ne peut donc le définir, et il n'est jamais écrit nulle part en
-- clair (empreinte bcrypt dans `app_parametres`, comme le code responsable).
-- Même protection contre les essais : 5 erreurs en 15 minutes bloquent la
-- vérification pendant 15 minutes.

alter table app_appareils
  add column if not exists statut text not null default 'en_attente'
    check (statut in ('en_attente', 'autorise', 'retire')),
  add column if not exists autorise_le timestamptz,
  add column if not exists autorise_par text,
  add column if not exists retire_le timestamptz;

comment on column app_appareils.statut is
  'en_attente : connu mais pas encore autorisé ; autorise : peut utiliser l''appli ; retire : bloqué par l''administrateur.';

-- Les appareils déjà en service restent utilisables.
update app_appareils
   set statut = 'autorise', autorise_le = now(), autorise_par = 'déjà en service le 05/10/2026'
 where statut = 'en_attente' and deconnecte_le is null;

-- Vérifie le code Administrateur. Renvoie 'ok', 'refuse', 'bloque' ou 'absent'
-- (aucun code n'a encore été créé).
create or replace function app_verifier_code_admin(
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
  select valeur into v_empreinte from app_parametres where cle = 'code_admin';
  if v_empreinte is null then
    return 'absent';
  end if;

  select count(*) into v_echecs from app_journal
  where action = 'code_admin_refuse' and quand > now() - interval '15 minutes';
  if v_echecs >= 5 then
    insert into app_journal (action, objet, prenom, appareil_id)
    values ('code_admin_bloque', 'code_admin', p_prenom, p_appareil);
    return 'bloque';
  end if;

  if crypt(coalesce(p_code, ''), v_empreinte) = v_empreinte then
    insert into app_journal (action, objet, prenom, appareil_id)
    values ('code_admin_accepte', 'code_admin', p_prenom, p_appareil);
    return 'ok';
  end if;

  insert into app_journal (action, objet, prenom, appareil_id)
  values ('code_admin_refuse', 'code_admin', p_prenom, p_appareil);
  return 'refuse';
end;
$$;

-- Crée le code Administrateur, une seule fois, avec le code responsable.
-- Renvoie 'ok', 'deja_cree', 'trop_court', ou le résultat de la vérification
-- du code responsable ('refuse', 'bloque').
create or replace function app_creer_code_admin(
  p_code_responsable text, p_nouveau text, p_appareil uuid default null, p_prenom text default null
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_resultat text;
begin
  if exists (select 1 from app_parametres where cle = 'code_admin') then
    return 'deja_cree';
  end if;
  if p_nouveau is null or length(p_nouveau) < 4 then
    return 'trop_court';
  end if;
  v_resultat := app_verifier_code_responsable(p_code_responsable, p_appareil, p_prenom);
  if v_resultat <> 'ok' then
    return v_resultat;
  end if;
  insert into app_parametres (cle, valeur) values ('code_admin', crypt(p_nouveau, gen_salt('bf')));
  insert into app_journal (action, objet, prenom, appareil_id)
  values ('code_admin_cree', 'code_admin', p_prenom, p_appareil);
  return 'ok';
end;
$$;

-- Change le code Administrateur (il faut connaître l'ancien).
create or replace function app_changer_code_admin(
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
  v_resultat := app_verifier_code_admin(p_ancien, p_appareil, p_prenom);
  if v_resultat <> 'ok' then
    return v_resultat;
  end if;
  update app_parametres set valeur = crypt(p_nouveau, gen_salt('bf')), modifie_le = now()
  where cle = 'code_admin';
  insert into app_journal (action, objet, prenom, appareil_id)
  values ('code_admin_change', 'code_admin', p_prenom, p_appareil);
  return 'ok';
end;
$$;

revoke all on function app_verifier_code_admin(text, uuid, text) from public, anon, authenticated;
revoke all on function app_creer_code_admin(text, text, uuid, text) from public, anon, authenticated;
revoke all on function app_changer_code_admin(text, text, uuid, text) from public, anon, authenticated;
grant execute on function app_verifier_code_admin(text, uuid, text) to service_role;
grant execute on function app_creer_code_admin(text, text, uuid, text) to service_role;
grant execute on function app_changer_code_admin(text, text, uuid, text) to service_role;
