-- =============================================================================
-- Green ERP — 0024 Plans: access control, catalogue and starting grid
--
-- The Basic / Grow / Pro rows below are a **starting point, not a fixture**.
-- They are ordinary rows: a super admin can rename them, reprice them, change
-- any limit, add a fourth plan, or delete them outright without a deployment.
-- That is the whole point of modelling plans as data.
--
-- Existing companies are deliberately *not* assigned a plan. Their legacy
-- `max_*` columns keep applying via `app.company_limit`, so switching a live
-- tenant onto a plan stays a conscious decision rather than a side effect of
-- this migration — one that could otherwise put a tenant instantly over its
-- new limits.
-- =============================================================================

alter table public.features             enable row level security;
alter table public.plans                enable row level security;
alter table public.plan_entitlements    enable row level security;
alter table public.company_entitlements enable row level security;

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('plans.view',           'platform', 'plans',        'view',      'View plans',                  'عرض الخطط',                     false, false, 7000),
  ('plans.manage',         'platform', 'plans',        'configure', 'Create and price plans',      'إنشاء وتسعير الخطط',            true,  false, 7001),
  ('entitlements.manage',  'platform', 'entitlements', 'configure', 'Grant features to a company', 'منح المزايا لشركة',             true,  true,  7002),
  ('features.manage',      'platform', 'features',     'configure', 'Manage the feature catalogue','إدارة كتالوج المزايا',          true,  false, 7003)
on conflict (code) do nothing;

-- Plan and pricing administration is a platform concern, not a tenant one, so
-- only the two platform-level roles get it.
select app.grant_perms_to_template('super_admin',  array['*']);
select app.grant_perms_to_template('system_admin', array['plans.*', 'entitlements.*', 'features.*']);

-- A company admin may see which plan they are on; they cannot change it.
select app.grant_perms_to_template('company_admin', array['plans.view']);

-- -----------------------------------------------------------------------------
-- Policies
--
-- The catalogue and the plan grid are readable by every signed-in user: a
-- client has to be able to see what their plan includes, and what an upgrade
-- would give them. Only platform admins write.
-- -----------------------------------------------------------------------------

create policy features_select on public.features
  for select to authenticated using (true);

create policy features_write on public.features
  for all to authenticated
  using (app.has_perm('features.manage'))
  with check (app.has_perm('features.manage'));

create policy plans_select on public.plans
  for select to authenticated using (true);

create policy plans_write on public.plans
  for all to authenticated
  using (app.has_perm('plans.manage'))
  with check (app.has_perm('plans.manage'));

create policy plan_entitlements_select on public.plan_entitlements
  for select to authenticated using (true);

create policy plan_entitlements_write on public.plan_entitlements
  for all to authenticated
  using (app.has_perm('plans.manage'))
  with check (app.has_perm('plans.manage'));

-- A company sees its own grants; granting is platform-level.
create policy company_entitlements_select on public.company_entitlements
  for select to authenticated
  using (app.same_company(company_id));

create policy company_entitlements_write on public.company_entitlements
  for all to authenticated
  using (app.has_perm('entitlements.manage'))
  with check (app.has_perm('entitlements.manage'));

alter view public.company_features set (security_invoker = on);

grant select, insert, update, delete on
  public.features, public.plans, public.plan_entitlements, public.company_entitlements
to authenticated;

grant select on public.company_features to authenticated;

grant execute on function app.company_has_feature(uuid, text) to authenticated;
grant execute on function app.company_limit(uuid, text) to authenticated;

do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_roles(v_company);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Feature catalogue
--
-- Modules first: `features.module_code` is a self-reference, so a feature
-- cannot name its module before that module exists.
-- -----------------------------------------------------------------------------

insert into public.features (code, kind, module_code, name_en, name_ar, unit, sort_order) values
  ('module_ecommerce',    'module', null, 'E-Commerce Management', 'إدارة التجارة الإلكترونية', null, 10),
  ('module_fulfillment',  'module', null, 'Fulfillment',           'التنفيذ والتجهيز',           null, 20),
  ('module_operations',   'module', null, 'Operations Management', 'إدارة العمليات',             null, 30)
on conflict (code) do nothing;

