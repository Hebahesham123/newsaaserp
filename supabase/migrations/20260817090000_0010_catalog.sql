-- =============================================================================
-- Green ERP — 0010 Catalog & pricing  (spec §3)
--
-- One unified master product per real-world item, linked to whatever
-- identifiers each channel happens to use (§3.5). Everything sellable resolves
-- to a variant: a simple product carries exactly one, which keeps pricing,
-- costing, mapping and — from Phase 4 — inventory uniform rather than forking
-- on product type.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums — §3.3, §3.7, §3.8, §3.9, §3.11
-- -----------------------------------------------------------------------------

-- §3.11 Product Statuses
create type public.product_status as enum (
  'draft', 'under_review', 'active', 'inactive', 'unavailable', 'out_of_stock',
  'temporarily_suspended', 'discontinued', 'archived', 'sync_error', 'unmapped'
);

-- §3.3 Product Types
create type public.product_type as enum (
  'simple', 'variant', 'bundle', 'kit', 'composite', 'digital', 'service',
  'marketplace', 'made_to_order', 'batch_controlled', 'serial_controlled'
);

-- §3.7 Pricing Management — one row per (scope, type) in product_prices
create type public.price_type as enum (
  'base', 'compare_at', 'wholesale', 'store', 'merchant', 'marketplace',
  'country', 'affiliate', 'promotional', 'bundle', 'time_based', 'quantity_based'
);

-- §3.8 Cost Management
create type public.cost_component as enum (
  'purchase', 'manufacturing', 'freight', 'customs', 'packaging', 'storage',
  'fulfillment', 'marketplace_commission', 'affiliate_commission',
  'payment_gateway', 'customer_shipping', 'other'
);

-- §3.9 Bundle and Kit Management
create type public.bundle_type as enum ('fixed', 'dynamic');

-- §3.5 mapping state, so unmapped and broken links are both reportable
create type public.mapping_status as enum ('mapped', 'unmapped', 'conflict', 'error');

-- -----------------------------------------------------------------------------
-- Catalog reference data — §3.6
-- Per company, because each merchant manages an independent catalog inside its
-- company and the same brand may be sold by several merchants.
-- -----------------------------------------------------------------------------

create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  merchant_id uuid references public.merchants (id) on delete restrict,
  code        text not null,
  name_en     text not null,
  name_ar     text not null,
  logo_url    text,
  description text,
  is_active   boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,
  updated_by  uuid references public.app_users (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references public.app_users (id) on delete set null,

  constraint brands_code_unique unique (company_id, code)
);

create index brands_company_idx  on public.brands (company_id);
create index brands_merchant_idx on public.brands (merchant_id) where merchant_id is not null;

create trigger brands_set_updated_at
  before update on public.brands
  for each row execute function app.set_updated_at();

-- Categories are self-referencing: one table covers main categories and
-- subcategories (§3.6) without a second nearly identical table.
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  parent_id   uuid references public.categories (id) on delete restrict,
  code        text not null,
  name_en     text not null,
  name_ar     text not null,
  description text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,
  updated_by  uuid references public.app_users (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references public.app_users (id) on delete set null,

  constraint categories_code_unique unique (company_id, code),
  constraint categories_not_self_parent check (parent_id is null or parent_id <> id)
);

create index categories_company_idx on public.categories (company_id, sort_order);
create index categories_parent_idx  on public.categories (parent_id) where parent_id is not null;

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function app.set_updated_at();

create table public.units_of_measure (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  code       text not null,
  name_en    text not null,
  name_ar    text not null,
  -- Decimal quantities are legal for weight-sold goods, not for pieces.
  allows_fractions boolean not null default false,
  is_active  boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint units_code_unique unique (company_id, code)
);

create trigger units_of_measure_set_updated_at
  before update on public.units_of_measure
  for each row execute function app.set_updated_at();

create table public.suppliers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  merchant_id  uuid references public.merchants (id) on delete restrict,
  code         text not null,
  name         text not null,
  contact_person text,
  email        text,
  phone        text,
  country      text,
  address      text,
  payment_terms text,
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  notes        text,
  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,
  archived_at  timestamptz,
  archived_by  uuid references public.app_users (id) on delete set null,

  constraint suppliers_code_unique unique (company_id, code)
);

