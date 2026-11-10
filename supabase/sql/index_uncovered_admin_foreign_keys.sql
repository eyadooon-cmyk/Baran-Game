create index if not exists baran_admin_memory_created_by_idx
  on public.baran_admin_memory (created_by);
create index if not exists baran_admin_work_plan_created_by_idx
  on public.baran_admin_work_plan (created_by);
create index if not exists baran_admin_work_plan_updated_by_idx
  on public.baran_admin_work_plan (updated_by);
create index if not exists baran_staff_roles_created_by_idx
  on public.baran_staff_roles (created_by);
create index if not exists store_announcements_created_by_idx
  on public.store_announcements (created_by);
