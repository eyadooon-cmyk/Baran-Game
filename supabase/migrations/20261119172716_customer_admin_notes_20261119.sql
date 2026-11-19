create table if not exists public.customer_admin_notes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint customer_admin_notes_note_length check (char_length(note) <= 1000)
);

alter table public.customer_admin_notes enable row level security;
revoke all on table public.customer_admin_notes from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_admin_notes to service_role;
