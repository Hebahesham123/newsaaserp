-- =====================================================================
-- RUN THIS ONCE, IN THE SUPABASE SQL EDITOR.
--
-- Migrations 0027-0029: the Orders change request.
-- Everything through 0026 is already applied to your project.
--
-- Paste the whole file into one tab and press Run. It is wrapped in a
-- single transaction, so a failure applies nothing and leaves the
-- database exactly as it was.
--
-- It is NOT safe to run twice: the second run fails on the first
-- `create type` and rolls itself back, which is noisy but harmless.
--
-- What it adds:
--   * product_commissions  - fixed / percentage / markup rules per product
--                            and per bundle tier
--   * order_items gains system_price, commission_model, commission_amount
--   * tickets + ticket_types + SLA gate + KPI impact
--   * saved views, per-user column preferences
--   * governorates + cities (Egypt seeded) for dependent dropdowns
--   * order_imports + order_import_rows for bulk import
--   * 12 new permissions
--
-- Two behaviours worth knowing before you run it:
--   * A commission can no longer be written by hand. A trigger computes it
--     from the product rule and overwrites whatever was supplied.
--   * A ticket whose type requires an SLA breach is REFUSED until that SLA
--     is actually breached. Seeded thresholds: confirmation 2h, warehouse
--     12h, shipping 24h, delivery 72h, return 48h, settlement 7d.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 20261018090000_0027_affiliate_commission_engine.sql
-- Product-level affiliate commission rules, and the triggers that compute every commission
-- ---------------------------------------------------------------------

-- =============================================================================
-- 0027 — Affiliate commission engine
--
-- §4 Order User / Affiliate, §5 Commission Status.
--
-- Commission is configured on the PRODUCT and applied by the ORDER. That split
-- is the whole design: pricing rules belong to the catalogue, where they are
-- maintained once, while an order is only ever a reader of them. It is also why
-- none of this lives in the application — "the affiliate never types the
-- commission" is only true if the database refuses to store a number it did not
-- compute itself.
--
-- Two models, from the brief:
--
--   fixed_amount  selling price is fixed; commission is a flat sum per unit
--   percentage    selling price is fixed; commission is a share of it
--   markup        affiliate picks the selling price inside a band, and keeps
--                 the difference over the system price
--
-- Bundles are tiers of the same rule rather than separate products: 1, 2 and 3
-- pieces are three rows differing only in `bundle_quantity`, so "3 pieces earns
-- more per unit" is expressible without duplicating the product.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. How a product pays an affiliate
-- -----------------------------------------------------------------------------

-- A separate type from `public.commission_model`, which is the affiliate's own
-- default (percentage / fixed_per_order / tiered). These are product-level
-- pricing rules and they answer a different question, so they do not share a
-- vocabulary. Extending the existing enum would also have been unusable here:
-- a value added by ALTER TYPE cannot be referenced in the same transaction.
create type public.product_commission_model as enum (
  'fixed_amount',
  'percentage',
  'markup'
);

create table public.product_commissions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,

  product_id      uuid not null references public.products (id) on delete cascade,
  -- Null means "every variant of this product". A variant-specific row wins.
  variant_id      uuid references public.product_variants (id) on delete cascade,

  -- The bundle tier this rule prices: 1 piece, 2 pieces, 3 pieces.
  bundle_quantity integer not null default 1 check (bundle_quantity >= 1),

  model           public.product_commission_model not null,

  -- Fixed models: the price the affiliate must sell at and may not change.
  selling_price   numeric(14,2) check (selling_price is null or selling_price >= 0),

  -- fixed_amount → currency per unit. percentage → percent of selling price.
  commission_value numeric(14,3) check (commission_value is null or commission_value >= 0),

  -- Markup model: the floor the company keeps, and the band the affiliate may
  -- price within.
  system_price      numeric(14,2) check (system_price is null or system_price >= 0),
  min_selling_price numeric(14,2) check (min_selling_price is null or min_selling_price >= 0),
  max_selling_price numeric(14,2) check (max_selling_price is null or max_selling_price >= 0),

  is_active       boolean not null default true,
  note            text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.app_users (id) on delete set null,
  updated_by      uuid references public.app_users (id) on delete set null,

  -- A rule that does not carry the numbers its own model needs is not a rule,
  -- it is a half-filled form. Refusing it here means the calculator downstream
  -- never has to ask whether a field it depends on happens to be null.
  constraint product_commissions_model_fields check (
    case model
      when 'fixed_amount' then selling_price is not null and commission_value is not null
      when 'percentage'   then selling_price is not null and commission_value is not null
      when 'markup'       then system_price is not null and max_selling_price is not null
    end
  ),

  -- A percentage over 100 would pay out more than the order is worth.
  constraint product_commissions_percentage_sane check (
    model <> 'percentage' or commission_value <= 100
  ),

  -- A flat commission larger than the price is a loss on every sale.
  constraint product_commissions_fixed_sane check (
    model <> 'fixed_amount' or commission_value <= selling_price
  ),

  constraint product_commissions_band check (
    model <> 'markup'
    or (
      system_price <= max_selling_price
      and (min_selling_price is null or min_selling_price <= max_selling_price)
      and (min_selling_price is null or min_selling_price >= system_price)
    )
  )
);

-- Nulls are distinct in a plain unique constraint, so a product-wide rule could
-- otherwise be inserted twice. Two partial indexes say what is actually meant.
create unique index product_commissions_product_tier_unique
  on public.product_commissions (product_id, bundle_quantity)
  where variant_id is null;

create unique index product_commissions_variant_tier_unique
  on public.product_commissions (product_id, variant_id, bundle_quantity)
  where variant_id is not null;

create index product_commissions_company_idx on public.product_commissions (company_id);
create index product_commissions_product_idx on public.product_commissions (product_id);

create trigger product_commissions_updated_at
  before update on public.product_commissions
  for each row execute function app.set_updated_at();

comment on table public.product_commissions is
  'Per-product affiliate commission rules. One row per bundle tier; a variant row overrides the product-wide row.';

-- -----------------------------------------------------------------------------
-- 2. What the order line records
-- -----------------------------------------------------------------------------

-- `unit_price` already holds what the customer pays, which under the markup
-- model is the affiliate's chosen selling price. These columns record what the
-- company kept and what the affiliate earned, frozen at the moment of sale so a
-- later edit to the product cannot rewrite history.
alter table public.order_items
  add column system_price      numeric(14,2),
  add column commission_model  public.product_commission_model,
  add column commission_amount numeric(14,2) not null default 0
    check (commission_amount >= 0),
  add column commission_rule_id uuid references public.product_commissions (id) on delete set null;

comment on column public.order_items.commission_amount is
  'Always computed by app.apply_item_commission(). A value supplied by a client is overwritten.';

-- -----------------------------------------------------------------------------
-- 3. Resolving which rule applies
-- -----------------------------------------------------------------------------

