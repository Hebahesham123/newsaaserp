-- =====================================================================
-- RUN THIS ONCE, IN THE SUPABASE SQL EDITOR.
--
-- Everything from the change request: plans, the department tree, KPIs,
-- user types, the customer directory and affiliates.
--
-- Paste the whole file into one tab and press Run. It is wrapped in a
-- single transaction: if any statement fails, nothing is applied and the
-- database is left exactly as it was, so a failed run is safe to retry
-- after the cause is fixed.
--
-- It is NOT safe to run twice. The second run fails on the first
-- `create table` and rolls itself back, which is noisy but harmless.
--
-- What it changes that you should know about:
--   * operating_model drops from 5 values to 3. Any company currently on
--     a marketplace model is recorded in `pending_marketplace_grants` for
--     you to reassign afterwards; no company row is deleted.
--   * 11 new permissions appear. Assign them to roles before the new
--     screens are usable by anyone but a super admin.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 20260824090000_0022_fix_barcode_upsert.sql
-- Barcode trigger fix (harmless if already applied)
-- ---------------------------------------------------------------------

-- =============================================================================
-- Green ERP — 0022 Fix the §3.13 rule 5 barcode check on upsert paths
--
-- `app.assert_barcode_unique` excluded the row being written with `id <> new.id`.
-- That is correct for a plain INSERT and for an UPDATE, but wrong for
-- `INSERT ... ON CONFLICT DO UPDATE`:
--
--   The BEFORE INSERT trigger fires *before* the conflict is detected, so
--   `new.id` holds a freshly generated uuid rather than the id of the row that
--   is about to be updated. The function then finds the existing row — the same
--   logical product — decides it is "another item", and raises.
--
--   The result: re-importing a product with its own unchanged barcode fails.
--   That breaks the §3.12 `products.import` path and any idempotent seed.
--
-- The fix is to identify "another item" by its **natural key** instead of its
-- surrogate one. SKU is already unique per merchant (§3.13 rule 3), so
-- `sku <> new.sku` expresses the rule the spec actually states — "two different
-- items may not share a barcode" — and is stable regardless of whether the row
-- is arriving as an insert, an update, or an upsert.
--
-- The rule itself is unchanged: two genuinely different SKUs still cannot share
-- a barcode unless the company opts in.
-- =============================================================================

create or replace function app.assert_barcode_unique()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed boolean;
  v_clash   boolean;
begin
  if new.barcode is null or new.barcode = '' then
    return new;
  end if;

  select coalesce((settings -> 'catalog' ->> 'allow_duplicate_barcodes')::boolean, false)
    into v_allowed
  from public.companies
  where id = new.company_id;

  if v_allowed then
    return new;
  end if;

  -- Compared on SKU, not id: see the header. `id <> new.id` is kept as a second
  -- guard so a row can never clash with itself even if two SKUs were somehow
  -- equal.
  if tg_table_name = 'products' then
    select exists (
      select 1 from public.products
      where merchant_id = new.merchant_id
        and barcode = new.barcode
        and sku <> new.sku
        and id <> new.id
    ) into v_clash;
  else
    select exists (
      select 1 from public.product_variants
      where merchant_id = new.merchant_id
        and barcode = new.barcode
        and sku <> new.sku
        and id <> new.id
    ) into v_clash;
  end if;

  if v_clash then
    raise exception
      'Barcode % is already used by another item for this merchant (spec §3.13 rule 5)', new.barcode
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

comment on function app.assert_barcode_unique is
  '§3.13 rule 5. Identifies "another item" by SKU rather than id, so the check survives INSERT ... ON CONFLICT DO UPDATE.';


-- ---------------------------------------------------------------------
-- 20260915090000_0023_plans_and_modules.sql
-- Plans, features, entitlements. Retypes operating_model 5 values to 3.
-- ---------------------------------------------------------------------

-- =============================================================================
-- Green ERP — 0023 Operating models, plans, modules & entitlements
--
-- Three changes that belong together, because each depends on the one before:
--
--  1. **Operating models collapse to three.** `own_store` and `multi_store`
--     differed only in how many stores were allowed — which is a plan limit,
--     not a way of operating. `marketplace` was likewise a capability rather
--     than a model. Both fold into `ecommerce_store_management`.
--
--  2. **Plans become data, not code.** The brief is explicit that Basic / Grow
--     / Pro must not be hard-coded: a super admin has to be able to create a
--     plan and set its limits and features so pricing can change without a
--     deployment. So a plan is a row, its entitlements are rows, and the
--     seeded Basic/Grow/Pro are a starting point that can be edited or deleted.
--
--  3. **Modules are just features.** "Which modules is this client on" and
--     "does this client have the affiliate feature" are the same question, so
--     they share one mechanism rather than two that can disagree.
--
-- Resolution order for any entitlement is: company override → plan → nothing.
-- The override layer is what makes an "Add-on" cell purchasable per client.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Operating models — five become three
--
-- Postgres cannot remove a value from an enum, so the column is retyped onto a
-- new enum. Which companies were on `marketplace` is captured first, because
-- that fact has to survive as a feature grant once the value is gone.
-- -----------------------------------------------------------------------------

create temporary table _marketplace_companies as
select id from public.companies where operating_model::text = 'marketplace';

create temporary table _marketplace_merchants as
select id from public.merchants where operating_model::text = 'marketplace';

alter table public.companies alter column operating_model drop default;
alter table public.merchants alter column operating_model drop default;

create type public.operating_model_v2 as enum (
  'ecommerce_store_management', 'fulfillment', 'operations_only'
);

alter table public.companies
  alter column operating_model type public.operating_model_v2
  using (
    case operating_model::text
      when 'fulfillment_center' then 'fulfillment'
      when 'operations_only'    then 'operations_only'
      -- own_store, multi_store and marketplace were all ways of selling.
      else 'ecommerce_store_management'
    end
  )::public.operating_model_v2;

