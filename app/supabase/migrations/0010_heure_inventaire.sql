-- Heure de l'inventaire, en plus de sa date : un stock compté le matin
-- avant livraison n'est pas celui du soir après le service.

alter table inv_inventaires
  add column if not exists heure_inventaire time;
comment on column inv_inventaires.heure_inventaire is
  'Heure de l''inventaire (heure de Paris), choisie au démarrage.';
