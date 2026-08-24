-- =============================================================================
-- Green ERP — 0012 Orders & Confirmation Center  (spec §4)
--
-- The operational heart of the system: an order arrives from any of 12 sources
-- (§4.2), is verified, assigned, called, and either confirmed into the warehouse
-- or cancelled with a recorded reason (§4.3).
--
-- Two design commitments shape everything below.
--
--  1. **The order is never destroyed.** §4.15 forbids deleting an order after
--     creation and permits archiving only once cancelled. No client role holds
--     DELETE on `orders`, and a trigger enforces the archive rule.
--
--  2. **Every touch is on the record.** §4.15 requires each call, message, edit
--     and status change to land in the order timeline with the responsible
--     employee. `order_events` is written by triggers, not by application code,
--     so a future integration cannot bypass it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums — §4.2, §4.3, §4.4, §4.10
-- -----------------------------------------------------------------------------

-- §4.2 Order Sources. WhatsApp is listed as future in the spec but modelled now
-- so the column never needs widening.
create type public.order_source as enum (
  'shopify', 'woocommerce', 'amazon', 'noon', 'custom_api', 'mobile_app', 'pos',
  'excel_import', 'manual', 'social_commerce', 'whatsapp', 'call_center'
);

-- §4.3 Order Lifecycle — the four stages, flattened into the statuses the spec
-- names. Configurable *reasons* live in a table (§4.11); the lifecycle itself is
-- fixed by the spec, so it is an enum.
create type public.order_status as enum (
  -- Stage 1 — intake
  'new', 'imported', 'pending_review',
  -- Stage 2 — verification
  'duplicate_check', 'fraud_check', 'customer_history_review',
  -- Stage 3 — confirmation
  'pending_assignment', 'assigned', 'first_call', 'second_call', 'third_call',
  'whatsapp_confirmation', 'callback', 'confirmed', 'cancelled',
  -- Stage 4 — handover
  'ready_for_warehouse'
);

create type public.order_stage as enum ('intake', 'verification', 'confirmation', 'warehouse');

-- §4.4 payment data. COD dominates this market, so it leads the list.
create type public.payment_method as enum (
  'cod', 'card', 'wallet', 'bank_transfer', 'payment_link', 'installment', 'other'
);

create type public.order_payment_status as enum (
  'pending', 'authorized', 'paid', 'partially_paid', 'refunded', 'voided', 'failed'
);

-- §4.6 how an order reached its owner — needed to measure the routing strategies.
create type public.assignment_method as enum ('manual', 'round_robin', 'smart', 'ai', 'self');

-- §4.10 call outcomes.
create type public.call_outcome as enum (
  'confirmed', 'cancelled', 'no_answer', 'busy', 'switched_off', 'wrong_number',
  'invalid_number', 'callback_requested', 'postponed', 'voicemail'
);

create type public.call_direction as enum ('outbound', 'inbound');

-- §4.9 messaging.
create type public.message_channel as enum ('whatsapp', 'sms', 'email');
create type public.message_direction as enum ('outbound', 'inbound');
create type public.message_status as enum ('queued', 'sent', 'delivered', 'read', 'failed');

-- §4.13 what a blacklist entry actually blocks.
create type public.blacklist_scope as enum ('phone', 'address', 'email');

-- §4.15 rule 4 — what the timeline records.
create type public.order_event_type as enum (
  'created', 'status_change', 'assigned', 'call', 'message', 'note',
  'items_changed', 'customer_changed', 'address_changed', 'confirmed',
  'cancelled', 'duplicate_flagged', 'risk_flagged', 'sync'
);

-- -----------------------------------------------------------------------------
-- Customers — §4.8 Customer 360°
--
-- Keyed on the phone number, which is the identity that actually matters here:
-- e-commerce orders in this market routinely arrive with no account and no
-- email, but never without a mobile number.
-- -----------------------------------------------------------------------------

