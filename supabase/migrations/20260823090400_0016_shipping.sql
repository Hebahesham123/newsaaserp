-- =============================================================================
-- Green ERP — 0016 Shipping, returns & COD collections  (spec §6)
--
-- Where the order leaves the building and the money comes back.
--
-- Two decisions shape this module:
--
--  1. **Couriers are adapters, exactly like channels.** §6.4 says shipment
--     status syncs via API or webhook, and falls back to manual updates when no
--     integration exists. So `couriers.provider` mirrors `stores.provider`, and
--     'manual' is a first-class provider rather than a missing one.
--
--  2. **Collections reconcile in four layers** (§6.11): order → collection →
--     courier statement → bank transfer. Each layer is its own table with its
--     own matched/unmatched state, because "the money is short" is a different
--     question at each layer and collapsing them hides where it went wrong.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums — §6.3, §6.5, §6.7, §6.8, §6.10, §6.11
-- -----------------------------------------------------------------------------

-- §6.3 Shipment Workflow, including the RTO branch.
create type public.shipment_status as enum (
  'ready_to_ship', 'handed_to_courier', 'in_transit', 'out_for_delivery',
  'delivered',
  'delivery_failed', 'second_attempt', 'third_attempt',
  'returned_to_warehouse', 'return_inspection', 'inventory_updated',
  'closed', 'cancelled', 'lost'
);

-- §6.5 the instructions that may be sent to a courier.
create type public.courier_instruction_type as enum (
  'retry_delivery', 'contact_customer', 'change_phone', 'change_address',
  'change_delivery_date', 'deliver_at_time', 'cancel_shipment',
  'request_return', 'expedite_return'
);

create type public.instruction_status as enum ('sent', 'acknowledged', 'executed', 'rejected', 'expired');

-- §6.7 Return Management lifecycle.
create type public.return_status as enum (
  'requested', 'courier_return', 'returned_to_warehouse', 'quality_inspection',
  'inventory_decision', 'merchant_notified', 'financially_settled', 'closed', 'cancelled'
);

-- §6.8 the six dispositions an inspected return may take.
create type public.return_disposition as enum (
  'restock', 'repack', 'repair', 'outlet', 'destroy', 'return_to_merchant'
);

-- §6.10 collection state per shipment.
create type public.collection_status as enum (
  'pending', 'collected', 'in_transfer', 'settled', 'short', 'over', 'missing', 'waived'
);

-- §6.11 courier statement reconciliation.
create type public.statement_status as enum (
  'draft', 'matched', 'variance', 'approved', 'paid', 'disputed'
);

create type public.courier_provider as enum ('manual', 'bosta', 'aramex', 'mylerz', 'jt', 'custom');

-- -----------------------------------------------------------------------------
-- Couriers — §6.2
-- -----------------------------------------------------------------------------

create table public.couriers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,

  code         text not null,
  name         text not null,
  provider     public.courier_provider not null default 'manual',

  contact_person text,
  phone        text,
  email        text,

  -- §6.4 tracking. The URL carries {awb} and is interpolated for display.
  tracking_url_template text,
  api_base_url text,

  -- §6.10 commercial terms driving collection expectations.
  cod_fee_percentage numeric(6,3) check (cod_fee_percentage is null or cod_fee_percentage between 0 and 100),
  cod_fee_flat numeric(14,2) check (cod_fee_flat is null or cod_fee_flat >= 0),
  settlement_cycle_days integer check (settlement_cycle_days is null or settlement_cycle_days > 0),
  currency     char(3) not null default 'EGP',

  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,
  archived_at  timestamptz,
  archived_by  uuid references public.app_users (id) on delete set null,

  constraint couriers_code_unique unique (company_id, code)
);

comment on table public.couriers is
  '§6.2 courier companies. `provider` mirrors stores.provider so a courier integration is a configuration change, not a code change.';

