-- =============================================================================
-- Green ERP — 0007 Row Level Security
--
-- §1.9  "Maintain complete data separation between companies"
-- §2.13 "A user cannot access an unauthorized company"
-- §2.13 "A merchant must never access another merchant's data"
--
-- Every table below has RLS enabled with no permissive default. A table with
-- no policy is unreadable by anon/authenticated — which is the intended state
-- for credential and log tables.
-- =============================================================================

alter table public.companies          enable row level security;
alter table public.merchants          enable row level security;
alter table public.stores             enable row level security;
alter table public.store_credentials  enable row level security;
alter table public.warehouses         enable row level security;
alter table public.app_users          enable row level security;
alter table public.departments        enable row level security;
alter table public.teams              enable row level security;
alter table public.team_members       enable row level security;
alter table public.shifts             enable row level security;
alter table public.shift_members      enable row level security;
alter table public.permissions        enable row level security;
alter table public.roles              enable row level security;
alter table public.role_permissions   enable row level security;
alter table public.user_roles         enable row level security;
alter table public.user_data_scopes   enable row level security;
alter table public.role_field_policies enable row level security;
alter table public.approval_requests  enable row level security;
alter table public.audit_log          enable row level security;
alter table public.login_attempts     enable row level security;
alter table public.sync_log           enable row level security;
alter table public.notifications      enable row level security;

-- -----------------------------------------------------------------------------
-- Companies — §2.2
-- -----------------------------------------------------------------------------
create policy companies_select on public.companies
  for select to authenticated
  using (app.is_platform_admin() or id = app.company_id());

create policy companies_insert on public.companies
  for insert to authenticated
  with check (app.is_platform_admin());

create policy companies_update on public.companies
  for update to authenticated
  using (app.same_company(id) and app.has_perm('companies.edit'))
  with check (app.same_company(id));

-- No DELETE policy anywhere: §2.13 rule 19/21 require archiving, not deletion.

-- -----------------------------------------------------------------------------
-- Merchants — §2.3.  Scoped by company AND by the user's merchant data scope.
-- -----------------------------------------------------------------------------
create policy merchants_select on public.merchants
  for select to authenticated
  using (app.same_company(company_id) and app.in_scope('merchant', id));

create policy merchants_insert on public.merchants
  for insert to authenticated
  with check (app.same_company(company_id) and app.has_perm('merchants.create'));

create policy merchants_update on public.merchants
  for update to authenticated
  using (app.same_company(company_id) and app.in_scope('merchant', id) and app.has_perm('merchants.edit'))
  with check (app.same_company(company_id));

-- -----------------------------------------------------------------------------
-- Stores — §2.4.  A store is visible only if its merchant is too.
-- -----------------------------------------------------------------------------
create policy stores_select on public.stores
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.in_scope('store', id)
  );

create policy stores_insert on public.stores
  for insert to authenticated
  with check (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('stores.create')
  );

create policy stores_update on public.stores
  for update to authenticated
  using (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.in_scope('store', id)
    and app.has_perm('stores.edit')
  )
  with check (app.same_company(company_id) and app.in_scope('merchant', merchant_id));

-- store_credentials: intentionally NO policy. Only the service role reaches it.

-- -----------------------------------------------------------------------------
-- Warehouses — §5.3
-- -----------------------------------------------------------------------------
create policy warehouses_select on public.warehouses
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.in_scope('warehouse', id)
    and app.can_access_merchant(dedicated_merchant_id)
  );

create policy warehouses_insert on public.warehouses
  for insert to authenticated
  with check (app.same_company(company_id) and app.has_perm('warehouses.create'));

create policy warehouses_update on public.warehouses
  for update to authenticated
  using (app.same_company(company_id) and app.in_scope('warehouse', id) and app.has_perm('warehouses.edit'))
  with check (app.same_company(company_id));

