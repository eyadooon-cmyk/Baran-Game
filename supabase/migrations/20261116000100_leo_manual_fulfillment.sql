-- BARAN GAME: isolated Leo manual fulfilment schema
-- This migration is committed to the feature branch only. It is NOT applied to production.
create table if not exists public.leo_manual_products (
  product_code text primary key check (product_code ~ '^LEO_[A-Z0-9_]{3,56}$'),
  category_id text not null check (category_id in ('pubg','freefire','jawaker')),
  group_id text not null,
  product_name text not null check (char_length(btrim(product_name)) between 2 and 160),
  input_label text not null,
  reference_cost_usd numeric(12,4) check (reference_cost_usd is null or reference_cost_usd >= 0),
  reference_cost_date date,
  supplier_cost_usd numeric(12,4) check (supplier_cost_usd is null or supplier_cost_usd >= 0),
  sale_price_usd numeric(12,4) check (sale_price_usd is null or sale_price_usd >= 0),
  sale_price_syp numeric(18,2) check (sale_price_syp is null or sale_price_syp >= 0),
  catalog_visible boolean not null default false check (catalog_visible = false),
  purchase_enabled boolean not null default false check (purchase_enabled = false),
  admin_notes text not null default '' check (char_length(admin_notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.leo_manual_products enable row level security;
revoke all on public.leo_manual_products from anon, authenticated;

create table if not exists public.leo_manual_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  product_code text not null references public.leo_manual_products(product_code),
  player_id text not null check (char_length(btrim(player_id)) between 3 and 80),
  product_name_snapshot text not null,
  customer_price_usd numeric(12,4) check (customer_price_usd is null or customer_price_usd >= 0),
  customer_price_syp numeric(18,2) check (customer_price_syp is null or customer_price_syp >= 0),
  supplier_cost_usd numeric(12,4) check (supplier_cost_usd is null or supplier_cost_usd >= 0),
  supplier_reference text,
  status text not null default 'pending' check (status in ('pending','in_progress','awaiting_admin_confirmation','completed','failed','needs_review','cancelled')),
  internal_notes text not null default '' check (char_length(internal_notes) <= 2000),
  exception_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (status <> 'completed' or (supplier_cost_usd is not null and supplier_cost_usd > 0 and ((supplier_reference is not null and char_length(btrim(supplier_reference)) >= 2) or (exception_reason is not null and char_length(btrim(exception_reason)) >= 5))))
);
create index if not exists leo_manual_orders_status_created_idx on public.leo_manual_orders(status, created_at desc);
create index if not exists leo_manual_orders_user_created_idx on public.leo_manual_orders(user_id, created_at desc);
alter table public.leo_manual_orders enable row level security;
revoke all on public.leo_manual_orders from anon, authenticated;

create table if not exists public.leo_manual_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.leo_manual_orders(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null check (char_length(btrim(event_type)) between 2 and 80),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists leo_manual_order_events_order_created_idx on public.leo_manual_order_events(order_id, created_at desc);
alter table public.leo_manual_order_events enable row level security;
revoke all on public.leo_manual_order_events from anon, authenticated;

insert into public.leo_manual_products
(product_code,category_id,group_id,product_name,input_label,reference_cost_usd,reference_cost_date)
values
('LEO_PUBG_UC_60','pubg','uc','60 UC','PUBG Player ID',0.93,'2026-11-15'),
('LEO_PUBG_UC_325','pubg','uc','325 UC','PUBG Player ID',4.53,'2026-11-15'),
('LEO_PUBG_UC_660','pubg','uc','660 UC','PUBG Player ID',9.03,'2026-11-15'),
('LEO_PUBG_UC_1800','pubg','uc','1800 UC','PUBG Player ID',22.43,'2026-11-15'),
('LEO_PUBG_UC_3850','pubg','uc','3850 UC','PUBG Player ID',45.04,'2026-11-15'),
('LEO_PUBG_UC_8100','pubg','uc','8100 UC','PUBG Player ID',89.50,'2026-11-15'),
('LEO_PUBG_GROWTH_FIRST_PURCHASE','pubg','growth','حزمة الشراء الأول','PUBG Player ID',0.90,'2026-11-15'),
('LEO_PUBG_GROWTH_WEAPON_UPGRADE','pubg','growth','حزمة ترقية الأسلحة النارية','PUBG Player ID',2.69,'2026-11-15'),
('LEO_PUBG_GROWTH_MYTHIC_EMBLEM','pubg','growth','حزمة الشعار الخرافي','PUBG Player ID',4.48,'2026-11-15'),
('LEO_PUBG_GROWTH_WEEKLY_DEAL_1','pubg','growth','حزمة الصفقة الأسبوعية 1','PUBG Player ID',0.97,'2026-11-15'),
('LEO_PUBG_GROWTH_WEEKLY_DEAL_2','pubg','growth','حزمة الصفقة الأسبوعية 2','PUBG Player ID',2.96,'2026-11-15'),
('LEO_PUBG_GROWTH_WEEKLY_MYTHIC_EMBLEM','pubg','growth','حزمة الشعار الخرافي الأسبوعية','PUBG Player ID',2.70,'2026-11-15'),
('LEO_PUBG_PRIME_1M','pubg','growth','Prime — شهر واحد','PUBG Player ID',0.90,'2026-11-15'),
('LEO_PUBG_PRIME_3M','pubg','growth','Prime — 3 أشهر','PUBG Player ID',2.70,'2026-11-15'),
('LEO_PUBG_PRIME_6M','pubg','growth','Prime — 6 أشهر','PUBG Player ID',5.39,'2026-11-15'),
('LEO_PUBG_PRIME_12M','pubg','growth','Prime — 12 شهراً','PUBG Player ID',10.78,'2026-11-15'),
('LEO_PUBG_PRIME_PLUS_1M','pubg','growth','Prime Plus — شهر واحد','PUBG Player ID',8.98,'2026-11-15'),
('LEO_PUBG_PRIME_PLUS_3M','pubg','growth','Prime Plus — 3 أشهر','PUBG Player ID',26.93,'2026-11-15'),
('LEO_PUBG_PRIME_PLUS_6M','pubg','growth','Prime Plus — 6 أشهر','PUBG Player ID',53.44,'2026-11-15'),
('LEO_PUBG_PRIME_PLUS_12M','pubg','growth','Prime Plus — 12 شهراً','PUBG Player ID',107.10,'2026-11-15'),
('LEO_FREEFIRE_DIAMONDS_110','freefire','diamonds','110 جوهرة','Free Fire Player ID',0.96,'2026-11-15'),
('LEO_FREEFIRE_DIAMONDS_210','freefire','diamonds','210 جوهرة','Free Fire Player ID',1.91,'2026-11-15'),
('LEO_FREEFIRE_DIAMONDS_583','freefire','diamonds','583 جوهرة','Free Fire Player ID',4.75,'2026-11-15'),
('LEO_FREEFIRE_DIAMONDS_1188','freefire','diamonds','1188 جوهرة','Free Fire Player ID',9.69,'2026-11-15'),
('LEO_FREEFIRE_DIAMONDS_2420','freefire','diamonds','2420 جوهرة','Free Fire Player ID',18.99,'2026-11-15'),
('LEO_FREEFIRE_MEMBERSHIP_WEEKLY','freefire','memberships','عضوية أسبوعية','Free Fire Player ID',2.28,'2026-11-15'),
('LEO_JAWAKER_TOKENS_SERVER_1','jawaker','tokens','جواكر سيرفر 1 — الحد الأدنى 10,000 توكن','Jawaker ID',1.09,'2026-11-15'),
('LEO_JAWAKER_TOKENS_SERVER_2','jawaker','tokens','جواكر سيرفر 2 — الحد الأدنى 10,000 توكن','Jawaker ID',1.09,'2026-11-15'),
('LEO_JAWAKER_BOOSTER_RED','jawaker','boosters','المسرّع الأحمر','Jawaker ID',1.64,'2026-11-15'),
('LEO_JAWAKER_BOOSTER_BLUE','jawaker','boosters','المسرّع الأزرق','Jawaker ID',8.43,'2026-11-15'),
('LEO_JAWAKER_BOOSTER_BLACK','jawaker','boosters','المسرّع الأسود','Jawaker ID',14.63,'2026-11-15'),
('LEO_JAWAKER_BOOSTER_GOLD','jawaker','boosters','المسرّع الذهبي','Jawaker ID',25.77,'2026-11-15')
on conflict (product_code) do nothing;