-- Most specific first: this variant at this tier, then this variant at any
-- tier, then the product at this tier, then the product at any tier. The
-- fallback chain is what lets a catalogue set one rule for a product and
-- override only the SKUs that genuinely differ.
create or replace function app.resolve_product_commission(
  p_product_id uuid,
  p_variant_id uuid,
  p_quantity   integer
)
returns public.product_commissions
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pc.*
  from public.product_commissions pc
  where pc.product_id = p_product_id
    and pc.is_active
    and (pc.variant_id is null or pc.variant_id = p_variant_id)
    and pc.bundle_quantity <= greatest(coalesce(p_quantity, 1), 1)
  order by
    (pc.variant_id is not null) desc,
    pc.bundle_quantity desc
  limit 1;
$$;

comment on function app.resolve_product_commission(uuid, uuid, integer) is
  'The commission rule governing one order line: most specific variant and highest applicable bundle tier.';

-- -----------------------------------------------------------------------------
-- 4. Applying it
-- -----------------------------------------------------------------------------

create or replace function app.apply_item_commission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_affiliate_id uuid;
  v_rule         public.product_commissions;
  v_qty          numeric;
  v_unit         numeric;
begin
  select o.affiliate_id into v_affiliate_id
  from public.orders o
  where o.id = new.order_id;

  -- No affiliate on the order means there is nothing to earn. Clearing rather
  -- than leaving the old values matters on update: unassigning an affiliate
  -- must not leave a commission behind.
  if v_affiliate_id is null then
    new.commission_amount  := 0;
    new.commission_model   := null;
    new.commission_rule_id := null;
    new.system_price       := null;
    return new;
  end if;

  v_qty  := greatest(coalesce(new.quantity, 0), 0);
  v_unit := coalesce(new.unit_price, 0);

  v_rule := app.resolve_product_commission(new.product_id, new.variant_id, new.quantity);

  -- A product with no rule earns nothing. Falling back to the affiliate's own
  -- default rate was considered and rejected: it would silently pay commission
  -- on products nobody configured for affiliate selling.
  if v_rule.id is null then
    new.commission_amount  := 0;
    new.commission_model   := null;
    new.commission_rule_id := null;
    new.system_price       := null;
    return new;
  end if;

  new.commission_rule_id := v_rule.id;
  new.commission_model   := v_rule.model;

  if v_rule.model = 'markup' then
    new.system_price := v_rule.system_price;

    if v_unit > v_rule.max_selling_price then
      raise exception
        'Selling price %.2f is above the maximum %.2f allowed for this product.',
        v_unit, v_rule.max_selling_price
        using errcode = 'check_violation';
    end if;

    if v_rule.min_selling_price is not null and v_unit < v_rule.min_selling_price then
      raise exception
        'Selling price %.2f is below the minimum %.2f allowed for this product.',
        v_unit, v_rule.min_selling_price
        using errcode = 'check_violation';
    end if;

    -- The affiliate keeps the margin over the system price, never less than nil.
    new.commission_amount := round(greatest(v_unit - v_rule.system_price, 0) * v_qty, 2);

  else
    -- Fixed models: the selling price is the company's, not the affiliate's.
    if v_rule.selling_price is not null and v_unit <> v_rule.selling_price then
      raise exception
        'This product sells at a fixed price of %.2f; %.2f was supplied.',
        v_rule.selling_price, v_unit
        using errcode = 'check_violation';
    end if;

    new.system_price := v_rule.selling_price;

    if v_rule.model = 'fixed_amount' then
      new.commission_amount := round(v_rule.commission_value * v_qty, 2);
    else
      new.commission_amount := round(v_rule.selling_price * v_rule.commission_value / 100 * v_qty, 2);
    end if;
  end if;

  return new;
end;
$$;

comment on function app.apply_item_commission() is
  'Computes the line commission from the product rule and refuses a selling price outside the allowed band.';

create trigger order_items_apply_commission
  before insert or update of product_id, variant_id, quantity, unit_price
  on public.order_items
  for each row execute function app.apply_item_commission();

-- -----------------------------------------------------------------------------
-- 5. Rolling the lines up to one commission per order
-- -----------------------------------------------------------------------------

create or replace function app.sync_order_commission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_order    public.orders;
  v_total    numeric;
begin
  select * into v_order from public.orders where id = v_order_id;

  if v_order.id is null then
    return coalesce(new, old);
  end if;

  if v_order.affiliate_id is null then
    delete from public.affiliate_commissions
    where order_id = v_order_id and status = 'pending';
    return coalesce(new, old);
  end if;

  select coalesce(sum(oi.commission_amount), 0) into v_total
  from public.order_items oi
  where oi.order_id = v_order_id;

  insert into public.affiliate_commissions as ac
    (company_id, affiliate_id, order_id, order_total, commission_amount, currency, status)
  values
    (v_order.company_id, v_order.affiliate_id, v_order_id,
     coalesce(v_order.total, 0), v_total, coalesce(v_order.currency, 'EGP'), 'pending')
  on conflict (order_id) do update
    set affiliate_id      = excluded.affiliate_id,
        order_total       = excluded.order_total,
        commission_amount = excluded.commission_amount,
        currency          = excluded.currency,
        updated_at        = now()
    -- Once money has been approved or paid, the figure is a record of what was
    -- owed, not a live calculation. Re-summing it later would quietly restate
    -- a settled payout.
    where ac.status = 'pending';

  return coalesce(new, old);
end;
$$;

comment on function app.sync_order_commission() is
  'Keeps one affiliate_commissions row per order, summed from its lines, while that row is still pending.';

create trigger order_items_sync_commission
  after insert or update or delete on public.order_items
  for each row execute function app.sync_order_commission();

-- -----------------------------------------------------------------------------
-- 6. §5 Commission Status — pending until the order actually lands
-- -----------------------------------------------------------------------------

-- Cancelling an order cancels the commission. An affiliate is not owed for
-- revenue that never arrived, and this is the half of the rule that cannot be
-- left to a nightly job: the money must stop being payable the moment the
-- order stops being real.
create or replace function app.cancel_commission_with_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'cancelled' and coalesce(old.status, new.status) <> 'cancelled' then
    update public.affiliate_commissions
       set status = 'cancelled', updated_at = now()
     where order_id = new.id
       and status in ('pending', 'payable');
  end if;

  return new;
end;
$$;

create trigger orders_cancel_commission
  after update of status on public.orders
  for each row execute function app.cancel_commission_with_order();

