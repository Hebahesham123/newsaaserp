-- =============================================================================
-- Green ERP — 0019 Finance RLS, permissions & seed data  (spec §7)
--
-- §7.11 names eight capabilities that must be independently controllable, and
-- §2.7.2 requires every financial permission to be isolated. So "view costs",
-- "edit costs", "view profit", "approve expense", "approve invoice" and "run
-- settlement" are six separate grants, not one finance role.
--
-- Every one of them is marked sensitive, which is what makes §2.9 log the reads
-- as well as the writes.
-- =============================================================================

alter table public.finance_periods           enable row level security;
alter table public.order_costs               enable row level security;
alter table public.marketing_expenses        enable row level security;
alter table public.expense_categories        enable row level security;
alter table public.operating_expenses        enable row level security;
alter table public.merchant_settlements      enable row level security;
alter table public.merchant_settlement_lines enable row level security;
alter table public.invoices                  enable row level security;
alter table public.invoice_lines             enable row level security;

-- -----------------------------------------------------------------------------
-- Permissions — §7.11
-- -----------------------------------------------------------------------------

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('finance.costs.view',        'finance', 'order_costs',    'view',      'View order costs',            'عرض التكاليف',                    true,  false, 5000),
  ('finance.costs.edit',        'finance', 'order_costs',    'edit',      'Edit order costs',            'تعديل التكاليف',                  true,  false, 5001),
  ('finance.costs.edit_closed', 'finance', 'order_costs',    'edit',      'Edit costs in a closed period','تعديل تكاليف فترة مقفلة',        true,  true,  5002),
  ('finance.profit.view',       'finance', 'profitability',  'view',      'View profitability',          'عرض الأرباح',                     true,  false, 5003),
  ('finance.marketing.view',    'finance', 'marketing',      'view',      'View marketing spend',        'عرض مصروفات التسويق',             true,  false, 5004),
  ('finance.marketing.manage',  'finance', 'marketing',      'edit',      'Record marketing spend',      'تسجيل مصروفات التسويق',           true,  false, 5005),
  ('finance.expenses.view',     'finance', 'expenses',       'view',      'View expenses',               'عرض المصروفات',                   true,  false, 5006),
  ('finance.expenses.create',   'finance', 'expenses',       'create',    'Add an expense',              'إضافة مصروف',                     false, false, 5007),
  ('finance.expenses.approve',  'finance', 'expenses',       'approve',   'Approve an expense',          'اعتماد المصروف',                  true,  true,  5008),
  ('finance.settlement.view',   'finance', 'settlements',    'view',      'View merchant settlements',   'عرض تسويات التجار',               true,  false, 5009),
  ('finance.settlement.run',    'finance', 'settlements',    'create',    'Run a settlement',            'تنفيذ تسوية',                     true,  false, 5010),
  ('finance.settlement.approve','finance', 'settlements',    'approve',   'Approve a settlement',        'اعتماد التسوية',                  true,  true,  5011),
  ('finance.invoice.view',      'finance', 'invoices',       'view',      'View invoices',               'عرض الفواتير',                    true,  false, 5012),
  ('finance.invoice.create',    'finance', 'invoices',       'create',    'Create an invoice',           'إنشاء فاتورة',                    true,  false, 5013),
  ('finance.invoice.approve',   'finance', 'invoices',       'approve',   'Approve an invoice',          'اعتماد فاتورة',                   true,  true,  5014),
  ('finance.period.close',      'finance', 'periods',        'configure', 'Close an accounting period',  'إقفال الفترة المالية',            true,  true,  5015),
  ('finance.export',            'finance', 'financial_reports','export',  'Export financial reports',    'تصدير التقارير المالية',          true,  false, 5016)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Role grants. Deliberately narrow: finance is where §2.7.2 matters most.
-- -----------------------------------------------------------------------------

select app.grant_perms_to_template('super_admin',   array['*']);
select app.grant_perms_to_template('system_admin',  array['finance.*']);
select app.grant_perms_to_template('company_admin', array['finance.*']);