create trigger couriers_set_updated_at
  before update on public.couriers
  for each row execute function app.set_updated_at();

-- §6.2 / §6.12 per-governorate rates and promised lead times.
create table public.courier_zones (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  courier_id   uuid not null references public.couriers (id) on delete cascade,

  governorate  text not null,
  city         text,
  shipping_fee numeric(14,2) not null default 0 check (shipping_fee >= 0),
  return_fee   numeric(14,2) not null default 0 check (return_fee >= 0),
  -- §6.6 the promise the delay monitor measures against.
  promised_days integer check (promised_days is null or promised_days > 0),
  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint courier_zones_unique unique (courier_id, governorate, city)
);

create index courier_zones_lookup_idx on public.courier_zones (courier_id, governorate) where is_active;

create trigger courier_zones_set_updated_at
  before update on public.courier_zones
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Shipments — §6.3, §6.4
-- -----------------------------------------------------------------------------

create sequence public.shipment_number_seq;

create table public.shipments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  merchant_id  uuid not null references public.merchants (id) on delete restrict,
  order_id     uuid not null references public.orders (id) on delete restrict,
  courier_id   uuid references public.couriers (id) on delete restrict,
  warehouse_id uuid references public.warehouses (id) on delete set null,
  package_id   uuid references public.packages (id) on delete set null,

  shipment_number text not null,
  -- §6.4 the air waybill: the courier's identifier, and how a customer tracks.
  awb          text,
  tracking_url text,

  status       public.shipment_status not null default 'ready_to_ship',

  -- §6.4 the fields the follow-up screen must display.
  handed_over_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  returned_at  timestamptz,
  last_update_at timestamptz,
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  courier_agent_name text,
  failure_reason text,

  -- §6.6 when this shipment should have arrived; drives the delay alerts.
  promised_at  timestamptz,

  governorate  text,
  city         text,

  -- §6.10 money the courier is expected to collect and remit.
  cod_amount   numeric(14,2) not null default 0 check (cod_amount >= 0),
  shipping_fee numeric(14,2) not null default 0 check (shipping_fee >= 0),
  currency     char(3) not null default 'EGP',

  weight_kg    numeric(12,3),
  notes        text,
  -- Untouched courier payload, for troubleshooting like the channel `raw`.
  raw          jsonb,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,

  constraint shipments_number_unique unique (company_id, shipment_number)
);

comment on table public.shipments is
  '§6.3 one shipment per parcel handed to a courier, tracked to Delivered or RTO with a full status history in shipment_events.';

-- Idempotent courier webhook ingest, mirroring the channel-order pattern.
create unique index shipments_awb_unique
  on public.shipments (courier_id, awb)
  where awb is not null;

create index shipments_order_idx     on public.shipments (order_id);
create index shipments_courier_idx   on public.shipments (courier_id, status);
create index shipments_company_idx   on public.shipments (company_id, status, created_at desc);
create index shipments_promised_idx  on public.shipments (promised_at)
  where status not in ('delivered', 'closed', 'cancelled');
create index shipments_awb_trgm_idx  on public.shipments using gin (awb extensions.gin_trgm_ops);

create trigger shipments_set_updated_at
  before update on public.shipments
  for each row execute function app.set_updated_at();

