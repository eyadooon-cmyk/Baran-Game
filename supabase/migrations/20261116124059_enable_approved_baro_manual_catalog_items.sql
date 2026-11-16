update public.leo_manual_products
set catalog_visible=true,purchase_enabled=true,updated_at=now()
where product_code in (
 'LEO_PUBG_UC_60','LEO_PUBG_UC_325','LEO_PUBG_UC_660','LEO_PUBG_UC_1800',
 'LEO_FREEFIRE_DIAMONDS_110','LEO_FREEFIRE_DIAMONDS_210','LEO_FREEFIRE_DIAMONDS_583',
 'LEO_FREEFIRE_DIAMONDS_1188','LEO_FREEFIRE_DIAMONDS_2420','LEO_FREEFIRE_MEMBERSHIP_WEEKLY',
 'LEO_JAWAKER_TOKENS_SERVER_1','LEO_JAWAKER_TOKENS_SERVER_2',
 'LEO_JAWAKER_BOOSTER_RED','LEO_JAWAKER_BOOSTER_BLUE','LEO_JAWAKER_BOOSTER_BLACK','LEO_JAWAKER_BOOSTER_GOLD'
);
insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
values('7c6f69ed-7786-43ce-b340-78c4c1f9a4d7'::uuid,'baro_initial_catalog_enable','leo_manual_catalog','BARO',
jsonb_build_object('visible_and_requestable_products',16,'note','Approved manual catalog items only. No price, purchase, wallet debit or supplier dispatch enabled.'));