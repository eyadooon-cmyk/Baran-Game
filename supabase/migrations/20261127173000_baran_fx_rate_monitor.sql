create table if not exists public.fx_rate_snapshots (
 id bigint generated always as identity primary key,
 provider text not null check (provider in ('Liraty','LiraScope')),
 city text not null default 'damascus', currency text not null default 'USD',
 buy_new numeric(20,6) not null check (buy_new>0), sell_new numeric(20,6) not null check (sell_new>0),
 buy_old numeric(20,6) not null check (buy_old>0), sell_old numeric(20,6) not null check (sell_old>0),
 source_updated_at timestamptz not null, fetched_at timestamptz not null default now()
);
create index if not exists fx_rate_snapshots_fetched_idx on public.fx_rate_snapshots(fetched_at desc);
create table if not exists public.fx_rate_state (
 id text primary key default 'main' check(id='main'), city text not null default 'damascus',
 auto_update_enabled boolean not null default true,
 status text not null default 'waiting' check(status in ('waiting','success','source_disagreement','source_unavailable','stale','disabled')),
 last_attempt_at timestamptz, last_success_at timestamptz, applied_rate_old numeric(20,6),
 source_difference_percent numeric(10,4), last_error text, updated_at timestamptz not null default now()
);
insert into public.fx_rate_state(id) values('main') on conflict(id) do nothing;
alter table public.fx_rate_snapshots enable row level security;
alter table public.fx_rate_state enable row level security;
revoke all on public.fx_rate_snapshots,public.fx_rate_state from public,anon,authenticated;
grant all on public.fx_rate_snapshots,public.fx_rate_state to service_role;
grant usage,select on sequence public.fx_rate_snapshots_id_seq to service_role;
create or replace function public.baran_verify_fx_cron_secret(p_secret text)
returns boolean language sql security definer set search_path=''
as $$
 select p_secret is not null and length(p_secret)>=64 and exists(
  select 1 from vault.decrypted_secrets where name='baran_fx_cron_secret' and decrypted_secret=p_secret
 );
$$;
revoke all on function public.baran_verify_fx_cron_secret(text) from public,anon,authenticated;
grant execute on function public.baran_verify_fx_cron_secret(text) to service_role;
do $$
begin
 if not exists(select 1 from vault.secrets where name='baran_fx_cron_secret') then
  perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'baran_fx_cron_secret','Private token for BARAN FX market-rate worker');
 end if;
end $$;
do $$
declare v_job_id bigint;
begin
 select jobid into v_job_id from cron.job where jobname='baran-fx-market-rate-refresh';
 if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
 perform cron.schedule('baran-fx-market-rate-refresh','0 */6 * * *',$job$
  select net.http_post(
   url:='https://yabpmdzsiuyxxkcqakfs.supabase.co/functions/v1/baran-fx-rates',
   headers:=jsonb_build_object(
    'Content-Type','application/json',
    'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYnBtZHpzaXV5eHhrY3Fha2ZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4MDQ1MjEsImV4cCI6MjEwOTM4MDUyMX0.rCmb54yirubhzyN2tPcl89L2ljgtXTbGDibgDLvoIxQ',
    'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='baran_fx_cron_secret')
   ),
   body:='{"action":"refresh","source":"cron"}'::jsonb,
   timeout_milliseconds:=20000
  );
 $job$);
end $$;