-- Delivery is what earns it. The flag lives on the affiliate because some are
-- paid on confirmation instead, and `pays_on_delivery` already records which.
create or replace function app.earn_commission_on_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'delivered' and coalesce(old.status::text, '') <> 'delivered' then
    update public.affiliate_commissions ac
       set status = 'payable', earned_on = current_date, updated_at = now()
     where ac.order_id = new.order_id
       and ac.status = 'pending';
  end if;

  -- A return reverses it, including one that comes back after it was approved.
  if new.status in ('returned_to_warehouse', 'return_inspection')
     and coalesce(old.status::text, '') not in ('returned_to_warehouse', 'return_inspection') then
    update public.affiliate_commissions ac
       set status = 'cancelled', updated_at = now()
     where ac.order_id = new.order_id
       and ac.status in ('pending', 'payable');
  end if;

  return new;
end;
$$;

create trigger shipments_earn_commission
  after update of status on public.shipments
  for each row execute function app.earn_commission_on_delivery();

-- -----------------------------------------------------------------------------
-- 7. Access control
-- -----------------------------------------------------------------------------

alter table public.product_commissions enable row level security;

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('products.commission.view',   'products', 'commissions', 'view',      'View product commission rules',   'عرض قواعد عمولة المنتج',   true,  false, 7300),
  ('products.commission.manage', 'products', 'commissions', 'configure', 'Manage product commission rules', 'إدارة قواعد عمولة المنتج', true,  false, 7301)
on conflict (code) do nothing;

select app.grant_perms_to_template('super_admin',        array['*']);
select app.grant_perms_to_template('system_admin',       array['products.commission.*']);
select app.grant_perms_to_template('company_admin',      array['products.commission.*']);
select app.grant_perms_to_template('operations_manager', array['products.commission.view']);
select app.grant_perms_to_template('marketing_manager',  array['products.commission.view', 'products.commission.manage']);
select app.grant_perms_to_template('accountant',         array['products.commission.view']);
select app.grant_perms_to_template('merchant_admin',     array['products.commission.view']);

create policy product_commissions_select on public.product_commissions
  for select to authenticated
  using (
    app.same_company(company_id)
    and (
      app.has_perm('products.commission.view')
      -- An affiliate must see the band they are allowed to price within, or
      -- they cannot fill the form the rule is about to judge.
      or (select u.affiliate_id from public.app_users u where u.id = app.uid()) is not null
    )
  );

create policy product_commissions_write on public.product_commissions
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('products.commission.manage'))
  with check (app.same_company(company_id) and app.has_perm('products.commission.manage'));

grant select, insert, update, delete on public.product_commissions to authenticated;

-- -----------------------------------------------------------------------------
-- 8. A readable view of what each affiliate is owed
-- -----------------------------------------------------------------------------

create view public.affiliate_commission_lines
with (security_invoker = on) as
select
  oi.id                 as order_item_id,
  oi.order_id,
  o.order_number,
  o.company_id,
  o.affiliate_id,
  a.name                as affiliate_name,
  oi.sku,
  oi.name               as product_name,
  oi.quantity,
  oi.unit_price         as selling_price,
  oi.system_price,
  oi.commission_model,
  oi.commission_amount,
  ac.status             as commission_status,
  ac.earned_on,
  o.order_date
from public.order_items oi
join public.orders o      on o.id = oi.order_id
join public.affiliates a  on a.id = o.affiliate_id
left join public.affiliate_commissions ac on ac.order_id = o.id
where oi.commission_amount > 0;

comment on view public.affiliate_commission_lines is
  'Line-level commission detail behind each affiliate_commissions row, for the "view details" drawer on the order.';

grant select on public.affiliate_commission_lines to authenticated;


-- ---------------------------------------------------------------------
-- 20261018090100_0028_tickets_sla_kpi.sql
-- Tickets, SLA validation, and KPI impact gated on confirmed responsibility
-- ---------------------------------------------------------------------

-- =============================================================================
-- 0028 — Tickets, SLA validation and KPI impact
--
-- §2 Quick Actions, §3 Ticket Rules & SLA Validation, §4 Ticket & KPI Integration.
--
-- Two rules from the brief shape everything here, and both are refusals:
--
--   A ticket may not be raised before the SLA it complains about is actually
--   breached. "Delayed confirmation" an hour into a two-hour SLA is not a
--   complaint, it is impatience, and letting it through would pollute the
--   metric the SLA exists to measure.
--
--   Raising a ticket does not touch anyone's KPI. The penalty lands only once a
--   human has reviewed it and confirmed responsibility. A system where opening
--   a ticket is itself the punishment is one where people stop opening tickets.
--
-- The person raising a ticket supplies three things: type, description and
-- evidence. Routing, priority, SLA and KPI rule are all derived — they are
-- properties of how the company is organised, not opinions of the reporter.
-- =============================================================================

create type public.ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');
create type public.ticket_priority as enum ('low', 'medium', 'high', 'urgent');

-- Which clock a ticket type measures. `none` is for types that are not about
-- lateness at all, such as a wrong confirmation.
create type public.sla_clock as enum (
  'none',
  'confirmation',
  'warehouse',
  'shipping',
  'delivery',
  'return',
  'settlement'
);

create type public.ticket_attachment_kind as enum (
  'file',
  'screenshot',
  'document',
  'call_recording'
);

-- -----------------------------------------------------------------------------
-- 1. The configured types, and the rules attached to each
-- -----------------------------------------------------------------------------

create table public.ticket_types (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,

  code          text not null,
  name_en       text not null,
  name_ar       text not null,
  description   text,

  -- The SLA this type complains about, and the threshold that must pass first.
  sla_clock     public.sla_clock not null default 'none',
  sla_hours     numeric(8,2) check (sla_hours is null or sla_hours >= 0),
  -- A type may be exempt: "wrong confirmation" is wrong immediately.
  requires_sla_breach boolean not null default true,

  -- Where it goes. Left null, routing falls back to the order's own team.
  assigned_department_id uuid references public.departments (id) on delete set null,
  assigned_team_id       uuid references public.teams (id) on delete set null,

  default_priority public.ticket_priority not null default 'medium',

  -- §4: the KPI this ticket counts against, once responsibility is confirmed.
  kpi_id        uuid references public.kpi_definitions (id) on delete set null,
  kpi_weight    numeric(8,2) not null default 1
    check (kpi_weight >= 0),

  is_active     boolean not null default true,
  sort_order    integer not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.app_users (id) on delete set null,
  updated_by    uuid references public.app_users (id) on delete set null,

  constraint ticket_types_code_unique unique (company_id, code),

  -- Requiring a breach without saying how long is a rule that can never be
  -- evaluated, so it is refused at definition time rather than at 2am.
  constraint ticket_types_sla_complete check (
    not requires_sla_breach
    or sla_clock = 'none'
    or sla_hours is not null
  )
);

create index ticket_types_company_idx on public.ticket_types (company_id);

create trigger ticket_types_updated_at
  before update on public.ticket_types
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. The tickets themselves
-- -----------------------------------------------------------------------------

create sequence if not exists public.ticket_number_seq;

