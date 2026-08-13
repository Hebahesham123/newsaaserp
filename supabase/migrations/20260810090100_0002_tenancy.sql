-- =============================================================================
-- Green ERP — 0002 Tenancy
-- System → Company → Merchant → Store → Warehouse  (spec §1.8)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Companies — §2.2
-- -----------------------------------------------------------------------------
create table public.companies (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null,

  -- §2.2.2 Company Master Data
  name_ar                 text not null,
  name_en                 text not null,
  trade_name              text,
  logo_url                text,
  business_type           text,
  country                 text,
  region                  text,               -- governorate / state / region
  address                 text,
  tax_registration_number text,
  commercial_registration_number text,
  email                   text,
  phone                   text,
  website                 text,
  base_currency           char(3) not null default 'EGP',
  timezone                text    not null default 'Africa/Cairo',
  default_locale          text    not null default 'ar',
  tax_structure           jsonb   not null default '{}'::jsonb,
  account_manager_id      uuid,               -- FK added in 0003 (app_users)

  status                  public.company_status not null default 'draft',

  -- §1.4 operating model drives which modules and fee engines activate
  operating_model         public.operating_model not null default 'own_store',

  -- Subscription / plan limits
  subscription_start_date date,
  subscription_end_date   date,
  subscription_plan       text,
  max_users               integer check (max_users is null or max_users > 0),
  max_stores              integer check (max_stores is null or max_stores > 0),
  max_monthly_orders      integer check (max_monthly_orders is null or max_monthly_orders > 0),

  internal_notes          text,

  -- §2.2.4 Company Settings — every company configures independently
  settings                jsonb not null default '{}'::jsonb,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid,
  updated_by              uuid,
  archived_at             timestamptz,
  archived_by             uuid,

  constraint companies_code_unique unique (code),
  constraint companies_locale_check check (default_locale in ('ar', 'en'))
);

comment on table public.companies is
  'Primary business entity using the platform (§2.2.1). All system data is associated with at least one company.';
comment on column public.companies.settings is
  '§2.2.4 per-company settings: language, currency, tax, orders, inventory, shipping, confirmation, returns, reporting, notifications, users, working hours, holidays, SLA, workflows, AI, integrations, numbering formats, date formats.';

create index companies_status_idx     on public.companies (status);
create index companies_name_trgm_idx  on public.companies using gin (name_en extensions.gin_trgm_ops, name_ar extensions.gin_trgm_ops);

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Merchants — §2.3
-- -----------------------------------------------------------------------------
create table public.merchants (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies (id) on delete restrict,
  code                    text not null,

  -- §2.3.2 Merchant Master Data
  name                    text not null,
  trade_name              text,
  merchant_type           text,
  account_manager_id      uuid,               -- FK added in 0003
  contact_person          text,
  email                   text,
  phone                   text,
  country                 text,
  address                 text,
  tax_registration_number text,
  commercial_registration_number text,
  currency                char(3) not null default 'EGP',

  status                  public.merchant_status not null default 'lead',

  contract_date           date,
  go_live_date            date,

  -- §2.3.3 one or more services per merchant
  services                public.merchant_service[] not null default '{}',
  operating_model         public.operating_model not null default 'own_store',

  -- Commercial terms
  credit_limit            numeric(14,2) check (credit_limit is null or credit_limit >= 0),
  payment_terms           text,
  settlement_cycle        text,               -- daily | weekly | monthly | custom (§7.7)
  commission_percentage   numeric(6,3) check (commission_percentage is null or commission_percentage between 0 and 100),

  -- §2.3.2 fulfillment service pricing. Consumed by Phase 6 settlements.
  service_pricing         jsonb not null default '{}'::jsonb,

  internal_notes          text,
  settings                jsonb not null default '{}'::jsonb,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid,
  updated_by              uuid,
  archived_at             timestamptz,
  archived_by             uuid,

  -- §2.13 rule 9: codes unique within their applicable scope
  constraint merchants_code_unique unique (company_id, code)
);

comment on table public.merchants is
  'Owner of the products, brand, or commercial account (§2.3.1). Data is isolated from other merchants (§2.13 rule 23).';