-- §6.3 "the time of every transition must be recorded, with a full log of all
-- updates received from the courier".
create table public.shipment_events (
  id           bigserial primary key,
  shipment_id  uuid not null references public.shipments (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete restrict,

  from_status  public.shipment_status,
  to_status    public.shipment_status,
  -- The courier's own wording, kept verbatim next to our normalised status.
  courier_status_text text,
  description  text,
  location     text,
  occurred_at  timestamptz not null default now(),
  -- Distinguishes a courier webhook from a manual correction (§6.4).
  source       text not null default 'manual' check (source in ('manual', 'api', 'webhook', 'import')),

  actor_id     uuid references public.app_users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index shipment_events_shipment_idx on public.shipment_events (shipment_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Courier instructions — §6.5
-- -----------------------------------------------------------------------------

create table public.courier_instructions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  shipment_id  uuid not null references public.shipments (id) on delete cascade,

  instruction  public.courier_instruction_type not null,
  status       public.instruction_status not null default 'sent',
  detail       jsonb,
  note         text,

  -- §6.5 who sent it, when, when it was carried out, and what the courier said.
  sent_by      uuid references public.app_users (id) on delete set null,
  sent_at      timestamptz not null default now(),
  executed_at  timestamptz,
  courier_response text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.courier_instructions is
  '§6.5 instructions sent to a courier, with response tracking. Every one is echoed onto the order timeline.';

create index courier_instructions_shipment_idx on public.courier_instructions (shipment_id, sent_at desc);

create trigger courier_instructions_set_updated_at
  before update on public.courier_instructions
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Delay monitoring — §6.6
--
-- The thresholds are configuration, not code: the spec gives examples ("more
-- than 24h without pickup", "more than 48h without movement") and explicitly
-- frames them as examples.
-- -----------------------------------------------------------------------------

create table public.delay_rules (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,

  code         text not null,
  name_en      text not null,
  name_ar      text not null,

  -- Which shipment state the clock runs in, and for how long before it alerts.
  applies_to_status public.shipment_status,
  threshold_hours integer not null check (threshold_hours > 0),
  -- Or: more than N delivery attempts.
  max_attempts integer check (max_attempts is null or max_attempts > 0),

  severity     public.notification_severity not null default 'warning',
  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint delay_rules_code_unique unique (company_id, code)
);

create trigger delay_rules_set_updated_at
  before update on public.delay_rules
  for each row execute function app.set_updated_at();

/**
 * §6.6 shipments currently breaching a delay rule.
 *
 * A view rather than a scheduled job writing alert rows: the answer changes
 * with the clock, so computing it on read cannot go stale, and the follow-up
 * team's screen and the §6.13 report necessarily agree.
 */
create view public.delayed_shipments as
select
  s.id as shipment_id,
  s.company_id,
  s.merchant_id,
  s.order_id,
  s.courier_id,
  s.shipment_number,
  s.awb,
  s.status,
  s.governorate,
  s.delivery_attempts,
  s.last_update_at,
  r.id   as rule_id,
  r.code as rule_code,
  r.name_en as rule_name_en,
  r.name_ar as rule_name_ar,
  r.severity,
  round(extract(epoch from (now() - coalesce(s.last_update_at, s.created_at))) / 3600.0, 1) as hours_since_update
from public.shipments s
join public.delay_rules r
  on r.company_id = s.company_id
 and r.is_active
 and (r.applies_to_status is null or r.applies_to_status = s.status)
where s.status not in ('delivered', 'closed', 'cancelled')
  and (
    extract(epoch from (now() - coalesce(s.last_update_at, s.created_at))) / 3600.0 >= r.threshold_hours
    or (r.max_attempts is not null and s.delivery_attempts >= r.max_attempts)
  );

comment on view public.delayed_shipments is
  '§6.6 shipments breaching a configured delay rule right now. Computed on read so it cannot go stale.';

-- -----------------------------------------------------------------------------
-- Returns — §6.7, §6.8, §6.9
-- -----------------------------------------------------------------------------

-- §6.9 "reasons must be editable from settings" — a table, like §4.11.
create table public.return_reasons (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  code         text not null,
  name_en      text not null,
  name_ar      text not null,
  -- Who bears the cost: separates a customer refusal from a warehouse error,
  -- which is what the §6.13 returns-by-cause report is asked to split.
  fault        text not null default 'customer'
    check (fault in ('customer', 'courier', 'warehouse', 'merchant', 'product', 'other')),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint return_reasons_code_unique unique (company_id, code)
);

create trigger return_reasons_set_updated_at
  before update on public.return_reasons
  for each row execute function app.set_updated_at();

create sequence public.return_number_seq;

create table public.returns (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  merchant_id  uuid not null references public.merchants (id) on delete restrict,
  order_id     uuid not null references public.orders (id) on delete restrict,
  shipment_id  uuid references public.shipments (id) on delete set null,
  warehouse_id uuid references public.warehouses (id) on delete set null,

  return_number text not null,
  status       public.return_status not null default 'requested',
  reason_id    uuid references public.return_reasons (id) on delete restrict,
  -- §6.7 an RTO is a failed delivery; a customer return is a request. The
  -- distinction drives who pays and which report it lands in.
  is_rto       boolean not null default false,

  requested_at timestamptz not null default now(),
  received_at  timestamptz,
  inspected_at timestamptz,
  inspected_by uuid references public.app_users (id) on delete set null,
  merchant_notified_at timestamptz,
  settled_at   timestamptz,
  closed_at    timestamptz,

  -- §6.8 evidence captured at inspection.
  inspection_notes text,
  photos       jsonb not null default '[]'::jsonb,

  refund_amount numeric(14,2) check (refund_amount is null or refund_amount >= 0),
  currency     char(3) not null default 'EGP',
  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,

  constraint returns_number_unique unique (company_id, return_number)
);

comment on table public.returns is
  '§6.7 the return lifecycle from request to closure, tracked stage by stage.';

create index returns_order_idx    on public.returns (order_id);
create index returns_status_idx   on public.returns (company_id, status, requested_at desc);
create index returns_merchant_idx on public.returns (merchant_id, status);

create trigger returns_set_updated_at
  before update on public.returns
  for each row execute function app.set_updated_at();

create table public.return_items (
  id           uuid primary key default gen_random_uuid(),
  return_id    uuid not null references public.returns (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete restrict,
  order_item_id uuid references public.order_items (id) on delete set null,
  variant_id   uuid not null references public.product_variants (id) on delete restrict,

  quantity     numeric(14,3) not null check (quantity > 0),

  -- §6.8 what the inspector found.
  condition    text check (condition in ('sellable', 'damaged', 'opened', 'incomplete', 'expired')),
  packaging_ok boolean,
  accessories_ok boolean,
  damage_notes text,

  -- §6.8 the six dispositions.
  disposition  public.return_disposition,
  disposition_at timestamptz,
  disposition_by uuid references public.app_users (id) on delete set null,
  -- Set once the disposition has actually moved stock, so it cannot post twice.
  stock_posted_at timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index return_items_return_idx  on public.return_items (return_id);
create index return_items_variant_idx on public.return_items (variant_id);

create trigger return_items_set_updated_at
  before update on public.return_items
  for each row execute function app.set_updated_at();

create or replace function app.assign_return_number()
returns trigger
language plpgsql
as $$
begin
  if new.return_number is null or new.return_number = '' then
    new.return_number := 'RET-' || to_char(now(), 'YYMM') || '-' ||
                         lpad(nextval('public.return_number_seq')::text, 6, '0');
  end if;

  -- Stage timestamps follow the status rather than relying on the caller.
  if new.status = 'returned_to_warehouse' and new.received_at is null then
    new.received_at := now();
  end if;
  if new.status = 'closed' and new.closed_at is null then
    new.closed_at := now();
  end if;

  return new;
end;
$$;

create trigger returns_prepare
  before insert or update on public.returns
  for each row execute function app.assign_return_number();

/**
 * §6.8 → §5.8: acting on a disposition is what moves the stock.
 *
 * Only `restock` and `repack` return sellable units to `available`; `damaged`
 * and `destroy` land in the damaged bucket; `return_to_merchant` leaves the
 * building and is therefore a shipment out, not stock in. Guarded by
 * `stock_posted_at` so a re-saved inspection cannot double the quantity.
 */
create or replace function public.apply_return_disposition(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_item   public.return_items;
  v_return public.returns;
begin
  select * into v_item from public.return_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'Return line % not found', p_item_id using errcode = 'foreign_key_violation';
  end if;

  if v_item.disposition is null then
    raise exception 'Set a disposition before posting the stock movement (spec §6.8)'
      using errcode = 'check_violation';
  end if;

  if v_item.stock_posted_at is not null then
    raise exception 'This return line has already been posted to stock'
      using errcode = 'check_violation';
  end if;

  select * into v_return from public.returns where id = v_item.return_id;

  if v_return.warehouse_id is null then
    raise exception 'The return has no warehouse; set one before posting stock'
      using errcode = 'check_violation';
  end if;

  if not app.has_perm('returns.inspect') then
    raise exception 'Posting a return disposition requires the returns.inspect permission'
      using errcode = 'insufficient_privilege';
  end if;

  if v_item.disposition in ('restock', 'repack') then
    perform public.post_inventory_movement(
      v_item.variant_id, v_return.warehouse_id, 'return', v_item.quantity,
      null, 'available', 'return', v_return.id, null,
      'Returned to stock — ' || v_item.disposition
    );
  elsif v_item.disposition in ('repair', 'destroy', 'outlet') then
    perform public.post_inventory_movement(
      v_item.variant_id, v_return.warehouse_id, 'return', v_item.quantity,
      null, 'damaged', 'return', v_return.id, null,
      'Return held as ' || v_item.disposition
    );
  else
    -- return_to_merchant: recorded on the return, not added to our stock.
    null;
  end if;

  update public.return_items
  set stock_posted_at = now(), disposition_at = coalesce(disposition_at, now()),
      disposition_by = coalesce(disposition_by, app.uid())
  where id = p_item_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- COD collections — §6.10
-- -----------------------------------------------------------------------------

-- Named `cod_collections`, not `collections`: §3.6 already owns that name for
-- merchandising collections, and two unrelated concepts must not share a table
-- name in one schema.
create table public.cod_collections (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  merchant_id  uuid not null references public.merchants (id) on delete restrict,
  order_id     uuid not null references public.orders (id) on delete restrict,
  shipment_id  uuid references public.shipments (id) on delete set null,
  courier_id   uuid references public.couriers (id) on delete restrict,

  status       public.collection_status not null default 'pending',

  -- §6.10 "the difference between expected and actually collected must be
  -- visible" — so both are stored and the variance is generated, not asserted.
  expected_amount numeric(14,2) not null default 0 check (expected_amount >= 0),
  collected_amount numeric(14,2) check (collected_amount is null or collected_amount >= 0),
  courier_fee  numeric(14,2) not null default 0 check (courier_fee >= 0),
  deductions   numeric(14,2) not null default 0 check (deductions >= 0),
  net_amount   numeric(14,2) generated always as
                 (coalesce(collected_amount, 0) - courier_fee - deductions) stored,
  variance     numeric(14,2) generated always as
                 (coalesce(collected_amount, 0) - expected_amount) stored,
  currency     char(3) not null default 'EGP',

  collected_at timestamptz,
  transferred_at timestamptz,
  transfer_reference text,
  due_at       timestamptz,

  statement_id uuid,
  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,

  constraint cod_collections_order_unique unique (order_id)
);

comment on table public.cod_collections is
  '§6.10 one COD collection per order. `variance` is generated, so expected-vs-collected can never disagree with its own components.';

create index cod_collections_courier_idx  on public.cod_collections (courier_id, status);
create index cod_collections_company_idx  on public.cod_collections (company_id, status, due_at);
create index cod_collections_merchant_idx on public.cod_collections (merchant_id, status);

create trigger cod_collections_set_updated_at
  before update on public.cod_collections
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Courier statements & reconciliation — §6.11
-- -----------------------------------------------------------------------------

create sequence public.statement_number_seq;

create table public.courier_statements (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  courier_id   uuid not null references public.couriers (id) on delete restrict,

  statement_number text not null,
  status       public.statement_status not null default 'draft',

  period_start date not null,
  period_end   date not null,

  -- What the courier says they owe, versus what our collections add up to.
  declared_total numeric(14,2) not null default 0,
  matched_total  numeric(14,2) not null default 0,
  variance_total numeric(14,2) generated always as (declared_total - matched_total) stored,
  currency     char(3) not null default 'EGP',

  -- §6.11 the bank transfer that settles it.
  bank_reference text,
  transferred_at timestamptz,
  transferred_amount numeric(14,2),

  -- §7.6 a variance may only be accepted by someone with the permission.
  approved_at  timestamptz,
  approved_by  uuid references public.app_users (id) on delete set null,
  approval_note text,

  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,

  constraint courier_statements_number_unique unique (company_id, statement_number),
  constraint courier_statements_period check (period_end >= period_start)
);

create index courier_statements_courier_idx on public.courier_statements (courier_id, period_start desc);

create trigger courier_statements_set_updated_at
  before update on public.courier_statements
  for each row execute function app.set_updated_at();

-- The courier's own line items, as delivered. Kept separate from `collections`
-- so "they billed us for an order we have no record of" is representable.
create table public.courier_statement_lines (
  id           uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.courier_statements (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete restrict,

  awb          text,
  external_order_ref text,
  declared_amount numeric(14,2) not null default 0,
  declared_fee numeric(14,2) not null default 0,

  -- Filled by the matcher; null means the line found no home.
  collection_id uuid references public.cod_collections (id) on delete set null,
  order_id     uuid references public.orders (id) on delete set null,
  match_status text not null default 'unmatched'
    check (match_status in ('unmatched', 'matched', 'variance', 'not_found', 'duplicate')),
  variance     numeric(14,2),
  note         text,

  created_at   timestamptz not null default now()
);

create index courier_statement_lines_statement_idx on public.courier_statement_lines (statement_id, match_status);
create index courier_statement_lines_awb_idx       on public.courier_statement_lines (awb) where awb is not null;

alter table public.cod_collections
  add constraint cod_collections_statement_fkey
  foreign key (statement_id) references public.courier_statements (id) on delete set null;

create or replace function app.assign_statement_number()
returns trigger
language plpgsql
as $$
begin
  if new.statement_number is null or new.statement_number = '' then
    new.statement_number := 'CST-' || to_char(now(), 'YYMM') || '-' ||
                            lpad(nextval('public.statement_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger courier_statements_number
  before insert on public.courier_statements
  for each row execute function app.assign_statement_number();

/**
 * §6.11 matches a statement against our collections and classifies every line.
 *
 * Matching is by AWB, which is the only identifier both sides reliably share.
 * The five outcomes the spec asks to detect map onto `match_status`:
 * short/over become 'variance', an unknown AWB becomes 'not_found', and a
 * collection with no statement line is surfaced by the report, not here.
 */
-- The OUT parameters are suffixed `_count` deliberately: a plpgsql OUT param
-- named `variance` would shadow the `variance` column on
-- courier_statement_lines and make any reference to it ambiguous.
create or replace function public.reconcile_courier_statement(p_statement_id uuid)
returns table (matched_count integer, variance_count integer, not_found_count integer)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_statement public.courier_statements;
begin
  select * into v_statement from public.courier_statements where id = p_statement_id;
  if v_statement.id is null then
    raise exception 'Statement % not found', p_statement_id using errcode = 'foreign_key_violation';
  end if;

  if not app.has_perm('collections.reconcile') then
    raise exception 'Reconciliation requires the collections.reconcile permission'
      using errcode = 'insufficient_privilege';
  end if;

  -- Resolve each line to a collection through the shipment's AWB.
  update public.courier_statement_lines l
  set collection_id = c.id,
      order_id      = c.order_id,
      variance      = l.declared_amount - c.expected_amount,
      match_status  = case
                        when l.declared_amount = c.expected_amount then 'matched'
                        else 'variance'
                      end
  from public.shipments s
  join public.cod_collections c on c.shipment_id = s.id
  where l.statement_id = p_statement_id
    and s.courier_id = v_statement.courier_id
    and s.awb is not null
    and l.awb = s.awb;

  -- Anything still unresolved is billing us for something we do not have.
  update public.courier_statement_lines
  set match_status = 'not_found'
  where statement_id = p_statement_id
    and collection_id is null
    and match_status = 'unmatched';

  -- Roll the matched value up onto the statement.
  update public.courier_statements
  set matched_total = coalesce((
        select sum(c.expected_amount)
        from public.courier_statement_lines l
        join public.cod_collections c on c.id = l.collection_id
        where l.statement_id = p_statement_id
      ), 0),
      status = case
                 when exists (
                   select 1 from public.courier_statement_lines
                   where statement_id = p_statement_id and match_status in ('variance', 'not_found')
                 ) then 'variance'::public.statement_status
                 else 'matched'::public.statement_status
               end
  where id = p_statement_id;

  select
    count(*) filter (where match_status = 'matched')::integer,
    count(*) filter (where match_status = 'variance')::integer,
    count(*) filter (where match_status = 'not_found')::integer
  into matched_count, variance_count, not_found_count
  from public.courier_statement_lines
  where statement_id = p_statement_id;

  return next;
end;
$$;

comment on function public.reconcile_courier_statement is
  '§6.11 matches a courier statement to our collections by AWB and classifies every line.';

-- -----------------------------------------------------------------------------
-- §6.12 courier scorecard, feeding the AI courier selection in §6.12 / §9.18.
-- -----------------------------------------------------------------------------

create view public.courier_scorecard as
select
  c.id   as courier_id,
  c.company_id,
  c.name,
  count(s.id)                                                        as shipments,
  count(s.id) filter (where s.status = 'delivered')                   as delivered,
  count(s.id) filter (where s.status in ('returned_to_warehouse', 'return_inspection', 'inventory_updated')) as returned,
  case when count(s.id) > 0
       then round(count(s.id) filter (where s.status = 'delivered')::numeric / count(s.id) * 100, 2)
       else null end                                                  as delivery_rate,
  case when count(s.id) > 0
       then round(count(s.id) filter (where s.status in ('returned_to_warehouse', 'return_inspection', 'inventory_updated'))::numeric / count(s.id) * 100, 2)
       else null end                                                  as return_rate,
  round(avg(extract(epoch from (s.delivered_at - s.handed_over_at)) / 86400.0)
        filter (where s.delivered_at is not null and s.handed_over_at is not null), 2) as avg_delivery_days,
  round(avg(extract(epoch from (s.returned_at - s.handed_over_at)) / 86400.0)
        filter (where s.returned_at is not null and s.handed_over_at is not null), 2)  as avg_return_days,
  round(avg(s.delivery_attempts), 2)                                  as avg_attempts
from public.couriers c
left join public.shipments s on s.courier_id = c.id
group by c.id, c.company_id, c.name;

comment on view public.courier_scorecard is
  '§6.12 delivery rate, return rate and average delivery/return time per courier.';

-- -----------------------------------------------------------------------------
-- Shipment status history and order-timeline echo
-- -----------------------------------------------------------------------------

create or replace function app.log_shipment_event()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.shipment_events (shipment_id, company_id, to_status, description, actor_id)
    values (new.id, new.company_id, new.status, 'Shipment created', app.uid());
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.shipment_events (shipment_id, company_id, from_status, to_status, actor_id)
    values (new.id, new.company_id, old.status, new.status, app.uid());

    -- §4.15 rule 7 — the order timeline is the single place an operator looks,
    -- so shipment progress is echoed there rather than living only here.
    insert into public.order_events (order_id, company_id, event_type, summary, detail, actor_id)
    values (new.order_id, new.company_id, 'status_change',
            format('Shipment %s: %s', new.shipment_number, new.status),
            jsonb_build_object('shipment_id', new.id, 'awb', new.awb, 'status', new.status),
            app.uid());
  end if;

  return new;
end;
$$;

create trigger shipments_history
  after insert or update on public.shipments
  for each row execute function app.log_shipment_event();

create or replace function app.prepare_shipment()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' and (new.shipment_number is null or new.shipment_number = '') then
    new.shipment_number := 'SHP-' || to_char(now(), 'YYMM') || '-' ||
                           lpad(nextval('public.shipment_number_seq')::text, 6, '0');
  end if;

  -- Stage timestamps derive from the status so the two cannot disagree.
  if new.status = 'handed_to_courier' and new.handed_over_at is null then
    new.handed_over_at := now();
  end if;
  if new.status = 'delivered' and new.delivered_at is null then
    new.delivered_at := now();
  end if;
  if new.status = 'returned_to_warehouse' and new.returned_at is null then
    new.returned_at := now();
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.last_update_at := now();
  end if;

  return new;
end;
$$;

create trigger shipments_prepare
  before insert or update on public.shipments
  for each row execute function app.prepare_shipment();

/**
 * §6.10 a shipment handed over with a COD amount creates the collection that is
 * expected back. Created here rather than in application code so a shipment
 * booked by a courier webhook is tracked the same as one booked by hand.
 */
create or replace function app.open_collection_for_shipment()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_courier public.couriers;
begin
  if new.cod_amount <= 0 then return new; end if;
  if new.status <> 'handed_to_courier' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'handed_to_courier' then return new; end if;

  select * into v_courier from public.couriers where id = new.courier_id;

  insert into public.cod_collections (
    company_id, merchant_id, order_id, shipment_id, courier_id,
    expected_amount, courier_fee, currency, due_at, created_by
  )
  values (
    new.company_id, new.merchant_id, new.order_id, new.id, new.courier_id,
    new.cod_amount,
    coalesce(v_courier.cod_fee_flat, 0)
      + round(new.cod_amount * coalesce(v_courier.cod_fee_percentage, 0) / 100.0, 2),
    new.currency,
    now() + make_interval(days => coalesce(v_courier.settlement_cycle_days, 7)),
    app.uid()
  )
  on conflict (order_id) do nothing;

  return new;
end;
$$;

create trigger shipments_open_collection
  after insert or update of status on public.shipments
  for each row execute function app.open_collection_for_shipment();

-- -----------------------------------------------------------------------------
-- Audit — §2.9
-- -----------------------------------------------------------------------------

create trigger couriers_audit                after insert or update or delete on public.couriers                for each row execute function app.audit_trigger();
create trigger courier_zones_audit           after insert or update or delete on public.courier_zones           for each row execute function app.audit_trigger();
create trigger shipments_audit               after insert or update or delete on public.shipments               for each row execute function app.audit_trigger();
create trigger courier_instructions_audit    after insert or update or delete on public.courier_instructions    for each row execute function app.audit_trigger();
create trigger returns_audit                 after insert or update or delete on public.returns                 for each row execute function app.audit_trigger();
create trigger return_items_audit            after insert or update or delete on public.return_items            for each row execute function app.audit_trigger();
create trigger return_reasons_audit          after insert or update or delete on public.return_reasons          for each row execute function app.audit_trigger();
create trigger cod_collections_audit         after insert or update or delete on public.cod_collections         for each row execute function app.audit_trigger();
create trigger courier_statements_audit      after insert or update or delete on public.courier_statements      for each row execute function app.audit_trigger();
create trigger delay_rules_audit             after insert or update or delete on public.delay_rules             for each row execute function app.audit_trigger();