create table public.tickets (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  ticket_number text not null,

  order_id      uuid references public.orders (id) on delete set null,
  ticket_type_id uuid not null references public.ticket_types (id) on delete restrict,

  description   text not null,
  status        public.ticket_status not null default 'open',
  priority      public.ticket_priority not null default 'medium',

  -- Who reported it, and from where. Derived from the session, not the form.
  raised_by           uuid references public.app_users (id) on delete set null,
  raised_from_team_id uuid references public.teams (id) on delete set null,

  -- Where it landed. Derived from the type, falling back to the order's owner.
  assigned_department_id uuid references public.departments (id) on delete set null,
  assigned_team_id       uuid references public.teams (id) on delete set null,
  responsible_user_id    uuid references public.app_users (id) on delete set null,
  supervisor_id          uuid references public.app_users (id) on delete set null,

  -- The SLA state at the moment it was raised, kept because the thresholds on
  -- the type may later change and this ticket was judged against the old one.
  sla_clock       public.sla_clock not null default 'none',
  sla_hours       numeric(8,2),
  sla_elapsed_hours numeric(8,2),
  sla_breached    boolean not null default false,
  sla_due_at      timestamptz,

  opened_at       timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at     timestamptz,
  closed_at       timestamptz,

  resolution      text,

  -- §4. The KPI penalty waits here until somebody confirms the fault was real.
  responsibility_confirmed    boolean not null default false,
  responsibility_confirmed_by uuid references public.app_users (id) on delete set null,
  responsibility_confirmed_at timestamptz,
  kpi_applied     boolean not null default false,
  kpi_entry_id    uuid references public.kpi_entries (id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.app_users (id) on delete set null,
  updated_by    uuid references public.app_users (id) on delete set null,

  constraint tickets_number_unique unique (company_id, ticket_number),

  -- A resolved ticket without a resolution is an unanswered question wearing a
  -- closed label.
  constraint tickets_resolution_present check (
    status not in ('resolved', 'closed') or resolution is not null
  )
);

create index tickets_company_idx     on public.tickets (company_id);
create index tickets_order_idx       on public.tickets (order_id);
create index tickets_status_idx      on public.tickets (company_id, status);
create index tickets_responsible_idx on public.tickets (responsible_user_id);
create index tickets_team_idx        on public.tickets (assigned_team_id);

create trigger tickets_updated_at
  before update on public.tickets
  for each row execute function app.set_updated_at();

create table public.ticket_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  ticket_id   uuid not null references public.tickets (id) on delete cascade,

  event_type  text not null,
  from_status public.ticket_status,
  to_status   public.ticket_status,
  note        text,
  payload     jsonb not null default '{}'::jsonb,

  actor_id    uuid references public.app_users (id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index ticket_events_ticket_idx on public.ticket_events (ticket_id, occurred_at desc);

create table public.ticket_attachments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  ticket_id    uuid not null references public.tickets (id) on delete cascade,

  kind         public.ticket_attachment_kind not null default 'file',
  file_url     text not null,
  file_name    text not null,
  content_type text,
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),

  uploaded_by  uuid references public.app_users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index ticket_attachments_ticket_idx on public.ticket_attachments (ticket_id);

-- -----------------------------------------------------------------------------
-- 3. Reading the clock
-- -----------------------------------------------------------------------------

-- How long the relevant stage has actually taken. Where the milestone has not
-- happened yet the clock is still running, so it is measured to now() — that is
-- precisely the case a lateness ticket is about.
create or replace function app.ticket_sla_elapsed_hours(
  p_order_id uuid,
  p_clock    public.sla_clock
)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_from  timestamptz;
  v_to    timestamptz;
begin
  if p_clock = 'none' or p_order_id is null then
    return null;
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then
    return null;
  end if;

  if p_clock = 'confirmation' then
    v_from := coalesce(v_order.order_date, v_order.created_at);
    v_to   := coalesce(v_order.confirmed_at, v_order.cancelled_at, now());

  elsif p_clock = 'warehouse' then
    v_from := v_order.ready_at;
    select min(s.created_at) into v_to
      from public.shipments s where s.order_id = p_order_id;
    v_to := coalesce(v_to, now());

  elsif p_clock = 'shipping' then
    select min(s.created_at), min(s.handed_over_at) into v_from, v_to
      from public.shipments s where s.order_id = p_order_id;
    v_to := coalesce(v_to, now());

  elsif p_clock = 'delivery' then
    select min(s.handed_over_at), min(s.delivered_at) into v_from, v_to
      from public.shipments s where s.order_id = p_order_id;
    v_to := coalesce(v_to, now());

  elsif p_clock = 'return' then
    select min(r.created_at), min(r.closed_at) into v_from, v_to
      from public.returns r where r.order_id = p_order_id;
    v_to := coalesce(v_to, now());

  else
    -- settlement and anything added later: measured from the order landing.
    v_from := coalesce(v_order.order_date, v_order.created_at);
    v_to   := now();
  end if;

  if v_from is null then
    return null;
  end if;

  return round(extract(epoch from (v_to - v_from)) / 3600.0, 2);
end;
$$;

comment on function app.ticket_sla_elapsed_hours(uuid, public.sla_clock) is
  'Hours elapsed on one SLA clock for an order, measured to now() while the stage is still open.';

-- -----------------------------------------------------------------------------
-- 4. Raising one: route it, judge it, and refuse it if it is premature
-- -----------------------------------------------------------------------------

create or replace function app.route_ticket()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type     public.ticket_types;
  v_order    public.orders;
  v_elapsed  numeric;
  v_team     public.teams;
begin
  select * into v_type from public.ticket_types where id = new.ticket_type_id;

  if v_type.id is null then
    raise exception 'Unknown ticket type.' using errcode = 'foreign_key_violation';
  end if;

  if not v_type.is_active then
    raise exception 'Ticket type % is no longer in use.', v_type.code
      using errcode = 'check_violation';
  end if;

  if new.order_id is not null then
    select * into v_order from public.orders where id = new.order_id;
  end if;

  new.ticket_number := coalesce(
    nullif(new.ticket_number, ''),
    'TK-' || lpad(nextval('public.ticket_number_seq')::text, 5, '0')
  );

  /* --- the SLA gate (§3) ------------------------------------------------- */

  v_elapsed := app.ticket_sla_elapsed_hours(new.order_id, v_type.sla_clock);

  new.sla_clock         := v_type.sla_clock;
  new.sla_hours         := v_type.sla_hours;
  new.sla_elapsed_hours := v_elapsed;
  new.sla_breached      := v_elapsed is not null
                           and v_type.sla_hours is not null
                           and v_elapsed >= v_type.sla_hours;

  if v_type.requires_sla_breach and v_type.sla_clock <> 'none' then
    if v_elapsed is null then
      raise exception
        'This ticket type measures the % SLA, which has not started for this order yet.',
        v_type.sla_clock
        using errcode = 'check_violation';
    end if;

    if not new.sla_breached then
      raise exception
        'The % SLA is % hours and only %.2f have passed. This ticket cannot be raised yet.',
        v_type.sla_clock, v_type.sla_hours, v_elapsed
        using errcode = 'check_violation';
    end if;
  end if;

  if v_order.id is not null and v_type.sla_hours is not null then
    new.sla_due_at := coalesce(v_order.order_date, v_order.created_at)
                      + make_interval(hours => floor(v_type.sla_hours)::int);
  end if;

  /* --- routing (§2: the reporter does not choose any of this) ------------ */

  new.raised_by := coalesce(new.raised_by, app.uid());

  select t.* into v_team
    from public.teams t
    join public.team_members tm on tm.team_id = t.id
   where tm.user_id = new.raised_by
   limit 1;

  new.raised_from_team_id := coalesce(new.raised_from_team_id, v_team.id);

  -- The configured destination wins; otherwise it lands on whoever owns the
  -- order, which is the only other party who can act on it.
  new.assigned_team_id := coalesce(v_type.assigned_team_id, new.assigned_team_id);
  new.assigned_department_id := coalesce(
    v_type.assigned_department_id,
    new.assigned_department_id,
    (select t.department_id from public.teams t where t.id = new.assigned_team_id)
  );

  new.responsible_user_id := coalesce(new.responsible_user_id, v_order.assigned_to);

  new.supervisor_id := coalesce(
    new.supervisor_id,
    (select t.leader_id from public.teams t where t.id = new.assigned_team_id),
    (select d.manager_id from public.departments d where d.id = new.assigned_department_id)
  );

  new.priority := coalesce(new.priority, v_type.default_priority);

  return new;
end;
$$;

comment on function app.route_ticket() is
  'Derives routing, priority and SLA state for a new ticket, and refuses one raised before its SLA is breached.';

create trigger tickets_route
  before insert on public.tickets
  for each row execute function app.route_ticket();

-- -----------------------------------------------------------------------------
-- 5. Lifecycle timestamps and the activity log
-- -----------------------------------------------------------------------------

create or replace function app.track_ticket_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'in_progress' and new.first_response_at is null then
      new.first_response_at := now();
    end if;
    if new.status = 'resolved' and new.resolved_at is null then
      new.resolved_at := now();
    end if;
    if new.status = 'closed' and new.closed_at is null then
      new.closed_at := now();
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.responsibility_confirmed
     and not old.responsibility_confirmed then
    new.responsibility_confirmed_at := coalesce(new.responsibility_confirmed_at, now());
    new.responsibility_confirmed_by := coalesce(new.responsibility_confirmed_by, app.uid());
  end if;

  return new;
end;
$$;

create trigger tickets_track_status
  before update on public.tickets
  for each row execute function app.track_ticket_status();

create or replace function app.log_ticket_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events (company_id, ticket_id, event_type, to_status, note, actor_id)
    values (new.company_id, new.id, 'raised', new.status, new.description, new.raised_by);

  elsif new.status is distinct from old.status then
    insert into public.ticket_events (company_id, ticket_id, event_type, from_status, to_status, note, actor_id)
    values (new.company_id, new.id, 'status_changed', old.status, new.status, new.resolution, app.uid());

  elsif new.responsibility_confirmed and not old.responsibility_confirmed then
    insert into public.ticket_events (company_id, ticket_id, event_type, note, actor_id)
    values (new.company_id, new.id, 'responsibility_confirmed', new.resolution, app.uid());
  end if;

  return new;
end;
$$;

create trigger tickets_log_event
  after insert or update on public.tickets
  for each row execute function app.log_ticket_event();

-- -----------------------------------------------------------------------------
-- 6. §4 — KPI impact, and only after a human says so
-- -----------------------------------------------------------------------------

create or replace function app.apply_ticket_kpi()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type  public.ticket_types;
  v_entry uuid;
begin
  -- Nothing happens on raise, on assignment, or on resolution. Only this.
  if not (new.responsibility_confirmed and not old.responsibility_confirmed) then
    return new;
  end if;

  if new.kpi_applied then
    return new;
  end if;

  select * into v_type from public.ticket_types where id = new.ticket_type_id;

  if v_type.kpi_id is null or new.responsible_user_id is null then
    return new;
  end if;

  insert into public.kpi_entries
    (company_id, kpi_id, subject, user_id, period_start, period_end,
     actual_value, note, created_by)
  values
    (new.company_id, v_type.kpi_id, 'user', new.responsible_user_id,
     date_trunc('month', coalesce(new.opened_at, now()))::date,
     (date_trunc('month', coalesce(new.opened_at, now())) + interval '1 month - 1 day')::date,
     v_type.kpi_weight,
     'Ticket ' || new.ticket_number,
     app.uid())
  on conflict do nothing
  returning id into v_entry;

  new.kpi_applied  := true;
  new.kpi_entry_id := coalesce(v_entry, new.kpi_entry_id);

  return new;
end;
$$;

comment on function app.apply_ticket_kpi() is
  'Writes the KPI penalty for a ticket, once and only once responsibility has been confirmed by a person.';

create trigger tickets_apply_kpi
  before update of responsibility_confirmed on public.tickets
  for each row execute function app.apply_ticket_kpi();

-- -----------------------------------------------------------------------------
-- 7. Access control
-- -----------------------------------------------------------------------------

alter table public.ticket_types       enable row level security;
alter table public.tickets            enable row level security;
alter table public.ticket_events      enable row level security;
alter table public.ticket_attachments enable row level security;

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('tickets.view',        'tickets', 'tickets', 'view',      'View tickets',               'عرض التذاكر',             false, false, 7400),
  ('tickets.create',      'tickets', 'tickets', 'create',    'Raise tickets',              'إنشاء تذكرة',             false, false, 7401),
  ('tickets.manage',      'tickets', 'tickets', 'edit',      'Work on tickets',            'معالجة التذاكر',          false, false, 7402),
  ('tickets.resolve',     'tickets', 'tickets', 'approve',   'Resolve and close tickets',  'حل وإغلاق التذاكر',       false, false, 7403),
  ('tickets.responsibility', 'tickets', 'tickets', 'approve', 'Confirm responsibility',    'اعتماد المسؤولية',        true,  true,  7404),
  ('tickets.configure',   'tickets', 'ticket_types', 'configure', 'Configure ticket rules', 'إعداد قواعد التذاكر',    false, false, 7405)
on conflict (code) do nothing;

select app.grant_perms_to_template('super_admin',        array['*']);
select app.grant_perms_to_template('system_admin',       array['tickets.*']);
select app.grant_perms_to_template('company_admin',      array['tickets.*']);
select app.grant_perms_to_template('operations_manager', array['tickets.view', 'tickets.create', 'tickets.manage', 'tickets.resolve', 'tickets.responsibility']);
select app.grant_perms_to_template('confirmation_agent', array['tickets.view', 'tickets.create']);
select app.grant_perms_to_template('warehouse_manager',  array['tickets.view', 'tickets.create', 'tickets.manage']);
select app.grant_perms_to_template('merchant_admin',     array['tickets.view', 'tickets.create']);

create policy ticket_types_select on public.ticket_types
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('tickets.view'));