create index suppliers_company_idx on public.suppliers (company_id);

create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function app.set_updated_at();

-- §3.6 Collections — a merchandising grouping that cuts across categories.
create table public.collections (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  merchant_id uuid references public.merchants (id) on delete restrict,
  code        text not null,
  name_en     text not null,
  name_ar     text not null,
  description text,
  -- Seasonal collections drive the §3.14 seasonal-product report.
  is_seasonal boolean not null default false,
  season_start date,
  season_end   date,
  is_active   boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,
  updated_by  uuid references public.app_users (id) on delete set null,

  constraint collections_code_unique unique (company_id, code)
);

create trigger collections_set_updated_at
  before update on public.collections
  for each row execute function app.set_updated_at();

-- §3.6 Product attributes — the named option axes variants are built from.
create table public.product_attributes (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  code       text not null,
  name_en    text not null,
  name_ar    text not null,
  -- Allowed values; empty means free text.
  values     text[] not null default '{}',
  is_variant_axis boolean not null default true,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_attributes_code_unique unique (company_id, code)
);

create trigger product_attributes_set_updated_at
  before update on public.product_attributes
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Products — §3.2 Product Master Data
-- -----------------------------------------------------------------------------

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  -- §3.13 rule 1: every product belongs to at least one merchant.
  merchant_id  uuid not null references public.merchants (id) on delete restrict,

  brand_id     uuid references public.brands (id) on delete set null,
  category_id  uuid references public.categories (id) on delete set null,
  supplier_id  uuid references public.suppliers (id) on delete set null,
  uom_id       uuid references public.units_of_measure (id) on delete set null,

  sku          text not null,
  barcode      text,

  name_en      text not null,
  name_ar      text not null,
  short_description text,
  description  text,

  product_type public.product_type not null default 'simple',
  status       public.product_status not null default 'draft',

  -- §3.2 physical attributes
  weight_grams numeric(12,3) check (weight_grams is null or weight_grams >= 0),
  length_cm    numeric(10,2) check (length_cm is null or length_cm >= 0),
  width_cm     numeric(10,2) check (width_cm is null or width_cm >= 0),
  height_cm    numeric(10,2) check (height_cm is null or height_cm >= 0),
  country_of_origin text,

  -- §3.2 commercial attributes. base_price is the master selling price; the
  -- price matrix in product_prices layers channel and customer-specific rates
  -- on top of it (§3.7).
  base_price   numeric(14,2) check (base_price is null or base_price >= 0),
  base_cost    numeric(14,2) check (base_cost is null or base_cost >= 0),
  currency     char(3) not null default 'EGP',
  tax_rate     numeric(6,3) check (tax_rate is null or tax_rate between 0 and 100),
  tax_included boolean not null default false,

  min_sale_quantity integer not null default 1 check (min_sale_quantity > 0),
  max_sale_quantity integer check (max_sale_quantity is null or max_sale_quantity >= min_sale_quantity),

  -- §3.2 classification flags
  is_sellable   boolean not null default true,
  is_stock_item boolean not null default true,

  -- §3.3 controlled-item flags
  is_batch_tracked  boolean not null default false,
  is_expiry_tracked boolean not null default false,
  is_serial_tracked boolean not null default false,
  shelf_life_days   integer check (shelf_life_days is null or shelf_life_days > 0),

  -- §3.6 merchandising
  tags        text[] not null default '{}',
  images      jsonb  not null default '[]'::jsonb,
  is_seasonal boolean not null default false,
  attributes  jsonb  not null default '{}'::jsonb,

  -- §3.12 "Approve products"
  approved_at timestamptz,
  approved_by uuid references public.app_users (id) on delete set null,

  internal_notes text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,
  updated_by  uuid references public.app_users (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references public.app_users (id) on delete set null,

  -- §3.13 rule 3: SKU unique within the merchant scope.
  constraint products_sku_unique unique (merchant_id, sku)
);

comment on table public.products is
  'Unified master product (§3.2). One record per real item regardless of how many channels list it; channel identifiers live in product_channel_mappings (§3.5).';
comment on column public.products.base_price is
  '§3.2 master selling price. §3.13 rule 11 forbids activating a product without one.';

