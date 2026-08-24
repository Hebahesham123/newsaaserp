-- =============================================================================
-- Green ERP — 0014 Warehouse, inventory & fulfillment  (spec §5)
--
-- The physical half of the system. A confirmed order (§4.3 stage 4) arrives
-- here and moves through receiving → QC → put-away → reservation → picking →
-- packing → final QC → dispatch (§5.4).
--
-- The load-bearing decision: **`inventory_ledger` is the truth, and
-- `inventory_levels` is a cache of it.** §5.10 says the ledger is the master
-- reference for all stock movement and that no approved movement may be
-- deleted. So every bucket in §5.8 is derived by trigger from ledger rows, and
-- the ledger itself grants no UPDATE or DELETE to any client role. A stock
-- figure that disagrees with its own history is worse than no figure at all.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums — §5.2, §5.4, §5.7, §5.10, §5.11, §5.12
-- -----------------------------------------------------------------------------

-- §5.2 Warehouse → Zone → Aisle → Rack → Shelf → Bin
create type public.location_level as enum ('zone', 'aisle', 'rack', 'shelf', 'bin');

-- §5.2 the named special areas a warehouse must be able to model.
create type public.location_area as enum (
  'storage', 'receiving', 'qc', 'picking', 'packing', 'dispatch', 'returns', 'damaged'
);

-- §5.4 the stages a unit passes through inside the warehouse, with a timestamp
-- and an operator recorded per stage.
create type public.warehouse_stage as enum (
  'receiving', 'quality_check', 'put_away', 'available', 'reserved',
  'picking', 'packing', 'final_quality_check', 'ready_to_ship',
  'courier_handover', 'shipment_created', 'completed'
);

-- §5.10 the eleven movement types. Every row in the ledger is one of these.
create type public.inventory_txn_type as enum (
  'receiving', 'put_away', 'reservation', 'picking', 'packing', 'shipment',
  'return', 'damage', 'adjustment', 'warehouse_transfer', 'inventory_count'
);

-- §5.8 the eight buckets a SKU's stock is split across.
create type public.inventory_bucket as enum (
  'available', 'reserved', 'picking', 'packed', 'in_transit', 'returned', 'damaged', 'expired'
);

-- §5.11 the eight task types.
create type public.warehouse_task_type as enum (
  'receiving', 'put_away', 'picking', 'packing', 'quality_check',
  'transfer', 'inventory_count', 'courier_handover'
);

create type public.task_status as enum (
  'pending', 'assigned', 'in_progress', 'on_hold', 'completed', 'cancelled'
);

create type public.task_priority as enum ('low', 'normal', 'high', 'urgent');

-- §5.12 picking strategies.
create type public.picking_strategy as enum ('single', 'batch', 'wave', 'zone');

-- §5.7 put-away / allocation strategy.
create type public.stock_strategy as enum ('fifo', 'fefo', 'lifo');

-- §5.5 / §5.6 receiving.
create type public.receipt_status as enum (
  'draft', 'in_progress', 'quality_check', 'put_away', 'completed', 'cancelled'
);

create type public.qc_result as enum ('pending', 'passed', 'failed', 'partial');

-- §5.20 fulfillment-centre service fees.
create type public.fulfillment_service as enum (
  'receiving', 'storage', 'picking', 'packing', 'shipping', 'returns'
);

-- -----------------------------------------------------------------------------
-- Locations — §5.2
--
-- Self-referencing, because the hierarchy is six levels deep and a table per
-- level would mean six joins to answer "where is this SKU".
-- -----------------------------------------------------------------------------

create table public.warehouse_locations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  parent_id    uuid references public.warehouse_locations (id) on delete restrict,

  level        public.location_level not null,
  area         public.location_area not null default 'storage',

  -- §5.2 "must have a unique Location Code usable during storage, counting and
  -- picking". Unique per warehouse, not per company: two warehouses may both
  -- have an A-01-02-03 and that is normal.
  code         text not null,
  name         text,

  -- §5.14 pick-path optimisation walks locations in this order.
  sort_order   integer not null default 0,

  -- Capacity is advisory; the spec asks for it but does not make it blocking.
  max_units    integer check (max_units is null or max_units >= 0),
  max_weight_kg numeric(12,3) check (max_weight_kg is null or max_weight_kg >= 0),

  is_pickable  boolean not null default true,
  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,
  archived_at  timestamptz,
  archived_by  uuid references public.app_users (id) on delete set null,

  constraint warehouse_locations_code_unique unique (warehouse_id, code),
  constraint warehouse_locations_not_self_parent check (parent_id is null or parent_id <> id)
);