insert into public.features (code, kind, module_code, name_en, name_ar, unit, sort_order) values
  -- Limits. Platform-wide, so no module.
  ('limit_stores',            'limit', null, 'Stores',              'المتاجر',                  'stores',     100),
  ('limit_users',             'limit', null, 'Users',               'المستخدمون',               'users',      110),
  ('limit_orders_per_month',  'limit', null, 'Orders per month',    'الطلبات شهريًا',            'orders',     120),
  ('limit_warehouses',        'limit', null, 'Warehouses',          'المخازن',                  'warehouses', 130),

  -- Core capabilities, present on every plan in the starting grid.
  ('order_management',     'feature', 'module_ecommerce',   'Order management',     'إدارة الطلبات',     null, 200),
  ('inventory_management', 'feature', 'module_fulfillment', 'Inventory management', 'إدارة المخزون',     null, 210),
  ('product_management',   'feature', 'module_ecommerce',   'Product management',   'إدارة المنتجات',    null, 220),
  ('customer_management',  'feature', 'module_ecommerce',   'Customer management',  'إدارة العملاء',     null, 230),
  ('returns_management',   'feature', 'module_fulfillment', 'Returns management',   'إدارة المرتجعات',   null, 240),

  -- Access, reporting and automation.
  ('roles_permissions',    'feature', null, 'Roles & permissions',       'الأدوار والصلاحيات',        null, 300),
  ('standard_reports',     'feature', null, 'Standard reports',          'التقارير الأساسية',         null, 310),
  ('advanced_reports',     'feature', null, 'Advanced reports & KPIs',   'التقارير المتقدمة والمؤشرات', null, 320),
  ('custom_dashboard',     'feature', null, 'Custom dashboard',          'لوحة تحكم مخصصة',           null, 330),
  ('automations',          'feature', null, 'Automations & workflows',   'الأتمتة وسير العمل',         null, 340),
  ('data_export',          'feature', null, 'Data export',               'تصدير البيانات',            null, 350),
  ('support_level',        'feature', null, 'Support level',             'مستوى الدعم',               null, 360),

  -- Commercial add-ons and integrations.
  ('affiliate_management',   'feature', null, 'Affiliate management',      'إدارة المسوقين بالعمولة',  null, 400),
  ('marketplace_integration','feature', null, 'Marketplace integration',   'التكامل مع المتاجر الكبرى', null, 410),
  ('shipping_integrations',  'feature', null, 'Shipping integrations',     'تكاملات الشحن',            null, 420),
  ('payment_integrations',   'feature', null, 'Payment integrations',      'تكاملات الدفع',            null, 430),
  ('accounting_integration', 'feature', null, 'Accounting / ERP',          'التكامل المحاسبي',         null, 440),
  ('api_access',             'feature', null, 'API access',                'الوصول للـ API',           null, 450),
  ('custom_integrations',    'feature', null, 'Custom integrations',       'تكاملات مخصصة',            null, 460)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- The starting grid
-- -----------------------------------------------------------------------------

insert into public.plans (code, name_en, name_ar, operating_model, sort_order, description) values
  ('basic', 'Basic', 'أساسية', null, 10, 'Entry plan. One store, core management, standard reports.'),
  ('grow',  'Grow',  'نمو',    null, 20, 'Multi-store with advanced reporting, affiliates and automations.'),
  ('pro',   'Pro',   'احترافية', null, 30, 'Full platform including marketplace, API access and priority support.')
on conflict (code) do nothing;

/**
 * Writes one cell of the pricing grid.
 *
 * Every cell in the brief is one of five shapes, and this maps them:
 *   a number   -> an included limit
 *   'yes'      -> included
 *   'no'       -> not included
 *   'addon'    -> purchasable per company
 *   a tier name-> included at basic / standard / advanced
 */