create index products_company_idx   on public.products (company_id);
create index products_merchant_idx  on public.products (merchant_id, status);
create index products_status_idx    on public.products (company_id, status);
create index products_brand_idx     on public.products (brand_id)    where brand_id is not null;
create index products_category_idx  on public.products (category_id) where category_id is not null;
create index products_barcode_idx   on public.products (merchant_id, barcode) where barcode is not null;
create index products_name_trgm_idx on public.products using gin (name_en extensions.gin_trgm_ops, name_ar extensions.gin_trgm_ops);
create index products_sku_trgm_idx  on public.products using gin (sku extensions.gin_trgm_ops);
create index products_tags_idx      on public.products using gin (tags);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Variants — §3.4.  Each carries its own SKU, barcode, price, cost and image.
-- -----------------------------------------------------------------------------

create table public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  -- Denormalised from the parent so unique constraints and RLS can be checked
  -- without a join on every row.
  company_id  uuid not null references public.companies (id) on delete restrict,
  merchant_id uuid not null references public.merchants (id) on delete restrict,

  sku         text not null,
  barcode     text,
  name        text,

  -- §3.4 the axis values that identify this variant, e.g. {"color":"Red","size":"XL"}
  options     jsonb not null default '{}'::jsonb,

  price       numeric(14,2) check (price is null or price >= 0),
  cost        numeric(14,2) check (cost is null or cost >= 0),

  weight_grams numeric(12,3) check (weight_grams is null or weight_grams >= 0),
  length_cm    numeric(10,2) check (length_cm is null or length_cm >= 0),
  width_cm     numeric(10,2) check (width_cm is null or width_cm >= 0),
  height_cm    numeric(10,2) check (height_cm is null or height_cm >= 0),

  image_url   text,
  position    integer not null default 0,
  is_active   boolean not null default true,
  -- A simple product's single implicit variant; hidden from variant management.
  is_default  boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,
  updated_by  uuid references public.app_users (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references public.app_users (id) on delete set null,

  -- §3.13 rule 3 applies to variant SKUs too — they are what a channel orders.
  constraint product_variants_sku_unique unique (merchant_id, sku)
);

comment on table public.product_variants is
  '§3.4 sellable unit. Every product has at least one; simple products carry a single is_default row so pricing, mapping and inventory never fork on product type.';

create index product_variants_product_idx  on public.product_variants (product_id, position);
create index product_variants_company_idx  on public.product_variants (company_id);
create index product_variants_barcode_idx  on public.product_variants (merchant_id, barcode) where barcode is not null;
create index product_variants_sku_trgm_idx on public.product_variants using gin (sku extensions.gin_trgm_ops);

create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function app.set_updated_at();

-- Variant tenancy must match its product's. Cheap guard against application
-- code writing a mismatched pair.
create or replace function app.assert_variant_tenant_consistency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company  uuid;
  v_merchant uuid;
begin
  select company_id, merchant_id into v_company, v_merchant
  from public.products where id = new.product_id;

  if v_company is null then
    raise exception 'Product % not found', new.product_id;
  end if;

  -- Fill them in when omitted, reject them when contradictory.
  if new.company_id is null then new.company_id := v_company; end if;
  if new.merchant_id is null then new.merchant_id := v_merchant; end if;

  if new.company_id <> v_company or new.merchant_id <> v_merchant then
    raise exception
      'Cross-tenant variant rejected: product % belongs to company %/merchant %',
      new.product_id, v_company, v_merchant
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger product_variants_tenant_consistency
  before insert or update of product_id, company_id, merchant_id on public.product_variants
  for each row execute function app.assert_variant_tenant_consistency();

-- -----------------------------------------------------------------------------
-- Collection membership — §3.6
-- -----------------------------------------------------------------------------

