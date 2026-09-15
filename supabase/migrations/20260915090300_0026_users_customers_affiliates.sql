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