create or replace function app.set_plan_entitlement(
  p_plan_code text,
  p_feature_code text,
  p_value text,
  p_limit integer default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan    uuid;
  v_feature uuid;
begin
  select id into v_plan    from public.plans    where code = p_plan_code;
  select id into v_feature from public.features where code = p_feature_code;

  if v_plan is null or v_feature is null then
    raise exception 'Unknown plan % or feature %', p_plan_code, p_feature_code;
  end if;

  insert into public.plan_entitlements (plan_id, feature_id, is_included, is_addon, tier, limit_value)
  values (
    v_plan,
    v_feature,
    p_value in ('yes', 'basic', 'standard', 'advanced', 'limit'),
    p_value = 'addon',
    case when p_value in ('basic', 'standard', 'advanced') then p_value::public.feature_tier end,
    p_limit
  )
  on conflict (plan_id, feature_id) do update
    set is_included = excluded.is_included,
        is_addon    = excluded.is_addon,
        tier        = excluded.tier,
        limit_value = excluded.limit_value;
end;
$$;

comment on function app.set_plan_entitlement is
  'Sets one cell of a plan grid. Used by the seed below and available to any future plan-management tooling.';

do $$
declare
  v_plan    text;
  v_feature text;
begin
  -- Limits
  perform app.set_plan_entitlement('basic', 'limit_stores',           'limit', 1);
  perform app.set_plan_entitlement('grow',  'limit_stores',           'limit', 3);
  perform app.set_plan_entitlement('pro',   'limit_stores',           'limit', 10);

  perform app.set_plan_entitlement('basic', 'limit_users',            'limit', 3);
  perform app.set_plan_entitlement('grow',  'limit_users',            'limit', 7);
  perform app.set_plan_entitlement('pro',   'limit_users',            'limit', 15);

  perform app.set_plan_entitlement('basic', 'limit_orders_per_month', 'limit', 1000);
  perform app.set_plan_entitlement('grow',  'limit_orders_per_month', 'limit', 5000);
  perform app.set_plan_entitlement('pro',   'limit_orders_per_month', 'limit', 15000);

  perform app.set_plan_entitlement('basic', 'limit_warehouses',       'limit', 1);
  perform app.set_plan_entitlement('grow',  'limit_warehouses',       'limit', 2);
  perform app.set_plan_entitlement('pro',   'limit_warehouses',       'limit', 5);

  -- Core capabilities: on every plan.
  foreach v_plan in array array['basic', 'grow', 'pro'] loop
    foreach v_feature in array array[
      'module_ecommerce', 'module_fulfillment',
      'order_management', 'inventory_management',
      'product_management', 'customer_management',
      'standard_reports'
    ] loop
      perform app.set_plan_entitlement(v_plan, v_feature, 'yes');
    end loop;
  end loop;

  -- Returns: basic on Basic, full above.
  perform app.set_plan_entitlement('basic', 'returns_management', 'basic');
  perform app.set_plan_entitlement('grow',  'returns_management', 'yes');
  perform app.set_plan_entitlement('pro',   'returns_management', 'yes');

  -- Roles: basic, full, then advanced.
  perform app.set_plan_entitlement('basic', 'roles_permissions', 'basic');
  perform app.set_plan_entitlement('grow',  'roles_permissions', 'yes');
  perform app.set_plan_entitlement('pro',   'roles_permissions', 'advanced');

  perform app.set_plan_entitlement('basic', 'advanced_reports', 'no');
  perform app.set_plan_entitlement('grow',  'advanced_reports', 'yes');
  perform app.set_plan_entitlement('pro',   'advanced_reports', 'yes');

  perform app.set_plan_entitlement('basic', 'custom_dashboard', 'no');
  perform app.set_plan_entitlement('grow',  'custom_dashboard', 'yes');
  perform app.set_plan_entitlement('pro',   'custom_dashboard', 'yes');

  perform app.set_plan_entitlement('basic', 'automations', 'no');
  perform app.set_plan_entitlement('grow',  'automations', 'basic');
  perform app.set_plan_entitlement('pro',   'automations', 'advanced');

  perform app.set_plan_entitlement('basic', 'affiliate_management', 'no');
  perform app.set_plan_entitlement('grow',  'affiliate_management', 'yes');
  perform app.set_plan_entitlement('pro',   'affiliate_management', 'yes');

  -- Marketplace: an add-on on the lower plans, included on Pro. This is the
  -- capability that used to be an operating model.
  perform app.set_plan_entitlement('basic', 'marketplace_integration', 'addon');
  perform app.set_plan_entitlement('grow',  'marketplace_integration', 'addon');
  perform app.set_plan_entitlement('pro',   'marketplace_integration', 'yes');

  perform app.set_plan_entitlement('basic', 'shipping_integrations', 'basic');
  perform app.set_plan_entitlement('grow',  'shipping_integrations', 'yes');
  perform app.set_plan_entitlement('pro',   'shipping_integrations', 'yes');

  perform app.set_plan_entitlement('basic', 'payment_integrations', 'basic');
  perform app.set_plan_entitlement('grow',  'payment_integrations', 'yes');
  perform app.set_plan_entitlement('pro',   'payment_integrations', 'yes');

  perform app.set_plan_entitlement('basic', 'accounting_integration', 'no');
  perform app.set_plan_entitlement('grow',  'accounting_integration', 'addon');
  perform app.set_plan_entitlement('pro',   'accounting_integration', 'yes');

  perform app.set_plan_entitlement('basic', 'api_access', 'no');
  perform app.set_plan_entitlement('grow',  'api_access', 'no');
  perform app.set_plan_entitlement('pro',   'api_access', 'yes');

  perform app.set_plan_entitlement('basic', 'custom_integrations', 'no');
  perform app.set_plan_entitlement('grow',  'custom_integrations', 'addon');
  perform app.set_plan_entitlement('pro',   'custom_integrations', 'addon');

  perform app.set_plan_entitlement('basic', 'data_export', 'basic');
  perform app.set_plan_entitlement('grow',  'data_export', 'yes');
  perform app.set_plan_entitlement('pro',   'data_export', 'yes');

  perform app.set_plan_entitlement('basic', 'support_level', 'standard');
  perform app.set_plan_entitlement('grow',  'support_level', 'standard');
  perform app.set_plan_entitlement('pro',   'support_level', 'advanced');

  -- Operations-only tenants run neither storefront nor warehouse modules, so
  -- the module flags stay off until a plan for that model is created.
  perform app.set_plan_entitlement('basic', 'module_operations', 'no');
  perform app.set_plan_entitlement('grow',  'module_operations', 'no');
  perform app.set_plan_entitlement('pro',   'module_operations', 'yes');
end $$;

-- -----------------------------------------------------------------------------
-- Carry the old `marketplace` operating model across as a real grant
-- -----------------------------------------------------------------------------

insert into public.company_entitlements (company_id, feature_id, is_included, note)
select g.company_id, f.id, true,
       'Carried over from the marketplace operating model, retired in migration 0023.'
from public.pending_marketplace_grants g
cross join public.features f
where f.code = 'marketplace_integration'
on conflict (company_id, feature_id) do nothing;

drop table public.pending_marketplace_grants;
