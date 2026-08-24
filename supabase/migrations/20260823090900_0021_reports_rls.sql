-- =============================================================================
-- Green ERP — 0021 Reports RLS & permissions  (spec §9)
--
-- §9.19 requires report-level permissions, including hiding costs and profits
-- from roles that may not see them. That is *not* implemented as a second
-- permission system here: every rpt_* view is `security_invoker`, so it returns
-- exactly the rows the caller's own policies allow, and a cost column simply
-- has no rows to show someone without `finance.costs.view`.
--
-- What this migration adds on top is the coarser gate: who may open the reports
-- module at all, who may build a report, and who may schedule one.
-- =============================================================================

alter table public.report_definitions enable row level security;
alter table public.saved_filters      enable row level security;
alter table public.report_schedules   enable row level security;
alter table public.report_runs        enable row level security;

-- -----------------------------------------------------------------------------
-- Permissions — §9.19
-- -----------------------------------------------------------------------------

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('reports.view',        'reports', 'reports',        'view',      'View reports',              'عرض التقارير',                false, false, 6000),
  ('reports.build',       'reports', 'report_builder', 'create',    'Build custom reports',      'إنشاء تقارير مخصصة',          false, false, 6001),
  ('reports.schedule',    'reports', 'schedules',      'configure', 'Schedule report delivery',  'جدولة إرسال التقارير',        false, false, 6002),
  ('reports.export',      'reports', 'reports',        'export',    'Export reports',            'تصدير التقارير',              true,  false, 6003),
  ('reports.dashboard',   'reports', 'dashboards',     'view',      'View dashboards',           'عرض لوحات التحكم',            false, false, 6004),
  ('reports.executive',   'reports', 'executive_board','view',      'View the executive board',  'عرض لوحة الإدارة التنفيذية',  true,  false, 6005),
  ('reports.runs.view',   'reports', 'report_runs',    'view',      'View report run history',   'عرض سجل تشغيل التقارير',      false, false, 6006)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Role grants
-- -----------------------------------------------------------------------------

select app.grant_perms_to_template('super_admin',   array['*']);
select app.grant_perms_to_template('system_admin',  array['reports.*']);
select app.grant_perms_to_template('company_admin', array['reports.*']);

select app.grant_perms_to_template('operations_manager', array[
  'reports.view', 'reports.build', 'reports.schedule', 'reports.export',
  'reports.dashboard', 'reports.executive', 'reports.runs.view'
]);

select app.grant_perms_to_template('accountant', array[
  'reports.view', 'reports.build', 'reports.export', 'reports.dashboard'
]);

select app.grant_perms_to_template('marketing_manager', array[
  'reports.view', 'reports.build', 'reports.export', 'reports.dashboard'
]);

select app.grant_perms_to_template('merchant_admin', array[
  'reports.view', 'reports.export', 'reports.dashboard'
]);

select app.grant_perms_to_template('warehouse_manager',       array['reports.view', 'reports.export', 'reports.dashboard']);
select app.grant_perms_to_template('store_manager',           array['reports.view', 'reports.dashboard']);
select app.grant_perms_to_template('confirmation_team_leader',array['reports.view', 'reports.dashboard']);
select app.grant_perms_to_template('inventory_controller',    array['reports.view']);
select app.grant_perms_to_template('quality_auditor',         array['reports.view', 'reports.export', 'reports.dashboard', 'reports.runs.view']);

-- The role exists precisely to read reports and nothing else.
select app.grant_perms_to_template('reports_viewer', array[
  'reports.view', 'reports.export', 'reports.dashboard'
]);

-- -----------------------------------------------------------------------------
-- Policies
-- -----------------------------------------------------------------------------

-- Platform templates (company_id null) are readable by every authenticated user
-- who may open reports; a tenant's own definitions are theirs alone.
create policy report_definitions_select on public.report_definitions
  for select to authenticated
  using (
    app.has_perm('reports.view')
    and (company_id is null or app.same_company(company_id))
    -- §9.19 a definition can declare the permission its data needs; without it
    -- the report is not even listed.
    and (requires_permission is null or app.has_perm(requires_permission))
  );

create policy report_definitions_write on public.report_definitions
  for all to authenticated
  using (company_id is not null and app.same_company(company_id) and app.has_perm('reports.build') and not is_system)
  with check (company_id is not null and app.same_company(company_id) and app.has_perm('reports.build') and not is_system);

-- §9.16 a saved filter is personal.
create policy saved_filters_select on public.saved_filters
  for select to authenticated
  using (user_id = app.uid());

create policy saved_filters_write on public.saved_filters
  for all to authenticated
  using (user_id = app.uid())
  with check (user_id = app.uid() and app.same_company(company_id));

create policy report_schedules_select on public.report_schedules
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('reports.view'));

create policy report_schedules_write on public.report_schedules
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('reports.schedule'))
  with check (app.same_company(company_id) and app.has_perm('reports.schedule'));

-- §9.19 the export log is readable by auditors, and append-only to everyone:
-- a user cannot delete the record of their own export.
create policy report_runs_select on public.report_runs
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('reports.runs.view'));

create policy report_runs_insert on public.report_runs
  for insert to authenticated
  with check (app.same_company(company_id) and app.has_perm('reports.view'));

-- -----------------------------------------------------------------------------
-- Reporting views run as the caller — this is the whole §9.19 mechanism.
-- -----------------------------------------------------------------------------

alter view public.rpt_orders                   set (security_invoker = on);
alter view public.rpt_confirmation_performance set (security_invoker = on);
alter view public.rpt_warehouse                set (security_invoker = on);
alter view public.rpt_shipments                set (security_invoker = on);
alter view public.rpt_returns                  set (security_invoker = on);
alter view public.rpt_collections              set (security_invoker = on);
alter view public.rpt_products                 set (security_invoker = on);
alter view public.rpt_customers                set (security_invoker = on);
alter view public.rpt_employees                set (security_invoker = on);
alter view public.rpt_executive_kpis           set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

grant select, insert, update, delete on public.saved_filters to authenticated;
grant select, insert, update on public.report_definitions, public.report_schedules to authenticated;
grant select, insert on public.report_runs to authenticated;

grant select on
  public.rpt_orders, public.rpt_confirmation_performance, public.rpt_warehouse,
  public.rpt_shipments, public.rpt_returns, public.rpt_collections,
  public.rpt_products, public.rpt_customers, public.rpt_employees,
  public.rpt_executive_kpis
to authenticated;

-- -----------------------------------------------------------------------------
-- Backfill role clones for existing companies — the last one, so this also
-- catches every permission added by migrations 0014 through 0020.
-- -----------------------------------------------------------------------------

do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_roles(v_company);
  end loop;
end $$;