create policy ticket_types_write on public.ticket_types
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('tickets.configure'))
  with check (app.same_company(company_id) and app.has_perm('tickets.configure'));

-- A ticket is visible to whoever reported it, whoever must act on it, and
-- whoever supervises them — plus anyone holding the module permission.
create policy tickets_select on public.tickets
  for select to authenticated
  using (
    app.same_company(company_id)
    and (
      app.has_perm('tickets.view')
      or raised_by = app.uid()
      or responsible_user_id = app.uid()
      or supervisor_id = app.uid()
    )
  );

create policy tickets_insert on public.tickets
  for insert to authenticated
  with check (app.same_company(company_id) and app.has_perm('tickets.create'));

create policy tickets_update on public.tickets
  for update to authenticated
  using (
    app.same_company(company_id)
    and (
      app.has_perm('tickets.manage')
      or responsible_user_id = app.uid()
      or supervisor_id = app.uid()
    )
  )
  with check (app.same_company(company_id));

create policy ticket_events_select on public.ticket_events
  for select to authenticated
  using (
    app.same_company(company_id)
    and exists (select 1 from public.tickets t where t.id = ticket_id)
  );

create policy ticket_events_insert on public.ticket_events
  for insert to authenticated
  with check (app.same_company(company_id));

create policy ticket_attachments_select on public.ticket_attachments
  for select to authenticated
  using (
    app.same_company(company_id)
    and exists (select 1 from public.tickets t where t.id = ticket_id)
  );

