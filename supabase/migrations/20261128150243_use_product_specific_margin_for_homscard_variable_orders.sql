DO $migration$
DECLARE
  v_definition text;
  v_old text := '  select ss.product_markup_percent,
         ss.market_exchange_rate*(1+ss.fx_buffer_percent/100)
    into v_markup,v_rate from public.store_settings ss where ss.id=''main'';
  if v_markup is null or v_markup<0 or v_rate is null or v_rate<=0 then
    raise exception ''إعدادات التسعير غير صالحة'' using errcode=''22023'';
  end if;
  v_sale_unit := round(v_cost*(1+v_markup/100),8);
  v_product_code := ''HOMSCARD_VAR_''||p_product_id;
  v_product_name := left(coalesce(nullif(v_audit.product_name,''''),v_audit.product_data->>''name'',''منتج HomsCard''),120);';
  v_new text := '  v_product_code := ''HOMSCARD_VAR_''||p_product_id;
  select coalesce(p.markup_percent,ss.product_markup_percent),
         ss.market_exchange_rate*(1+ss.fx_buffer_percent/100)
    into v_markup,v_rate
    from public.store_settings ss
    left join public.products p on p.product_code=v_product_code
   where ss.id=''main'';
  if v_markup is null or v_markup<0 or v_rate is null or v_rate<=0 then
    raise exception ''إعدادات التسعير غير صالحة'' using errcode=''22023'';
  end if;
  v_sale_unit := round(v_cost*(1+v_markup/100),8);
  v_product_name := left(coalesce(nullif(v_audit.product_name,''''),v_audit.product_data->>''name'',''منتج HomsCard''),120);';
  v_old_insert text := 'insert into public.products(product_code,category,name,description,price_usd,price_syp,is_active,catalog_group)';
  v_new_insert text := 'insert into public.products(product_code,category,name,description,price_usd,price_syp,is_active,catalog_group,markup_percent)';
  v_old_values text := 'round(v_sale_unit*v_rate),true,''homscard_variable'')';
  v_new_values text := 'round(v_sale_unit*v_rate),true,''homscard_variable'',v_markup)';
  v_old_conflict text := '    price_usd=excluded.price_usd,price_syp=excluded.price_syp,is_active=true,';
  v_new_conflict text := '    price_usd=greatest(products.price_usd,excluded.price_usd),price_syp=greatest(products.price_syp,excluded.price_syp),is_active=true,';
BEGIN
  SELECT pg_get_functiondef('public.baran_create_homscard_variable_order(uuid,text,integer,text,text,uuid)'::regprocedure)
    INTO v_definition;
  IF position(v_old in v_definition)=0 OR position(v_old_insert in v_definition)=0
     OR position(v_old_values in v_definition)=0 OR position(v_old_conflict in v_definition)=0 THEN
    RAISE EXCEPTION 'Unexpected HomsCard variable-order function definition; migration aborted';
  END IF;
  v_definition := replace(v_definition,v_old,v_new);
  v_definition := replace(v_definition,v_old_insert,v_new_insert);
  v_definition := replace(v_definition,v_old_values,v_new_values);
  v_definition := replace(v_definition,v_old_conflict,v_new_conflict);
  EXECUTE v_definition;
END
$migration$;