alter table public.merchants
  alter column operating_model type public.operating_model_v2
  using (
    case operating_model::text
      when 'fulfillment_center' then 'fulfillment'
      when 'operations_only'    then 'operations_only'
      else 'ecommerce_store_management'
    end
  )::public.operating_model_v2;

drop type public.operating_model;
alter type public.operating_model_v2 rename to operating_model;

alter table public.companies
  alter column operating_model set default 'ecommerce_store_management';
alter table public.merchants
  alter column operating_model set default 'ecommerce_store_management';

-- -----------------------------------------------------------------------------
-- 2. Feature catalogue
-- -----------------------------------------------------------------------------

-- `module` gates a whole area of the product and drives dashboard composition.
-- `feature` is a capability inside one. `limit` is a number rather than a flag.
create type public.feature_kind as enum ('module', 'feature', 'limit');

-- How generously a feature is granted, for the cells the brief writes as
-- "Basic" or "Advanced" rather than a plain tick.
create type public.feature_tier as enum ('basic', 'standard', 'advanced');

create table public.features (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  kind        public.feature_kind not null,
  -- Which module a feature belongs to; null for modules themselves and for
  -- limits that apply platform-wide.
  module_code text references public.features (code) on delete set null,

  name_en     text not null,
  name_ar     text not null,
  description text,

  -- Limits only: the unit, so the UI renders "10 stores" rather than "10".
  unit        text,

  is_active   boolean not null default true,
  sort_order  integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.features is
  'Catalogue of everything a plan can grant: modules, features within them, and numeric limits. Rows rather than code, so a new capability is a row.';

create index features_kind_idx on public.features (kind, sort_order);

create trigger features_set_updated_at
  before update on public.features
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Plans
-- -----------------------------------------------------------------------------

create table public.plans (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name_en     text not null,
  name_ar     text not null,
  description text,

  -- A plan may be offered for one operating model, or for all when null.
  operating_model public.operating_model,

  monthly_price numeric(14,2) check (monthly_price is null or monthly_price >= 0),
  currency    char(3) not null default 'EGP',

  is_active   boolean not null default true,
  sort_order  integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,
  updated_by  uuid references public.app_users (id) on delete set null
);

comment on table public.plans is
  'Subscription plans as data. Super admins create and price them; nothing in the application hard-codes Basic/Grow/Pro.';

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function app.set_updated_at();

-- One row per (plan, feature). Between them these four columns express every
-- cell in the pricing grid: a tick, a dash, "Add-on", "Basic"/"Advanced", or a
-- number.
create table public.plan_entitlements (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans (id) on delete cascade,
  feature_id  uuid not null references public.features (id) on delete cascade,

  is_included boolean not null default false,
  -- Not in the plan, but the client may buy it. Activated per company below.
  is_addon    boolean not null default false,
  tier        public.feature_tier,
  -- Null on an included limit means unlimited.
  limit_value integer check (limit_value is null or limit_value >= 0),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint plan_entitlements_unique unique (plan_id, feature_id),
  -- Included and available-as-an-add-on are different states, not both.
  constraint plan_entitlements_addon_check check (not (is_included and is_addon))
);

create index plan_entitlements_plan_idx on public.plan_entitlements (plan_id);

create trigger plan_entitlements_set_updated_at
  before update on public.plan_entitlements
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. What a given company actually has
-- -----------------------------------------------------------------------------

alter table public.companies
  add column plan_id uuid references public.plans (id) on delete restrict;

comment on column public.companies.plan_id is
  'The plan this company is on. The legacy subscription_plan text and max_* columns remain as a fallback for companies not yet moved onto a plan.';

-- The override layer: a purchased add-on, a negotiated limit, or a feature
-- withheld from one client. Always wins over the plan.
create table public.company_entitlements (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  feature_id  uuid not null references public.features (id) on delete cascade,

  is_included boolean not null default true,
  tier        public.feature_tier,
  limit_value integer check (limit_value is null or limit_value >= 0),

  -- A trial or a fixed-term add-on stops counting once it expires.
  starts_on   date,
  ends_on     date,
  note        text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,
  updated_by  uuid references public.app_users (id) on delete set null,

  constraint company_entitlements_unique unique (company_id, feature_id),
  constraint company_entitlements_window check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

comment on table public.company_entitlements is
  'Per-company overrides on top of the plan — purchased add-ons, negotiated limits, or a capability withheld. This is what makes an Add-on cell actionable.';

create index company_entitlements_company_idx on public.company_entitlements (company_id);

create trigger company_entitlements_set_updated_at
  before update on public.company_entitlements
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Resolution
--
-- One function per question, both SECURITY DEFINER so policies and triggers can
-- call them without recursing through the tables they protect.
-- -----------------------------------------------------------------------------

create or replace function app.company_has_feature(p_company_id uuid, p_feature_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with override as (
    select ce.is_included
    from public.company_entitlements ce
    join public.features f on f.id = ce.feature_id
    where ce.company_id = p_company_id
      and f.code = p_feature_code
      and f.is_active
      and (ce.starts_on is null or ce.starts_on <= current_date)
      and (ce.ends_on is null or ce.ends_on >= current_date)
  ),
  from_plan as (
    select pe.is_included
    from public.companies c
    join public.plan_entitlements pe on pe.plan_id = c.plan_id
    join public.features f on f.id = pe.feature_id
    where c.id = p_company_id
      and f.code = p_feature_code
      and f.is_active
  )
  -- Override first, then the plan, then not granted.
  select coalesce(
    (select is_included from override),
    (select is_included from from_plan),
    false
  );
$$;

comment on function app.company_has_feature is
  'Is this capability active for this company? A company override wins over the plan; absent means no.';

create or replace function app.company_limit(p_company_id uuid, p_feature_code text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- NULL means unlimited at every layer. The legacy columns on `companies` are
  -- the last resort, so a company with no plan behaves exactly as before.
  select coalesce(
    (select ce.limit_value
       from public.company_entitlements ce
       join public.features f on f.id = ce.feature_id
      where ce.company_id = p_company_id and f.code = p_feature_code
        and (ce.ends_on is null or ce.ends_on >= current_date)),
    (select pe.limit_value
       from public.companies c
       join public.plan_entitlements pe on pe.plan_id = c.plan_id
       join public.features f on f.id = pe.feature_id
      where c.id = p_company_id and f.code = p_feature_code and pe.is_included),
    (select case p_feature_code
              when 'limit_stores'            then c.max_stores
              when 'limit_users'             then c.max_users
              when 'limit_orders_per_month'  then c.max_monthly_orders
            end
       from public.companies c where c.id = p_company_id)
  );
$$;

comment on function app.company_limit is
  'Numeric limit for a company, or NULL for unlimited. Falls back to the legacy companies.max_* columns when no plan is assigned.';

/**
 * Everything a company is entitled to, in one readable row set.
 *
 * The application reads this to decide which dashboard widgets and navigation
 * entries exist. `security_invoker`, so a user sees only their own company.
 */
create view public.company_features as
select
  c.id                as company_id,
  f.code              as feature_code,
  f.kind,
  f.module_code,
  f.name_en,
  f.name_ar,
  f.unit,
  f.sort_order,
  app.company_has_feature(c.id, f.code) as is_active,
  app.company_limit(c.id, f.code)       as limit_value,
  coalesce(
    (select ce.tier from public.company_entitlements ce
      where ce.company_id = c.id and ce.feature_id = f.id),
    (select pe.tier from public.plan_entitlements pe
      where pe.plan_id = c.plan_id and pe.feature_id = f.id)
  ) as tier,
  -- Surfaced so the UI can offer "available on your plan as an add-on".
  coalesce((select pe.is_addon from public.plan_entitlements pe
             where pe.plan_id = c.plan_id and pe.feature_id = f.id), false) as is_addon
from public.companies c
cross join public.features f
where f.is_active;

comment on view public.company_features is
  'Resolved entitlements per company. The dashboard and navigation read this to decide what exists for a client.';

-- -----------------------------------------------------------------------------
-- 6. Limit enforcement
--
-- A limit nobody enforces is documentation. These sit alongside the §2.13
-- cascade rules: the database refuses, so no code path can quietly exceed it.
-- -----------------------------------------------------------------------------

create or replace function app.enforce_company_limit()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_limit integer;
  v_count integer;
  v_code  text;
begin
  v_code := case tg_table_name
              when 'stores'     then 'limit_stores'
              when 'app_users'  then 'limit_users'
              when 'warehouses' then 'limit_warehouses'
            end;

  if v_code is null or new.company_id is null then
    return new;
  end if;

  v_limit := app.company_limit(new.company_id, v_code);

  -- NULL is unlimited.
  if v_limit is null then
    return new;
  end if;

  execute format(
    'select count(*) from public.%I where company_id = $1 and archived_at is null',
    tg_table_name
  ) into v_count using new.company_id;

  if v_count >= v_limit then
    raise exception
      'The plan for this company allows % rows in %; archive one or move the company to a larger plan.',
      v_limit, tg_table_name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger stores_plan_limit
  before insert on public.stores
  for each row execute function app.enforce_company_limit();

create trigger app_users_plan_limit
  before insert on public.app_users
  for each row execute function app.enforce_company_limit();

create trigger warehouses_plan_limit
  before insert on public.warehouses
  for each row execute function app.enforce_company_limit();

-- -----------------------------------------------------------------------------
-- 7. Audit
-- -----------------------------------------------------------------------------

create trigger plans_audit                after insert or update or delete on public.plans                for each row execute function app.audit_trigger();
create trigger plan_entitlements_audit    after insert or update or delete on public.plan_entitlements    for each row execute function app.audit_trigger();
create trigger company_entitlements_audit after insert or update or delete on public.company_entitlements for each row execute function app.audit_trigger();
create trigger features_audit             after insert or update or delete on public.features             for each row execute function app.audit_trigger();

-- -----------------------------------------------------------------------------
-- 8. Preserve what the marketplace operating model meant
--
-- Companies and merchants that were on `marketplace` keep the capability as an
-- explicit grant, so collapsing the enum loses no information. Run after the
-- feature catalogue exists, which migration 0024 seeds.
-- -----------------------------------------------------------------------------

create table public.pending_marketplace_grants (
  company_id uuid primary key references public.companies (id) on delete cascade
);

insert into public.pending_marketplace_grants (company_id)
select id from _marketplace_companies
on conflict do nothing;

insert into public.pending_marketplace_grants (company_id)
select m.company_id from public.merchants m
join _marketplace_merchants mm on mm.id = m.id
on conflict do nothing;

comment on table public.pending_marketplace_grants is
  'Companies that were on the marketplace operating model before 0023 collapsed it. Migration 0024 converts these into marketplace_integration grants and drops this table.';


-- ---------------------------------------------------------------------
-- 20260915090100_0024_plans_rls_and_seed.sql
-- Plan RLS, 4 permissions, the feature catalogue and the starting grid
-- ---------------------------------------------------------------------

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


-- ---------------------------------------------------------------------
-- 20260915090200_0025_org_hierarchy_and_kpis.sql
-- departments.parent_id + cycle guard, department_tree, KPIs
-- ---------------------------------------------------------------------

-- =============================================================================
-- Green ERP — 0025 Department hierarchy & departmental KPIs
--
-- Two related changes:
--
--  1. **Departments become a tree.** A `parent_id` rather than a main/sub flag,
--     because the brief asks for arbitrary depth later and a two-level model
--     would have to be rebuilt to get there. Cycles are refused by trigger:
--     a department cannot end up as its own ancestor.
--
--  2. **KPIs hang off the parent department.** A definition is owned by the
--     department that cares about it; each entry targets one subject — a
--     sub-department, a team, a role or a person — for one period.
--
-- Achievement is *derived*, never stored. Whether a KPI is doing well depends
-- on its direction (a response time improves by falling, a confirmation rate by
-- rising), so a stored percentage would silently go stale the moment someone
-- corrected the direction. `kpi_performance` computes it instead.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Hierarchy
-- -----------------------------------------------------------------------------

alter table public.departments
  add column parent_id uuid references public.departments (id) on delete restrict;

comment on column public.departments.parent_id is
  'Null means a main department. Any depth is permitted; app.assert_department_acyclic refuses cycles.';

create index departments_parent_idx on public.departments (parent_id) where parent_id is not null;

/**
 * A department may not be its own ancestor.
 *
 * Walks up the proposed chain rather than checking only the immediate parent,
 * because the illegal case that actually happens is a three-deep loop created
 * by re-parenting a grandparent under its own grandchild.
 */
create or replace function app.assert_department_acyclic()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cursor uuid := new.parent_id;
  v_depth  integer := 0;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A department cannot be its own parent'
      using errcode = 'check_violation';
  end if;

  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'That parent is a descendant of this department, which would create a cycle'
        using errcode = 'check_violation';
    end if;

    v_depth := v_depth + 1;
    -- A guard against a pre-existing loop turning this into an infinite walk.
    if v_depth > 20 then
      raise exception 'Department hierarchy is deeper than 20 levels; refusing to walk further'
        using errcode = 'check_violation';
    end if;

    select parent_id into v_cursor from public.departments where id = v_cursor;
  end loop;

  return new;
end;
$$;

create trigger departments_acyclic
  before insert or update of parent_id on public.departments
  for each row execute function app.assert_department_acyclic();

/**
 * The tree, flattened — depth and a sortable path, so the UI can render an
 * indented list without recursing per row.
 */
create view public.department_tree as
with recursive walk as (
  select
    d.id, d.company_id, d.parent_id, d.code, d.name_en, d.name_ar,
    d.manager_id, d.is_active, d.archived_at,
    0 as depth,
    d.name_en::text as path,
    array[d.id] as ancestry
  from public.departments d
  where d.parent_id is null

  union all

  select
    c.id, c.company_id, c.parent_id, c.code, c.name_en, c.name_ar,
    c.manager_id, c.is_active, c.archived_at,
    w.depth + 1,
    w.path || ' / ' || c.name_en,
    w.ancestry || c.id
  from public.departments c
  join walk w on w.id = c.parent_id
)
select
  w.*,
  -- The department at the top of this branch; KPIs are owned there.
  w.ancestry[1] as root_id,
  (select count(*) from public.departments ch where ch.parent_id = w.id) as child_count,
  (select count(*) from public.app_users u where u.department_id = w.id and u.archived_at is null) as user_count
from walk w;

comment on view public.department_tree is
  'Departments with depth, a readable path and their root. `root_id` is the parent department a KPI belongs to.';

-- -----------------------------------------------------------------------------
-- 2. KPI definitions
-- -----------------------------------------------------------------------------

create type public.kpi_frequency as enum ('daily', 'weekly', 'monthly', 'quarterly');

-- Whether a bigger number is better. Response time and complaint count improve
-- by falling; confirmation rate improves by rising.
create type public.kpi_direction as enum ('higher_is_better', 'lower_is_better');

-- What a KPI is measured against.
create type public.kpi_subject as enum ('department', 'team', 'user', 'role');

create table public.kpi_definitions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  -- The department that owns and reviews this KPI. Normally a parent.
  department_id uuid not null references public.departments (id) on delete cascade,

  code          text not null,
  name_en       text not null,
  name_ar       text not null,
  description   text,

  unit          text,
  frequency     public.kpi_frequency not null default 'monthly',
  direction     public.kpi_direction not null default 'higher_is_better',

  -- The default target, inherited by an entry that does not set its own.
  default_target numeric(14,2),

  is_active     boolean not null default true,
  sort_order    integer not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.app_users (id) on delete set null,
  updated_by    uuid references public.app_users (id) on delete set null,

  constraint kpi_definitions_code_unique unique (department_id, code)
);

comment on table public.kpi_definitions is
  'A measure owned by a department. Entries below record one period of it for one subject.';

create index kpi_definitions_department_idx on public.kpi_definitions (department_id, sort_order);

create trigger kpi_definitions_set_updated_at
  before update on public.kpi_definitions
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. KPI entries — one measurement, one subject, one period
-- -----------------------------------------------------------------------------

create table public.kpi_entries (
  id            uuid primary key default gen_random_uuid(),
  kpi_id        uuid not null references public.kpi_definitions (id) on delete cascade,
  company_id    uuid not null references public.companies (id) on delete restrict,

  subject       public.kpi_subject not null,
  -- Exactly one of the four is populated, enforced below.
  department_id uuid references public.departments (id) on delete cascade,
  team_id       uuid references public.teams (id) on delete cascade,
  user_id       uuid references public.app_users (id) on delete cascade,
  role_id       uuid references public.roles (id) on delete cascade,

  period_start  date not null,
  period_end    date not null,

  target_value  numeric(14,2),
  actual_value  numeric(14,2),

  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.app_users (id) on delete set null,
  updated_by    uuid references public.app_users (id) on delete set null,

  constraint kpi_entries_period check (period_end >= period_start),

  -- The subject column must match the declared subject, and only that one may
  -- be set. Without this, a row could claim to measure a team while carrying a
  -- user id, and every report downstream would disagree with itself.
  constraint kpi_entries_subject_check check (
    (subject = 'department' and department_id is not null and team_id is null and user_id is null and role_id is null) or
    (subject = 'team'       and team_id is not null and department_id is null and user_id is null and role_id is null) or
    (subject = 'user'       and user_id is not null and department_id is null and team_id is null and role_id is null) or
    (subject = 'role'       and role_id is not null and department_id is null and team_id is null and user_id is null)
  )
);

comment on table public.kpi_entries is
  'One KPI, one subject, one period. Achievement is computed in kpi_performance, never stored.';

create index kpi_entries_kpi_idx    on public.kpi_entries (kpi_id, period_start desc);
create index kpi_entries_period_idx on public.kpi_entries (company_id, period_start desc);

-- One measurement per subject per period, so a correction updates rather than
-- silently doubling. Partial indexes because only one subject column is set.
create unique index kpi_entries_department_unique on public.kpi_entries (kpi_id, department_id, period_start) where department_id is not null;
create unique index kpi_entries_team_unique       on public.kpi_entries (kpi_id, team_id, period_start)       where team_id is not null;
create unique index kpi_entries_user_unique       on public.kpi_entries (kpi_id, user_id, period_start)       where user_id is not null;
create unique index kpi_entries_role_unique       on public.kpi_entries (kpi_id, role_id, period_start)       where role_id is not null;

create trigger kpi_entries_set_updated_at
  before update on public.kpi_entries
  for each row execute function app.set_updated_at();

/**
 * Achievement and status, derived.
 *
 * Direction is what makes this worth computing rather than storing: for a
 * lower-is-better KPI the ratio inverts, so a stored percentage would be wrong
 * the moment a definition's direction was corrected.
 */
create view public.kpi_performance as
select
  e.id            as entry_id,
  e.company_id,
  k.id            as kpi_id,
  k.code,
  k.name_en,
  k.name_ar,
  k.unit,
  k.frequency,
  k.direction,
  k.department_id as owner_department_id,
  e.subject,
  e.department_id,
  e.team_id,
  e.user_id,
  e.role_id,
  e.period_start,
  e.period_end,
  coalesce(e.target_value, k.default_target) as target_value,
  e.actual_value,
  case
    when e.actual_value is null then null
    when coalesce(e.target_value, k.default_target) is null
      or coalesce(e.target_value, k.default_target) = 0 then null
    when k.direction = 'higher_is_better'
      then round(e.actual_value / coalesce(e.target_value, k.default_target) * 100, 1)
    -- Lower is better: hitting half the target time is 200% achievement.
    when e.actual_value = 0 then null
    else round(coalesce(e.target_value, k.default_target) / e.actual_value * 100, 1)
  end as achievement_pct,
  case
    when e.actual_value is null then 'pending'
    when coalesce(e.target_value, k.default_target) is null then 'untargeted'
    when k.direction = 'higher_is_better' then
      case
        when e.actual_value >= coalesce(e.target_value, k.default_target)       then 'achieved'
        when e.actual_value >= coalesce(e.target_value, k.default_target) * 0.8 then 'at_risk'
        else 'missed'
      end
    else
      case
        when e.actual_value <= coalesce(e.target_value, k.default_target)       then 'achieved'
        when e.actual_value <= coalesce(e.target_value, k.default_target) * 1.2 then 'at_risk'
        else 'missed'
      end
  end as status
from public.kpi_entries e
join public.kpi_definitions k on k.id = e.kpi_id;

comment on view public.kpi_performance is
  'KPI entries with achievement and status derived from the definition direction. The KPI tab and department comparison read this.';

-- -----------------------------------------------------------------------------
-- 4. Access control
-- -----------------------------------------------------------------------------

alter table public.kpi_definitions enable row level security;
alter table public.kpi_entries     enable row level security;

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('kpi.view',    'org', 'department_kpi', 'view',      'View department KPIs',   'عرض مؤشرات الأداء',        false, false, 7100),
  ('kpi.manage',  'org', 'department_kpi', 'configure', 'Define and target KPIs', 'تعريف وتحديد المؤشرات',   false, false, 7101),
  ('kpi.record',  'org', 'department_kpi', 'edit',      'Record KPI results',     'تسجيل نتائج المؤشرات',    false, false, 7102)
on conflict (code) do nothing;

select app.grant_perms_to_template('super_admin',   array['*']);
select app.grant_perms_to_template('system_admin',  array['kpi.*']);
select app.grant_perms_to_template('company_admin', array['kpi.*']);

-- §KPI: defining and targeting is the manager's job; everyone else reads.
select app.grant_perms_to_template('operations_manager',       array['kpi.view', 'kpi.manage', 'kpi.record']);
select app.grant_perms_to_template('warehouse_manager',        array['kpi.view', 'kpi.manage', 'kpi.record']);
select app.grant_perms_to_template('confirmation_team_leader', array['kpi.view', 'kpi.manage', 'kpi.record']);
select app.grant_perms_to_template('store_manager',            array['kpi.view', 'kpi.record']);
select app.grant_perms_to_template('marketing_manager',        array['kpi.view', 'kpi.manage', 'kpi.record']);
select app.grant_perms_to_template('quality_auditor',          array['kpi.view']);
select app.grant_perms_to_template('reports_viewer',           array['kpi.view']);
select app.grant_perms_to_template('accountant',               array['kpi.view']);

create policy kpi_definitions_select on public.kpi_definitions
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('kpi.view'));

create policy kpi_definitions_write on public.kpi_definitions
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('kpi.manage'))
  with check (app.same_company(company_id) and app.has_perm('kpi.manage'));

create policy kpi_entries_select on public.kpi_entries
  for select to authenticated
  using (
    app.same_company(company_id)
    and (
      app.has_perm('kpi.view')
      -- Everyone can see their own numbers even without the department-wide
      -- permission; being measured without being told is indefensible.
      or user_id = app.uid()
    )
  );

create policy kpi_entries_write on public.kpi_entries
  for all to authenticated
  using (app.same_company(company_id) and (app.has_perm('kpi.manage') or app.has_perm('kpi.record')))
  with check (app.same_company(company_id) and (app.has_perm('kpi.manage') or app.has_perm('kpi.record')));

alter view public.department_tree  set (security_invoker = on);
alter view public.kpi_performance  set (security_invoker = on);

grant select, insert, update, delete on public.kpi_definitions, public.kpi_entries to authenticated;
grant select on public.department_tree, public.kpi_performance to authenticated;

create trigger kpi_definitions_audit after insert or update or delete on public.kpi_definitions for each row execute function app.audit_trigger();
create trigger kpi_entries_audit     after insert or update or delete on public.kpi_entries     for each row execute function app.audit_trigger();

do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_roles(v_company);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 20260915090300_0026_users_customers_affiliates.sql
-- Affiliates, user_type, customer_links, customer_directory
-- ---------------------------------------------------------------------

-- =============================================================================
-- Green ERP — 0026 User types, customer identity, and a minimal affiliate model
--
-- Three changes the restructure needs:
--
--  1. **`user_type` becomes typed and anchored.** It was free text with nothing
--     linking a user to the entity they belong to, so "Merchant Users" could
--     only ever be a guess. It is now an enum plus a nullable FK per entity,
--     with a check that the pair agrees.
--
--     Warehouse is deliberately *not* a user type. The brief is explicit, and
--     it is right: warehouse access is a data scope, and Phase 1 already has
--     `user_data_scopes` for exactly that.
--
--  2. **Customers can belong to more than one store.** The same phone number
--     ordering from two merchants is one person, and Customer 360 is worth less
--     if it shows half their history. A link table records every relationship
--     while the customer row stays the single identity.
--
--  3. **A minimal affiliate model.** Spec §8 is absent from the source PDF, so
--     this is inferred from the brief alone: affiliates refer orders and earn
--     commission. It is deliberately small — enough for the Affiliate Users tab
--     and Affiliate Dashboard to hold real data, and shaped so the real §8 can
--     extend it rather than replace it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Affiliates
--
-- Created first because `app_users` needs to reference it.
-- -----------------------------------------------------------------------------

create type public.affiliate_status as enum (
  'pending', 'active', 'suspended', 'terminated'
);

create type public.commission_model as enum (
  'percentage', 'fixed_per_order', 'tiered'
);

create table public.affiliates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  -- An affiliate usually promotes one merchant, but may work across a company.
  merchant_id   uuid references public.merchants (id) on delete restrict,

  code          text not null,
  name          text not null,
  email         text,
  phone         text,

  -- The public identifier that appears in a referral link and lands on
  -- `orders.affiliate_ref`. Kept separate from `code` so it can be rotated
  -- without breaking historical attribution.
  referral_code text not null,

  status        public.affiliate_status not null default 'pending',

  commission_model public.commission_model not null default 'percentage',
  commission_rate  numeric(6,3) check (commission_rate is null or commission_rate >= 0),
  -- Commission is only owed once an order is actually delivered, so a return
  -- does not leave us paying for revenue we never kept.
  pays_on_delivery boolean not null default true,

  payout_details text,
  notes          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.app_users (id) on delete set null,
  updated_by    uuid references public.app_users (id) on delete set null,
  archived_at   timestamptz,
  archived_by   uuid references public.app_users (id) on delete set null,

  constraint affiliates_code_unique     unique (company_id, code),
  constraint affiliates_referral_unique unique (company_id, referral_code)
);