create policy ticket_attachments_write on public.ticket_attachments
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('tickets.create'))
  with check (app.same_company(company_id) and app.has_perm('tickets.create'));

grant select, insert, update on public.ticket_types, public.tickets to authenticated;
grant select, insert on public.ticket_events to authenticated;
grant select, insert, delete on public.ticket_attachments to authenticated;

-- -----------------------------------------------------------------------------
-- 8. A readable ticket, with its SLA state already worked out
-- -----------------------------------------------------------------------------

create view public.ticket_board
with (security_invoker = on) as
select
  t.id,
  t.company_id,
  t.ticket_number,
  t.order_id,
  o.order_number,
  o.customer_name,
  o.customer_phone,
  tt.code         as type_code,
  tt.name_en      as type_name_en,
  tt.name_ar      as type_name_ar,
  t.description,
  t.status,
  t.priority,
  t.sla_clock,
  t.sla_hours,
  t.sla_elapsed_hours,
  t.sla_breached,
  t.sla_due_at,
  t.opened_at,
  t.resolved_at,
  t.closed_at,
  t.raised_by,
  raiser.full_name      as raised_by_name,
  t.assigned_team_id,
  team.name             as assigned_team_name,
  t.assigned_department_id,
  dept.name_en          as assigned_department_name,
  t.responsible_user_id,
  owner.full_name       as responsible_user_name,
  t.supervisor_id,
  boss.full_name        as supervisor_name,
  t.responsibility_confirmed,
  t.kpi_applied,
  -- Hours a ticket has been open, which is what an SLA board actually sorts on.
  round(extract(epoch from (coalesce(t.resolved_at, now()) - t.opened_at)) / 3600.0, 2)
    as age_hours
from public.tickets t
join public.ticket_types tt on tt.id = t.ticket_type_id
left join public.orders o      on o.id = t.order_id
left join public.app_users raiser on raiser.id = t.raised_by
left join public.app_users owner  on owner.id = t.responsible_user_id
left join public.app_users boss   on boss.id = t.supervisor_id
left join public.teams team       on team.id = t.assigned_team_id
left join public.departments dept on dept.id = t.assigned_department_id;

comment on view public.ticket_board is
  'Tickets with their type, routing and SLA state resolved, for the Tickets list and the order drawer.';

grant select on public.ticket_board to authenticated;


-- ---------------------------------------------------------------------
-- 20261018090200_0029_orders_list_and_import.sql
-- Saved views, column preferences, governorates/cities, and bulk order import
-- ---------------------------------------------------------------------

-- =============================================================================
-- 0029 — Saved views, column preferences, address lookups and bulk import
--
-- §6 Customize Columns, §8 Saved Views, §11 Date Range, Bulk Order Import, and
-- the dependent Governorate / City dropdowns that Manual Order Creation needs.
--
-- Two ideas worth stating because they shape the tables:
--
-- A saved view is not a saved filter. The brief asks for filters, columns and
-- sorting to travel together, because "Delayed Confirmation" is useless if it
-- restores the rows but not the columns that made them readable. So this
-- extends `saved_filters` rather than adding a parallel table — a view is a
-- filter that also remembers how it was being looked at.
--
-- An import is not a transaction. Rows are validated and stored individually,
-- so that twenty good rows are not discarded because of five bad ones, and the
-- person fixing the file can see exactly which line failed and why.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. §8 Saved Views — filters, columns and sorting as one saved thing
-- -----------------------------------------------------------------------------

alter table public.saved_filters
  add column columns    jsonb not null default '[]'::jsonb,
  add column sort       jsonb not null default '{}'::jsonb,
  add column date_range jsonb not null default '{}'::jsonb,
  -- A view a team shares, rather than one person's. It still obeys the
  -- viewer's own data scope: sharing the definition never shares the rows.
  add column is_shared  boolean not null default false;

comment on column public.saved_filters.columns is
  'Ordered list of column keys. Empty means the screen default.';
comment on column public.saved_filters.date_range is
  'The §11 selection: {"preset":"last_7_days"} or {"field":"order_date","from":…,"to":…}.';
comment on column public.saved_filters.is_shared is
  'Shares the view definition with the company. Rows still follow the viewer''s own data scope.';

-- -----------------------------------------------------------------------------
-- 2. §6 Customize Columns — the preference, saved automatically
-- -----------------------------------------------------------------------------

-- Deliberately separate from saved views. A view is chosen; this is simply how
-- a person last left the screen, and it should follow them without being named.
create table public.user_table_preferences (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies (id) on delete cascade,
  user_id     uuid not null references public.app_users (id) on delete cascade,

  -- Which table: 'orders', 'customers', …
  screen      text not null,
  -- Ordered column keys. Order is the display order; absence means hidden.
  columns     jsonb not null default '[]'::jsonb,
  density     text not null default 'comfortable'
    check (density in ('compact', 'comfortable')),
  page_size   integer not null default 10 check (page_size between 5 and 200),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint user_table_preferences_unique unique (user_id, screen)
);

create trigger user_table_preferences_updated_at
  before update on public.user_table_preferences
  for each row execute function app.set_updated_at();