comment on table public.warehouse_locations is
  '§5.2 Warehouse → Zone → Aisle → Rack → Shelf → Bin, plus the named special areas (receiving, QC, picking, packing, dispatch, returns, damaged).';

create index warehouse_locations_warehouse_idx on public.warehouse_locations (warehouse_id, sort_order);
create index warehouse_locations_parent_idx    on public.warehouse_locations (parent_id) where parent_id is not null;
create index warehouse_locations_area_idx      on public.warehouse_locations (warehouse_id, area);

create trigger warehouse_locations_set_updated_at
  before update on public.warehouse_locations
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Inventory ledger — §5.10
--
-- Append-only and authoritative. `quantity` is signed: a receipt is positive
-- into `available`, a pick is negative out of `reserved` and positive into
-- `picking`. Movements between buckets are therefore two rows with the same
-- reference, which keeps every row a single unambiguous fact.
-- -----------------------------------------------------------------------------

create sequence public.inventory_txn_seq;

create table public.inventory_ledger (
  id           bigserial primary key,
  company_id   uuid not null references public.companies (id) on delete restrict,
  merchant_id  uuid not null references public.merchants (id) on delete restrict,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  location_id  uuid references public.warehouse_locations (id) on delete restrict,

  variant_id   uuid not null references public.product_variants (id) on delete restrict,
  product_id   uuid references public.products (id) on delete restrict,

  txn_number   text not null,
  txn_type     public.inventory_txn_type not null,
  bucket       public.inventory_bucket not null default 'available',

  -- Signed. §5.10 records the quantity of every movement; the sign is what
  -- makes the running balance derivable rather than asserted.
  quantity     numeric(14,3) not null check (quantity <> 0),

  -- §5.5 batch and expiry tracking for controlled items (§3.3).
  batch_number text,
  expiry_date  date,
  serial_number text,

  unit_cost    numeric(14,4) check (unit_cost is null or unit_cost >= 0),

  -- §5.10 "المرجع Order / Transfer / Return"
  reference_type text,
  reference_id   uuid,

  reason       text,
  notes        text,

  -- §5.10 "no movement may be deleted after approval". Approval is a column,
  -- not a deletion right: an unapproved adjustment can be superseded, an
  -- approved one is permanent.
  approved_at  timestamptz,
  approved_by  uuid references public.app_users (id) on delete set null,

  created_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,

  constraint inventory_ledger_txn_unique unique (txn_number)
);

comment on table public.inventory_ledger is
  '§5.10 the master record of every stock movement. Append-only: no client role holds UPDATE or DELETE, and inventory_levels is derived from this by trigger.';

create index inventory_ledger_variant_idx   on public.inventory_ledger (variant_id, created_at desc);
create index inventory_ledger_warehouse_idx on public.inventory_ledger (warehouse_id, created_at desc);
create index inventory_ledger_company_idx   on public.inventory_ledger (company_id, created_at desc);
create index inventory_ledger_type_idx      on public.inventory_ledger (company_id, txn_type, created_at desc);
create index inventory_ledger_reference_idx on public.inventory_ledger (reference_type, reference_id) where reference_id is not null;
create index inventory_ledger_batch_idx     on public.inventory_ledger (variant_id, batch_number) where batch_number is not null;

-- -----------------------------------------------------------------------------
-- Inventory levels — §5.8, the eight buckets per SKU per warehouse
--
-- Derived. Never written by application code; the ledger trigger owns it.
-- -----------------------------------------------------------------------------

create table public.inventory_levels (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  merchant_id  uuid not null references public.merchants (id) on delete restrict,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  variant_id   uuid not null references public.product_variants (id) on delete restrict,
  product_id   uuid references public.products (id) on delete restrict,

  -- §5.8 the eight quantities the spec requires be held separately.
  available    numeric(14,3) not null default 0,
  reserved     numeric(14,3) not null default 0,
  picking      numeric(14,3) not null default 0,
  packed       numeric(14,3) not null default 0,
  in_transit   numeric(14,3) not null default 0,
  returned     numeric(14,3) not null default 0,
  damaged      numeric(14,3) not null default 0,
  expired      numeric(14,3) not null default 0,

  -- Convenience for reorder reports; not a bucket.
  reorder_point numeric(14,3) check (reorder_point is null or reorder_point >= 0),

  last_movement_at timestamptz,
  updated_at   timestamptz not null default now(),

  constraint inventory_levels_unique unique (warehouse_id, variant_id)
);

comment on table public.inventory_levels is
  '§5.8 the eight stock buckets per SKU per warehouse. Derived from inventory_ledger by trigger — never written directly.';