comment on table public.affiliates is
  'Minimal affiliate model inferred from the change brief, since spec section 8 is absent from the source PDF. Shaped so the real section 8 can extend it.';

create index affiliates_company_idx  on public.affiliates (company_id, status);
create index affiliates_merchant_idx on public.affiliates (merchant_id) where merchant_id is not null;

create trigger affiliates_set_updated_at
  before update on public.affiliates
  for each row execute function app.set_updated_at();

-- Orders already carry `affiliate_ref` as free text, reserved for this. Add the
-- real link alongside it rather than replacing it, so historical rows whose
-- affiliate was never registered keep the string they arrived with.
alter table public.orders
  add column affiliate_id uuid references public.affiliates (id) on delete set null;

create index orders_affiliate_idx on public.orders (affiliate_id) where affiliate_id is not null;

comment on column public.orders.affiliate_id is
  'Resolved affiliate. `affiliate_ref` keeps the raw referral string the order arrived with, including for affiliates never registered.';

/**
 * Resolve `affiliate_ref` to a real affiliate at intake.
 *
 * Matching on the referral code rather than requiring the caller to look it up
 * means an order from a channel webhook is attributed the same way as one typed
 * in by hand.
 */
create or replace function app.resolve_order_affiliate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.affiliate_ref is null or new.affiliate_id is not null then
    return new;
  end if;

  select a.id into new.affiliate_id
  from public.affiliates a
  where a.company_id = new.company_id
    and a.referral_code = new.affiliate_ref
    and a.archived_at is null
  limit 1;

  return new;
