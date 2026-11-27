-- Defense in depth for the retired SyriaMarket backup table.
-- Keep it owner-only: no client or service-role grants and no RLS policies.
-- The postgres owner can still maintain/read the archive; no app role can access it.
alter table private.syrimarket_catalog_backups enable row level security;

revoke all on table private.syrimarket_catalog_backups
  from public, anon, authenticated, service_role;