create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  merchant_id uuid references public.merchants (id) on delete set null,

  phone       text not null,
  alt_phone   text,
  name        text not null,
  email       text,

  -- §4.4 address block, reused as the customer's default.
  governorate text,
  city        text,
  address     text,
  latitude    numeric(10,7),
  longitude   numeric(10,7),

  preferred_language text not null default 'ar' check (preferred_language in ('ar', 'en')),

  -- §4.8 rolling aggregates. Maintained by trigger so Customer 360 is a single
  -- row read rather than five aggregate queries on every screen open.
  --
  -- `delivered_count` and `returned_count` stay at zero until Phase 5: delivery
  -- and return outcomes are recorded by the shipping module, and inferring them
  -- from order status here would report a confirmed order as delivered.
  orders_count     integer not null default 0,
  delivered_count  integer not null default 0,
  returned_count   integer not null default 0,
  cancelled_count  integer not null default 0,
  lifetime_value   numeric(14,2) not null default 0,
  average_order_value numeric(14,2) not null default 0,
  last_order_at    timestamptz,
  last_call_at     timestamptz,
  last_message_at  timestamptz,

  -- §4.13 risk. Recomputed whenever the aggregates move.
  risk_score       integer not null default 0 check (risk_score between 0 and 100),
  is_blacklisted   boolean not null default false,
  blacklist_reason text,

  tags        text[] not null default '{}',
  notes       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,
  updated_by  uuid references public.app_users (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references public.app_users (id) on delete set null,

  -- One customer per phone per company. Merchants inside a company share the
  -- customer record, which is what makes Customer 360 complete (§4.8).
  constraint customers_phone_unique unique (company_id, phone)
);

comment on table public.customers is
  '§4.8 Customer 360°. Identity is (company_id, phone); aggregates are trigger-maintained so the screen is one row read.';

create index customers_company_idx  on public.customers (company_id);
create index customers_phone_idx    on public.customers (company_id, phone);
create index customers_risk_idx     on public.customers (company_id, risk_score desc) where risk_score > 0;
create index customers_name_trgm_idx on public.customers using gin (name extensions.gin_trgm_ops);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Cancellation reasons — §4.11 "must be fully configurable"
--
-- A per-company reference table, not an enum: the spec's list is explicitly an
-- example, and a new reason must not require a migration.
-- -----------------------------------------------------------------------------

create table public.cancellation_reasons (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  code        text not null,
  name_en     text not null,
  name_ar     text not null,
  -- Distinguishes "customer refused" from "we could not reach them", which is
  -- what the §4.16 cancellation-reason report is actually asked to separate.
  is_customer_fault boolean not null default false,
  requires_note boolean not null default false,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint cancellation_reasons_code_unique unique (company_id, code)
);

create trigger cancellation_reasons_set_updated_at
  before update on public.cancellation_reasons
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Blacklist — §4.13
-- -----------------------------------------------------------------------------

create table public.blacklist_entries (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  scope       public.blacklist_scope not null,
  -- Normalised at write time by the trigger below so lookups are exact.
  value       text not null,
  reason      text not null,
  expires_at  timestamptz,
  is_active   boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,
  updated_by  uuid references public.app_users (id) on delete set null,

  constraint blacklist_entries_unique unique (company_id, scope, value)
);

comment on table public.blacklist_entries is
  '§4.13 blocked phones, addresses and emails. Checked at order intake; a hit raises the risk score and warns the agent before they call.';

create index blacklist_entries_lookup_idx on public.blacklist_entries (company_id, scope, value) where is_active;

create trigger blacklist_entries_set_updated_at
  before update on public.blacklist_entries
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Orders — §4.4 Order Information
-- -----------------------------------------------------------------------------

-- Order numbers are human-facing and must be stable and guessable-in-sequence
-- for support calls. A single sequence keeps them unique across the platform;
-- the company prefix keeps them readable.
create sequence public.order_number_seq;

