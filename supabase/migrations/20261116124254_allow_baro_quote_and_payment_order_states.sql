alter table public.leo_manual_orders drop constraint if exists leo_manual_orders_status_check;
alter table public.leo_manual_orders add constraint leo_manual_orders_status_check
 check (status = any(array['pending','awaiting_payment','paid','in_progress','awaiting_admin_confirmation','completed','failed','needs_review','cancelled']));
create or replace function public.baro_manual_create_customer_order(p_user_id uuid,p_product_code text,p_player_id text,p_quantity integer,p_customer_note text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_product public.leo_manual_products%rowtype; v_order public.leo_manual_orders%rowtype;
v_player text:=pg_catalog.btrim(coalesce(p_player_id,'')); v_note text:=pg_catalog.btrim(coalesce(p_customer_note,''));
begin
 if p_user_id is null or p_product_code is null or p_product_code !~ '^LEO_[A-Z0-9_]{3,56}$'
 or pg_catalog.length(v_player)<3 or pg_catalog.length(v_player)>80 or v_player ~ '[[:cntrl:]]'
 or pg_catalog.length(v_note)>500 or p_quantity is null or p_quantity<1 or p_quantity>1000000 then
  raise exception using errcode='22023',message='بيانات طلب BARO غير صحيحة.';
 end if;
 select * into v_product from public.leo_manual_products where product_code=p_product_code for share;
 if not found or v_product.catalog_visible is not true or v_product.purchase_enabled is not true then
  raise exception using errcode='55000',message='هذا المنتج غير متاح للطلب اليدوي حالياً.';
 end if;
 if v_product.category_id='jawaker' and v_product.group_id='tokens' then
  if p_quantity<10000 or p_quantity>1000000 then raise exception using errcode='22023',message='كمية جواكر يجب أن تكون بين 10,000 و1,000,000.'; end if;
 elsif p_quantity<>1 then raise exception using errcode='22023',message='هذا المنتج لا يقبل كمية متغيرة.';
 end if;
 if (select count(*) from public.leo_manual_orders where user_id=p_user_id and created_at>pg_catalog.now()-interval '10 minutes')>=5 then
  raise exception using errcode='54000',message='وصلت للحد المؤقت للطلبات. حاول بعد قليل.';
 end if;
 insert into public.leo_manual_orders(user_id,product_code,player_id,product_name_snapshot,quantity,customer_note,status,payment_status)
 values(p_user_id,p_product_code,v_player,v_product.product_name,p_quantity,v_note,'pending','awaiting_quote') returning * into v_order;
 insert into public.leo_manual_order_events(order_id,actor_id,event_type,details)
 values(v_order.id,p_user_id,'customer_order_created',pg_catalog.jsonb_build_object('product_code',p_product_code,'quantity',p_quantity));
 return pg_catalog.jsonb_build_object('success',true,'order_id',v_order.id,'status',v_order.status,'payment_status',v_order.payment_status,'wallet_changed',false,'finance_posted',false);
end;$function$;
revoke all on function public.baro_manual_create_customer_order(uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.baro_manual_create_customer_order(uuid,text,text,integer,text) to service_role;