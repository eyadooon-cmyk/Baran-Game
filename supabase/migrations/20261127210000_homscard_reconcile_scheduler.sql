-- Vault-backed HMAC authentication and a bounded one-minute read-only reconciliation schedule.
-- This job calls only the HomsCard status-check endpoint through the Edge Function.
do $vault$
begin
  if not exists (
    select 1 from vault.secrets where name = 'baran_homscard_reconcile_hmac'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'baran_homscard_reconcile_hmac',
      'HMAC key for the scheduled read-only HomsCard order status reconciler'
    );
  end if;
end;
$vault$;

create or replace function public.baran_verify_homscard_reconcile_signature(
  p_timestamp text,
  p_body text,
  p_signature text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text := coalesce(auth.jwt()->>'role','');
  v_secret text;
  v_epoch bigint;
  v_expected text;
begin
  if v_role <> 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if p_timestamp is null or p_timestamp !~ '^[0-9]{10}$'
     or p_body is null or length(p_body) > 2000
     or p_signature is null or p_signature !~ '^[0-9a-fA-F]{64}$' then
    return false;
  end if;

  v_epoch := p_timestamp::bigint;
  if abs(extract(epoch from clock_timestamp())::bigint - v_epoch) > 300 then
    return false;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'baran_homscard_reconcile_hmac'
  limit 1;

  if v_secret is null or length(v_secret) < 32 then
    return false;
  end if;

  v_expected := encode(
    extensions.hmac(
      convert_to(
        p_timestamp || E'\\nPOST\\n/functions/v1/baran-homscard-reconcile\\n' || p_body,
        'UTF8'
      ),
      convert_to(v_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  return lower(v_expected) = lower(p_signature);
end;
$function$;

revoke all on function public.baran_verify_homscard_reconcile_signature(text,text,text)
  from public, anon, authenticated;
grant execute on function public.baran_verify_homscard_reconcile_signature(text,text,text)
  to service_role;

do $schedule$
begin
  perform cron.schedule(
    'baran-homscard-reconcile-every-minute',
    '* * * * *',
    $job$
    do $run$
    declare
      v_timestamp text := extract(epoch from clock_timestamp())::bigint::text;
      v_body text := jsonb_build_object('source','cron')::text;
      v_secret text;
      v_signature text;
    begin
      select decrypted_secret into v_secret
      from vault.decrypted_secrets
      where name = 'baran_homscard_reconcile_hmac'
      limit 1;
      if v_secret is null then
        raise warning 'HomsCard reconciliation HMAC secret is missing; no request sent';
        return;
      end if;

      v_signature := encode(
        extensions.hmac(
          convert_to(
            v_timestamp || E'\\nPOST\\n/functions/v1/baran-homscard-reconcile\\n' || v_body,
            'UTF8'
          ),
          convert_to(v_secret, 'UTF8'),
          'sha256'
        ),
        'hex'
      );

      perform net.http_post(
        url := 'https://yabpmdzsiuyxxkcqakfs.supabase.co/functions/v1/baran-homscard-reconcile',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-baran-timestamp',v_timestamp,
          'x-baran-signature',v_signature
        ),
        body := v_body::jsonb,
        timeout_milliseconds := 55000
      );
    end;
    $run$;
    $job$
  );
end;
$schedule$;