end;
$$;

create trigger orders_resolve_affiliate
  before insert or update of affiliate_ref on public.orders
  for each row execute function app.resolve_order_affiliate();

-- Commission earned per order. A row per order rather than a running balance,
-- so a recalculation is auditable and a dispute can point at one line.
create table public.affiliate_commissions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  affiliate_id  uuid not null references public.affiliates (id) on delete restrict,
  order_id      uuid not null references public.orders (id) on delete restrict,

  order_total   numeric(14,2) not null default 0,
  commission_amount numeric(14,2) not null default 0 check (commission_amount >= 0),
  currency      char(3) not null default 'EGP',

  -- pending → payable once delivered → paid. Cancelled when the order is.
  status        text not null default 'pending'
    check (status in ('pending', 'payable', 'paid', 'cancelled')),

  earned_on     date not null default current_date,
  paid_at       timestamptz,
  payout_reference text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint affiliate_commissions_order_unique unique (order_id)
);

create index affiliate_commissions_affiliate_idx on public.affiliate_commissions (affiliate_id, status);

create trigger affiliate_commissions_set_updated_at
  before update on public.affiliate_commissions
  for each row execute function app.set_updated_at();

/** §Affiliate dashboard: referred orders, conversion and commission, per affiliate. */
create view public.affiliate_performance as
select
  a.id            as affiliate_id,
  a.company_id,
  a.merchant_id,
  a.name,
  a.referral_code,
  a.status,
  count(o.id)                                                          as referred_orders,
  count(o.id) filter (where o.status = 'confirmed'
                         or o.status = 'ready_for_warehouse')          as confirmed_orders,
  count(o.id) filter (where o.status = 'cancelled')                    as cancelled_orders,
  coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0)     as referred_revenue,
  case when count(o.id) > 0
       then round(count(o.id) filter (where o.status = 'confirmed'
                                         or o.status = 'ready_for_warehouse')::numeric
                  / count(o.id) * 100, 2)
       end                                                             as confirmation_rate,
  coalesce((select sum(ac.commission_amount) from public.affiliate_commissions ac
             where ac.affiliate_id = a.id), 0)                         as commission_total,
  coalesce((select sum(ac.commission_amount) from public.affiliate_commissions ac
             where ac.affiliate_id = a.id and ac.status = 'paid'), 0)  as commission_paid,
  coalesce((select sum(ac.commission_amount) from public.affiliate_commissions ac
             where ac.affiliate_id = a.id and ac.status in ('pending', 'payable')), 0) as commission_outstanding
