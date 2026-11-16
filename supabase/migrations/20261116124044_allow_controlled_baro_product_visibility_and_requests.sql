alter table public.leo_manual_products
 drop constraint if exists leo_manual_products_catalog_visible_check,
 drop constraint if exists leo_manual_products_purchase_enabled_check;
alter table public.leo_manual_products
 add constraint leo_manual_products_purchase_requires_visible
 check (purchase_enabled = false or catalog_visible = true);

create or replace function public.baro_manual_product_update_atomic(
 p_admin_id uuid,p_product_code text,p_supplier_cost_usd numeric,p_sale_price_usd numeric,p_sale_price_syp numeric,p_admin_notes text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_product public.leo_manual_products%rowtype;
begin
 if p_admin_id is null or not public.admin_is_user(p_admin_id) then raise exception using errcode='42501',message='admin access required'; end if;
 if (p_supplier_cost_usd is not null and p_supplier_cost_usd<0) or (p_sale_price_usd is not null and p_sale_price_usd<0)
 or (p_sale_price_syp is not null and p_sale_price_syp<0) or pg_catalog.length(coalesce(p_admin_notes,''))>1000 then
  raise exception using errcode='22023',message='invalid product pricing';
 end if;
 update public.leo_manual_products set supplier_cost_usd=p_supplier_cost_usd,sale_price_usd=p_sale_price_usd,sale_price_syp=p_sale_price_syp,
 admin_notes=coalesce(p_admin_notes,''),updated_at=pg_catalog.now() where product_code=p_product_code returning * into v_product;
 if not found then raise exception using errcode='P0002',message='product not found'; end if;
 insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
 values(p_admin_id,'leo_manual_product_update','leo_manual_product',p_product_code,
 pg_catalog.jsonb_build_object('supplier_cost_usd',p_supplier_cost_usd,'sale_price_usd',p_sale_price_usd,'sale_price_syp',p_sale_price_syp,
 'purchase_enabled',v_product.purchase_enabled,'catalog_visible',v_product.catalog_visible));
 return pg_catalog.jsonb_build_object('product',pg_catalog.to_jsonb(v_product),'purchase_enabled',v_product.purchase_enabled);
end;$function$;
revoke all on function public.baro_manual_product_update_atomic(uuid,text,numeric,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.baro_manual_product_update_atomic(uuid,text,numeric,numeric,numeric,text) to service_role;