create index inventory_levels_variant_idx  on public.inventory_levels (variant_id);
create index inventory_levels_company_idx  on public.inventory_levels (company_id, merchant_id);
create index inventory_levels_low_idx      on public.inventory_levels (warehouse_id)
  where reorder_point is not null;

/**
 * §5.8 "these values must update automatically after any movement in the system".
 *
 * The ledger row is the event; this keeps the bucket in step. Written as an
 * upsert so the first movement for a SKU in a warehouse creates its row.
 */
create or replace function app.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  insert into public.inventory_levels (
    company_id, merchant_id, warehouse_id, variant_id, product_id, last_movement_at
  )
  values (new.company_id, new.merchant_id, new.warehouse_id, new.variant_id, new.product_id, now())
  on conflict (warehouse_id, variant_id) do update
    set last_movement_at = now();

  update public.inventory_levels
  set available  = available  + case when new.bucket = 'available'  then new.quantity else 0 end,
      reserved   = reserved   + case when new.bucket = 'reserved'   then new.quantity else 0 end,
      picking    = picking    + case when new.bucket = 'picking'    then new.quantity else 0 end,
      packed     = packed     + case when new.bucket = 'packed'     then new.quantity else 0 end,
      in_transit = in_transit + case when new.bucket = 'in_transit' then new.quantity else 0 end,
      returned   = returned   + case when new.bucket = 'returned'   then new.quantity else 0 end,
      damaged    = damaged    + case when new.bucket = 'damaged'    then new.quantity else 0 end,
      expired    = expired    + case when new.bucket = 'expired'    then new.quantity else 0 end,
      updated_at = now()
  where warehouse_id = new.warehouse_id and variant_id = new.variant_id;

  return new;
end;
$$;

create trigger inventory_ledger_apply
  after insert on public.inventory_ledger
  for each row execute function app.apply_inventory_movement();

-- §5.10 the ledger is immutable once written. These refuse the verbs outright
-- so a stray grant cannot quietly re-open them.
create or replace function app.refuse_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'inventory_ledger is append-only (spec §5.10); post a correcting adjustment instead'
    using errcode = 'check_violation';
end;
$$;

create trigger inventory_ledger_no_update
  before update on public.inventory_ledger
  for each row execute function app.refuse_ledger_mutation();

create trigger inventory_ledger_no_delete
  before delete on public.inventory_ledger
  for each row execute function app.refuse_ledger_mutation();

-- Movement numbering, mirroring the order-number convention.
create or replace function app.assign_txn_number()
returns trigger
language plpgsql
as $$
begin
  if new.txn_number is null or new.txn_number = '' then
    new.txn_number := 'INV-' || to_char(now(), 'YYMM') || '-' ||
                      lpad(nextval('public.inventory_txn_seq')::text, 7, '0');
  end if;
  return new;
end;
$$;

create trigger inventory_ledger_number
  before insert on public.inventory_ledger
  for each row execute function app.assign_txn_number();

/**
 * The one supported way to move stock (§5.10).
 *
 * Application code calls this rather than inserting ledger rows, so a bucket
 * transfer is always a balanced pair and can never be half-written.
 */
