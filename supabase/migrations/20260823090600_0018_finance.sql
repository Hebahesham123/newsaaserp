-- =============================================================================
-- Green ERP — 0018 Finance, settlements & profitability  (spec §7)
--
-- Scope note the spec makes itself (§7.2): this is **operational finance, not a
-- general ledger**. There are no journals, no chart of accounts and no double
-- entry — the question being answered is "did this order make money", not "does
-- the trial balance close".
--
-- The organising idea is that **profit is derived, never stored**. §7.12 rule 6
-- requires profitability to recalculate whenever any cost component changes. A
-- stored profit column would need every writer to remember to update it; a view
-- over the cost rows cannot be wrong.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums — §7.3, §7.4, §7.8, §7.10
-- -----------------------------------------------------------------------------

-- §7.3 the four cost groups plus the catch-all.
create type public.cost_category as enum ('product', 'operations', 'shipping', 'marketing', 'other');

-- §7.3 the individual lines within those groups.
create type public.order_cost_type as enum (
  -- product
  'purchase', 'manufacturing',
  -- operations
  'picking', 'packing', 'packaging_material', 'storage',
  -- shipping
  'courier_fee', 'return_shipping', 'return_handling',
  -- marketing
  'ads_meta', 'ads_google', 'ads_tiktok', 'affiliate_commission', 'influencer', 'coupon_discount',
  -- extra
  'payment_gateway', 'bank_charges', 'customer_service', 'other'
);

-- §7.4 advertising platforms.
create type public.marketing_platform as enum (
  'meta', 'google', 'tiktok', 'snapchat', 'influencer', 'affiliate', 'other'
);

-- §7.8 Draft → Approved → Paid → Cancelled, verbatim.
create type public.invoice_status as enum ('draft', 'approved', 'paid', 'cancelled');

-- §7.7 merchant settlement statement lifecycle.
create type public.settlement_status as enum ('draft', 'calculated', 'approved', 'paid', 'disputed');

-- §7.10 expense approval flow.
create type public.expense_status as enum ('draft', 'submitted', 'approved', 'rejected', 'paid');

create type public.settlement_cycle as enum ('daily', 'weekly', 'biweekly', 'monthly');

-- -----------------------------------------------------------------------------
-- §7.12 rule 1: an order's costs cannot be edited after the period is closed.
--
-- Periods are per company and explicit, because "closed" has to be a fact
-- somebody asserted on a date, not an inference from the calendar.
-- -----------------------------------------------------------------------------

create table public.finance_periods (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,

  period_start date not null,
  period_end   date not null,
  is_closed    boolean not null default false,
  closed_at    timestamptz,
  closed_by    uuid references public.app_users (id) on delete set null,
  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint finance_periods_unique unique (company_id, period_start),
  constraint finance_periods_range check (period_end >= period_start)
);

create index finance_periods_lookup_idx on public.finance_periods (company_id, period_start, period_end);

create trigger finance_periods_set_updated_at
  before update on public.finance_periods
  for each row execute function app.set_updated_at();

create or replace function app.period_is_closed(p_company_id uuid, p_date timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.finance_periods
    where company_id = p_company_id
      and is_closed
      and p_date::date between period_start and period_end
  );
$$;

-- -----------------------------------------------------------------------------
-- Order cost structure — §7.3
--
-- One row per cost line per order, rather than a wide column per cost type: the
-- spec's list will grow, and a table absorbs that without a migration.
-- -----------------------------------------------------------------------------

create table public.order_costs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  merchant_id  uuid not null references public.merchants (id) on delete restrict,
  order_id     uuid not null references public.orders (id) on delete cascade,

  category     public.cost_category not null,
  cost_type    public.order_cost_type not null,
  amount       numeric(14,4) not null check (amount >= 0),
  currency     char(3) not null default 'EGP',

  -- Where the number came from: a rate card, a courier invoice, an allocation
  -- of campaign spend, or somebody typing it in.
  source       text not null default 'manual'
    check (source in ('manual', 'catalog', 'rate_card', 'courier', 'campaign', 'allocation', 'import')),
  reference_type text,
  reference_id uuid,
  note         text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,

  constraint order_costs_unique unique (order_id, cost_type, reference_id)
);

