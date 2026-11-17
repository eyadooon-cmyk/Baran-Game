create or replace function public.notify_admin_customer_registered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.admin_users where user_id = new.id) then
    return new;
  end if;
  insert into public.baran_notifications
    (recipient_id, audience, kind, title, body, entity_type, entity_id)
  select user_id, 'admin', 'customer_registered', 'عميل جديد',
         'تم تسجيل حساب عميل جديد في BARAN GAME.',
         'customer', new.id
  from public.admin_users;
  return new;
end;
$$;
drop trigger if exists trg_notify_admin_customer_registered on public.profiles;
create trigger trg_notify_admin_customer_registered
after insert on public.profiles
for each row execute function public.notify_admin_customer_registered();

create or replace function public.notify_admin_order_failed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('rejected', 'failed') and old.status is distinct from new.status then
    insert into public.baran_notifications
      (recipient_id, audience, kind, title, body, entity_type, entity_id)
    select user_id, 'admin', 'order_failed', 'طلب يحتاج متابعة',
           'تغيّرت حالة أحد الطلبات إلى ' || new.status || '. راجع تفاصيل الطلب.',
           'order', new.id
    from public.admin_users;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notify_admin_order_failed on public.orders;
create trigger trg_notify_admin_order_failed
after update of status on public.orders
for each row execute function public.notify_admin_order_failed();

revoke all on function public.notify_admin_customer_registered() from public, anon, authenticated;
revoke all on function public.notify_admin_order_failed() from public, anon, authenticated;
