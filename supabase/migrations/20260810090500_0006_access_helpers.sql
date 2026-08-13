-- =============================================================================
-- Green ERP — 0006 Access helpers & audit triggers
--
-- Every function here is SECURITY DEFINER and owned by the migration role, so
-- it bypasses RLS. That is deliberate and required: policies that query the
-- same tables they protect would otherwise recurse infinitely. The functions
-- live in the private `app` schema and are not reachable through PostgREST.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identity resolution
-- -----------------------------------------------------------------------------

create or replace function app.uid()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.app_users where auth_user_id = auth.uid() limit 1;
$$;

comment on function app.uid is 'app_users.id for the current session, or NULL when unauthenticated.';

create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select is_platform_admin and status = 'active'
       from public.app_users where auth_user_id = auth.uid() limit 1),
    false
  );
$$;

create or replace function app.company_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select company_id from public.app_users where auth_user_id = auth.uid() limit 1;
$$;

create or replace function app.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select status = 'active' and archived_at is null
       from public.app_users where auth_user_id = auth.uid() limit 1),
    false
  );
$$;

-- -----------------------------------------------------------------------------
-- Tenant boundary — §1.9 "Maintain complete data separation between companies"
-- -----------------------------------------------------------------------------

create or replace function app.same_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.is_platform_admin()
      or (p_company_id is not null and p_company_id = app.company_id());
$$;

-- -----------------------------------------------------------------------------
-- Action permissions — §2.7.1
-- -----------------------------------------------------------------------------