comment on table public.order_costs is
  '§7.3 the cost lines that make up an order. Profitability is a view over these, so it can never disagree with them.';

create index order_costs_order_idx    on public.order_costs (order_id, category);
create index order_costs_company_idx  on public.order_costs (company_id, created_at desc);
create index order_costs_merchant_idx on public.order_costs (merchant_id, cost_type);

create trigger order_costs_set_updated_at
  before update on public.order_costs
  for each row execute function app.set_updated_at();

-- §7.12 rule 1 — the closed-period guard.
create or replace function app.guard_closed_period()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.order_costs := case when tg_op = 'DELETE' then old else new end;
  v_order_date timestamptz;
begin
  select order_date into v_order_date from public.orders where id = v_row.order_id;

  if app.period_is_closed(v_row.company_id, coalesce(v_order_date, now()))
     and not app.has_perm('finance.costs.edit_closed') then
    raise exception
      'This order falls in a closed accounting period; editing its costs needs the finance.costs.edit_closed permission (spec §7.12 rule 1)'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger order_costs_period_guard
  before insert or update or delete on public.order_costs
  for each row execute function app.guard_closed_period();

-- -----------------------------------------------------------------------------
-- Marketing expenses — §7.4
-- -----------------------------------------------------------------------------

create table public.marketing_expenses (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  merchant_id  uuid references public.merchants (id) on delete restrict,
  store_id     uuid references public.stores (id) on delete set null,
  product_id   uuid references public.products (id) on delete set null,

  platform     public.marketing_platform not null,
  -- Campaigns become a Phase 8 entity; the reference is carried as text now so
  -- historical spend keeps its attribution when that table lands.
  campaign_ref text,
  campaign_name text,

  spent_on     date not null,
  amount       numeric(14,2) not null check (amount >= 0),
  currency     char(3) not null default 'EGP',

  -- §7.4 "support automatic import from Meta and Google in future" — the
  -- external id is what makes a re-import idempotent when that arrives.
  external_id  text,
  imported_at  timestamptz,

  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null
);

comment on table public.marketing_expenses is
  '§7.4 ad spend per campaign, store, merchant and optionally product. Feeds §7.9 campaign profitability.';

create unique index marketing_expenses_external_unique
  on public.marketing_expenses (company_id, platform, external_id)
  where external_id is not null;

create index marketing_expenses_date_idx     on public.marketing_expenses (company_id, spent_on desc);
create index marketing_expenses_campaign_idx on public.marketing_expenses (campaign_ref) where campaign_ref is not null;
create index marketing_expenses_store_idx    on public.marketing_expenses (store_id) where store_id is not null;

create trigger marketing_expenses_set_updated_at
  before update on public.marketing_expenses
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Operating expenses — §7.10
-- -----------------------------------------------------------------------------

-- §7.12 rule 4: "all expenses must be linked to a category". A table, so the
-- categories are configurable, and a NOT NULL FK, so the rule is structural.
create table public.expense_categories (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  code         text not null,
  name_en      text not null,
  name_ar      text not null,
  -- Whether this category is absorbed into per-order operating cost or stays a
  -- company overhead. Drives whether it reaches §7.9 order profit.
  is_direct    boolean not null default false,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint expense_categories_code_unique unique (company_id, code)
);

create trigger expense_categories_set_updated_at
  before update on public.expense_categories
  for each row execute function app.set_updated_at();

create sequence public.expense_number_seq;