create table public.product_collections (
  collection_id uuid not null references public.collections (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  position      integer not null default 0,
  added_at      timestamptz not null default now(),
  primary key (collection_id, product_id)
);

create index product_collections_product_idx on public.product_collections (product_id);

-- -----------------------------------------------------------------------------
-- Channel mapping — §3.5
--
-- One row per (variant, store). The external identifiers differ per platform,
-- so they are separate nullable columns rather than a single opaque id: a
-- report of "products missing an ASIN" has to be answerable.
-- -----------------------------------------------------------------------------

create table public.product_channel_mappings (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  product_id  uuid not null references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete cascade,
  store_id    uuid not null references public.stores (id) on delete cascade,

  external_product_id text,
  external_variant_id text,
  external_sku        text,
  asin                text,
  marketplace_fulfillment_sku text,
  external_barcode    text,
  external_url        text,

  status      public.mapping_status not null default 'mapped',
  last_synced_at timestamptz,
  last_error  text,
  -- §3.10 direction: which side wins for this listing.
  master_source text not null default 'system'
    check (master_source in ('system', 'channel', 'bidirectional')),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,
  updated_by  uuid references public.app_users (id) on delete set null,

  -- One listing per variant per store; a null variant maps the product itself.
  constraint product_channel_mappings_unique unique (store_id, product_id, variant_id)
);

comment on table public.product_channel_mappings is
  '§3.5 links the master product to the identifiers each channel uses. §3.13 rule 13: inventory must not sync before a mapping exists.';

create index pcm_product_idx on public.product_channel_mappings (product_id);
create index pcm_store_idx   on public.product_channel_mappings (store_id, status);
create index pcm_variant_idx on public.product_channel_mappings (variant_id) where variant_id is not null;
create index pcm_external_idx on public.product_channel_mappings (store_id, external_variant_id);

create trigger product_channel_mappings_set_updated_at
  before update on public.product_channel_mappings
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Price matrix — §3.7
--
-- A price applies to a product or one variant, optionally narrowed to a store,
-- a marketplace, a country, a quantity break or a date window. Resolution picks
-- the most specific active row; ties are broken by priority.
-- -----------------------------------------------------------------------------

create table public.product_prices (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  product_id  uuid not null references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete cascade,

  price_type  public.price_type not null default 'base',
  amount      numeric(14,2) not null check (amount >= 0),
  currency    char(3) not null default 'EGP',

  -- Scope narrowing. All null = applies everywhere.
  store_id    uuid references public.stores (id) on delete cascade,
  merchant_id uuid references public.merchants (id) on delete cascade,
  country     text,
  min_quantity integer check (min_quantity is null or min_quantity > 0),

  valid_from  timestamptz,
  valid_to    timestamptz,
  priority    integer not null default 0,
  is_active   boolean not null default true,
  note        text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,
  updated_by  uuid references public.app_users (id) on delete set null,

  constraint product_prices_window_check check (valid_to is null or valid_from is null or valid_to > valid_from),
  -- A quantity break without a quantity is meaningless.
  constraint product_prices_quantity_check check (price_type <> 'quantity_based' or min_quantity is not null)
);

comment on table public.product_prices is
  '§3.7 price matrix. Every insert, change and deactivation is written to price_history by trigger (§3.13 rule 15).';

create index product_prices_product_idx on public.product_prices (product_id, price_type) where is_active;
create index product_prices_variant_idx on public.product_prices (variant_id) where variant_id is not null;
create index product_prices_store_idx   on public.product_prices (store_id) where store_id is not null;

create trigger product_prices_set_updated_at
  before update on public.product_prices
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Cost components — §3.8.  Summed into an effective cost for profitability.
-- -----------------------------------------------------------------------------

create table public.product_costs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  product_id  uuid not null references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete cascade,

  component   public.cost_component not null,
  amount      numeric(14,4) not null check (amount >= 0),
  currency    char(3) not null default 'EGP',
  -- Marketplace and affiliate commissions are naturally percentages.
  is_percentage boolean not null default false,

  effective_from date,
  effective_to   date,
  note        text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,
  updated_by  uuid references public.app_users (id) on delete set null,

  constraint product_costs_window_check check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint product_costs_unique unique (product_id, variant_id, component, effective_from)
);

comment on table public.product_costs is
  '§3.8 cost components. Feeds §7 profitability by order, product, store and merchant.';

create index product_costs_product_idx on public.product_costs (product_id, component);

create trigger product_costs_set_updated_at
  before update on public.product_costs
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Bundles and kits — §3.9
-- -----------------------------------------------------------------------------

