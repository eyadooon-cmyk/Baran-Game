create or replace function private.baran_can_upload_support_attachment(p_ticket_id text, p_uploader_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_ticket_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then false
    when auth.uid() is distinct from p_uploader_id then false
    else
      exists (
        select 1 from public.customer_feedback f
        where f.id::text = p_ticket_id
          and f.feedback_type = 'support'
          and f.attachments_enabled = true
          and (f.user_id = p_uploader_id or public.admin_is_user(p_uploader_id))
      )
      and (
        select count(*) from storage.objects o
        where o.bucket_id = 'baran-support-attachments'
          and (storage.foldername(o.name))[1] = p_ticket_id
          and (storage.foldername(o.name))[2] = p_uploader_id::text
      ) < 3
  end;
$function$;

revoke all on function private.baran_can_upload_support_attachment(text, uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.baran_can_upload_support_attachment(text, uuid) to authenticated;

drop policy if exists baran_support_attachments_insert on storage.objects;
create policy baran_support_attachments_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'baran-support-attachments'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
  and private.baran_can_upload_support_attachment(
    (storage.foldername(name))[1],
    (select auth.uid())
  )
);