-- Audit du 14/11/2026 : fermer l'accès public aux vues et fonctions.
--
-- Les tables sont en RLS sans policy : seule la clé de service (serveur de
-- l'appli) les lit. Mais la vue cmd_historique s'exécutait avec les droits de
-- son propriétaire (pas de security_invoker) et restait ouverte aux rôles
-- anon et authenticated : avec la clé publique du projet, l'historique des
-- consommations était lisible par l'API REST de Supabase, sans passer par
-- l'appli. Même chose pour la fonction cmd_commande, qui la lit.
--
-- Aucun effet sur l'appli : elle utilise la clé de service (service_role),
-- qui n'est pas soumise à la RLS.
--
-- À retenir : toute nouvelle vue doit être créée avec
-- « with (security_invoker = true) », et un « create or replace view » de
-- cmd_historique doit reprendre cette option.

alter view cmd_historique set (security_invoker = true);

revoke all on cmd_historique        from anon, authenticated;
revoke all on cmd_del_arte_soldes   from anon, authenticated;
revoke all on inv_produits_attendus from anon, authenticated;

revoke execute on function public.cmd_commande(integer)    from public, anon, authenticated;
revoke execute on function public.cmd_lignes_stock_saisi_le() from public, anon, authenticated;

grant select on cmd_historique, cmd_del_arte_soldes, inv_produits_attendus to service_role;
grant execute on function public.cmd_commande(integer) to service_role;