create table public.operating_expenses (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  -- §7.10 an expense may be attributed to a merchant or a warehouse, or neither.
  merchant_id  uuid references public.merchants (id) on delete restrict,
  warehouse_id uuid references public.warehouses (id) on delete set null,
  category_id  uuid not null references public.expense_categories (id) on delete restrict,

  expense_number text not null,
  status       public.expense_status not null default 'draft',

  description  text not null,
  incurred_on  date not null,
  amount       numeric(14,2) not null check (amount >= 0),
  currency     char(3) not null default 'EGP',

  vendor       text,
  reference    text,
  attachment_url text,

  -- §7.11 "approve expense" is its own permission, and §2.7.4 keeps maker ≠
  -- checker: the trigger below refuses self-approval.
  submitted_by uuid references public.app_users (id) on delete set null,
  submitted_at timestamptz,
  approved_by  uuid references public.app_users (id) on delete set null,
  approved_at  timestamptz,
  rejection_note text,
  paid_at      timestamptz,

  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,

  constraint operating_expenses_number_unique unique (company_id, expense_number)
);

create index operating_expenses_company_idx  on public.operating_expenses (company_id, incurred_on desc);
create index operating_expenses_status_idx   on public.operating_expenses (company_id, status);
create index operating_expenses_category_idx on public.operating_expenses (category_id);

create trigger operating_expenses_set_updated_at
  before update on public.operating_expenses
  for each row execute function app.set_updated_at();

create or replace function app.prepare_expense()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' and (new.expense_number is null or new.expense_number = '') then
    new.expense_number := 'EXP-' || to_char(now(), 'YYMM') || '-' ||
                          lpad(nextval('public.expense_number_seq')::text, 6, '0');
  end if;

  if new.status = 'submitted' and new.submitted_at is null then
    new.submitted_at := now();
    new.submitted_by := coalesce(new.submitted_by, app.uid());
  end if;

  if new.status = 'approved' then
    if new.approved_at is null then
      new.approved_at := now();
      new.approved_by := coalesce(new.approved_by, app.uid());
    end if;

    -- §2.7.4 segregation of duties: the person who raised it cannot be the
    -- person who approves it.
    if new.approved_by is not null and new.approved_by = coalesce(new.submitted_by, new.created_by) then
      raise exception
        'The same user cannot both raise and approve an expense (spec §2.7.4)'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger operating_expenses_prepare
  before insert or update on public.operating_expenses
  for each row execute function app.prepare_expense();

-- -----------------------------------------------------------------------------
-- Merchant settlements — §7.7
-- -----------------------------------------------------------------------------

create sequence public.settlement_number_seq;

create table public.merchant_settlements (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  merchant_id  uuid not null references public.merchants (id) on delete restrict,

  settlement_number text not null,
  status       public.settlement_status not null default 'draft',
  cycle        public.settlement_cycle not null default 'monthly',

  period_start date not null,
  period_end   date not null,

  -- §7.7 every figure the statement must show.
  total_orders     integer not null default 0,
  delivered_orders integer not null default 0,
  returned_orders  integer not null default 0,
  gross_sales      numeric(14,2) not null default 0,

  storage_cost   numeric(14,2) not null default 0,
  picking_cost   numeric(14,2) not null default 0,
  packing_cost   numeric(14,2) not null default 0,
  shipping_cost  numeric(14,2) not null default 0,
  returns_cost   numeric(14,2) not null default 0,
  commission     numeric(14,2) not null default 0,
  other_deductions numeric(14,2) not null default 0,

  collected_amount numeric(14,2) not null default 0,

  -- Generated, so the bottom line is arithmetic on the rows above it rather
  -- than a number somebody typed.
  total_deductions numeric(14,2) generated always as
    (storage_cost + picking_cost + packing_cost + shipping_cost + returns_cost + commission + other_deductions) stored,
  net_payable numeric(14,2) generated always as
    (collected_amount - (storage_cost + picking_cost + packing_cost + shipping_cost + returns_cost + commission + other_deductions)) stored,

  currency     char(3) not null default 'EGP',

  calculated_at timestamptz,
  approved_at  timestamptz,
  approved_by  uuid references public.app_users (id) on delete set null,
  paid_at      timestamptz,
  payment_reference text,
  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,

  constraint merchant_settlements_number_unique unique (company_id, settlement_number),
  constraint merchant_settlements_period unique (merchant_id, period_start, period_end),
  constraint merchant_settlements_range check (period_end >= period_start)
);