comment on column public.merchants.service_pricing is
  '§2.3.2 per-merchant pricing for storage, picking, packing, receiving, shipping and return handling. Drives §5.20 fee calculation and §7.7 settlements.';

create index merchants_company_idx    on public.merchants (company_id);
create index merchants_status_idx     on public.merchants (company_id, status);
create index merchants_name_trgm_idx  on public.merchants using gin (name extensions.gin_trgm_ops);

create trigger merchants_set_updated_at
  before update on public.merchants
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Warehouses — §5.3 (stub for Phase 1, fully built out in Phase 4)
-- -----------------------------------------------------------------------------
create table public.warehouses (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete restrict,
  code           text not null,
  name           text not null,
  warehouse_type public.warehouse_type not null default 'main',

  -- Null = shared warehouse serving every merchant in the company.
  -- Set = warehouse dedicated to one merchant (fulfillment-centre mode, §5.20).
  dedicated_merchant_id uuid references public.merchants (id) on delete restrict,

  country        text,
  region         text,
  address        text,
  phone          text,
  manager_id     uuid,                        -- FK added in 0003
  is_active      boolean not null default true,
  settings       jsonb not null default '{}'::jsonb,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  archived_at    timestamptz,
  archived_by    uuid,

  constraint warehouses_code_unique unique (company_id, code)
);

comment on table public.warehouses is
  'Physical location where products are stored and orders are fulfilled (§1.8). Expanded with zones/aisles/racks/shelves/bins in Phase 4 (§5.2).';

create index warehouses_company_idx  on public.warehouses (company_id);
create index warehouses_merchant_idx on public.warehouses (dedicated_merchant_id) where dedicated_merchant_id is not null;

create trigger warehouses_set_updated_at
  before update on public.warehouses
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Stores / sales channels — §2.4
-- -----------------------------------------------------------------------------
create table public.stores (
  id                uuid not null primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  -- §2.13 rule 1: a store cannot exist without a merchant
  merchant_id       uuid not null references public.merchants (id) on delete restrict,

  -- §2.4.2 Store Master Data
  code              text not null,
  name              text not null,
  platform          public.channel_platform not null,
  store_url         text,
  country           text,
  currency          char(3) not null default 'EGP',
  locale            text    not null default 'ar',
  timezone          text    not null default 'Africa/Cairo',

  status            public.store_status not null default 'draft',

  connected_at      timestamptz,
  last_sync_at      timestamptz,
  last_sync_status  public.sync_status,
  last_sync_error   text,

  -- Sync configuration (§2.4.4). 'master_source' resolves conflicts per §3.10.
  order_import_method     text not null default 'webhook',
  product_sync_method     text not null default 'scheduled',
  inventory_sync_method   text not null default 'scheduled',
  price_sync_method       text not null default 'manual',
  master_source           jsonb not null default '{}'::jsonb,
  sync_enabled            boolean not null default false,

  tax_settings      jsonb not null default '{}'::jsonb,
  shipping_settings jsonb not null default '{}'::jsonb,
  payment_settings  jsonb not null default '{}'::jsonb,

  default_warehouse_id uuid references public.warehouses (id) on delete set null,
  default_courier_id   uuid,                  -- FK added in Phase 5

  confirmation_policy jsonb not null default '{}'::jsonb,
  cancellation_policy jsonb not null default '{}'::jsonb,
  return_policy       jsonb not null default '{}'::jsonb,

  store_manager_id  uuid,                     -- FK added in 0003
  notes             text,

  -- Which concrete adapter services this store. 'mock' lets the entire order
  -- pipeline be developed and tested before real credentials exist; switching
  -- to 'shopify' is a data change, not a code change. See docs/ROADMAP.md §3.
  provider          text not null default 'mock',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  archived_at       timestamptz,
  archived_by       uuid,

  constraint stores_code_unique   unique (company_id, code),
  constraint stores_provider_check check (provider in ('mock', 'shopify', 'woocommerce', 'amazon', 'noon', 'custom'))
);