comment on table public.user_table_preferences is
  'Per-user, per-screen column visibility and order. Which columns are offered at all is decided by permissions, not here.';

-- -----------------------------------------------------------------------------
-- 3. Governorates and cities — the dependent dropdowns
-- -----------------------------------------------------------------------------

-- `company_id is null` means platform-provided. A company may add its own
-- areas without being able to edit the shared list.
create table public.governorates (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,

  code       text not null,
  name_en    text not null,
  name_ar    text not null,

  is_active  boolean not null default true,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index governorates_global_code_unique
  on public.governorates (code) where company_id is null;
create unique index governorates_company_code_unique
  on public.governorates (company_id, code) where company_id is not null;

create table public.cities (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies (id) on delete cascade,
  governorate_id  uuid not null references public.governorates (id) on delete cascade,

  code            text not null,
  name_en         text not null,
  name_ar         text not null,

  is_active       boolean not null default true,
  sort_order      integer not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint cities_code_unique unique (governorate_id, code)
);

create index cities_governorate_idx on public.cities (governorate_id);

-- Egypt's governorates, as the shared list every company starts from.
insert into public.governorates (company_id, code, name_en, name_ar, sort_order) values
  (null, 'CAI', 'Cairo',          'القاهرة',        1),
  (null, 'GIZ', 'Giza',           'الجيزة',         2),
  (null, 'ALX', 'Alexandria',     'الإسكندرية',     3),
  (null, 'QLY', 'Qalyubia',       'القليوبية',      4),
  (null, 'SHR', 'Sharqia',        'الشرقية',        5),
  (null, 'DKH', 'Dakahlia',       'الدقهلية',       6),
  (null, 'BHR', 'Beheira',        'البحيرة',        7),
  (null, 'GHR', 'Gharbia',        'الغربية',        8),
  (null, 'MNF', 'Monufia',        'المنوفية',       9),
  (null, 'KFS', 'Kafr El Sheikh', 'كفر الشيخ',     10),
  (null, 'DMT', 'Damietta',       'دمياط',         11),
  (null, 'PTS', 'Port Said',      'بورسعيد',       12),
  (null, 'ISM', 'Ismailia',       'الإسماعيلية',   13),
  (null, 'SUZ', 'Suez',           'السويس',        14),
  (null, 'NSN', 'North Sinai',    'شمال سيناء',    15),
  (null, 'SSN', 'South Sinai',    'جنوب سيناء',    16),
  (null, 'BNS', 'Beni Suef',      'بني سويف',      17),
  (null, 'FYM', 'Faiyum',         'الفيوم',        18),
  (null, 'MNY', 'Minya',          'المنيا',        19),
  (null, 'AST', 'Asyut',          'أسيوط',         20),
  (null, 'SHG', 'Sohag',          'سوهاج',         21),
  (null, 'QNA', 'Qena',           'قنا',           22),
  (null, 'LXR', 'Luxor',          'الأقصر',        23),
  (null, 'ASW', 'Aswan',          'أسوان',         24),
  (null, 'RSH', 'Red Sea',        'البحر الأحمر',  25),
  (null, 'NVL', 'New Valley',     'الوادي الجديد', 26),
  (null, 'MTR', 'Matrouh',        'مطروح',         27)
on conflict do nothing;

-- Enough areas for the three governorates that carry most order volume, so the
-- dependent dropdown has something real to depend on.
insert into public.cities (company_id, governorate_id, code, name_en, name_ar, sort_order)
select null, g.id, c.code, c.name_en, c.name_ar, c.sort_order
from public.governorates g
join (values
  ('CAI', 'MAADI',      'Maadi',          'المعادي',          1),
  ('CAI', 'NASR',       'Nasr City',      'مدينة نصر',        2),
  ('CAI', 'HELIOPOLIS', 'Heliopolis',     'مصر الجديدة',      3),
  ('CAI', 'ZAMALEK',    'Zamalek',        'الزمالك',          4),
  ('CAI', 'DOWNTOWN',   'Downtown',       'وسط البلد',        5),
  ('CAI', 'SHOUBRA',    'Shoubra',        'شبرا',             6),
  ('CAI', 'NEWCAIRO',   'New Cairo',      'القاهرة الجديدة',  7),
  ('CAI', 'TAGAMOA',    'Fifth Settlement','التجمع الخامس',   8),
  ('CAI', 'HELWAN',     'Helwan',         'حلوان',            9),
  ('CAI', 'ABBASIA',    'Abbasia',        'العباسية',        10),
  ('GIZ', 'DOKKI',      'Dokki',          'الدقي',            1),
  ('GIZ', 'MOHANDESEEN','Mohandeseen',    'المهندسين',        2),
  ('GIZ', 'HARAM',      'Haram',          'الهرم',            3),
  ('GIZ', 'FAISAL',     'Faisal',         'فيصل',             4),
  ('GIZ', 'SHEIKHZAYED','Sheikh Zayed',   'الشيخ زايد',       5),
  ('GIZ', 'OCTOBER',    '6th of October', 'السادس من أكتوبر', 6),
  ('GIZ', 'IMBABA',     'Imbaba',         'إمبابة',           7),
  ('GIZ', 'AGOUZA',     'Agouza',         'العجوزة',          8),
  ('ALX', 'SMOUHA',     'Smouha',         'سموحة',            1),
  ('ALX', 'MIAMI',      'Miami',          'ميامي',            2),
  ('ALX', 'SIDIBISHR',  'Sidi Bishr',     'سيدي بشر',         3),
  ('ALX', 'STANLEY',    'Stanley',        'ستانلي',           4),
  ('ALX', 'MONTAZA',    'Montaza',        'المنتزه',          5),
  ('ALX', 'AGAMI',      'Agami',          'العجمي',           6)
) as c(gov_code, code, name_en, name_ar, sort_order)
  on c.gov_code = g.code
where g.company_id is null
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 4. Bulk Order Import
-- -----------------------------------------------------------------------------

create type public.import_status as enum (
  'uploaded',
  'validating',
  'validated',
  'importing',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled'
);

create table public.order_imports (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,

  file_name     text not null,
  file_size     bigint check (file_size is null or file_size >= 0),

  status        public.import_status not null default 'uploaded',

  total_rows    integer not null default 0 check (total_rows >= 0),
  valid_rows    integer not null default 0 check (valid_rows >= 0),
  error_rows    integer not null default 0 check (error_rows >= 0),
  total_items   integer not null default 0 check (total_items >= 0),
  created_orders integer not null default 0 check (created_orders >= 0),

  -- §Import History: who, when, and what came of it.
  uploaded_by   uuid references public.app_users (id) on delete set null,
  uploaded_at   timestamptz not null default now(),
  validated_at  timestamptz,
  imported_at   timestamptz,

  error_summary text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index order_imports_company_idx on public.order_imports (company_id, uploaded_at desc);

create trigger order_imports_updated_at
  before update on public.order_imports
  for each row execute function app.set_updated_at();

create table public.order_import_rows (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  import_id   uuid not null references public.order_imports (id) on delete cascade,

  -- The line in the uploaded file, so an error message can point at it.
  row_number  integer not null check (row_number > 0),
  -- Groups the lines of one multi-product order, from the file's own reference.
  order_reference text,

  raw         jsonb not null default '{}'::jsonb,

  is_valid    boolean not null default false,
  -- [{"field":"sku","message":"SKU 'ABC1234' not found"}]
  errors      jsonb not null default '[]'::jsonb,

  -- Set once the row has actually produced something.
  order_id    uuid references public.orders (id) on delete set null,

  created_at  timestamptz not null default now(),

  constraint order_import_rows_unique unique (import_id, row_number)
);

create index order_import_rows_import_idx on public.order_import_rows (import_id, row_number);
create index order_import_rows_invalid_idx on public.order_import_rows (import_id)
  where is_valid = false;

-- Keeps the batch counters honest without the application having to remember.
create or replace function app.refresh_import_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_import uuid := coalesce(new.import_id, old.import_id);
begin
  update public.order_imports i
     set total_rows = sub.total,
         valid_rows = sub.valid,
         error_rows = sub.invalid,
         created_orders = sub.created,
         updated_at = now()
    from (
      select count(*)                                  as total,
             count(*) filter (where is_valid)          as valid,
             count(*) filter (where not is_valid)      as invalid,
             count(distinct order_id)                  as created
      from public.order_import_rows
      where import_id = v_import
    ) sub
   where i.id = v_import;

  return coalesce(new, old);
end;
$$;

create trigger order_import_rows_refresh_counts
  after insert or update or delete on public.order_import_rows
  for each row execute function app.refresh_import_counts();

-- -----------------------------------------------------------------------------
-- 5. Access control
-- -----------------------------------------------------------------------------

alter table public.user_table_preferences enable row level security;
alter table public.governorates           enable row level security;
alter table public.cities                 enable row level security;
alter table public.order_imports          enable row level security;
alter table public.order_import_rows      enable row level security;

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('orders.import',        'orders', 'orders', 'import',    'Import orders in bulk',   'استيراد الأوردرات',      false, false, 7500),
  ('orders.export',        'orders', 'orders', 'export',    'Export orders',           'تصدير الأوردرات',        true,  false, 7501),
  ('orders.bulk_actions',  'orders', 'orders', 'edit',      'Run bulk actions',        'إجراءات جماعية',         false, false, 7502),
  ('settings.areas.manage','companies', 'areas', 'configure','Manage governorates and areas', 'إدارة المحافظات والمناطق', false, false, 7503)
on conflict (code) do nothing;

select app.grant_perms_to_template('super_admin',        array['*']);
select app.grant_perms_to_template('system_admin',       array['orders.import', 'orders.export', 'orders.bulk_actions', 'settings.areas.manage']);
select app.grant_perms_to_template('company_admin',      array['orders.import', 'orders.export', 'orders.bulk_actions', 'settings.areas.manage']);
select app.grant_perms_to_template('operations_manager', array['orders.import', 'orders.export', 'orders.bulk_actions']);
select app.grant_perms_to_template('store_manager',      array['orders.export']);
select app.grant_perms_to_template('merchant_admin',     array['orders.export']);

-- A preference is personal. There is no "view other people's column layout".
create policy user_table_preferences_own on public.user_table_preferences
  for all to authenticated
  using (user_id = app.uid())
  with check (user_id = app.uid());

-- The shared list is readable by everyone; a company's own additions only by
-- that company.
create policy governorates_select on public.governorates
  for select to authenticated
  using (company_id is null or app.same_company(company_id));

create policy governorates_write on public.governorates
  for all to authenticated
  using (company_id is not null and app.same_company(company_id) and app.has_perm('settings.areas.manage'))
  with check (company_id is not null and app.same_company(company_id) and app.has_perm('settings.areas.manage'));

create policy cities_select on public.cities
  for select to authenticated
  using (company_id is null or app.same_company(company_id));

create policy cities_write on public.cities
  for all to authenticated
  using (company_id is not null and app.same_company(company_id) and app.has_perm('settings.areas.manage'))
  with check (company_id is not null and app.same_company(company_id) and app.has_perm('settings.areas.manage'));

create policy order_imports_select on public.order_imports
  for select to authenticated
  using (app.same_company(company_id) and (app.has_perm('orders.import') or uploaded_by = app.uid()));

create policy order_imports_write on public.order_imports
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('orders.import'))
  with check (app.same_company(company_id) and app.has_perm('orders.import'));

create policy order_import_rows_all on public.order_import_rows
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('orders.import'))
  with check (app.same_company(company_id) and app.has_perm('orders.import'));