comment on table public.merchant_settlements is
  '§7.7 the periodic statement a fulfillment centre issues to a merchant. net_payable is generated from its own components.';

create index merchant_settlements_merchant_idx on public.merchant_settlements (merchant_id, period_start desc);
create index merchant_settlements_status_idx   on public.merchant_settlements (company_id, status);

create trigger merchant_settlements_set_updated_at
  before update on public.merchant_settlements
  for each row execute function app.set_updated_at();

-- The orders a statement covers, so a merchant can see what it was built from.
create table public.merchant_settlement_lines (
  id            uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.merchant_settlements (id) on delete cascade,
  company_id    uuid not null references public.companies (id) on delete restrict,
  order_id      uuid references public.orders (id) on delete set null,

  description   text not null,
  order_value   numeric(14,2) not null default 0,
  collected     numeric(14,2) not null default 0,
  fees          numeric(14,2) not null default 0,
  net           numeric(14,2) generated always as (collected - fees) stored,

  created_at    timestamptz not null default now()
);

create index merchant_settlement_lines_settlement_idx on public.merchant_settlement_lines (settlement_id);

create or replace function app.prepare_settlement()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' and (new.settlement_number is null or new.settlement_number = '') then
    new.settlement_number := 'MST-' || to_char(now(), 'YYMM') || '-' ||
                             lpad(nextval('public.settlement_number_seq')::text, 6, '0');
  end if;

  -- §7.12 rule 2: "no settlement may be approved before the data is matched".
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    if new.calculated_at is null then
      raise exception
        'Settlement % cannot be approved before it has been calculated and matched (spec §7.12 rule 2)',
        new.settlement_number
        using errcode = 'check_violation';
    end if;

    if new.approved_at is null then
      new.approved_at := now();
      new.approved_by := coalesce(new.approved_by, app.uid());
    end if;

    if new.approved_by is not null and new.approved_by = new.created_by then
      raise exception
        'The same user cannot both prepare and approve a settlement (spec §2.7.4)'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger merchant_settlements_prepare
  before insert or update on public.merchant_settlements
  for each row execute function app.prepare_settlement();

/**
 * §7.7 builds a merchant statement from the period's actual orders, collections
 * and fee schedule.
 *
 * Recalculating replaces the lines rather than appending, so re-running after a
 * correction gives the same answer as running once — and an approved statement
 * is refused outright, because the merchant has already been told the number.
 */
