-- Index the BARO settings audit foreign key.
-- Branch-only migration; no production changes.
create index if not exists baro_manual_settings_updated_by_idx
  on public.baro_manual_settings(updated_by)
  where updated_by is not null;