-- The accountant does the work; approvals are held by management so maker and
-- checker are different people (§2.7.4).
select app.grant_perms_to_template('accountant', array[
  'finance.costs.view', 'finance.costs.edit', 'finance.profit.view',
  'finance.marketing.view', 'finance.marketing.manage',
  'finance.expenses.view', 'finance.expenses.create',
  'finance.settlement.view', 'finance.settlement.run',
  'finance.invoice.view', 'finance.invoice.create', 'finance.export'
]);

select app.grant_perms_to_template('operations_manager', array[
  'finance.costs.view', 'finance.profit.view', 'finance.expenses.view',
  'finance.expenses.create', 'finance.expenses.approve',
  'finance.settlement.view', 'finance.settlement.approve',
  'finance.invoice.view', 'finance.invoice.approve', 'finance.export'
]);

select app.grant_perms_to_template('marketing_manager', array[
  'finance.marketing.view', 'finance.marketing.manage', 'finance.profit.view', 'finance.export'
]);

-- A merchant sees their own settlements and invoices, never the company's costs.
select app.grant_perms_to_template('merchant_admin', array[
  'finance.settlement.view', 'finance.invoice.view', 'finance.export'
]);

select app.grant_perms_to_template('warehouse_manager', array['finance.expenses.view', 'finance.expenses.create']);
select app.grant_perms_to_template('store_manager',     array['finance.profit.view']);
select app.grant_perms_to_template('quality_auditor',   array['finance.costs.view', 'finance.profit.view', 'finance.settlement.view', 'finance.invoice.view']);
select app.grant_perms_to_template('reports_viewer',    array['finance.profit.view']);

-- -----------------------------------------------------------------------------
-- Policies
-- -----------------------------------------------------------------------------

create policy finance_periods_select on public.finance_periods
  for select to authenticated using (app.same_company(company_id));

create policy finance_periods_write on public.finance_periods
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('finance.period.close'))
  with check (app.same_company(company_id) and app.has_perm('finance.period.close'));

create policy order_costs_select on public.order_costs
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('finance.costs.view')
  );

create policy order_costs_write on public.order_costs
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('finance.costs.edit'))
  with check (app.same_company(company_id) and app.has_perm('finance.costs.edit'));

create policy marketing_expenses_select on public.marketing_expenses
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.can_access_merchant(merchant_id)
    and app.has_perm('finance.marketing.view')
  );

create policy marketing_expenses_write on public.marketing_expenses
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('finance.marketing.manage'))
  with check (app.same_company(company_id) and app.has_perm('finance.marketing.manage'));

create policy expense_categories_select on public.expense_categories
  for select to authenticated using (app.same_company(company_id));

create policy expense_categories_write on public.expense_categories
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('finance.expenses.approve'))
  with check (app.same_company(company_id) and app.has_perm('finance.expenses.approve'));

create policy operating_expenses_select on public.operating_expenses
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.can_access_merchant(merchant_id)
    and app.can_access_warehouse(warehouse_id)
    and app.has_perm('finance.expenses.view')
  );

create policy operating_expenses_write on public.operating_expenses
  for all to authenticated
  using (
    app.same_company(company_id)
    and (app.has_perm('finance.expenses.create') or app.has_perm('finance.expenses.approve'))
  )
  with check (
    app.same_company(company_id)
    and (app.has_perm('finance.expenses.create') or app.has_perm('finance.expenses.approve'))
  );

create policy merchant_settlements_select on public.merchant_settlements
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('finance.settlement.view')
  );

create policy merchant_settlements_write on public.merchant_settlements
  for all to authenticated
  using (
    app.same_company(company_id)
    and (app.has_perm('finance.settlement.run') or app.has_perm('finance.settlement.approve'))
  )
  with check (app.same_company(company_id));

create policy merchant_settlement_lines_select on public.merchant_settlement_lines
  for select to authenticated
  using (exists (
    select 1 from public.merchant_settlements s
    where s.id = settlement_id
      and app.same_company(s.company_id)
      and app.in_scope('merchant', s.merchant_id)
      and app.has_perm('finance.settlement.view')
  ));