create or replace function public.calculate_merchant_settlement(p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_s public.merchant_settlements;
begin
  select * into v_s from public.merchant_settlements where id = p_settlement_id;
  if v_s.id is null then
    raise exception 'Settlement % not found', p_settlement_id using errcode = 'foreign_key_violation';
  end if;

  if not app.has_perm('finance.settlement.run') then
    raise exception 'Calculating a settlement requires the finance.settlement.run permission'
      using errcode = 'insufficient_privilege';
  end if;

  if v_s.status in ('approved', 'paid') then
    raise exception 'Settlement % is already approved; issue a correction instead', v_s.settlement_number
      using errcode = 'check_violation';
  end if;

  delete from public.merchant_settlement_lines where settlement_id = p_settlement_id;

  insert into public.merchant_settlement_lines (settlement_id, company_id, order_id, description, order_value, collected, fees)
  select p_settlement_id, v_s.company_id, o.id,
         'Order ' || o.order_number,
         o.total,
         coalesce(c.collected_amount, 0),
         coalesce((select sum(oc.amount) from public.order_costs oc where oc.order_id = o.id), 0)
  from public.orders o
  left join public.cod_collections c on c.order_id = o.id
  where o.merchant_id = v_s.merchant_id
    and o.order_date::date between v_s.period_start and v_s.period_end
    and o.archived_at is null
    and o.status <> 'cancelled';

  -- Aggregated per order first, then summed. Joining shipments, returns and
  -- cost lines in one pass would multiply an order's value by the number of
  -- rows it has in each — an order with two parcels would be counted twice.
  update public.merchant_settlements s
  set total_orders     = coalesce(agg.orders, 0),
      delivered_orders = coalesce(agg.delivered, 0),
      returned_orders  = coalesce(agg.returned, 0),
      gross_sales      = coalesce(agg.sales, 0),
      collected_amount = coalesce(agg.collected, 0),
      storage_cost     = coalesce(agg.storage, 0),
      picking_cost     = coalesce(agg.picking, 0),
      packing_cost     = coalesce(agg.packing, 0),
      shipping_cost    = coalesce(agg.shipping, 0),
      returns_cost     = coalesce(agg.returns, 0),
      status           = 'calculated',
      calculated_at    = now()
  from (
    select
      count(*)                        as orders,
      count(*) filter (where per.delivered) as delivered,
      count(*) filter (where per.returned)  as returned,
      coalesce(sum(per.total), 0)     as sales,
      coalesce(sum(per.collected), 0) as collected,
      coalesce(sum(per.storage), 0)   as storage,
      coalesce(sum(per.picking), 0)   as picking,
      coalesce(sum(per.packing), 0)   as packing,
      coalesce(sum(per.shipping), 0)  as shipping,
      coalesce(sum(per.returns), 0)   as returns
    from (
      select
        o.total,
        coalesce((select c.collected_amount from public.cod_collections c where c.order_id = o.id), 0) as collected,
        exists (select 1 from public.shipments sh where sh.order_id = o.id and sh.status = 'delivered') as delivered,
        exists (select 1 from public.returns r where r.order_id = o.id)                                 as returned,
        coalesce((select sum(oc.amount) from public.order_costs oc
                   where oc.order_id = o.id and oc.cost_type = 'storage'), 0)      as storage,
        coalesce((select sum(oc.amount) from public.order_costs oc
                   where oc.order_id = o.id and oc.cost_type = 'picking'), 0)      as picking,
        coalesce((select sum(oc.amount) from public.order_costs oc
                   where oc.order_id = o.id and oc.cost_type in ('packing', 'packaging_material')), 0) as packing,
        coalesce((select sum(oc.amount) from public.order_costs oc
                   where oc.order_id = o.id and oc.cost_type = 'courier_fee'), 0)  as shipping,
        coalesce((select sum(oc.amount) from public.order_costs oc
                   where oc.order_id = o.id and oc.cost_type in ('return_shipping', 'return_handling')), 0) as returns
      from public.orders o
      where o.merchant_id = v_s.merchant_id
        and o.order_date::date between v_s.period_start and v_s.period_end
        and o.archived_at is null
        and o.status <> 'cancelled'
    ) per
  ) agg
  where s.id = p_settlement_id;
end;
$$;

comment on function public.calculate_merchant_settlement is
  '§7.7 rebuilds a merchant statement from the period''s orders, collections and costs. Idempotent; refuses an approved statement.';

-- -----------------------------------------------------------------------------
-- Invoicing — §7.8
-- -----------------------------------------------------------------------------

create sequence public.invoice_number_seq;

create table public.invoices (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  merchant_id  uuid references public.merchants (id) on delete restrict,
  settlement_id uuid references public.merchant_settlements (id) on delete set null,

  invoice_number text not null,
  status       public.invoice_status not null default 'draft',

  issue_date   date not null default current_date,
  due_date     date,

  subtotal     numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_amount   numeric(14,2) not null default 0 check (tax_amount >= 0),
  discount     numeric(14,2) not null default 0 check (discount >= 0),
  total        numeric(14,2) not null default 0 check (total >= 0),
  currency     char(3) not null default 'EGP',

  approved_at  timestamptz,
  approved_by  uuid references public.app_users (id) on delete set null,
  paid_at      timestamptz,
  payment_reference text,
  cancelled_at timestamptz,
  cancellation_reason text,

  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,

  constraint invoices_number_unique unique (company_id, invoice_number)
);

create index invoices_merchant_idx on public.invoices (merchant_id, issue_date desc);
create index invoices_status_idx   on public.invoices (company_id, status);

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function app.set_updated_at();

create table public.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete restrict,

  -- §7.8 fulfillment services, storage, shipping, picking, returns, extras.
  service      public.fulfillment_service,
  description  text not null,
  quantity     numeric(14,3) not null default 1 check (quantity > 0),
  unit_price   numeric(14,4) not null default 0 check (unit_price >= 0),
  line_total   numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,

  position     integer not null default 0,
  created_at   timestamptz not null default now()
);

