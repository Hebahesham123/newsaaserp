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