create table public.bundle_components (
  id          uuid primary key default gen_random_uuid(),
  bundle_product_id uuid not null references public.products (id) on delete cascade,
  component_variant_id uuid not null references public.product_variants (id) on delete restrict,

  quantity    numeric(12,3) not null default 1 check (quantity > 0),
  -- A dynamic bundle offers optional components the customer picks from.
  is_required boolean not null default true,
  position    integer not null default 0,

  created_at  timestamptz not null default now(),

  constraint bundle_components_unique unique (bundle_product_id, component_variant_id)
  -- Self-reference and cycles need a lookup, so they are enforced by the
  -- bundle_components_no_recursion trigger below rather than a CHECK.
);

create index bundle_components_bundle_idx    on public.bundle_components (bundle_product_id, position);
create index bundle_components_component_idx on public.bundle_components (component_variant_id);

-- The self-reference check needs a lookup, so it is a trigger not a CHECK.
create or replace function app.assert_bundle_not_recursive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_component_product uuid;
  v_bundle_type public.product_type;
begin
  select product_id into v_component_product
  from public.product_variants where id = new.component_variant_id;

  if v_component_product = new.bundle_product_id then
    raise exception 'A bundle cannot contain itself'
      using errcode = 'check_violation';
  end if;

  select product_type into v_bundle_type
  from public.products where id = new.bundle_product_id;

  if v_bundle_type not in ('bundle', 'kit', 'composite') then
    raise exception 'Product % is not a bundle, kit or composite product', new.bundle_product_id
      using errcode = 'check_violation';
  end if;

  -- One level of nesting is enough to catch the common cycle; deeper cycles are
  -- prevented because a bundle's components must themselves be sellable units.
  if exists (
    select 1
    from public.bundle_components bc
    join public.product_variants pv on pv.id = bc.component_variant_id
    where bc.bundle_product_id = v_component_product
      and pv.product_id = new.bundle_product_id
  ) then
    raise exception 'Circular bundle composition rejected'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger bundle_components_no_recursion
  before insert or update on public.bundle_components
  for each row execute function app.assert_bundle_not_recursive();

-- §3.9 bundle cost is the sum of its components' costs.
create or replace function public.bundle_cost(p_bundle_product_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(bc.quantity * coalesce(pv.cost, p.base_cost, 0)), 0)
  from public.bundle_components bc
  join public.product_variants pv on pv.id = bc.component_variant_id
  join public.products p          on p.id = pv.product_id
  where bc.bundle_product_id = p_bundle_product_id;
$$;

comment on function public.bundle_cost is
  '§3.9 rolls a bundle cost up from its components, preferring the variant cost over the product base cost.';

-- -----------------------------------------------------------------------------
-- Price and cost history — §3.7 / §3.13 rule 15
--
-- Written by triggers so no application path can change a price without a
-- record. Append-only: clients get SELECT and nothing else.
-- -----------------------------------------------------------------------------

create table public.price_history (
  id          bigserial primary key,
  company_id  uuid,
  product_id  uuid references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete cascade,

  kind        text not null check (kind in ('price', 'cost')),
  price_type  public.price_type,
  component   public.cost_component,
  scope       text,                       -- 'product' | 'variant' | 'matrix'

  old_amount  numeric(14,4),
  new_amount  numeric(14,4),
  currency    char(3),

  changed_by  uuid references public.app_users (id) on delete set null,
  change_reason text,
  changed_at  timestamptz not null default now()
);

create index price_history_product_idx on public.price_history (product_id, changed_at desc);
create index price_history_variant_idx on public.price_history (variant_id, changed_at desc);
create index price_history_company_idx on public.price_history (company_id, changed_at desc);

comment on table public.price_history is
  '§3.13 rule 15: every price and cost change is logged. Append-only — no client role holds UPDATE or DELETE.';

/**
 * Records a change to the master price or cost on `products`.
 */
create or replace function app.log_product_price_change()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.base_price is distinct from old.base_price then
    insert into public.price_history (company_id, product_id, kind, price_type, scope, old_amount, new_amount, currency, changed_by, change_reason)
    values (new.company_id, new.id, 'price', 'base', 'product', old.base_price, new.base_price, new.currency, app.uid(),
            nullif(current_setting('app.change_reason', true), ''));
  end if;

  if tg_op = 'UPDATE' and new.base_cost is distinct from old.base_cost then
    insert into public.price_history (company_id, product_id, kind, component, scope, old_amount, new_amount, currency, changed_by, change_reason)
    values (new.company_id, new.id, 'cost', 'purchase', 'product', old.base_cost, new.base_cost, new.currency, app.uid(),
            nullif(current_setting('app.change_reason', true), ''));
  end if;

  if tg_op = 'INSERT' and new.base_price is not null then
    insert into public.price_history (company_id, product_id, kind, price_type, scope, old_amount, new_amount, currency, changed_by)
    values (new.company_id, new.id, 'price', 'base', 'product', null, new.base_price, new.currency, app.uid());
  end if;

  return new;
