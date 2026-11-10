alter table public.baran_admin_work_plan
  add column if not exists assigned_to uuid null references auth.users(id) on delete set null,
  add column if not exists moderator_note text null,
  add column if not exists moderator_updated_at timestamptz null;

create index if not exists baran_admin_work_plan_assigned_to_idx
  on public.baran_admin_work_plan(assigned_to, status, created_at desc)
  where assigned_to is not null;

alter table public.baran_admin_work_plan
  drop constraint if exists baran_admin_work_plan_moderator_note_length_check;

alter table public.baran_admin_work_plan
  add constraint baran_admin_work_plan_moderator_note_length_check
  check (moderator_note is null or char_length(moderator_note) <= 1000);