create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);

/**
 * §7.8 the invoice lifecycle, and §7.12 rule 5: an approved invoice can never
 * be deleted. Cancellation is a status, and it is the only way out.
 */
create or replace function app.prepare_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' and (new.invoice_number is null or new.invoice_number = '') then
    new.invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' ||
                          lpad(nextval('public.invoice_number_seq')::text, 6, '0');
  end if;

  if new.status = 'approved' and new.approved_at is null then
    new.approved_at := now();
    new.approved_by := coalesce(new.approved_by, app.uid());
  end if;

  if new.status = 'paid' and new.paid_at is null then
    new.paid_at := now();
  end if;

  if new.status = 'cancelled' then
    if tg_op = 'UPDATE' and old.status = 'paid' then
      raise exception 'A paid invoice cannot be cancelled; issue a credit note instead'
        using errcode = 'check_violation';
    end if;
    if new.cancelled_at is null then new.cancelled_at := now(); end if;
  end if;

  -- An approved invoice's figures are what the merchant was told; only the
  -- status may move after that.
  if tg_op = 'UPDATE' and old.status in ('approved', 'paid') then
    if new.subtotal is distinct from old.subtotal
       or new.total is distinct from old.total
       or new.tax_amount is distinct from old.tax_amount then
      raise exception
        'Invoice % is approved; its amounts can no longer be changed (spec §7.12 rule 5)', old.invoice_number
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger invoices_prepare
  before insert or update on public.invoices
  for each row execute function app.prepare_invoice();

create or replace function app.refuse_approved_invoice_delete()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'draft' then
    raise exception
      'Invoice % has been approved and cannot be deleted (spec §7.12 rule 5); cancel it instead', old.invoice_number
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger invoices_no_delete_after_approval
  before delete on public.invoices
  for each row execute function app.refuse_approved_invoice_delete();

-- Keep the header in step with its lines, so the two cannot disagree.
create or replace function app.recalculate_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
  v_subtotal numeric(14,2);
begin
  select coalesce(sum(line_total), 0) into v_subtotal
  from public.invoice_lines where invoice_id = v_invoice_id;

  update public.invoices
  set subtotal = v_subtotal,
      total    = round(v_subtotal + tax_amount - discount, 2)
  where id = v_invoice_id
    and status = 'draft';

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger invoice_lines_recalculate
  after insert or update or delete on public.invoice_lines
  for each row execute function app.recalculate_invoice();

-- -----------------------------------------------------------------------------
-- Profitability — §7.9
--
-- Views, not tables. §7.12 rule 6 requires profit to follow its inputs, and a
-- view is the only shape that cannot fall behind them.
-- -----------------------------------------------------------------------------