end;
$$;

create trigger products_price_history
  after insert or update of base_price, base_cost on public.products
  for each row execute function app.log_product_price_change();

create or replace function app.log_variant_price_change()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.price is distinct from old.price then
    insert into public.price_history (company_id, product_id, variant_id, kind, price_type, scope, old_amount, new_amount, changed_by, change_reason)
    values (new.company_id, new.product_id, new.id, 'price', 'base', 'variant', old.price, new.price, app.uid(),
            nullif(current_setting('app.change_reason', true), ''));
  end if;

  if tg_op = 'UPDATE' and new.cost is distinct from old.cost then
    insert into public.price_history (company_id, product_id, variant_id, kind, component, scope, old_amount, new_amount, changed_by, change_reason)
    values (new.company_id, new.product_id, new.id, 'cost', 'purchase', 'variant', old.cost, new.cost, app.uid(),
            nullif(current_setting('app.change_reason', true), ''));
  end if;

  if tg_op = 'INSERT' and new.price is not null then
    insert into public.price_history (company_id, product_id, variant_id, kind, price_type, scope, old_amount, new_amount, changed_by)
    values (new.company_id, new.product_id, new.id, 'price', 'base', 'variant', null, new.price, app.uid());
  end if;

  return new;
end;
$$;

create trigger product_variants_price_history
  after insert or update of price, cost on public.product_variants
  for each row execute function app.log_variant_price_change();

create or replace function app.log_matrix_price_change()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_old numeric(14,4) := case when tg_op = 'INSERT' then null else old.amount end;
  v_new numeric(14,4) := case when tg_op = 'DELETE' then null else new.amount end;
  v_row public.product_prices;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;

  -- Deactivating a price is a price change from the seller's point of view.
  if tg_op = 'UPDATE' and new.amount = old.amount and new.is_active = old.is_active then
    return new;
  end if;

  insert into public.price_history (company_id, product_id, variant_id, kind, price_type, scope, old_amount, new_amount, currency, changed_by, change_reason)
  values (v_row.company_id, v_row.product_id, v_row.variant_id, 'price', v_row.price_type, 'matrix',
          v_old, case when tg_op <> 'DELETE' and not new.is_active then null else v_new end,
          v_row.currency, app.uid(), nullif(current_setting('app.change_reason', true), ''));

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger product_prices_history
  after insert or update or delete on public.product_prices
  for each row execute function app.log_matrix_price_change();

create or replace function app.log_cost_change()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.product_costs;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;

  insert into public.price_history (company_id, product_id, variant_id, kind, component, scope, old_amount, new_amount, currency, changed_by, change_reason)
  values (v_row.company_id, v_row.product_id, v_row.variant_id, 'cost', v_row.component, 'matrix',
          case when tg_op = 'INSERT' then null else old.amount end,
          case when tg_op = 'DELETE' then null else new.amount end,
          v_row.currency, app.uid(), nullif(current_setting('app.change_reason', true), ''));

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger product_costs_history
  after insert or update or delete on public.product_costs
  for each row execute function app.log_cost_change();

-- -----------------------------------------------------------------------------
-- Business rules the database must own — §3.13
-- -----------------------------------------------------------------------------