create or replace function public.post_inventory_movement(
  p_variant_id uuid,
  p_warehouse_id uuid,
  p_txn_type public.inventory_txn_type,
  p_quantity numeric,
  p_from_bucket public.inventory_bucket default null,
  p_to_bucket public.inventory_bucket default null,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_location_id uuid default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_company  uuid;
  v_merchant uuid;
  v_product  uuid;
  v_available numeric;
begin
  if p_quantity <= 0 then
    raise exception 'Movement quantity must be positive; direction comes from the buckets'
      using errcode = 'check_violation';
  end if;

  select pv.company_id, pv.merchant_id, pv.product_id
    into v_company, v_merchant, v_product
  from public.product_variants pv
  where pv.id = p_variant_id;

  if v_company is null then
    raise exception 'Variant % not found', p_variant_id using errcode = 'foreign_key_violation';
  end if;

  if not app.same_company(v_company) then
    raise exception 'Cross-tenant stock movement rejected' using errcode = 'insufficient_privilege';
  end if;

  -- §5.23 stock cannot be driven negative out of a bucket it does not hold.
  if p_from_bucket is not null then
    execute format('select coalesce(%I, 0) from public.inventory_levels where warehouse_id = $1 and variant_id = $2',
                   p_from_bucket)
      into v_available
      using p_warehouse_id, p_variant_id;

    if coalesce(v_available, 0) < p_quantity then
      raise exception
        'Only % in % for this SKU; cannot move % (spec §5.23)',
        coalesce(v_available, 0), p_from_bucket, p_quantity
        using errcode = 'check_violation';
    end if;

    insert into public.inventory_ledger (
      company_id, merchant_id, warehouse_id, location_id, variant_id, product_id,
      txn_type, bucket, quantity, reference_type, reference_id, reason, created_by
    ) values (
      v_company, v_merchant, p_warehouse_id, p_location_id, p_variant_id, v_product,
      p_txn_type, p_from_bucket, -p_quantity, p_reference_type, p_reference_id, p_reason, app.uid()
    );
  end if;

  if p_to_bucket is not null then
    insert into public.inventory_ledger (
      company_id, merchant_id, warehouse_id, location_id, variant_id, product_id,
      txn_type, bucket, quantity, reference_type, reference_id, reason, created_by
    ) values (
      v_company, v_merchant, p_warehouse_id, p_location_id, p_variant_id, v_product,
      p_txn_type, p_to_bucket, p_quantity, p_reference_type, p_reference_id, p_reason, app.uid()
    );
  end if;
end;
$$;

comment on function public.post_inventory_movement is
  '§5.10 the only supported way to move stock. A bucket transfer posts a balanced pair of ledger rows.';

-- -----------------------------------------------------------------------------
-- Receiving — §5.5, §5.6, §5.7
-- -----------------------------------------------------------------------------

create sequence public.receipt_number_seq;

create table public.goods_receipts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  merchant_id  uuid not null references public.merchants (id) on delete restrict,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  supplier_id  uuid references public.suppliers (id) on delete restrict,

  receipt_number text not null,
  status       public.receipt_status not null default 'draft',

  -- §5.5 what must be recorded when a receipt is created.
  purchase_order_number text,
  invoice_number text,
  received_at  timestamptz not null default now(),
  received_by  uuid references public.app_users (id) on delete set null,

  -- §5.5 stock can also arrive from another warehouse.
  source_warehouse_id uuid references public.warehouses (id) on delete restrict,

  -- §5.6 QC at receipt.
  qc_result    public.qc_result not null default 'pending',
  qc_notes     text,
  qc_by        uuid references public.app_users (id) on delete set null,
  qc_at        timestamptz,

  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,

  constraint goods_receipts_number_unique unique (company_id, receipt_number)
);

create index goods_receipts_warehouse_idx on public.goods_receipts (warehouse_id, received_at desc);
create index goods_receipts_status_idx    on public.goods_receipts (company_id, status);

create trigger goods_receipts_set_updated_at
  before update on public.goods_receipts
  for each row execute function app.set_updated_at();

