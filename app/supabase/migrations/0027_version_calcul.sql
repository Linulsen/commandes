-- Version des règles de calcul avec laquelle une commande a été proposée
-- (audit du 14/11/2026). Renseignée à la validation, depuis la constante
-- VERSION_CALCUL de app/src/lib/forecast.ts. Null pour les commandes validées
-- avant le 14/11/2026 (version non enregistrée).

alter table cmd_sessions add column if not exists version_calcul text;

comment on column cmd_sessions.version_calcul is
  'Version des règles de calcul (VERSION_CALCUL, forecast.ts) au moment de la validation ; null avant le 14/11/2026.';
