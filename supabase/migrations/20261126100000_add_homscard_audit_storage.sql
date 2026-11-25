-- Durable, admin-only HomsCard catalog audit storage.
create table if not exists public.baran_homscard_audit_runs (
  run_id uuid primary key,
  created_by uuid not null references auth.users(id) on delete restrict,
  catalog_count integer not null default 0 check (catalog_count between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.baran_homscard_audit_items (
  run_id uuid not null references public.baran_homscard_audit_runs(run_id) on delete cascade,
  product_id text not null check (product_id ~ '^[0-9]{1,10}$'),
  product_name text not null default '',
  product_data jsonb not null default '{}'::jsonb,
  page_data jsonb not null default '{}'::jsonb,
  page_status text not null default 'not_checked' check (page_status in ('not_checked','success','failed')),
  page_error text,
  audit_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (run_id, product_id)
);
create index if not exists baran_homscard_audit_runs_updated_idx on public.baran_homscard_audit_runs(updated_at desc);
create index if not exists baran_homscard_audit_items_run_status_idx on public.baran_homscard_audit_items(run_id,page_status);
alter table public.baran_homscard_audit_runs enable row level security;
alter table public.baran_homscard_audit_items enable row level security;
revoke all on public.baran_homscard_audit_runs from anon, authenticated;
revoke all on public.baran_homscard_audit_items from anon, authenticated;
grant all on public.baran_homscard_audit_runs to service_role;
grant all on public.baran_homscard_audit_items to service_role;
