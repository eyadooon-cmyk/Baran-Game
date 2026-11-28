-- Private receipt storage reserved for the future wallet-transfer request flow.
-- Deliberately no client-facing storage.objects policies are created here:
-- uploads must remain disabled until a server-side draft/order authorization flow exists.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'baran-wallet-receipts',
  'baran-wallet-receipts',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = excluded.allowed_mime_types;
