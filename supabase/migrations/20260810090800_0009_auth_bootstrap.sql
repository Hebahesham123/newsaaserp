-- =============================================================================
-- Green ERP — 0009 Auth bridge & bootstrap
--
-- Links Supabase auth.users to public.app_users. Two paths:
--   1. Invite flow  — an app_users row already exists with a matching email and
--                     status 'invited'; signing up claims it (§2.5.1).
--   2. Bootstrap    — the very first account on an empty platform becomes the
--                     System Owner (§1.7), so the instance is usable at all.
-- Any other signup is rejected: users are created by administrators, not by
-- self-service registration.
-- =============================================================================

create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_existing public.app_users%rowtype;
  v_is_first boolean;
  v_name     text;
begin
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(new.email, '@', 1)
  );

  -- Path 1: claim a pending invitation.
  select * into v_existing
  from public.app_users
  where lower(email) = lower(new.email)
    and auth_user_id is null
    and status in ('invited', 'activation_pending')
  limit 1;

  if found then
    update public.app_users
       set auth_user_id = new.id,
           status       = 'active',
           full_name    = case when v_existing.full_name = '' then v_name else v_existing.full_name end,
           updated_at   = now()
     where id = v_existing.id;
    return new;
  end if;

  -- Path 2: bootstrap the first operator on an empty platform.
  select not exists (select 1 from public.app_users) into v_is_first;

  if v_is_first then
    insert into public.app_users (auth_user_id, company_id, is_platform_admin, full_name, email, status, locale)
    values (new.id, null, true, v_name, new.email, 'active', 'ar');
    return new;
  end if;

  raise exception
    'No invitation exists for %. Accounts are created by an administrator (spec §2.5.1).', new.email
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

comment on function app.handle_new_auth_user is
  'Bridges auth.users to app_users. Claims a pending invitation, or bootstraps the first platform admin. Rejects uninvited signups.';

-- -----------------------------------------------------------------------------
-- Login attempt recording — §2.5.4 "Complete login attempt history"
-- Called from the server after every authentication attempt. SECURITY DEFINER
-- because failed attempts have no authenticated session to write with.
-- -----------------------------------------------------------------------------
create or replace function public.record_login_attempt(
  p_email          text,
  p_succeeded      boolean,
  p_failure_reason text default null,
  p_ip             text  default null,
  p_user_agent     text  default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_ip inet;
begin
  select id into v_user_id from public.app_users where lower(email) = lower(p_email) limit 1;

  begin
    v_ip := nullif(trim(split_part(coalesce(p_ip, ''), ',', 1)), '')::inet;
  exception when others then
    v_ip := null;
  end;

  insert into public.login_attempts (user_id, email, succeeded, failure_reason, ip_address, user_agent)
  values (v_user_id, p_email, p_succeeded, p_failure_reason, v_ip, p_user_agent);

  if v_user_id is null then
    return;
  end if;

  if p_succeeded then
    update public.app_users
       set last_login_at = now(), failed_login_count = 0, locked_until = null
     where id = v_user_id;
  else
    -- §2.5.4 account lockout after repeated failures.
    update public.app_users
       set failed_login_count = failed_login_count + 1,
           locked_until = case
             when failed_login_count + 1 >= 5 then now() + interval '15 minutes'
             else locked_until
           end
     where id = v_user_id;
  end if;
end;
$$;

revoke all on function public.record_login_attempt(text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.record_login_attempt(text, boolean, text, text, text) to service_role;
