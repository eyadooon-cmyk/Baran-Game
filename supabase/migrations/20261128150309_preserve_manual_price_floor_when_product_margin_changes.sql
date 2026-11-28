CREATE OR REPLACE FUNCTION public.reprice_homscard_product_on_margin_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  current_unit_cost numeric;
  calculated_usd numeric;
BEGIN
  IF NEW.markup_percent IS NOT DISTINCT FROM OLD.markup_percent THEN
    RETURN NEW;
  END IF;

  SELECT sp.unit_cost
    INTO current_unit_cost
  FROM public.supplier_products sp
  JOIN public.suppliers su ON su.id = sp.supplier_id
  WHERE sp.product_id = NEW.id
    AND su.name = 'HomsCard'
    AND sp.is_preferred = true
    AND sp.currency = 'USD'
    AND sp.unit_cost > 0
  ORDER BY sp.updated_at DESC
  LIMIT 1;

  IF current_unit_cost IS NOT NULL THEN
    calculated_usd := round(current_unit_cost * (1 + NEW.markup_percent / 100), 2);
    IF calculated_usd > 0 THEN
      NEW.price_usd := greatest(coalesce(OLD.price_usd, 0), coalesce(NEW.price_usd, 0), calculated_usd);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;