create policy merchant_settlement_lines_write on public.merchant_settlement_lines
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('finance.settlement.run'))
  with check (app.same_company(company_id) and app.has_perm('finance.settlement.run'));

create policy invoices_select on public.invoices
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.can_access_merchant(merchant_id)
    and app.has_perm('finance.invoice.view')
  );

create policy invoices_write on public.invoices
  for all to authenticated
  using (
    app.same_company(company_id)
    and (app.has_perm('finance.invoice.create') or app.has_perm('finance.invoice.approve'))
  )
  with check (app.same_company(company_id));

create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and app.same_company(i.company_id) and app.has_perm('finance.invoice.view')
  ));

create policy invoice_lines_write on public.invoice_lines
  for all to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and app.same_company(i.company_id) and app.has_perm('finance.invoice.create')
  ))
  with check (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and app.same_company(i.company_id) and app.has_perm('finance.invoice.create')
  ));

-- -----------------------------------------------------------------------------
-- Profitability views run as the caller, so `finance.profit.view` is enforced
-- through the underlying order and cost policies rather than duplicated here.
-- -----------------------------------------------------------------------------

alter view public.order_profitability    set (security_invoker = on);
alter view public.merchant_profitability set (security_invoker = on);
alter view public.campaign_profitability set (security_invoker = on);
alter view public.product_profitability  set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Grants. DELETE only where the spec allows a row to genuinely disappear:
-- a draft invoice line, and a cost line that was entered in error.
-- -----------------------------------------------------------------------------

grant select, insert, update on
  public.finance_periods, public.marketing_expenses, public.expense_categories,
  public.operating_expenses, public.merchant_settlements, public.merchant_settlement_lines,
  public.invoices
to authenticated;

grant select, insert, update, delete on public.order_costs, public.invoice_lines to authenticated;

grant select on
  public.order_profitability, public.merchant_profitability,
  public.campaign_profitability, public.product_profitability
to authenticated;

grant usage on sequence
  public.expense_number_seq, public.settlement_number_seq, public.invoice_number_seq
to authenticated;

grant execute on function public.calculate_merchant_settlement(uuid) to authenticated;
grant execute on function public.rebuild_order_costs(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Backfill role clones.
-- -----------------------------------------------------------------------------

do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_roles(v_company);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- §7.10 the spec's own expense list, as editable categories.
-- -----------------------------------------------------------------------------

create or replace function app.provision_company_finance_defaults(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.expense_categories (company_id, code, name_en, name_ar, is_direct, sort_order)
  select p_company_id, c.code, c.name_en, c.name_ar, c.direct, c.ord
  from (values
    ('warehouse_rent', 'Warehouse rent',        'إيجار المخزن',            true,   1),
    ('salaries',       'Salaries',              'رواتب الموظفين',          false,  2),
    ('electricity',    'Electricity',           'الكهرباء',                false,  3),
    ('internet',       'Internet',              'الإنترنت',                false,  4),
    ('packaging',      'Packaging',             'مواد التغليف',            true,   5),
    ('maintenance',    'Equipment maintenance', 'صيانة المعدات',           false,  6),
    ('fuel',           'Fuel',                  'الوقود',                  true,   7),
    ('internal_transport', 'Internal transport','الشحن الداخلي',           true,   8),
    ('software',       'Software & subscriptions','البرامج والاشتراكات',   false,  9),
    ('other',          'Other expense',         'مصروف آخر',               false, 10)
  ) as c(code, name_en, name_ar, direct, ord)
  on conflict (company_id, code) do nothing;
end;
$$;

create or replace function app.provision_finance_defaults_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.provision_company_finance_defaults(new.id);
  return new;
end;
$$;

create trigger companies_provision_finance_defaults
  after insert on public.companies
  for each row execute function app.provision_finance_defaults_trigger();

do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_finance_defaults(v_company);
  end loop;
end $$;