comment on table public.stores is
  'A sales channel from which orders are received (§2.4.1). Each store belongs to exactly one merchant; one merchant may operate many stores (§2.4.1).';
comment on column public.stores.provider is
  'Concrete channel adapter. Defaults to ''mock'' so the pipeline is testable without live credentials; flip to ''shopify'' once the app is installed.';
comment on column public.stores.master_source is
  '§3.10 declares the authoritative source per data type (price, inventory, product, ...) to prevent sync conflicts.';

create index stores_company_idx  on public.stores (company_id);
create index stores_merchant_idx on public.stores (merchant_id);
create index stores_status_idx   on public.stores (company_id, status);
create index stores_platform_idx on public.stores (platform);

create trigger stores_set_updated_at
  before update on public.stores
  for each row execute function app.set_updated_at();

-- Merchant and store must live in the same company. Cheap guard against a
-- cross-tenant FK slipping through application code.
create or replace function app.assert_store_tenant_consistency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_merchant_company uuid;
begin
  select company_id into v_merchant_company from public.merchants where id = new.merchant_id;
  if v_merchant_company is null then
    raise exception 'Merchant % not found', new.merchant_id;
  end if;
  if v_merchant_company <> new.company_id then
    raise exception 'Cross-tenant assignment rejected: merchant % belongs to company %, not %',
      new.merchant_id, v_merchant_company, new.company_id;
  end if;
  return new;
end;
$$;

create trigger stores_tenant_consistency
  before insert or update of company_id, merchant_id on public.stores
  for each row execute function app.assert_store_tenant_consistency();

-- -----------------------------------------------------------------------------
-- Store credentials — §2.4.2 "API credentials", "Webhook information"
--
-- Held in a dedicated table that no client role can read. Values are encrypted
-- application-side (AES-256-GCM) before insert, so a Postgres-level leak still
-- does not yield usable tokens. Only the service role touches this table.
-- -----------------------------------------------------------------------------
create table public.store_credentials (
  store_id             uuid primary key references public.stores (id) on delete cascade,
  company_id           uuid not null references public.companies (id) on delete restrict,

  access_token_enc     text,          -- AES-256-GCM ciphertext
  refresh_token_enc    text,
  api_key_enc          text,
  api_secret_enc       text,
  webhook_secret_enc   text,

  shop_domain          text,          -- e.g. my-shop.myshopify.com (not secret)
  scopes               text[],
  installed_at         timestamptz,
  token_expires_at     timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.store_credentials is
  'Encrypted channel credentials. No RLS policy grants access to anon/authenticated — reachable only via the service role from server code.';

create trigger store_credentials_set_updated_at
  before update on public.store_credentials
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- §2.13 rule 15/17: suspension cascades.
-- A suspended company accepts no new operations; a suspended merchant halts
-- store synchronization. Enforced in the database so no code path can bypass it.
-- -----------------------------------------------------------------------------
create or replace function app.company_accepts_operations(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.companies
    where id = p_company_id
      and status in ('active', 'draft', 'under_review')
  );
$$;

create or replace function app.assert_company_accepts_operations()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.company_accepts_operations(new.company_id) then
    raise exception
      'Company % is suspended or expired; new operations are blocked (spec §2.13 rule 17)',
      new.company_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger merchants_company_active
  before insert on public.merchants
  for each row execute function app.assert_company_accepts_operations();

create trigger stores_company_active
  before insert on public.stores
  for each row execute function app.assert_company_accepts_operations();

-- Stores eligible to synchronize right now. The sync worker reads this view
-- rather than `stores`, so §2.13 rule 15 holds without duplicated logic.
create view public.syncable_stores as
select s.*
from public.stores s
join public.merchants m on m.id = s.merchant_id
join public.companies c on c.id = s.company_id
where s.sync_enabled
  and s.status in ('connected', 'active')
  and s.archived_at is null
  and m.status in ('active', 'ready_for_go_live')
  and m.archived_at is null
  and c.status = 'active'
  and c.archived_at is null;

comment on view public.syncable_stores is
  '§2.13 rule 15: store synchronization stops when the merchant or company is suspended. Sync workers must read this view, never `stores` directly.';
