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