from public.affiliates a
left join public.orders o
  on o.affiliate_id = a.id and o.archived_at is null
group by a.id;

comment on view public.affiliate_performance is
  'Per-affiliate referred orders, conversion and commission. Backs the affiliate dashboard.';

-- -----------------------------------------------------------------------------
-- 2. User types
-- -----------------------------------------------------------------------------

create type public.user_type as enum (
  'company', 'merchant', 'affiliate', 'store', 'supplier'
);

-- The column exists as free text; migrate what is there, then retype.
alter table public.app_users
  add column user_type_v2 public.user_type not null default 'company';

-- Deliberately defensive: a row may claim to be a merchant user without
-- carrying a merchant_id, and the check constraint added below would then
-- refuse to validate against existing data. Anything that cannot satisfy its
-- own type falls back to `company`, which requires no entity.
update public.app_users
set user_type_v2 = case
                     when lower(coalesce(user_type, '')) = 'merchant'
                          and merchant_id is not null then 'merchant'
                     else 'company'
                   end::public.user_type;

alter table public.app_users drop column user_type;
alter table public.app_users rename column user_type_v2 to user_type;

comment on column public.app_users.user_type is
  'Which kind of party this user belongs to. Warehouse is deliberately absent: warehouse access is a data scope, not a user type.';