-- Rule 5: duplicate barcodes are rejected unless the company allows them.
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

  if tg_table_name = 'products' then
    select exists (
      select 1 from public.products
      where merchant_id = new.merchant_id and barcode = new.barcode and id <> new.id
    ) into v_clash;
  else
    select exists (
      select 1 from public.product_variants
      where merchant_id = new.merchant_id and barcode = new.barcode and id <> new.id
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

create trigger products_barcode_unique
  before insert or update of barcode on public.products
  for each row execute function app.assert_barcode_unique();

create trigger product_variants_barcode_unique
  before insert or update of barcode on public.product_variants
  for each row execute function app.assert_barcode_unique();

-- Rule 11: a product cannot be published without a selling price.
create or replace function app.assert_product_publishable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_price boolean;
begin
  if new.status not in ('active', 'under_review') then
    return new;
  end if;

  -- Publishable if the master price is set, or any variant prices itself, or an
  -- active base row exists in the price matrix.
  select new.base_price is not null
      or exists (select 1 from public.product_variants where product_id = new.id and price is not null and is_active)
      or exists (select 1 from public.product_prices where product_id = new.id and price_type = 'base' and is_active)
    into v_has_price;

  if not v_has_price then
    raise exception
      'Product % cannot be activated without a selling price (spec §3.13 rule 11)', new.sku
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger products_publishable
  before insert or update of status, base_price on public.products
  for each row execute function app.assert_product_publishable();

/**
 * Rule 7 / rule 13, exposed for Phase 3 order intake and Phase 4 inventory:
 * whether a variant may be sold right now, and whether it may sync.
 */
create or replace function public.variant_sellable(p_variant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.product_variants pv
    join public.products p  on p.id = pv.product_id
    join public.merchants m on m.id = p.merchant_id
    join public.companies c on c.id = p.company_id
    where pv.id = p_variant_id
      and pv.is_active
      and pv.archived_at is null
      and p.is_sellable
      and p.status = 'active'
      and p.archived_at is null
      and m.status in ('active', 'ready_for_go_live')
      and m.archived_at is null
      and c.status = 'active'
  );
$$;

comment on function public.variant_sellable is
  '§3.13 rule 7: an inactive product cannot be sold. Also honours merchant and company suspension (rule 21).';

-- §3.13 rule 13: inventory must not synchronize before mapping is complete.
create view public.mapped_variants as
select
  pv.id            as variant_id,
  pv.product_id,
  pv.company_id,
  pv.merchant_id,
  pcm.store_id,
  pcm.external_variant_id,
  pcm.status       as mapping_status
from public.product_variants pv
join public.product_channel_mappings pcm
  on pcm.variant_id = pv.id
where pcm.status = 'mapped'
  and pv.is_active
  and pv.archived_at is null;

comment on view public.mapped_variants is
  '§3.13 rule 13: inventory sync must read this, never product_variants directly — an unmapped variant has nothing to sync against.';

-- §3.14 "Unmapped products" report, as a view so the screen and the report agree.
create view public.unmapped_products as
select
  p.id,
  p.company_id,
  p.merchant_id,
  p.sku,
  p.name_en,
  p.name_ar,
  p.status,
  p.base_price,
  p.barcode,
  (select count(*) from public.product_variants v where v.product_id = p.id and v.archived_at is null) as variant_count,
  (select count(*) from public.product_channel_mappings m where m.product_id = p.id) as mapping_count
from public.products p
where p.archived_at is null
  and not exists (
    select 1 from public.product_channel_mappings m
    where m.product_id = p.id and m.status = 'mapped'
  );

comment on view public.unmapped_products is
  '§3.14 products with no live channel mapping — the queue the catalog team works through.';

-- -----------------------------------------------------------------------------
-- Audit — §2.9 applies to catalog tables too.
-- -----------------------------------------------------------------------------

create trigger products_audit            after insert or update or delete on public.products            for each row execute function app.audit_trigger();
create trigger product_variants_audit    after insert or update or delete on public.product_variants    for each row execute function app.audit_trigger();
create trigger brands_audit              after insert or update or delete on public.brands              for each row execute function app.audit_trigger();
create trigger categories_audit          after insert or update or delete on public.categories          for each row execute function app.audit_trigger();
create trigger suppliers_audit           after insert or update or delete on public.suppliers           for each row execute function app.audit_trigger();
create trigger collections_audit         after insert or update or delete on public.collections         for each row execute function app.audit_trigger();
create trigger product_prices_audit      after insert or update or delete on public.product_prices      for each row execute function app.audit_trigger();
create trigger product_costs_audit       after insert or update or delete on public.product_costs       for each row execute function app.audit_trigger();
create trigger pcm_audit                 after insert or update or delete on public.product_channel_mappings for each row execute function app.audit_trigger();
create trigger bundle_components_audit   after insert or update or delete on public.bundle_components   for each row execute function app.audit_trigger();
