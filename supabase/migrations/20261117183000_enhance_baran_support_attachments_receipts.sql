-- Secure support attachments, per-message read receipts, and ticket priority.
alter table public.baran_support_messages
  add column if not exists read_at timestamptz,
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size bigint;

alter table public.baran_support_messages
  drop constraint if exists baran_support_messages_attachment_size_check;
alter table public.baran_support_messages
  add constraint baran_support_messages_attachment_size_check
  check (attachment_size is null or attachment_size between 1 and 10485760);

alter table public.baran_support_messages
  drop constraint if exists baran_support_messages_attachment_metadata_check;
alter table public.baran_support_messages
  add constraint baran_support_messages_attachment_metadata_check
  check (
    (attachment_path is null and attachment_name is null and attachment_mime is null and attachment_size is null)
    or
    (attachment_path is not null and attachment_name is not null and attachment_mime is not null and attachment_size is not null)
  );

alter table public.customer_feedback
  add column if not exists priority text not null default 'normal'
  check (priority in ('low','normal','high','urgent'));

create index if not exists customer_feedback_support_priority_idx
  on public.customer_feedback(priority,updated_at desc)
  where feedback_type='support';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('baran-support-attachments','baran-support-attachments',false,10485760,
  array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set
  public=false,
  file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists baran_support_attachments_insert on storage.objects;
create policy baran_support_attachments_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='baran-support-attachments'
  and (storage.foldername(name))[2]=(select auth.uid()::text)
  and exists (
    select 1 from public.customer_feedback f
    where f.id::text=(storage.foldername(name))[1]
      and f.feedback_type='support'
      and (f.user_id=(select auth.uid()) or public.admin_is_user((select auth.uid())))
  )
);

drop policy if exists baran_support_attachments_select on storage.objects;
create policy baran_support_attachments_select
on storage.objects for select to authenticated
using (
  bucket_id='baran-support-attachments'
  and (storage.foldername(name))[2]=(select auth.uid()::text)
  and exists (
    select 1 from public.customer_feedback f
    where f.id::text=(storage.foldername(name))[1]
      and f.feedback_type='support'
      and (f.user_id=(select auth.uid()) or public.admin_is_user((select auth.uid())))
  )
);

comment on column public.baran_support_messages.read_at is
  'Timestamp when the other conversation party read this message.';
comment on column public.baran_support_messages.attachment_path is
  'Private Storage object path; downloads are served with short-lived signed URLs by baran-support-center.';