-- -----------------------------------------------------------------------------
-- Users — §2.5.  Everyone may read their own record; reading others needs the
-- users.view permission and lands inside the same company.
-- -----------------------------------------------------------------------------
create policy app_users_select on public.app_users
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or (app.same_company(company_id) and app.has_perm('users.view'))
  );

create policy app_users_insert on public.app_users
  for insert to authenticated
  with check (app.same_company(company_id) and app.has_perm('users.create'));

create policy app_users_update on public.app_users
  for update to authenticated
  using (
    auth_user_id = auth.uid()
    or (app.same_company(company_id) and app.has_perm('users.edit'))
  )
  with check (
    auth_user_id = auth.uid()
    or (app.same_company(company_id) and app.has_perm('users.edit'))
  );

-- -----------------------------------------------------------------------------
-- Org structure — §2.8
-- -----------------------------------------------------------------------------
create policy departments_select on public.departments
  for select to authenticated using (app.same_company(company_id));
create policy departments_write on public.departments
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('departments.manage'))
  with check (app.same_company(company_id) and app.has_perm('departments.manage'));

create policy teams_select on public.teams
  for select to authenticated using (app.same_company(company_id));
create policy teams_write on public.teams
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('teams.manage'))
  with check (app.same_company(company_id) and app.has_perm('teams.manage'));

create policy shifts_select on public.shifts
  for select to authenticated using (app.same_company(company_id));
create policy shifts_write on public.shifts
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('shifts.manage'))
  with check (app.same_company(company_id) and app.has_perm('shifts.manage'));

create policy team_members_select on public.team_members
  for select to authenticated
  using (exists (select 1 from public.teams t where t.id = team_id and app.same_company(t.company_id)));
create policy team_members_write on public.team_members
  for all to authenticated
  using (exists (select 1 from public.teams t where t.id = team_id and app.same_company(t.company_id)) and app.has_perm('teams.manage'))
  with check (exists (select 1 from public.teams t where t.id = team_id and app.same_company(t.company_id)) and app.has_perm('teams.manage'));

create policy shift_members_select on public.shift_members
  for select to authenticated
  using (exists (select 1 from public.shifts s where s.id = shift_id and app.same_company(s.company_id)));
create policy shift_members_write on public.shift_members
  for all to authenticated
  using (exists (select 1 from public.shifts s where s.id = shift_id and app.same_company(s.company_id)) and app.has_perm('shifts.manage'))
  with check (exists (select 1 from public.shifts s where s.id = shift_id and app.same_company(s.company_id)) and app.has_perm('shifts.manage'));

-- -----------------------------------------------------------------------------
-- RBAC — §2.6, §2.7
-- -----------------------------------------------------------------------------

-- The permission catalogue is reference data; any signed-in user may read it so
-- the permission matrix screen can render. It is never writable from a client.
create policy permissions_select on public.permissions
  for select to authenticated using (true);

create policy roles_select on public.roles
  for select to authenticated
  using (company_id is null or app.same_company(company_id));

create policy roles_write on public.roles
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('roles.manage'))
  with check (app.same_company(company_id) and app.has_perm('roles.manage'));

create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (exists (
    select 1 from public.roles r
    where r.id = role_id and (r.company_id is null or app.same_company(r.company_id))
  ));

create policy role_permissions_write on public.role_permissions
  for all to authenticated
  using (exists (
    select 1 from public.roles r where r.id = role_id and app.same_company(r.company_id)
  ) and app.has_perm('roles.manage'))
  with check (exists (
    select 1 from public.roles r where r.id = role_id and app.same_company(r.company_id)
  ) and app.has_perm('roles.manage'));

create policy user_roles_select on public.user_roles
  for select to authenticated
  using (
    user_id = app.uid()
    or exists (select 1 from public.app_users u where u.id = user_id and app.same_company(u.company_id))
  );

create policy user_roles_write on public.user_roles
  for all to authenticated
  using (exists (
    select 1 from public.app_users u where u.id = user_id and app.same_company(u.company_id)
  ) and app.has_perm('users.assign_roles'))
  with check (exists (
    select 1 from public.app_users u where u.id = user_id and app.same_company(u.company_id)
  ) and app.has_perm('users.assign_roles'));