create view public.order_profitability as
select
  o.id            as order_id,
  o.company_id,
  o.merchant_id,
  o.store_id,
  o.order_number,
  o.order_date,
  o.status,
  o.campaign_ref,
  o.currency,
  o.total         as revenue,
  coalesce(sum(oc.amount) filter (where oc.category = 'product'), 0)    as product_cost,
  coalesce(sum(oc.amount) filter (where oc.category = 'operations'), 0) as operations_cost,
  coalesce(sum(oc.amount) filter (where oc.category = 'shipping'), 0)   as shipping_cost,
  coalesce(sum(oc.amount) filter (where oc.category = 'marketing'), 0)  as marketing_cost,
  coalesce(sum(oc.amount) filter (where oc.category = 'other'), 0)      as other_cost,
  coalesce(sum(oc.amount), 0)                                           as total_cost,
  o.total - coalesce(sum(oc.amount), 0)                                 as gross_profit,
  case when o.total > 0
       then round((o.total - coalesce(sum(oc.amount), 0)) / o.total * 100, 2)
       else null end                                                    as margin_percentage
from public.orders o
left join public.order_costs oc on oc.order_id = o.id
where o.archived_at is null
group by o.id;

comment on view public.order_profitability is
  '§7.9 order-level P&L. Derived from order_costs, so §7.12 rule 6 (recalculate on any cost change) holds by construction.';

create view public.merchant_profitability as
select
  p.company_id,
  p.merchant_id,
  date_trunc('month', p.order_date)::date as month,
  count(*)                    as orders,
  sum(p.revenue)              as revenue,
  sum(p.total_cost)           as total_cost,
  sum(p.gross_profit)         as gross_profit,
  case when sum(p.revenue) > 0
       then round(sum(p.gross_profit) / sum(p.revenue) * 100, 2)
       else null end          as margin_percentage
from public.order_profitability p
group by p.company_id, p.merchant_id, date_trunc('month', p.order_date);

create view public.campaign_profitability as
select
  p.company_id,
  p.campaign_ref,
  count(*)                                    as orders,
  sum(p.revenue)                              as revenue,
  sum(p.marketing_cost)                       as attributed_ad_spend,
  sum(p.total_cost)                           as total_cost,
  sum(p.gross_profit)                         as gross_profit,
  -- Return on ad spend, the number a marketing manager actually asks for.
  case when sum(p.marketing_cost) > 0
       then round(sum(p.revenue) / sum(p.marketing_cost), 2)
       else null end                          as roas
from public.order_profitability p
where p.campaign_ref is not null
group by p.company_id, p.campaign_ref;

create view public.product_profitability as
select
  oi.company_id,
  oi.variant_id,
  oi.product_id,
  sum(oi.total)                                     as revenue,
  sum(oi.quantity)                                  as units_sold,
  coalesce(sum(oi.quantity * pv.cost), 0)           as product_cost,
  sum(oi.total) - coalesce(sum(oi.quantity * pv.cost), 0) as gross_profit
from public.order_items oi
join public.orders o on o.id = oi.order_id and o.status <> 'cancelled' and o.archived_at is null
left join public.product_variants pv on pv.id = oi.variant_id
group by oi.company_id, oi.variant_id, oi.product_id;

/**
 * §7.3 "the total order cost must be calculated automatically."
 *
 * Populates the cost lines that can be derived without human input: product
 * cost from the catalog, courier fee from the shipment, packaging from the
 * package. Called when an order is confirmed and again when it ships. Existing
 * lines of the same type are replaced, so re-running is safe.
 */
