-- L'administrateur (session ouverte avec le code Administrateur, contrôlée par
-- l'appli) peut redéfinir le code responsable sans connaître l'ancien : utile
-- s'il est oublié, ou pour le changer sans que personne d'autre le connaisse.
create or replace function app_redefinir_code_responsable(
  p_nouveau text, p_appareil uuid default null, p_prenom text default null
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_nouveau is null or length(p_nouveau) < 4 then
    return 'trop_court';
  end if;
  insert into app_parametres (cle, valeur) values ('code_responsable', crypt(p_nouveau, gen_salt('bf')))
  on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now();
  insert into app_journal (action, objet, prenom, appareil_id)
  values ('code_responsable_redefini', 'code_responsable', p_prenom, p_appareil);
  return 'ok';
end;
$$;
revoke all on function app_redefinir_code_responsable(text, uuid, text) from public, anon, authenticated;
grant execute on function app_redefinir_code_responsable(text, uuid, text) to service_role;