create table public.goods_receipt_items (
  id           uuid primary key default gen_random_uuid(),
  receipt_id   uuid not null references public.goods_receipts (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete restrict,
  variant_id   uuid not null references public.product_variants (id) on delete restrict,

  expected_quantity numeric(14,3) check (expected_quantity is null or expected_quantity >= 0),
  received_quantity numeric(14,3) not null default 0 check (received_quantity >= 0),
  -- §5.6 QC splits a receipt line into good and rejected stock.
  accepted_quantity numeric(14,3) not null default 0 check (accepted_quantity >= 0),
  damaged_quantity  numeric(14,3) not null default 0 check (damaged_quantity >= 0),

  batch_number text,
  expiry_date  date,
  unit_cost    numeric(14,4) check (unit_cost is null or unit_cost >= 0),

  -- §5.7 where the accepted stock was put away.
  location_id  uuid references public.warehouse_locations (id) on delete restrict,
  put_away_at  timestamptz,
  put_away_by  uuid references public.app_users (id) on delete set null,

  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint goods_receipt_items_split_check
    check (accepted_quantity + damaged_quantity <= received_quantity)
);

create index goods_receipt_items_receipt_idx on public.goods_receipt_items (receipt_id);
create index goods_receipt_items_variant_idx on public.goods_receipt_items (variant_id);

create trigger goods_receipt_items_set_updated_at
  before update on public.goods_receipt_items
  for each row execute function app.set_updated_at();

create or replace function app.assign_receipt_number()
returns trigger
language plpgsql
as $$
begin
  if new.receipt_number is null or new.receipt_number = '' then
    new.receipt_number := 'GRN-' || to_char(now(), 'YYMM') || '-' ||
                          lpad(nextval('public.receipt_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger goods_receipts_number
  before insert on public.goods_receipts
  for each row execute function app.assign_receipt_number();

/**
 * §5.7 put-away posts the accepted quantity into available stock, and the
 * damaged quantity into the damaged bucket, in one movement.
 *
 * Guarded against double posting: the line records when it was put away, and a
 * second attempt is refused rather than doubling the stock.
 */
create or replace function public.put_away_receipt_item(p_item_id uuid, p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_item   public.goods_receipt_items;
  v_receipt public.goods_receipts;
begin
  select * into v_item from public.goods_receipt_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'Receipt line % not found', p_item_id using errcode = 'foreign_key_violation';
  end if;

  if v_item.put_away_at is not null then
    raise exception 'This receipt line has already been put away'
      using errcode = 'check_violation';
  end if;

  select * into v_receipt from public.goods_receipts where id = v_item.receipt_id;

  if not app.has_perm('inventory.putaway') then
    raise exception 'Put-away requires the inventory.putaway permission'
      using errcode = 'insufficient_privilege';
  end if;

  if v_item.accepted_quantity > 0 then
    perform public.post_inventory_movement(
      v_item.variant_id, v_receipt.warehouse_id, 'put_away', v_item.accepted_quantity,
      null, 'available', 'goods_receipt', v_receipt.id, p_location_id,
      'Put away from receipt ' || v_receipt.receipt_number
    );
  end if;

  if v_item.damaged_quantity > 0 then
    perform public.post_inventory_movement(
      v_item.variant_id, v_receipt.warehouse_id, 'damage', v_item.damaged_quantity,
      null, 'damaged', 'goods_receipt', v_receipt.id, p_location_id,
      'Rejected at QC on receipt ' || v_receipt.receipt_number
    );
  end if;

  update public.goods_receipt_items
  set location_id = p_location_id, put_away_at = now(), put_away_by = app.uid()
  where id = p_item_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reservation — §5.9
-- -----------------------------------------------------------------------------

/**
 * §5.9 "as soon as the order reaches Confirmed, the required quantity is
 * reserved automatically".
 *
 * Bundles reserve their components, not the bundle itself (§5.9 rule 4), which
 * is why this walks `bundle_components` rather than reserving the parent SKU.
 * A shortfall does not fail the order — §5.9 rule 3 puts it on a waiting list
 * and notifies operations — so this reports rather than raises.
 */
create or replace function public.reserve_order_stock(p_order_id uuid, p_warehouse_id uuid)
returns table (variant_id uuid, requested numeric, reserved numeric, shortfall numeric)
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_line   record;
  v_avail  numeric;
  v_take   numeric;
begin
  for v_line in
    -- A bundle line expands into its components; everything else is itself.
    select coalesce(bc.component_variant_id, oi.variant_id) as variant_id,
           oi.quantity * coalesce(bc.quantity, 1)           as quantity
    from public.order_items oi
    left join public.products p on p.id = oi.product_id and p.product_type in ('bundle', 'kit', 'composite')
    left join public.bundle_components bc on bc.bundle_product_id = p.id
    where oi.order_id = p_order_id
      and coalesce(bc.component_variant_id, oi.variant_id) is not null
  loop
    select coalesce(il.available, 0) into v_avail
    from public.inventory_levels il
    where il.warehouse_id = p_warehouse_id and il.variant_id = v_line.variant_id;

    v_take := least(coalesce(v_avail, 0), v_line.quantity);

    if v_take > 0 then
      perform public.post_inventory_movement(
        v_line.variant_id, p_warehouse_id, 'reservation', v_take,
        'available', 'reserved', 'order', p_order_id, null,
        'Reserved for confirmed order'
      );
    end if;

    variant_id := v_line.variant_id;
    requested  := v_line.quantity;
    reserved   := v_take;
    shortfall  := v_line.quantity - v_take;
    return next;
  end loop;
end;
$$;

comment on function public.reserve_order_stock is
  '§5.9 reserves a confirmed order. Bundles reserve components (rule 4); a shortfall is reported, not raised (rule 3).';

/** §5.9 rule 2 — cancelling an order returns its reservation to available. */
create or replace function public.release_order_stock(p_order_id uuid, p_warehouse_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row record;
begin
  -- Release exactly what was reserved for this order, from the ledger, rather
  -- than recomputing from the lines — the lines may have been edited since.
  for v_row in
    select l.variant_id, sum(l.quantity) as qty
    from public.inventory_ledger l
    where l.reference_type = 'order'
      and l.reference_id = p_order_id
      and l.bucket = 'reserved'
    group by l.variant_id
    having sum(l.quantity) > 0
  loop
    perform public.post_inventory_movement(
      v_row.variant_id, p_warehouse_id, 'adjustment', v_row.qty,
      'reserved', 'available', 'order', p_order_id, null,
      'Reservation released'
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Warehouse tasks — §5.11, §5.21
-- -----------------------------------------------------------------------------

create sequence public.warehouse_task_seq;

create table public.warehouse_tasks (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,

  task_number  text not null,
  task_type    public.warehouse_task_type not null,
  status       public.task_status not null default 'pending',
  priority     public.task_priority not null default 'normal',

  -- §5.11 "Related Order"; a count or transfer task has none.
  order_id     uuid references public.orders (id) on delete set null,
  receipt_id   uuid references public.goods_receipts (id) on delete set null,
  pick_list_id uuid,

  assigned_to  uuid references public.app_users (id) on delete set null,
  assigned_at  timestamptz,

  -- §5.11 SLA, and the timestamps §5.4 requires per stage.
  sla_minutes  integer check (sla_minutes is null or sla_minutes > 0),
  due_at       timestamptz,
  started_at   timestamptz,
  completed_at timestamptz,

  completion_notes text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,

  constraint warehouse_tasks_number_unique unique (company_id, task_number)
);

comment on table public.warehouse_tasks is
  '§5.11 every warehouse step is a task with an owner, an SLA and start/end times — which is what makes §5.21 productivity measurable.';

create index warehouse_tasks_warehouse_idx on public.warehouse_tasks (warehouse_id, status);
create index warehouse_tasks_assigned_idx  on public.warehouse_tasks (assigned_to, status) where assigned_to is not null;
create index warehouse_tasks_order_idx     on public.warehouse_tasks (order_id) where order_id is not null;
create index warehouse_tasks_due_idx       on public.warehouse_tasks (due_at) where due_at is not null;

create trigger warehouse_tasks_set_updated_at
  before update on public.warehouse_tasks
  for each row execute function app.set_updated_at();

create or replace function app.prepare_warehouse_task()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' and (new.task_number is null or new.task_number = '') then
    new.task_number := 'TSK-' || to_char(now(), 'YYMM') || '-' ||
                       lpad(nextval('public.warehouse_task_seq')::text, 6, '0');
  end if;

  -- The SLA is the promise; due_at is the deadline it implies.
  if new.sla_minutes is not null and new.due_at is null then
    new.due_at := coalesce(new.created_at, now()) + make_interval(mins => new.sla_minutes);
  end if;

  -- §5.4 stage timestamps: set them from the status rather than trusting the
  -- caller to remember both.
  if new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;

  if new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  end if;

  if new.assigned_to is not null and new.assigned_at is null then
    new.assigned_at := now();
    if new.status = 'pending' then
      new.status := 'assigned';
    end if;
  end if;

  return new;
end;
$$;

create trigger warehouse_tasks_prepare
  before insert or update on public.warehouse_tasks
  for each row execute function app.prepare_warehouse_task();

-- -----------------------------------------------------------------------------
-- Picking — §5.12, §5.13, §5.14
-- -----------------------------------------------------------------------------

create sequence public.pick_list_seq;

create table public.pick_lists (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,

  pick_number  text not null,
  strategy     public.picking_strategy not null default 'single',
  status       public.task_status not null default 'pending',

  -- §5.12 wave picking groups by courier, governorate, dispatch time, product
  -- type or priority. The grouping key is recorded so the wave is explicable.
  wave_key     text,
  zone_id      uuid references public.warehouse_locations (id) on delete set null,

  assigned_to  uuid references public.app_users (id) on delete set null,
  started_at   timestamptz,
  completed_at timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,

  constraint pick_lists_number_unique unique (company_id, pick_number)
);

create index pick_lists_warehouse_idx on public.pick_lists (warehouse_id, status);
create index pick_lists_assigned_idx  on public.pick_lists (assigned_to, status) where assigned_to is not null;

create trigger pick_lists_set_updated_at
  before update on public.pick_lists
  for each row execute function app.set_updated_at();

create table public.pick_list_items (
  id           uuid primary key default gen_random_uuid(),
  pick_list_id uuid not null references public.pick_lists (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete restrict,
  order_id     uuid not null references public.orders (id) on delete restrict,
  order_item_id uuid references public.order_items (id) on delete set null,
  variant_id   uuid not null references public.product_variants (id) on delete restrict,
  location_id  uuid references public.warehouse_locations (id) on delete set null,

  requested_quantity numeric(14,3) not null check (requested_quantity > 0),
  picked_quantity    numeric(14,3) not null default 0 check (picked_quantity >= 0),

  -- §5.14 pick-path order, precomputed so the picker walks the aisle once.
  pick_sequence integer not null default 0,

  picked_at    timestamptz,
  picked_by    uuid references public.app_users (id) on delete set null,
  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index pick_list_items_list_idx  on public.pick_list_items (pick_list_id, pick_sequence);
create index pick_list_items_order_idx on public.pick_list_items (order_id);

-- Declared here rather than inline: `warehouse_tasks` is created before
-- `pick_lists`, because a picking task is what produces the list.
alter table public.warehouse_tasks
  add constraint warehouse_tasks_pick_list_fkey
  foreign key (pick_list_id) references public.pick_lists (id) on delete set null;

create trigger pick_list_items_set_updated_at
  before update on public.pick_list_items
  for each row execute function app.set_updated_at();

create or replace function app.assign_pick_number()
returns trigger
language plpgsql
as $$
begin
  if new.pick_number is null or new.pick_number = '' then
    new.pick_number := 'PCK-' || to_char(now(), 'YYMM') || '-' ||
                       lpad(nextval('public.pick_list_seq')::text, 6, '0');
  end if;
  if new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

create trigger pick_lists_prepare
  before insert or update on public.pick_lists
  for each row execute function app.assign_pick_number();

/** §5.12 confirming a pick moves stock reserved → picking. */
create or replace function public.confirm_pick(p_item_id uuid, p_quantity numeric)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_item public.pick_list_items;
  v_list public.pick_lists;
begin
  select * into v_item from public.pick_list_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'Pick line % not found', p_item_id using errcode = 'foreign_key_violation';
  end if;

  select * into v_list from public.pick_lists where id = v_item.pick_list_id;

  if p_quantity <= 0 or p_quantity > v_item.requested_quantity - v_item.picked_quantity then
    raise exception 'Pick quantity must be between 0 and the outstanding quantity'
      using errcode = 'check_violation';
  end if;

  perform public.post_inventory_movement(
    v_item.variant_id, v_list.warehouse_id, 'picking', p_quantity,
    'reserved', 'picking', 'order', v_item.order_id, v_item.location_id,
    'Picked on ' || v_list.pick_number
  );

  update public.pick_list_items
  set picked_quantity = picked_quantity + p_quantity,
      picked_at = now(),
      picked_by = app.uid()
  where id = p_item_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Packing — §5.15, §5.16, §5.17, §5.18
-- -----------------------------------------------------------------------------

create table public.packing_materials (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  code         text not null,
  name         text not null,
  -- §5.16 material cost feeds §7.3 order cost.
  unit_cost    numeric(14,4) not null default 0 check (unit_cost >= 0),
  currency     char(3) not null default 'EGP',
  max_weight_kg numeric(12,3),
  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint packing_materials_code_unique unique (company_id, code)
);

create trigger packing_materials_set_updated_at
  before update on public.packing_materials
  for each row execute function app.set_updated_at();

create sequence public.package_number_seq;

create table public.packages (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  order_id     uuid not null references public.orders (id) on delete restrict,

  package_number text not null,
  material_id  uuid references public.packing_materials (id) on delete set null,

  weight_kg    numeric(12,3) check (weight_kg is null or weight_kg >= 0),
  length_cm    numeric(10,2),
  width_cm     numeric(10,2),
  height_cm    numeric(10,2),

  -- §5.16 the packaging cost actually incurred on this parcel.
  material_cost numeric(14,4) not null default 0 check (material_cost >= 0),

  -- §5.17 final quality check before dispatch.
  qc_result    public.qc_result not null default 'pending',
  qc_by        uuid references public.app_users (id) on delete set null,
  qc_at        timestamptz,

  packed_by    uuid references public.app_users (id) on delete set null,
  packed_at    timestamptz not null default now(),
  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint packages_number_unique unique (company_id, package_number)
);

create index packages_order_idx     on public.packages (order_id);
create index packages_warehouse_idx on public.packages (warehouse_id, packed_at desc);

create trigger packages_set_updated_at
  before update on public.packages
  for each row execute function app.set_updated_at();

create table public.package_items (
  id           uuid primary key default gen_random_uuid(),
  package_id   uuid not null references public.packages (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete restrict,
  variant_id   uuid not null references public.product_variants (id) on delete restrict,
  order_item_id uuid references public.order_items (id) on delete set null,
  quantity     numeric(14,3) not null check (quantity > 0),
  created_at   timestamptz not null default now()
);

create index package_items_package_idx on public.package_items (package_id);

create or replace function app.assign_package_number()
returns trigger
language plpgsql
as $$
begin
  if new.package_number is null or new.package_number = '' then
    new.package_number := 'PKG-' || to_char(now(), 'YYMM') || '-' ||
                          lpad(nextval('public.package_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger packages_number
  before insert on public.packages
  for each row execute function app.assign_package_number();

/** §5.15 packing a line moves stock picking → packed. */
create or replace function app.apply_package_item()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_package public.packages;
begin
  select * into v_package from public.packages where id = new.package_id;

  perform public.post_inventory_movement(
    new.variant_id, v_package.warehouse_id, 'packing', new.quantity,
    'picking', 'packed', 'order', v_package.order_id, null,
    'Packed into ' || v_package.package_number
  );

  return new;
end;
$$;

create trigger package_items_apply
  after insert on public.package_items
  for each row execute function app.apply_package_item();

-- -----------------------------------------------------------------------------
-- Fulfillment-centre service fees — §5.20
-- -----------------------------------------------------------------------------

create table public.fulfillment_fees (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  merchant_id  uuid not null references public.merchants (id) on delete restrict,

  service      public.fulfillment_service not null,
  -- Either a flat fee per event or a rate per unit; both are used in practice.
  fee_per_event numeric(14,4) check (fee_per_event is null or fee_per_event >= 0),
  fee_per_unit  numeric(14,4) check (fee_per_unit is null or fee_per_unit >= 0),
  currency     char(3) not null default 'EGP',

  effective_from date,
  effective_to   date,
  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint fulfillment_fees_unique unique (merchant_id, service, effective_from),
  constraint fulfillment_fees_window check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

comment on table public.fulfillment_fees is
  '§5.20 per-merchant service pricing for a fulfillment centre. Consumed by §7.7 merchant settlement.';

create trigger fulfillment_fees_set_updated_at
  before update on public.fulfillment_fees
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- §5.24 KPI helper and the low-stock view the dashboards read.
-- -----------------------------------------------------------------------------

create view public.stock_on_hand as
select
  il.company_id,
  il.merchant_id,
  il.warehouse_id,
  il.variant_id,
  il.product_id,
  pv.sku,
  p.name_en,
  p.name_ar,
  il.available,
  il.reserved,
  il.picking,
  il.packed,
  il.in_transit,
  il.returned,
  il.damaged,
  il.expired,
  -- Physically present stock: what a stock count should find on the shelves.
  (il.available + il.reserved + il.picking + il.packed + il.damaged + il.expired) as on_hand,
  il.reorder_point,
  (il.reorder_point is not null and il.available <= il.reorder_point) as needs_reorder,
  il.last_movement_at
from public.inventory_levels il
join public.product_variants pv on pv.id = il.variant_id
left join public.products p on p.id = il.product_id;

comment on view public.stock_on_hand is
  '§5.8 / §5.24 the eight buckets with SKU and product names attached, plus the reorder flag.';

-- §5.21 employee productivity, from the task timestamps rather than a separate
-- counter that could drift from them.
create view public.warehouse_productivity as
select
  t.company_id,
  t.warehouse_id,
  t.assigned_to as user_id,
  t.task_type,
  count(*) filter (where t.status = 'completed')                                     as completed_tasks,
  count(*) filter (where t.status = 'completed' and t.due_at is not null and t.completed_at > t.due_at) as late_tasks,
  round(avg(extract(epoch from (t.completed_at - t.started_at)) / 60.0)
        filter (where t.status = 'completed' and t.started_at is not null), 2)       as avg_minutes
from public.warehouse_tasks t
where t.assigned_to is not null
group by t.company_id, t.warehouse_id, t.assigned_to, t.task_type;

-- -----------------------------------------------------------------------------
-- Audit — §2.9
-- -----------------------------------------------------------------------------

create trigger warehouse_locations_audit  after insert or update or delete on public.warehouse_locations  for each row execute function app.audit_trigger();
create trigger goods_receipts_audit       after insert or update or delete on public.goods_receipts       for each row execute function app.audit_trigger();
create trigger goods_receipt_items_audit  after insert or update or delete on public.goods_receipt_items  for each row execute function app.audit_trigger();
create trigger warehouse_tasks_audit      after insert or update or delete on public.warehouse_tasks      for each row execute function app.audit_trigger();
create trigger pick_lists_audit           after insert or update or delete on public.pick_lists           for each row execute function app.audit_trigger();
create trigger packages_audit             after insert or update or delete on public.packages             for each row execute function app.audit_trigger();
create trigger fulfillment_fees_audit     after insert or update or delete on public.fulfillment_fees     for each row execute function app.audit_trigger();
create trigger inventory_ledger_audit     after insert                     on public.inventory_ledger     for each row execute function app.audit_trigger();