create or replace function public.rebuild_order_costs(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'Order % not found', p_order_id using errcode = 'foreign_key_violation';
  end if;

  -- Only the derived lines are rebuilt; anything entered by hand survives.
  delete from public.order_costs
  where order_id = p_order_id
    and source in ('catalog', 'courier', 'rate_card');

  -- Product cost, from the variant cost captured in the catalog (§3.8).
  insert into public.order_costs (company_id, merchant_id, order_id, category, cost_type, amount, currency, source, note)
  select v_order.company_id, v_order.merchant_id, p_order_id, 'product', 'purchase',
         coalesce(sum(oi.quantity * coalesce(pv.cost, 0)), 0), v_order.currency, 'catalog',
         'Rolled up from variant costs'
  from public.order_items oi
  left join public.product_variants pv on pv.id = oi.variant_id
  where oi.order_id = p_order_id
  having coalesce(sum(oi.quantity * coalesce(pv.cost, 0)), 0) > 0;

  -- Courier fee, from the shipment actually booked (§6.10).
  insert into public.order_costs (company_id, merchant_id, order_id, category, cost_type, amount, currency, source, reference_type, reference_id, note)
  select v_order.company_id, v_order.merchant_id, p_order_id, 'shipping', 'courier_fee',
         s.shipping_fee, s.currency, 'courier', 'shipment', s.id,
         'Courier fee for ' || s.shipment_number
  from public.shipments s
  where s.order_id = p_order_id and s.shipping_fee > 0;

  -- Packaging material actually consumed (§5.16).
  insert into public.order_costs (company_id, merchant_id, order_id, category, cost_type, amount, currency, source, reference_type, reference_id, note)
  select v_order.company_id, v_order.merchant_id, p_order_id, 'operations', 'packaging_material',
         pk.material_cost, v_order.currency, 'rate_card', 'package', pk.id,
         'Packaging for ' || pk.package_number
  from public.packages pk
  where pk.order_id = p_order_id and pk.material_cost > 0;

  -- Fulfillment service fees per the merchant's rate card (§5.20).
  insert into public.order_costs (company_id, merchant_id, order_id, category, cost_type, amount, currency, source, note)
  select v_order.company_id, v_order.merchant_id, p_order_id, 'operations',
         case f.service when 'picking' then 'picking'::public.order_cost_type
                        when 'packing' then 'packing'::public.order_cost_type
                        else 'storage'::public.order_cost_type end,
         coalesce(f.fee_per_event, 0), f.currency, 'rate_card',
         'Fulfillment fee: ' || f.service
  from public.fulfillment_fees f
  where f.merchant_id = v_order.merchant_id
    and f.is_active
    and f.service in ('picking', 'packing', 'storage')
    and coalesce(f.fee_per_event, 0) > 0
    and (f.effective_from is null or f.effective_from <= v_order.order_date::date)
    and (f.effective_to is null or f.effective_to >= v_order.order_date::date);
end;
$$;

comment on function public.rebuild_order_costs is
  '§7.3 rebuilds the derived cost lines for an order from the catalog, shipment, package and merchant rate card. Manual lines are preserved.';

-- -----------------------------------------------------------------------------
-- Audit — §7.12 rule 3: every financial change is in the audit log.
-- -----------------------------------------------------------------------------

create trigger order_costs_audit          after insert or update or delete on public.order_costs          for each row execute function app.audit_trigger();
create trigger marketing_expenses_audit   after insert or update or delete on public.marketing_expenses   for each row execute function app.audit_trigger();
create trigger expense_categories_audit   after insert or update or delete on public.expense_categories   for each row execute function app.audit_trigger();
create trigger operating_expenses_audit   after insert or update or delete on public.operating_expenses   for each row execute function app.audit_trigger();
create trigger merchant_settlements_audit after insert or update or delete on public.merchant_settlements for each row execute function app.audit_trigger();
create trigger invoices_audit             after insert or update or delete on public.invoices             for each row execute function app.audit_trigger();
create trigger invoice_lines_audit        after insert or update or delete on public.invoice_lines        for each row execute function app.audit_trigger();
create trigger finance_periods_audit      after insert or update or delete on public.finance_periods      for each row execute function app.audit_trigger();