grant select, insert, update, delete on public.user_table_preferences to authenticated;
grant select on public.governorates, public.cities to authenticated;
grant insert, update, delete on public.governorates, public.cities to authenticated;
grant select, insert, update, delete on public.order_imports, public.order_import_rows to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Demo ticket types, so the Raise Ticket flow has rules to obey
-- -----------------------------------------------------------------------------

-- Provisioned per company on creation, alongside the other defaults. Without
-- these the ticket screen is a form with an empty Issue Type list.
create or replace function app.provision_company_ticket_types(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.ticket_types
    (company_id, code, name_en, name_ar, sla_clock, sla_hours, requires_sla_breach, default_priority, sort_order)
  values
    (p_company_id, 'delayed_confirmation', 'Delayed confirmation', 'تأخر التأكيد',       'confirmation', 2,  true,  'high',   1),
    (p_company_id, 'wrong_confirmation',   'Wrong confirmation',   'تأكيد خاطئ',         'none',         null, false, 'high',   2),
    (p_company_id, 'warehouse_delay',      'Warehouse delay',      'تأخر المخزن',        'warehouse',    12, true,  'medium', 3),
    (p_company_id, 'shipping_delay',       'Shipping delay',       'تأخر الشحن',         'shipping',     24, true,  'medium', 4),
    (p_company_id, 'delivery_delay',       'Delivery delay',       'تأخر التسليم',       'delivery',     72, true,  'high',   5),
    (p_company_id, 'return_delay',         'Return delay',         'تأخر الاسترجاع',     'return',       48, true,  'medium', 6),
    (p_company_id, 'settlement_issue',     'Settlement issue',     'مشكلة في التسوية',   'settlement',   168, true, 'low',    7)
  on conflict (company_id, code) do nothing;
end;
$$;

create or replace function app.provision_ticket_types_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.provision_company_ticket_types(new.id);
  return new;
end;
$$;

create trigger companies_provision_ticket_types
  after insert on public.companies
  for each row execute function app.provision_ticket_types_trigger();

-- Backfill the companies that already exist.
do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_ticket_types(v_company);
  end loop;
end;
$$;


commit;

-- Done. Reload the app.