create or replace function app.has_perm(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.is_platform_admin()
      or exists (
        select 1
        from public.user_roles ur
        join public.roles r            on r.id = ur.role_id and r.is_active
        join public.role_permissions rp on rp.role_id = r.id
        join public.permissions p       on p.id = rp.permission_id
        where ur.user_id = app.uid()
          and p.code = p_code
      );
$$;

comment on function app.has_perm is
  '§2.7.1 action-level check. Platform admins short-circuit to true.';

-- -----------------------------------------------------------------------------
-- Data permissions — §2.7.1
--
-- No row of a given scope type = unrestricted within the company.
-- One or more rows = restricted to exactly those ids.
-- -----------------------------------------------------------------------------

create or replace function app.in_scope(p_type public.data_scope_type, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select case
    when app.is_platform_admin() then true
    when not exists (
      select 1 from public.user_data_scopes
      where user_id = app.uid() and scope_type = p_type
    ) then true
    else exists (
      select 1 from public.user_data_scopes
      where user_id = app.uid() and scope_type = p_type and scope_id = p_id
    )
  end;
$$;

comment on function app.in_scope is
  '§2.7.1 data-level check. Absence of any scope row of that type means unrestricted within the company.';

-- Composite helpers used directly by policies.

create or replace function app.can_access_merchant(p_merchant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select p_merchant_id is null or app.in_scope('merchant', p_merchant_id);
$$;

create or replace function app.can_access_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select p_store_id is null or app.in_scope('store', p_store_id);
$$;

create or replace function app.can_access_warehouse(p_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select p_warehouse_id is null or app.in_scope('warehouse', p_warehouse_id);
$$;

-- -----------------------------------------------------------------------------
-- Request context — used to populate audit fields (§2.9.2)
-- -----------------------------------------------------------------------------

create or replace function app.request_header(p_name text)
returns text
language plpgsql
stable
as $$
declare
  v_headers jsonb;
begin
  begin
    v_headers := current_setting('request.headers', true)::jsonb;
  exception when others then
    return null;
  end;
  if v_headers is null then
    return null;
  end if;
  return v_headers ->> p_name;
end;
$$;

create or replace function app.request_ip()
returns inet
language plpgsql
stable
set search_path = app, pg_temp
as $$
declare
  v_raw text;
begin
  v_raw := coalesce(app.request_header('x-forwarded-for'), app.request_header('x-real-ip'));
  if v_raw is null then
    return null;
  end if;
  -- x-forwarded-for may be a comma-separated chain; the client is first.
  v_raw := trim(split_part(v_raw, ',', 1));
  begin
    return v_raw::inet;
  exception when others then
    return null;
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Generic audit trigger — §2.9
--
-- Attached to every business table. Records the actor, tenant, action, changed
-- fields, before/after values and request metadata. Because it is SECURITY
-- DEFINER it can write to audit_log even though clients cannot.
-- -----------------------------------------------------------------------------

create or replace function app.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_action   public.audit_action;
  v_old      jsonb;
  v_new      jsonb;
  v_company  uuid;
  v_merchant uuid;
  v_record   text;
  v_changed  text[];
  v_ua       text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_action := 'create';
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);

    select array_agg(k order by k)
      into v_changed
      from jsonb_object_keys(v_new) as k
     where v_new -> k is distinct from v_old -> k
       and k not in ('updated_at', 'updated_by');

    -- Nothing of substance changed; do not create noise in the trail.
    if v_changed is null then
      return new;
    end if;

    if 'archived_at' = any (v_changed) and v_new ->> 'archived_at' is not null then
      v_action := 'archive';
    elsif 'status' = any (v_changed) then
      v_action := 'status_change';
    else
      v_action := 'update';
    end if;
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_action := 'delete';
  end if;

  -- companies carry their tenant id in `id`; everything else in `company_id`.
  if tg_table_name = 'companies' then
    v_company := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  else
    v_company := nullif(coalesce(v_new ->> 'company_id', v_old ->> 'company_id'), '')::uuid;
  end if;

  v_merchant := nullif(coalesce(v_new ->> 'merchant_id', v_old ->> 'merchant_id'), '')::uuid;
  v_record   := coalesce(v_new ->> 'id', v_old ->> 'id');
  v_ua       := app.request_header('user-agent');

  insert into public.audit_log (
    company_id, merchant_id, actor_id, action, module, record_id,
    old_value, new_value, changed_fields,
    ip_address, user_agent, change_reason
  )
  values (
    v_company,
    v_merchant,
    app.uid(),
    v_action,
    tg_table_name,
    v_record,
    v_old,
    v_new,
    v_changed,
    app.request_ip(),
    v_ua,
    nullif(current_setting('app.change_reason', true), '')
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function app.audit_trigger is
  '§2.9 generic audit writer. Attach with: CREATE TRIGGER <t>_audit AFTER INSERT OR UPDATE OR DELETE ON <t> FOR EACH ROW EXECUTE FUNCTION app.audit_trigger();';

-- Attach to every Phase 1 business table (§2.9.1).
create trigger companies_audit        after insert or update or delete on public.companies        for each row execute function app.audit_trigger();
create trigger merchants_audit        after insert or update or delete on public.merchants        for each row execute function app.audit_trigger();
create trigger stores_audit           after insert or update or delete on public.stores           for each row execute function app.audit_trigger();
create trigger warehouses_audit       after insert or update or delete on public.warehouses       for each row execute function app.audit_trigger();
create trigger app_users_audit        after insert or update or delete on public.app_users        for each row execute function app.audit_trigger();
create trigger departments_audit      after insert or update or delete on public.departments      for each row execute function app.audit_trigger();
create trigger teams_audit            after insert or update or delete on public.teams            for each row execute function app.audit_trigger();
create trigger shifts_audit           after insert or update or delete on public.shifts           for each row execute function app.audit_trigger();
create trigger roles_audit            after insert or update or delete on public.roles            for each row execute function app.audit_trigger();
create trigger approval_requests_audit after insert or update or delete on public.approval_requests for each row execute function app.audit_trigger();

-- §2.9.1 "Permission changes" need their own action type, so these tables get a
-- dedicated writer rather than the generic one.
create or replace function app.audit_permission_change()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_company uuid;
  v_subject uuid;
begin
  v_subject := coalesce(v_new ->> 'user_id', v_old ->> 'user_id', v_new ->> 'role_id', v_old ->> 'role_id')::uuid;

  if tg_table_name in ('user_roles', 'user_data_scopes') then
    select company_id into v_company from public.app_users
     where id = coalesce(v_new ->> 'user_id', v_old ->> 'user_id')::uuid;
  else
    select company_id into v_company from public.roles
     where id = coalesce(v_new ->> 'role_id', v_old ->> 'role_id')::uuid;
  end if;

  insert into public.audit_log (
    company_id, actor_id, action, module, record_id,
    old_value, new_value, ip_address, user_agent
  )
  values (
    v_company, app.uid(),
    case when tg_table_name = 'team_members' then 'team_membership_change'::public.audit_action
         else 'permission_change'::public.audit_action end,
    tg_table_name, v_subject::text,
    v_old, v_new, app.request_ip(), app.request_header('user-agent')
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger user_roles_audit         after insert or update or delete on public.user_roles         for each row execute function app.audit_permission_change();
create trigger role_permissions_audit   after insert or update or delete on public.role_permissions   for each row execute function app.audit_permission_change();
create trigger user_data_scopes_audit   after insert or update or delete on public.user_data_scopes   for each row execute function app.audit_permission_change();
create trigger role_field_policies_audit after insert or update or delete on public.role_field_policies for each row execute function app.audit_permission_change();
create trigger team_members_audit       after insert or update or delete on public.team_members       for each row execute function app.audit_permission_change();

-- -----------------------------------------------------------------------------
-- Client-facing RPCs. These are in `public` so PostgREST exposes them, but they
-- only ever reveal the caller's own effective permissions.
-- -----------------------------------------------------------------------------

create or replace function public.my_permission_codes()
returns setof text
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  -- Platform admins hold the whole catalogue implicitly.
  select p.code
  from public.permissions p
  where app.is_platform_admin()
  union
  select p.code
  from public.user_roles ur
  join public.roles r             on r.id = ur.role_id and r.is_active
  join public.role_permissions rp on rp.role_id = r.id
  join public.permissions p       on p.id = rp.permission_id
  where ur.user_id = app.uid();
$$;

comment on function public.my_permission_codes is
  'Effective action-permission codes for the current user. Drives client-side screen and control gating; the database still enforces via RLS.';

create or replace function public.my_field_policies()
returns table (entity text, field text, visibility public.field_visibility, can_edit boolean, mask_pattern text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  -- Most restrictive visibility across the user's roles wins: hidden > masked > visible.
  select fp.entity,
         fp.field,
         (array_agg(fp.visibility order by
            case fp.visibility when 'hidden' then 0 when 'masked' then 1 else 2 end))[1] as visibility,
         bool_or(fp.can_edit)                                                            as can_edit,
         (array_agg(fp.mask_pattern) filter (where fp.mask_pattern is not null))[1]      as mask_pattern
  from public.role_field_policies fp
  join public.user_roles ur on ur.role_id = fp.role_id
  where ur.user_id = app.uid()
  group by fp.entity, fp.field;
$$;

revoke all on function public.my_permission_codes() from public, anon;
revoke all on function public.my_field_policies()   from public, anon;
grant execute on function public.my_permission_codes() to authenticated;
grant execute on function public.my_field_policies()   to authenticated;