create table public.orders (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  merchant_id uuid not null references public.merchants (id) on delete restrict,
  store_id    uuid references public.stores (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete restrict,

  -- §4.4 basic data
  order_number text not null,
  external_order_number text,
  -- The channel's own id. Unique per store so a redelivered webhook updates the
  -- order instead of creating a second one.
  external_id text,
  order_date  timestamptz not null default now(),
  source      public.order_source not null,

  -- §4.2 attribution. Campaign and affiliate are Phase 8 entities; the columns
  -- exist now so historical orders carry the attribution when those tables land.
  campaign_ref text,
  affiliate_ref text,

  status      public.order_status not null default 'new',
  stage       public.order_stage not null default 'intake',

  -- §4.4 customer data, denormalised onto the order. The customer record can be
  -- corrected later; what was true when the order was placed must not change.
  customer_name  text not null,
  customer_phone text not null,
  customer_alt_phone text,
  customer_email text,
  governorate text,
  city        text,
  address     text,
  address_notes text,
  latitude    numeric(10,7),
  longitude   numeric(10,7),
  maps_url    text,

  -- §4.4 payment data
  payment_method public.payment_method not null default 'cod',
  payment_status public.order_payment_status not null default 'pending',
  currency    char(3) not null default 'EGP',
  subtotal    numeric(14,2) not null default 0 check (subtotal >= 0),
  discount_total numeric(14,2) not null default 0 check (discount_total >= 0),
  shipping_fees  numeric(14,2) not null default 0 check (shipping_fees >= 0),
  tax_total   numeric(14,2) not null default 0 check (tax_total >= 0),
  total       numeric(14,2) not null default 0 check (total >= 0),
  cod_amount  numeric(14,2) check (cod_amount is null or cod_amount >= 0),

  -- §4.6 assignment
  assigned_to uuid references public.app_users (id) on delete set null,
  assigned_at timestamptz,
  assigned_by uuid references public.app_users (id) on delete set null,
  assignment_method public.assignment_method,

  -- §4.7 confirmation outcome
  confirmed_at timestamptz,
  confirmed_by uuid references public.app_users (id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.app_users (id) on delete set null,
  cancellation_reason_id uuid references public.cancellation_reasons (id) on delete restrict,
  cancellation_note text,
  ready_at    timestamptz,
  warehouse_id uuid references public.warehouses (id) on delete set null,

  -- §4.10 call tracking
  call_attempts integer not null default 0 check (call_attempts >= 0),
  last_call_at  timestamptz,
  next_callback_at timestamptz,

  -- §4.12 / §4.13
  risk_score  integer not null default 0 check (risk_score between 0 and 100),
  is_duplicate boolean not null default false,
  duplicate_of_id uuid references public.orders (id) on delete set null,

  -- §4.4 additional data
  notes       text,
  internal_notes text,
  tags        text[] not null default '{}',
  attachments jsonb not null default '[]'::jsonb,

  -- Untouched channel payload, for replay and troubleshooting.
  raw         jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,
  updated_by  uuid references public.app_users (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references public.app_users (id) on delete set null,

  constraint orders_number_unique unique (company_id, order_number),
  constraint orders_not_self_duplicate check (duplicate_of_id is null or duplicate_of_id <> id)
);

comment on table public.orders is
  '§4.4 order master. §4.15: never deleted, archived only once cancelled, every change recorded in order_events.';
comment on column public.orders.external_id is
  'Channel order id. The partial unique index on (store_id, external_id) makes webhook redelivery idempotent.';

-- Idempotent channel upsert. Partial, because manually created orders have no
-- external id and several of them per store is normal.
create unique index orders_external_unique
  on public.orders (store_id, external_id)
  where external_id is not null;

create index orders_company_idx    on public.orders (company_id, order_date desc);
create index orders_merchant_idx   on public.orders (merchant_id, status);
create index orders_store_idx      on public.orders (store_id, order_date desc);
create index orders_status_idx     on public.orders (company_id, status, order_date desc);
create index orders_stage_idx      on public.orders (company_id, stage);
create index orders_assigned_idx   on public.orders (assigned_to, status) where assigned_to is not null;
create index orders_customer_idx   on public.orders (customer_id, order_date desc);
create index orders_phone_idx      on public.orders (company_id, customer_phone);
create index orders_callback_idx   on public.orders (next_callback_at) where next_callback_at is not null;
create index orders_risk_idx       on public.orders (company_id, risk_score desc) where risk_score > 0;
create index orders_number_trgm_idx on public.orders using gin (order_number extensions.gin_trgm_ops);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Order items — §4.4 "Products data"
-- -----------------------------------------------------------------------------

create table public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete restrict,

  -- Nullable: an order can arrive for a product that is not mapped yet (§3.13
  -- rule 13). The line still has to be storable, or the order would be lost.
  product_id  uuid references public.products (id) on delete restrict,
  variant_id  uuid references public.product_variants (id) on delete restrict,

  -- Captured at order time; the catalog may change afterwards.
  sku         text,
  name        text not null,
  variant_name text,
  external_line_id text,

  quantity    numeric(12,3) not null check (quantity > 0),
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  discount    numeric(14,2) not null default 0 check (discount >= 0),
  tax         numeric(14,2) not null default 0 check (tax >= 0),
  -- Generated, so a line total can never contradict its own components.
  total       numeric(14,2) generated always as
                (round((quantity * unit_price) - discount + tax, 2)) stored,

  position    integer not null default 0,
  notes       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.order_items is
  '§4.4 order lines. `total` is generated, and §4.15 rule 6 recalculates the parent order whenever a line changes.';

create index order_items_order_idx   on public.order_items (order_id, position);
create index order_items_product_idx on public.order_items (product_id) where product_id is not null;
create index order_items_variant_idx on public.order_items (variant_id) where variant_id is not null;

create trigger order_items_set_updated_at
  before update on public.order_items
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Order timeline — §4.15 rule 4, §4.5 "Customer Timeline"
--
-- Append-only. Clients get SELECT and INSERT (for notes) and nothing else, so
-- history cannot be rewritten to hide a mishandled order.
-- -----------------------------------------------------------------------------

create table public.order_events (
  id          bigserial primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete restrict,

  event_type  public.order_event_type not null,
  from_status public.order_status,
  to_status   public.order_status,

  summary     text,
  detail      jsonb,

  actor_id    uuid references public.app_users (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.order_events is
  '§4.15 rule 4 and rule 10 — the order timeline. Written by trigger so no code path can mutate an order without leaving a trace.';

create index order_events_order_idx on public.order_events (order_id, created_at desc);
create index order_events_type_idx  on public.order_events (company_id, event_type, created_at desc);

-- -----------------------------------------------------------------------------
-- Calls — §4.10
-- -----------------------------------------------------------------------------

create table public.order_calls (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete set null,

  direction   public.call_direction not null default 'outbound',
  attempt_number integer not null default 1 check (attempt_number > 0),
  phone       text not null,

  started_at  timestamptz not null default now(),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  outcome     public.call_outcome not null,
  -- §4.10 "التسجيل الصوتي" — a URL, not the audio itself.
  recording_url text,
  notes       text,
  callback_at timestamptz,

  agent_id    uuid references public.app_users (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.order_calls is
  '§4.10 one row per contact attempt, with outcome, duration, recording and the agent responsible (§4.15 rule 10).';

create index order_calls_order_idx    on public.order_calls (order_id, started_at desc);
create index order_calls_agent_idx    on public.order_calls (agent_id, started_at desc);
create index order_calls_customer_idx on public.order_calls (customer_id, started_at desc);

-- -----------------------------------------------------------------------------
-- Messages — §4.9 WhatsApp Integration
-- -----------------------------------------------------------------------------

create table public.order_messages (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete set null,

  channel     public.message_channel not null default 'whatsapp',
  direction   public.message_direction not null default 'outbound',
  status      public.message_status not null default 'queued',

  -- §4.9 template name when sent from a template, free text otherwise.
  template_code text,
  language    text not null default 'ar' check (language in ('ar', 'en')),
  body        text,
  media_url   text,
  -- §4.9 payment links and location requests are messages with a payload.
  payload     jsonb,

  external_message_id text,
  error       text,

  sent_at     timestamptz,
  delivered_at timestamptz,
  read_at     timestamptz,

  agent_id    uuid references public.app_users (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.order_messages is
  '§4.9 every WhatsApp/SMS/email exchange, recorded on the order timeline (§4.15 rule 7).';

create index order_messages_order_idx on public.order_messages (order_id, created_at desc);

-- -----------------------------------------------------------------------------
-- §4.9 message templates — configurable per company, bilingual (§4.9)
-- -----------------------------------------------------------------------------

create table public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  code        text not null,
  name        text not null,
  channel     public.message_channel not null default 'whatsapp',
  body_ar     text not null,
  body_en     text not null,
  -- Placeholder names the body may interpolate, e.g. {customer_name}.
  variables   text[] not null default '{}',
  is_active   boolean not null default true,
  sort_order  integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint message_templates_code_unique unique (company_id, code)
);

create trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row execute function app.set_updated_at();

-- =============================================================================
-- Business rules the database owns — §4.15
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Which stage a status belongs to (§4.3). Kept in one function so the stage
-- column can never drift from the status.
-- -----------------------------------------------------------------------------

create or replace function app.stage_for_status(p_status public.order_status)
returns public.order_stage
language sql
immutable
as $$
  select case p_status
    when 'new' then 'intake'
    when 'imported' then 'intake'
    when 'pending_review' then 'intake'
    when 'duplicate_check' then 'verification'
    when 'fraud_check' then 'verification'
    when 'customer_history_review' then 'verification'
    when 'ready_for_warehouse' then 'warehouse'
    else 'confirmation'
  end::public.order_stage;
$$;

-- -----------------------------------------------------------------------------
-- Rule 1: an order cannot reach the warehouse before it is confirmed.
-- Rule 3: only a cancelled order may be archived.
-- Rule 9: a cancellation must carry a reason.
-- Also assigns the order number and keeps `stage` consistent with `status`.
-- -----------------------------------------------------------------------------

create or replace function app.enforce_order_rules()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_prefix text;
begin
  -- Order number, assigned once and never rewritten.
  if tg_op = 'INSERT' and (new.order_number is null or new.order_number = '') then
    select coalesce(nullif(c.code, ''), 'ORD') into v_prefix
    from public.companies c where c.id = new.company_id;

    new.order_number :=
      coalesce(v_prefix, 'ORD') || '-' ||
      to_char(now(), 'YYMM') || '-' ||
      lpad(nextval('public.order_number_seq')::text, 6, '0');
  end if;

  new.stage := app.stage_for_status(new.status);

  -- Rule 1 — §4.15 "لا يمكن إرسال الطلب للمخزن قبل التأكيد".
  if new.status = 'ready_for_warehouse' then
    if tg_op = 'INSERT' or old.status is distinct from 'ready_for_warehouse' then
      if new.confirmed_at is null then
        raise exception
          'Order % cannot be sent to the warehouse before it is confirmed (spec §4.15 rule 1)', new.order_number
          using errcode = 'check_violation';
      end if;
    end if;
    if new.ready_at is null then
      new.ready_at := now();
    end if;
  end if;

  -- Rule 9 — a cancellation without a recorded reason is not a cancellation.
  if new.status = 'cancelled' then
    if new.cancellation_reason_id is null then
      raise exception
        'Order % cannot be cancelled without a cancellation reason (spec §4.15 rule 8)', new.order_number
        using errcode = 'check_violation';
    end if;
    if new.cancelled_at is null then
      new.cancelled_at := now();
      new.cancelled_by := coalesce(new.cancelled_by, app.uid());
    end if;
  end if;

  -- Confirmation stamps itself, so the timestamp cannot disagree with the status.
  if new.status = 'confirmed' and new.confirmed_at is null then
    new.confirmed_at := now();
    new.confirmed_by := coalesce(new.confirmed_by, app.uid());
  end if;

  -- Rule 3 — §4.15 "يتم أرشفة الطلبات الملغاة فقط".
  if tg_op = 'UPDATE' and new.archived_at is not null and old.archived_at is null then
    if new.status <> 'cancelled' then
      raise exception
        'Only a cancelled order may be archived; order % is % (spec §4.15 rule 3)', new.order_number, new.status
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger orders_enforce_rules
  before insert or update on public.orders
  for each row execute function app.enforce_order_rules();

-- -----------------------------------------------------------------------------
-- Rule 2: an order is never deleted. No client role is granted DELETE, and this
-- refuses it even if a future grant is added by mistake.
-- -----------------------------------------------------------------------------

create or replace function app.refuse_order_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Orders cannot be deleted after creation (spec §4.15 rule 2); cancel and archive instead'
    using errcode = 'check_violation';
end;
$$;

create trigger orders_no_delete
  before delete on public.orders
  for each row execute function app.refuse_order_delete();

-- -----------------------------------------------------------------------------
-- Rule 6: recalculate the order total whenever its lines change.
-- Rule 5: lines cannot change after warehouse handover without the dedicated
--         permission.
-- -----------------------------------------------------------------------------

create or replace function app.recalculate_order_totals()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_status   public.order_status;
  v_number   text;
  v_subtotal numeric(14,2);
  v_discount numeric(14,2);
  v_tax      numeric(14,2);
begin
  select status, order_number into v_status, v_number
  from public.orders where id = v_order_id;

  -- Rule 5 — §4.15 "لا يمكن تعديل المنتجات بعد تحويل الطلب للمخزن إلا بصلاحية خاصة".
  if v_status = 'ready_for_warehouse' and not app.has_perm('orders.edit.after_warehouse') then
    raise exception
      'Order % has been handed to the warehouse; editing its items needs the orders.edit.after_warehouse permission (spec §4.15 rule 5)', v_number
      using errcode = 'insufficient_privilege';
  end if;

  select
    coalesce(sum(quantity * unit_price), 0),
    coalesce(sum(discount), 0),
    coalesce(sum(tax), 0)
  into v_subtotal, v_discount, v_tax
  from public.order_items where order_id = v_order_id;

  update public.orders
  set subtotal       = v_subtotal,
      discount_total = v_discount,
      tax_total      = v_tax,
      total          = round(v_subtotal - v_discount + v_tax + shipping_fees, 2),
      -- A COD order collects whatever the order is worth.
      cod_amount     = case
                         when payment_method = 'cod'
                         then round(v_subtotal - v_discount + v_tax + shipping_fees, 2)
                         else cod_amount
                       end
  where id = v_order_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger order_items_recalculate
  after insert or update or delete on public.order_items
  for each row execute function app.recalculate_order_totals();

-- Shipping is on the order, not the lines, so changing it must also re-total.
create or replace function app.recalculate_on_shipping_change()
returns trigger
language plpgsql
as $$
begin
  new.total := round(new.subtotal - new.discount_total + new.tax_total + new.shipping_fees, 2);
  if new.payment_method = 'cod' then
    new.cod_amount := new.total;
  end if;
  return new;
end;
$$;

create trigger orders_recalculate_shipping
  before update of shipping_fees, payment_method on public.orders
  for each row execute function app.recalculate_on_shipping_change();

-- -----------------------------------------------------------------------------
-- Rule 4 / rule 10: the timeline. Written here so no application path can skip it.
-- -----------------------------------------------------------------------------

create or replace function app.log_order_event()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_type public.order_event_type;
  v_summary text;
  v_changed text[];
begin
  if tg_op = 'INSERT' then
    insert into public.order_events (order_id, company_id, event_type, to_status, summary, actor_id)
    values (new.id, new.company_id, 'created', new.status,
            format('Order received from %s', new.source), app.uid());
    return new;
  end if;

  -- Status transitions get their own, more specific event types.
  if new.status is distinct from old.status then
    v_type := case new.status
                when 'confirmed' then 'confirmed'
                when 'cancelled' then 'cancelled'
                else 'status_change'
              end::public.order_event_type;

    insert into public.order_events (order_id, company_id, event_type, from_status, to_status, summary, actor_id)
    values (new.id, new.company_id, v_type, old.status, new.status, null, app.uid());
  end if;

  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    insert into public.order_events (order_id, company_id, event_type, summary, detail, actor_id)
    values (new.id, new.company_id, 'assigned',
            'Order assigned',
            jsonb_build_object('assigned_to', new.assigned_to, 'method', new.assignment_method),
            app.uid());
  end if;

  -- §4.7 permits editing the customer and the address during confirmation; both
  -- are material enough to record separately from a generic update.
  if new.customer_name  is distinct from old.customer_name
     or new.customer_phone is distinct from old.customer_phone
     or new.customer_alt_phone is distinct from old.customer_alt_phone then
    insert into public.order_events (order_id, company_id, event_type, summary, detail, actor_id)
    values (new.id, new.company_id, 'customer_changed', 'Customer details edited',
            jsonb_build_object('from', jsonb_build_object('name', old.customer_name, 'phone', old.customer_phone),
                               'to',   jsonb_build_object('name', new.customer_name, 'phone', new.customer_phone)),
            app.uid());
  end if;

  if new.address is distinct from old.address
     or new.governorate is distinct from old.governorate
     or new.city is distinct from old.city then
    insert into public.order_events (order_id, company_id, event_type, summary, detail, actor_id)
    values (new.id, new.company_id, 'address_changed', 'Delivery address edited',
            jsonb_build_object('from', jsonb_build_object('governorate', old.governorate, 'city', old.city, 'address', old.address),
                               'to',   jsonb_build_object('governorate', new.governorate, 'city', new.city, 'address', new.address)),
            app.uid());
  end if;

  return new;
end;
$$;

create trigger orders_timeline
  after insert or update on public.orders
  for each row execute function app.log_order_event();

-- Items, calls and messages land on the same timeline (§4.15 rules 4 and 7).

create or replace function app.log_order_item_event()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.order_items := case when tg_op = 'DELETE' then old else new end;
begin
  insert into public.order_events (order_id, company_id, event_type, summary, detail, actor_id)
  values (v_row.order_id, v_row.company_id, 'items_changed',
          case tg_op when 'INSERT' then 'Item added'
                     when 'UPDATE' then 'Item changed'
                     else 'Item removed' end,
          jsonb_build_object('sku', v_row.sku, 'name', v_row.name, 'quantity', v_row.quantity),
          app.uid());

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger order_items_timeline
  after insert or update or delete on public.order_items
  for each row execute function app.log_order_item_event();

create or replace function app.log_call_event()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  insert into public.order_events (order_id, company_id, event_type, summary, detail, actor_id)
  values (new.order_id, new.company_id, 'call',
          format('Call attempt %s — %s', new.attempt_number, new.outcome),
          jsonb_build_object('outcome', new.outcome, 'duration_seconds', new.duration_seconds,
                             'callback_at', new.callback_at, 'phone', new.phone),
          coalesce(new.agent_id, app.uid()));

  -- Keep the order's call counters in step, so the list can show them without a join.
  update public.orders
  set call_attempts    = call_attempts + 1,
      last_call_at     = new.started_at,
      next_callback_at = coalesce(new.callback_at, next_callback_at)
  where id = new.order_id;

  update public.customers
  set last_call_at = new.started_at
  where id = new.customer_id;

  return new;
end;
$$;

create trigger order_calls_timeline
  after insert on public.order_calls
  for each row execute function app.log_call_event();

create or replace function app.log_message_event()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  insert into public.order_events (order_id, company_id, event_type, summary, detail, actor_id)
  values (new.order_id, new.company_id, 'message',
          format('%s %s', new.direction, new.channel),
          jsonb_build_object('channel', new.channel, 'template', new.template_code, 'status', new.status),
          coalesce(new.agent_id, app.uid()));

  update public.customers
  set last_message_at = now()
  where id = new.customer_id;

  return new;
end;
$$;

create trigger order_messages_timeline
  after insert on public.order_messages
  for each row execute function app.log_message_event();

-- -----------------------------------------------------------------------------
-- §4.8 customer aggregates and §4.13 risk score.
--
-- Recomputed from the orders themselves rather than incremented, so a corrected
-- order cannot leave the totals permanently skewed.
-- -----------------------------------------------------------------------------

create or replace function app.refresh_customer_stats(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_orders    integer;
  v_cancelled integer;
  v_value     numeric(14,2);
  v_last      timestamptz;
  v_blacklisted boolean;
  v_risk      integer;
begin
  if p_customer_id is null then return; end if;

  select count(*),
         count(*) filter (where status = 'cancelled'),
         coalesce(sum(total) filter (where status <> 'cancelled'), 0),
         max(order_date)
    into v_orders, v_cancelled, v_value, v_last
  from public.orders
  where customer_id = p_customer_id;

  select exists (
    select 1
    from public.blacklist_entries b
    join public.customers c on c.company_id = b.company_id
    where c.id = p_customer_id
      and b.is_active
      and (b.expires_at is null or b.expires_at > now())
      and (
        (b.scope = 'phone' and b.value = c.phone) or
        (b.scope = 'email' and b.value = lower(c.email)) or
        (b.scope = 'address' and c.address is not null and lower(c.address) like '%' || b.value || '%')
      )
  ) into v_blacklisted;

  -- §4.13 risk from cancellation ratio, order history and blacklist state.
  -- Deliberately simple and explainable: an agent has to be able to justify the
  -- warning they are shown before they pick up the phone.
  v_risk := least(100,
      case when v_orders > 0 then (v_cancelled::numeric / v_orders * 60)::integer else 0 end
    + case when v_blacklisted then 40 else 0 end
    + case when v_orders = 0 then 10 else 0 end
  );

  update public.customers
  set orders_count        = v_orders,
      cancelled_count     = v_cancelled,
      lifetime_value      = v_value,
      average_order_value = case when v_orders - v_cancelled > 0
                                 then round(v_value / (v_orders - v_cancelled), 2)
                                 else 0 end,
      last_order_at       = v_last,
      is_blacklisted      = v_blacklisted,
      risk_score          = v_risk
  where id = p_customer_id;
end;
$$;

create or replace function app.sync_customer_stats()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.refresh_customer_stats(new.customer_id);

  if tg_op = 'UPDATE' and old.customer_id is distinct from new.customer_id then
    perform app.refresh_customer_stats(old.customer_id);
  end if;

  -- Mirror the customer's risk onto the order so the list can sort by it (§4.13).
  update public.orders o
  set risk_score = c.risk_score
  from public.customers c
  where o.id = new.id and c.id = new.customer_id and o.risk_score is distinct from c.risk_score;

  return new;
end;
$$;

create trigger orders_customer_stats
  after insert or update of status, total, customer_id on public.orders
  for each row execute function app.sync_customer_stats();

-- -----------------------------------------------------------------------------
-- §4.12 Duplicate detection.
--
-- The spec's criteria: same phone, address, customer name, same products, same
-- day. Exposed as a function the intake path calls and the screen reads, so the
-- warning an agent sees and the flag stored on the order come from one rule.
-- -----------------------------------------------------------------------------

create or replace function public.find_duplicate_orders(p_order_id uuid)
returns table (
  order_id uuid,
  order_number text,
  order_date timestamptz,
  status public.order_status,
  match_reason text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with subject as (
    select o.*, (
      select array_agg(coalesce(oi.variant_id::text, oi.sku) order by coalesce(oi.variant_id::text, oi.sku))
      from public.order_items oi where oi.order_id = o.id
    ) as item_keys
    from public.orders o where o.id = p_order_id
  )
  select c.id,
         c.order_number,
         c.order_date,
         c.status,
         concat_ws(', ',
           case when c.customer_phone = s.customer_phone then 'same phone' end,
           case when lower(coalesce(c.address, '')) = lower(coalesce(s.address, ''))
                 and coalesce(s.address, '') <> '' then 'same address' end,
           case when lower(c.customer_name) = lower(s.customer_name) then 'same name' end,
           case when c.order_date::date = s.order_date::date then 'same day' end,
           case when (
             select array_agg(coalesce(oi.variant_id::text, oi.sku) order by coalesce(oi.variant_id::text, oi.sku))
             from public.order_items oi where oi.order_id = c.id
           ) = s.item_keys then 'same products' end
         ) as match_reason
  from public.orders c, subject s
  where c.id <> s.id
    and c.company_id = s.company_id
    and c.archived_at is null
    and c.status <> 'cancelled'
    -- The spec anchors duplicates to the same day; a week of slack catches the
    -- customer who reorders because they think the first attempt failed.
    and c.order_date > s.order_date - interval '7 days'
    and c.order_date < s.order_date + interval '7 days'
    and (
      c.customer_phone = s.customer_phone
      or lower(c.customer_name) = lower(s.customer_name)
      or (coalesce(s.address, '') <> '' and lower(coalesce(c.address, '')) = lower(coalesce(s.address, '')))
    );
$$;

comment on function public.find_duplicate_orders is
  '§4.12 duplicate candidates for one order — same phone, name, address, products or day.';

-- Rule 8: flag the duplicate at intake so the agent is warned before they call.
create or replace function app.flag_duplicate_order()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_match uuid;
begin
  select o.id into v_match
  from public.orders o
  where o.company_id = new.company_id
    and o.id <> new.id
    and o.archived_at is null
    and o.status <> 'cancelled'
    and o.customer_phone = new.customer_phone
    and o.order_date > new.order_date - interval '1 day'
    and o.order_date < new.order_date + interval '1 day'
  order by o.order_date desc
  limit 1;

  if v_match is not null then
    update public.orders
    set is_duplicate = true, duplicate_of_id = v_match
    where id = new.id;

    insert into public.order_events (order_id, company_id, event_type, summary, detail, actor_id)
    values (new.id, new.company_id, 'duplicate_flagged',
            'Possible duplicate of an existing order',
            jsonb_build_object('duplicate_of', v_match), app.uid());
  end if;

  return new;
end;
$$;

create trigger orders_duplicate_check
  after insert on public.orders
  for each row execute function app.flag_duplicate_order();

-- -----------------------------------------------------------------------------
-- §4.6 Round-robin assignment, as a function so the routing rule lives in one
-- place and the "who is least loaded" question is answered transactionally.
-- -----------------------------------------------------------------------------

create or replace function public.next_confirmation_agent(p_company_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
  from public.app_users u
  join public.user_roles ur on ur.user_id = u.id
  join public.roles r       on r.id = ur.role_id and r.is_active
  where u.company_id = p_company_id
    and u.status = 'active'
    and u.archived_at is null
    and r.code in ('confirmation_agent', 'confirmation_team_leader')
  group by u.id, u.max_assigned_orders
  order by (
    select count(*)
    from public.orders o
    where o.assigned_to = u.id
      and o.status not in ('confirmed', 'cancelled', 'ready_for_warehouse')
  )::numeric / greatest(coalesce(u.max_assigned_orders, 50), 1) asc,
  u.id asc
  limit 1;
$$;

comment on function public.next_confirmation_agent is
  '§4.6 round-robin target: the eligible agent with the lowest open-order load relative to their capacity.';

-- -----------------------------------------------------------------------------
-- §4.5 / §4.17 the confirmation queue, as a view so the screen and the §4.16
-- reports count the same thing.
-- -----------------------------------------------------------------------------

create view public.confirmation_queue as
select
  o.id,
  o.company_id,
  o.merchant_id,
  o.store_id,
  o.order_number,
  o.order_date,
  o.status,
  o.stage,
  o.customer_name,
  o.customer_phone,
  o.governorate,
  o.total,
  o.currency,
  o.assigned_to,
  o.call_attempts,
  o.next_callback_at,
  o.risk_score,
  o.is_duplicate,
  -- Age in hours drives the §4.16 SLA report.
  round(extract(epoch from (now() - o.order_date)) / 3600.0, 2) as age_hours
from public.orders o
where o.archived_at is null
  and o.status not in ('confirmed', 'cancelled', 'ready_for_warehouse');

comment on view public.confirmation_queue is
  '§4.17 Confirmation Screen source — every order still awaiting a confirmation decision.';

-- -----------------------------------------------------------------------------
-- Audit — §2.9 applies to order tables too.
-- -----------------------------------------------------------------------------

create trigger customers_audit            after insert or update or delete on public.customers            for each row execute function app.audit_trigger();
create trigger orders_audit               after insert or update             on public.orders               for each row execute function app.audit_trigger();
create trigger order_items_audit          after insert or update or delete on public.order_items          for each row execute function app.audit_trigger();
create trigger order_calls_audit          after insert or update or delete on public.order_calls          for each row execute function app.audit_trigger();
create trigger order_messages_audit       after insert or update or delete on public.order_messages       for each row execute function app.audit_trigger();
create trigger blacklist_entries_audit    after insert or update or delete on public.blacklist_entries    for each row execute function app.audit_trigger();
create trigger cancellation_reasons_audit after insert or update or delete on public.cancellation_reasons for each row execute function app.audit_trigger();
create trigger message_templates_audit    after insert or update or delete on public.message_templates    for each row execute function app.audit_trigger();
