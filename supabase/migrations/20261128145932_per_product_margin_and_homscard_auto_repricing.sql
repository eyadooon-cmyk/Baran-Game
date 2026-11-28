ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS markup_percent numeric(6,3) NOT NULL DEFAULT 4.000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_markup_percent_range'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_markup_percent_range
      CHECK (markup_percent >= 0 AND markup_percent <= 100);
  END IF;
END $$;

UPDATE public.store_settings
SET product_markup_percent = 4.000,
    updated_at = now()
WHERE id = 'main';

UPDATE public.products p
SET markup_percent = CASE
      WHEN p.product_code LIKE 'PUBG_MOBILE_%' THEN 3.000
      WHEN p.product_code LIKE 'FREEFIRE_ROBOT_%' THEN 3.000
      WHEN p.product_code = 'JAWAKER_BOOSTER_RED' THEN 5.000
      WHEN p.product_code = 'JAWAKER_BOOSTER_BLUE' THEN 4.000
      WHEN p.product_code = 'JAWAKER_BOOSTER_BLACK' THEN 3.500
      WHEN p.product_code = 'JAWAKER_BOOSTER_GOLD' THEN 4.000
      WHEN p.product_code IN (
        'HOMSCARD_WALLET_SHAM_CASH',
        'HOMSCARD_WALLET_USDT_BEP20',
        'HOMSCARD_WALLET_WHISH_MONEY'
      ) THEN 5.000
      ELSE 4.000
    END
FROM public.supplier_products sp
JOIN public.suppliers su ON su.id = sp.supplier_id
WHERE sp.product_id = p.id
  AND su.name = 'HomsCard'
  AND sp.is_preferred = true
  AND sp.currency = 'USD'
  AND p.category IN ('game','app');

CREATE OR REPLACE FUNCTION public.sync_homscard_product_usd_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  supplier_name text;
BEGIN
  IF NEW.is_preferred IS DISTINCT FROM true
     OR NEW.currency <> 'USD'
     OR NEW.unit_cost IS NULL
     OR NEW.unit_cost <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT s.name INTO supplier_name
  FROM public.suppliers s
  WHERE s.id = NEW.supplier_id;

  IF supplier_name <> 'HomsCard' THEN
    RETURN NEW;
  END IF;

  UPDATE public.products p
  SET price_usd = greatest(
        coalesce(p.price_usd, 0),
        round(NEW.unit_cost * (1 + p.markup_percent / 100), 2)
      ),
      updated_at = now()
  WHERE p.id = NEW.product_id
    AND p.category IN ('game','app');

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS supplier_products_sync_homscard_usd_price
  ON public.supplier_products;

CREATE TRIGGER supplier_products_sync_homscard_usd_price
AFTER INSERT OR UPDATE OF unit_cost, currency, is_preferred, supplier_id, product_id
ON public.supplier_products
FOR EACH ROW
EXECUTE FUNCTION public.sync_homscard_product_usd_price();

UPDATE public.products p
SET price_usd = greatest(
      coalesce(p.price_usd, 0),
      round(sp.unit_cost * (1 + p.markup_percent / 100), 2)
    ),
    updated_at = now()
FROM public.supplier_products sp
JOIN public.suppliers su ON su.id = sp.supplier_id
WHERE sp.product_id = p.id
  AND su.name = 'HomsCard'
  AND sp.is_preferred = true
  AND sp.currency = 'USD'
  AND sp.unit_cost > 0
  AND p.category IN ('game','app');