-- The entity the user belongs to. Exactly one, matching the type.
alter table public.app_users
  add column affiliate_id uuid references public.affiliates (id) on delete restrict,
  add column store_id     uuid references public.stores (id) on delete restrict,
  add column supplier_id  uuid references public.suppliers (id) on delete restrict;

-- `merchant_id` already exists on app_users from Phase 1.
alter table public.app_users
  add constraint app_users_type_entity_check check (
    (user_type = 'company'   and merchant_id is null and affiliate_id is null and store_id is null and supplier_id is null) or
    (user_type = 'merchant'  and merchant_id is not null and affiliate_id is null and store_id is null and supplier_id is null) or
    (user_type = 'affiliate' and affiliate_id is not null and merchant_id is null and store_id is null and supplier_id is null) or
    (user_type = 'store'     and store_id is not null and merchant_id is null and affiliate_id is null and supplier_id is null) or
    (user_type = 'supplier'  and supplier_id is not null and merchant_id is null and affiliate_id is null and store_id is null)
  );

create index app_users_type_idx      on public.app_users (company_id, user_type);
create index app_users_affiliate_idx on public.app_users (affiliate_id) where affiliate_id is not null;
create index app_users_store_idx     on public.app_users (store_id)     where store_id is not null;
create index app_users_supplier_idx  on public.app_users (supplier_id)  where supplier_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Customers across stores
--
-- The customer row stays the single identity per (company, phone). This records
-- every store, merchant and company that identity has ordered from, which is
-- what lets one profile show a complete history.
-- -----------------------------------------------------------------------------