create policy user_data_scopes_select on public.user_data_scopes
  for select to authenticated
  using (
    user_id = app.uid()
    or exists (select 1 from public.app_users u where u.id = user_id and app.same_company(u.company_id))
  );

create policy user_data_scopes_write on public.user_data_scopes
  for all to authenticated
  using (exists (
    select 1 from public.app_users u where u.id = user_id and app.same_company(u.company_id)
  ) and app.has_perm('users.assign_roles'))
  with check (exists (
    select 1 from public.app_users u where u.id = user_id and app.same_company(u.company_id)
  ) and app.has_perm('users.assign_roles'));

create policy role_field_policies_select on public.role_field_policies
  for select to authenticated
  using (exists (
    select 1 from public.roles r
    where r.id = role_id and (r.company_id is null or app.same_company(r.company_id))
  ));

create policy role_field_policies_write on public.role_field_policies
  for all to authenticated
  using (exists (
    select 1 from public.roles r where r.id = role_id and app.same_company(r.company_id)
  ) and app.has_perm('roles.manage'))
  with check (exists (
    select 1 from public.roles r where r.id = role_id and app.same_company(r.company_id)
  ) and app.has_perm('roles.manage'));

-- -----------------------------------------------------------------------------
-- Approvals — §2.7.4
-- -----------------------------------------------------------------------------
create policy approval_requests_select on public.approval_requests
  for select to authenticated using (app.same_company(company_id));

create policy approval_requests_insert on public.approval_requests
  for insert to authenticated
  with check (app.same_company(company_id) and requested_by = app.uid());

-- The SoD constraint on the table blocks self-approval; this policy adds the
-- permission requirement on top.
create policy approval_requests_decide on public.approval_requests
  for update to authenticated
  using (app.same_company(company_id) and app.has_perm('approvals.decide'))
  with check (app.same_company(company_id) and app.has_perm('approvals.decide'));

-- -----------------------------------------------------------------------------
-- Logs — read-only to clients, written only by SECURITY DEFINER triggers and
-- the service role. No INSERT/UPDATE/DELETE policies exist by design (§2.9).
-- -----------------------------------------------------------------------------
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('audit.view'));

create policy login_attempts_select on public.login_attempts
  for select to authenticated
  using (
    user_id = app.uid()
    or (app.has_perm('audit.view')
        and exists (select 1 from public.app_users u where u.id = user_id and app.same_company(u.company_id)))
  );

create policy sync_log_select on public.sync_log
  for select to authenticated
  using (app.same_company(company_id) and app.can_access_store(store_id));

create policy notifications_select on public.notifications
  for select to authenticated
  using (recipient_id = app.uid());

create policy notifications_update on public.notifications
  for update to authenticated
  using (recipient_id = app.uid())
  with check (recipient_id = app.uid());

-- -----------------------------------------------------------------------------
-- Views inherit the RLS of their underlying tables when created with
-- security_invoker. Without it a view would run as its owner and leak.
-- -----------------------------------------------------------------------------
alter view public.syncable_stores set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Table-level grants. RLS narrows rows; grants decide which verbs exist at all.
-- Note the deliberate absence of DELETE for every table.
-- -----------------------------------------------------------------------------
grant usage on schema public to authenticated;

grant select, insert, update on
  public.companies, public.merchants, public.stores, public.warehouses,
  public.app_users, public.departments, public.teams, public.shifts,
  public.roles, public.approval_requests
to authenticated;

grant select, insert, update, delete on
  public.team_members, public.shift_members, public.role_permissions,
  public.user_roles, public.user_data_scopes, public.role_field_policies
to authenticated;

grant select on
  public.permissions, public.audit_log, public.login_attempts,
  public.sync_log, public.syncable_stores
to authenticated;

grant select, update on public.notifications to authenticated;

-- Credentials are never granted to a client role.
revoke all on public.store_credentials from anon, authenticated;
