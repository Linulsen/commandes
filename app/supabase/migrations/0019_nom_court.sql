-- Libellé court d'affichage (demandé par Nicolas le 12/10/2026).
--
-- Au relevé, le nom long du fournisseur est coupé sur deux lignes : pour les
-- Häagen-Dazs, la contenance (95 ml, 460 ml) disparaissait et on ne savait
-- plus quel pot on comptait. Le libellé court s'affiche au relevé, à
-- l'inventaire et sur la page de rangement. Le nom complet (`nom`) ne change
-- pas : il sert à reconnaître l'article dans le classeur de la carte, sur les
-- bons de livraison photographiés et sur le bon de commande. La recherche
-- trouve l'article par l'un ou l'autre.

alter table cmd_produits
  add column if not exists nom_court text;
comment on column cmd_produits.nom_court is
  'Libellé court affiché au relevé, à l''inventaire et au rangement (ex. « HD VANILLE 95 ML »). Null : le nom complet.';

update cmd_produits set nom_court = case id
  when 215 then 'HD CARAMEL SALÉ 95 ML'
  when 216 then 'HD CARAMEL SALÉ 460 ML'
  when 217 then 'HD PISTACHE 420 ML'
  when 351 then 'HD TIRAMISU 420 ML'
  when 218 then 'HD VANILLE 95 ML'
  when 219 then 'HD VANILLE 460 ML'
end
where id in (215, 216, 217, 351, 218, 219)
  and nom ilike '%haagen%';
