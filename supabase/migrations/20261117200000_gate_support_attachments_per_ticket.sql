-- Attachments are opt-in per support ticket and capped for customer uploads.
alter table public.customer_feedback
  add column if not exists attachments_enabled boolean not null default false;

drop policy if exists baran_support_attachments_insert on storage.objects;
create policy baran_support_attachments_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'baran-support-attachments'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
  and exists (
    select 1
    from public.customer_feedback f
    where f.id::text = (storage.foldername(name))[1]
      and f.feedback_type = 'support'
      and f.attachments_enabled = true
      and (
        (
          f.user_id = (select auth.uid())
          and (
            select count(*)
            from public.baran_support_messages m
            where m.feedback_id = f.id
              and m.sender_role = 'customer'
              and m.attachment_path is not null
          ) < 3
        )
        or public.admin_is_user((select auth.uid()))
      )
  )
);

comment on column public.customer_feedback.attachments_enabled is
  'When true, support participants may upload private attachments for this ticket; defaults off.';
