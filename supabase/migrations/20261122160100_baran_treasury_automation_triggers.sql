-- Reproducible source for the treasury automation triggers installed directly
-- in production on 2026-11-22. This migration is intentionally idempotent:
-- indexes/triggers are created only when missing and functions are replaced
-- with the verified production definitions. No historical rows are backfilled.

CREATE UNIQUE INDEX IF NOT EXISTS admin_treasury_shamcash_deposit_reference_uidx
  ON public.admin_treasury_entries (reference)
  WHERE reference LIKE 'shamcash-deposit:%';

CREATE UNIQUE INDEX IF NOT EXISTS admin_treasury_baro_wallet_allocation_uidx
  ON public.admin_treasury_entries (reference)
  WHERE reference LIKE 'baro-wallet-allocation:%';

CREATE UNIQUE INDEX IF NOT EXISTS admin_treasury_wallet_advance_settlement_uidx
  ON public.admin_treasury_entries (reference)
  WHERE reference LIKE 'wallet-advance-settlement:%';

CREATE OR REPLACE FUNCTION public.baran_post_verified_customer_deposit_to_treasury()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_admin_id uuid;
begin
  if new.status <> 'approved'
     or old.status is not distinct from new.status
     or new.request_source <> 'customer'
     or new.payment_method <> 'sham_cash'
     or new.amount is null or new.amount <= 0
     or new.currency not in ('USD','SYP') then
    return new;
  end if;

  select coalesce(new.reviewer_id, (
    select au.user_id from public.admin_users au
    order by au.created_at asc
    limit 1
  )) into v_admin_id;

  if v_admin_id is null then
    raise exception 'تعذر تحديد حساب الإدارة لتسجيل حوالة الخزنة.';
  end if;

  insert into public.admin_treasury_entries (
    entry_type, title, amount, currency, reference, notes, created_by
  ) values (
    'cash_in',
    'قبض شام كاش مؤكد — إيداع محفظة زبون',
    round(new.amount, 2),
    new.currency,
    'shamcash-deposit:' || new.id::text,
    'تسجيل تلقائي لحركة نقدية واردة بعد اعتماد طلب الإيداع. هذا قبض نقدي مقابل التزام رصيد للزبون، وليس مبيعاً أو ربحاً.',
    v_admin_id
  )
  on conflict (reference)
  where reference like 'shamcash-deposit:%'
  do nothing;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.baran_allocate_baro_wallet_charge_to_treasury()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_admin_id uuid;
begin
  if new.transaction_type <> 'baro_manual_wallet_charge'
     or new.baro_manual_order_id is null
     or new.amount >= 0
     or new.currency not in ('USD','SYP') then
    return new;
  end if;

  select au.user_id
    into v_admin_id
  from public.admin_users au
  order by au.created_at asc
  limit 1;

  if v_admin_id is null then
    raise exception 'تعذر تحديد حساب الإدارة لتسجيل تخصيص محفظة BARO.';
  end if;

  insert into public.admin_treasury_entries
    (entry_type,title,amount,currency,reference,notes,created_by)
  values
    ('transfer_out',
     'تخصيص رصيد محفظة إلى BARO اليدوي',
     round(abs(new.amount),2),
     new.currency,
     'baro-wallet-allocation:' || new.id::text,
     'تحويل تخصيص داخلي من مالية BARAN العامة إلى دفتر BARO مقابل طلب BARO مدفوع من محفظة الزبون. ليس مصروفاً خارجياً ولا مبيعاً جديداً في BARAN. طلب BARO: ' || new.baro_manual_order_id::text,
     v_admin_id)
  on conflict (reference)
    where reference like 'baro-wallet-allocation:%'
  do nothing;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.baran_post_wallet_advance_settlement_to_treasury()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  if old.settled_at is not null or new.settled_at is null
     or new.transfer_reference is null or btrim(new.transfer_reference) = '' then
    return new;
  end if;

  insert into public.admin_treasury_entries
    (entry_type,title,amount,currency,reference,notes,created_by,created_at)
  values
    ('cash_in',
     'قبض حوالة شام كاش مقابل تسوية سلفة محفظة',
     round(new.amount,2),
     new.currency,
     'wallet-advance-settlement:' || new.id::text,
     'قبض نقدي موثق عند تسوية سلفة إدارية للمحفظة. رقم الحوالة: ' ||
       new.transfer_reference || '. لا يُضاف رصيد جديد للزبون ولا يُسجل مبيعاً أو ربحاً؛ رصيد الزبون سبق إضافته عند إنشاء السلفة.',
     new.created_by,
     new.settled_at)
  on conflict (reference)
    where reference like 'wallet-advance-settlement:%'
  do nothing;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.baran_post_verified_customer_deposit_to_treasury() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.baran_allocate_baro_wallet_charge_to_treasury() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.baran_post_wallet_advance_settlement_to_treasury() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'baran_treasury_post_verified_customer_deposit'
      AND tgrelid = 'public.deposit_requests'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER baran_treasury_post_verified_customer_deposit
      AFTER UPDATE OF status ON public.deposit_requests
      FOR EACH ROW
      WHEN (old.status IS DISTINCT FROM new.status)
      EXECUTE FUNCTION public.baran_post_verified_customer_deposit_to_treasury();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'baran_treasury_allocate_baro_wallet_charge'
      AND tgrelid = 'public.wallet_transactions'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER baran_treasury_allocate_baro_wallet_charge
      AFTER INSERT ON public.wallet_transactions
      FOR EACH ROW
      EXECUTE FUNCTION public.baran_allocate_baro_wallet_charge_to_treasury();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'baran_treasury_post_wallet_advance_settlement'
      AND tgrelid = 'public.admin_wallet_advances'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER baran_treasury_post_wallet_advance_settlement
      AFTER UPDATE OF settled_at ON public.admin_wallet_advances
      FOR EACH ROW
      WHEN (old.settled_at IS NULL AND new.settled_at IS NOT NULL)
      EXECUTE FUNCTION public.baran_post_wallet_advance_settlement_to_treasury();
  END IF;
END;
$$;