create table public.customer_links (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers (id) on delete cascade,
  company_id    uuid not null references public.companies (id) on delete cascade,
  merchant_id   uuid references public.merchants (id) on delete cascade,
  store_id      uuid references public.stores (id) on delete cascade,

  first_order_at timestamptz,
  last_order_at  timestamptz,
  orders_count   integer not null default 0,
  total_spent    numeric(14,2) not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint customer_links_unique unique (customer_id, company_id, merchant_id, store_id)
);

comment on table public.customer_links is
  'Every company/merchant/store an identity has ordered from. The customers row remains the single identity; this is the breadth behind Customer 360.';

create index customer_links_customer_idx on public.customer_links (customer_id);
create index customer_links_store_idx    on public.customer_links (store_id) where store_id is not null;

create trigger customer_links_set_updated_at
  before update on public.customer_links
  for each row execute function app.set_updated_at();

/**
 * Maintain the link whenever an order lands.
 *
 * Aggregates are recomputed from the orders rather than incremented, so a
 * corrected or cancelled order cannot leave a link permanently overstated.
 */
create or replace function app.sync_customer_link()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.customer_id is null then
    return new;
  end if;

  insert into public.customer_links (customer_id, company_id, merchant_id, store_id)
  values (new.customer_id, new.company_id, new.merchant_id, new.store_id)
  on conflict (customer_id, company_id, merchant_id, store_id) do nothing;

  update public.customer_links l
  set orders_count   = agg.count,
      total_spent    = agg.total,
      first_order_at = agg.first_at,
      last_order_at  = agg.last_at
  from (
    select count(*) as count,
           coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0) as total,
           min(o.order_date) as first_at,
           max(o.order_date) as last_at
    from public.orders o
    where o.customer_id = new.customer_id
      and o.company_id  = new.company_id
      and o.merchant_id is not distinct from new.merchant_id
      and o.store_id    is not distinct from new.store_id
      and o.archived_at is null
  ) agg
  where l.customer_id = new.customer_id
    and l.company_id  = new.company_id
    and l.merchant_id is not distinct from new.merchant_id
    and l.store_id    is not distinct from new.store_id;

  return new;
end;
$$;

create trigger orders_customer_link
  after insert or update of customer_id, store_id, total, status on public.orders
  for each row execute function app.sync_customer_link();

/** The list behind the Customers screen: one row per identity, breadth attached. */
create view public.customer_directory as
select
  c.id            as customer_id,
  c.company_id,
  c.name,
  c.phone,
  c.email,
  c.alt_phone,
  c.governorate,
  c.city,
  c.address,
  c.preferred_language,
  c.notes,
  c.orders_count,
  c.cancelled_count,
  c.lifetime_value as total_spent,
  c.risk_score,
  c.is_blacklisted,
  c.last_order_at,
  (select count(distinct l.store_id)    from public.customer_links l where l.customer_id = c.id and l.store_id is not null)    as store_count,
  (select count(distinct l.merchant_id) from public.customer_links l where l.customer_id = c.id and l.merchant_id is not null) as merchant_count,
  (select string_agg(distinct s.name, ', ')
     from public.customer_links l
     join public.stores s on s.id = l.store_id
    where l.customer_id = c.id) as store_names
from public.customers c
where c.archived_at is null;

comment on view public.customer_directory is
  'Customers with the breadth of their relationships attached, for the Customers list and the 360 header.';

-- -----------------------------------------------------------------------------
-- 4. Access control
-- -----------------------------------------------------------------------------

alter table public.affiliates            enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.customer_links        enable row level security;

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('affiliates.view',         'affiliates', 'affiliates',  'view',      'View affiliates',            'عرض المسوقين',                false, false, 7200),
  ('affiliates.manage',       'affiliates', 'affiliates',  'configure', 'Manage affiliates',          'إدارة المسوقين',              false, false, 7201),
  ('affiliates.commission.view',   'affiliates', 'commissions', 'view',  'View affiliate commission',  'عرض عمولات المسوقين',         true,  false, 7202),
  ('affiliates.commission.approve','affiliates', 'commissions', 'approve','Approve affiliate payouts', 'اعتماد مستحقات المسوقين',     true,  true,  7203)
on conflict (code) do nothing;

select app.grant_perms_to_template('super_admin',   array['*']);
select app.grant_perms_to_template('system_admin',  array['affiliates.*']);
select app.grant_perms_to_template('company_admin', array['affiliates.*']);
select app.grant_perms_to_template('operations_manager', array['affiliates.view', 'affiliates.manage', 'affiliates.commission.view']);
select app.grant_perms_to_template('marketing_manager',  array['affiliates.view', 'affiliates.manage', 'affiliates.commission.view']);
select app.grant_perms_to_template('accountant',         array['affiliates.view', 'affiliates.commission.view', 'affiliates.commission.approve']);
select app.grant_perms_to_template('merchant_admin',     array['affiliates.view']);
select app.grant_perms_to_template('reports_viewer',     array['affiliates.view']);

create policy affiliates_select on public.affiliates
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.can_access_merchant(merchant_id)
    and (
      app.has_perm('affiliates.view')
      -- An affiliate user sees their own record and nothing else.
      or id = (select u.affiliate_id from public.app_users u where u.id = app.uid())
    )
  );

create policy affiliates_write on public.affiliates
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('affiliates.manage'))
  with check (app.same_company(company_id) and app.has_perm('affiliates.manage'));

create policy affiliate_commissions_select on public.affiliate_commissions
  for select to authenticated
  using (
    app.same_company(company_id)
    and (
      app.has_perm('affiliates.commission.view')
      or affiliate_id = (select u.affiliate_id from public.app_users u where u.id = app.uid())
    )
  );

create policy affiliate_commissions_write on public.affiliate_commissions
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('affiliates.commission.approve'))
  with check (app.same_company(company_id) and app.has_perm('affiliates.commission.approve'));

-- Links follow the customer's own visibility rule.
create policy customer_links_select on public.customer_links
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('orders.customer.view'));

create policy customer_links_write on public.customer_links
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('orders.customer.edit'))
  with check (app.same_company(company_id) and app.has_perm('orders.customer.edit'));

alter view public.affiliate_performance set (security_invoker = on);
alter view public.customer_directory    set (security_invoker = on);

grant select, insert, update on public.affiliates, public.affiliate_commissions, public.customer_links to authenticated;
grant select on public.affiliate_performance, public.customer_directory to authenticated;

create trigger affiliates_audit            after insert or update or delete on public.affiliates            for each row execute function app.audit_trigger();
create trigger affiliate_commissions_audit after insert or update or delete on public.affiliate_commissions for each row execute function app.audit_trigger();

do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_roles(v_company);
  end loop;
end $$;

-- Backfill links for orders that already exist, so Customer 360 is complete
-- from the moment this migration lands rather than only for future orders.
insert into public.customer_links (customer_id, company_id, merchant_id, store_id,
                                   orders_count, total_spent, first_order_at, last_order_at)
select o.customer_id, o.company_id, o.merchant_id, o.store_id,
       count(*),
       coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0),
       min(o.order_date), max(o.order_date)
from public.orders o
where o.customer_id is not null and o.archived_at is null
group by o.customer_id, o.company_id, o.merchant_id, o.store_id
on conflict (customer_id, company_id, merchant_id, store_id) do nothing;


commit;

-- Done. Reload the app; the new screens should answer now.
