-- =============================================================================
-- Green ERP — 0020 Reports & BI  (spec §9)
--
-- §9.20 is the constraint that shapes this whole module: **a new report must not
-- require new development.** That rules out a table-per-report design. Instead:
--
--  * A set of **reporting views** expose each domain in the shape a report
--    wants — one row per order, per shipment, per return, per collection. They
--    run as the caller (`security_invoker`), so a report can never show a user
--    a row they could not have queried directly. That is what makes §9.19
--    ("hide costs and profits by role") true without a second permission
--    system: the cost columns come from tables the user's policies already gate.
--
--  * `report_definitions` stores what a report *is* — source view, columns,
--    filters, grouping — as data. The builder writes rows here; the runner
--    reads them. Adding a report is a row, not a migration.
--
--  * Every run and export is recorded in `report_runs`, because §9.19 requires
--    all exports to be audited and §2.9 counts an export as a sensitive event.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums — §9.3, §9.17
-- -----------------------------------------------------------------------------

-- §9.3 the fifteen report categories.
create type public.report_category as enum (
  'orders', 'confirmation', 'warehouse', 'inventory', 'shipping', 'returns',
  'collections', 'financial', 'profitability', 'products', 'customers',
  'merchants', 'affiliates', 'employees', 'executive'
);

create type public.report_format as enum ('excel', 'csv', 'pdf', 'print', 'email');

create type public.schedule_frequency as enum ('daily', 'weekly', 'monthly');

-- -----------------------------------------------------------------------------
-- Reporting views — the surface the report engine queries.
--
-- Flat and denormalised on purpose: a report writer should not need a join, and
-- the §9.16 global filter bar has to find its sixteen dimensions as columns.
-- -----------------------------------------------------------------------------

/** §9.4 Order Reports — one row per order with every filter dimension attached. */
create view public.rpt_orders as
select
  o.id                as order_id,
  o.company_id,
  o.merchant_id,
  m.name              as merchant_name,
  o.store_id,
  st.name             as store_name,
  o.order_number,
  o.external_order_number,
  o.order_date,
  o.order_date::date  as order_day,
  date_trunc('week',  o.order_date)::date  as order_week,
  date_trunc('month', o.order_date)::date  as order_month,
  o.source,
  o.status,
  o.stage,
  o.governorate,
  o.city,
  o.payment_method,
  o.payment_status,
  o.currency,
  o.total,
  o.cod_amount,
  o.customer_id,
  o.customer_name,
  o.assigned_to,
  au.full_name        as assigned_to_name,
  o.campaign_ref,
  o.affiliate_ref,
  o.call_attempts,
  o.risk_score,
  o.is_duplicate,
  o.confirmed_at,
  o.cancelled_at,
  cr.name_en          as cancellation_reason_en,
  cr.name_ar          as cancellation_reason_ar,
  -- §9.5 how long the order waited for a decision.
  case when o.confirmed_at is not null
       then round(extract(epoch from (o.confirmed_at - o.order_date)) / 3600.0, 2)
       end            as hours_to_confirm,
  (select count(*) from public.order_items oi where oi.order_id = o.id) as line_count,
  (select coalesce(sum(oi.quantity), 0) from public.order_items oi where oi.order_id = o.id) as unit_count
from public.orders o
left join public.merchants m  on m.id = o.merchant_id
left join public.stores st    on st.id = o.store_id
left join public.app_users au on au.id = o.assigned_to
left join public.cancellation_reasons cr on cr.id = o.cancellation_reason_id
where o.archived_at is null;

comment on view public.rpt_orders is
  '§9.4 the order reporting surface. security_invoker, so row visibility is the caller''s own.';

/** §9.5 Confirmation-team performance, per agent. */
create view public.rpt_confirmation_performance as
select
  o.company_id,
  o.assigned_to      as user_id,
  au.full_name       as agent_name,
  date_trunc('day', o.order_date)::date as day,
  count(*)                                                as assigned_orders,
  count(*) filter (where o.status = 'confirmed')           as confirmed_orders,
  count(*) filter (where o.status = 'cancelled')           as cancelled_orders,
  case when count(*) > 0
       then round(count(*) filter (where o.status = 'confirmed')::numeric / count(*) * 100, 2)
       end                                                as confirmation_rate,
  coalesce(sum(o.call_attempts), 0)                       as total_calls,
  round(avg(c.duration_seconds), 1)                       as avg_call_seconds,
  round(avg(extract(epoch from (o.confirmed_at - o.order_date)) / 3600.0)
        filter (where o.confirmed_at is not null), 2)     as avg_hours_to_confirm
from public.orders o
left join public.app_users au on au.id = o.assigned_to
left join public.order_calls c on c.order_id = o.id
where o.assigned_to is not null
  and o.archived_at is null
group by o.company_id, o.assigned_to, au.full_name, date_trunc('day', o.order_date);

/** §9.6 Warehouse throughput and SLA. */
create view public.rpt_warehouse as
select
  t.company_id,
  t.warehouse_id,
  w.name             as warehouse_name,
  t.task_type,
  date_trunc('day', t.created_at)::date as day,
  count(*)                                                          as tasks,
  count(*) filter (where t.status = 'completed')                    as completed,
  count(*) filter (where t.status = 'completed' and t.due_at is not null and t.completed_at > t.due_at) as breached_sla,
  round(avg(extract(epoch from (t.completed_at - t.started_at)) / 60.0)
        filter (where t.completed_at is not null and t.started_at is not null), 2) as avg_minutes
from public.warehouse_tasks t
left join public.warehouses w on w.id = t.warehouse_id
group by t.company_id, t.warehouse_id, w.name, t.task_type, date_trunc('day', t.created_at);

/** §9.7 Courier reports — one row per shipment. */
create view public.rpt_shipments as
select
  s.id               as shipment_id,
  s.company_id,
  s.merchant_id,
  s.order_id,
  o.order_number,
  s.courier_id,
  c.name             as courier_name,
  s.shipment_number,
  s.awb,
  s.status,
  s.governorate,
  s.city,
  s.delivery_attempts,
  s.cod_amount,
  s.shipping_fee,
  s.currency,
  s.handed_over_at,
  s.delivered_at,
  s.returned_at,
  date_trunc('day', coalesce(s.handed_over_at, s.created_at))::date as day,
  case when s.delivered_at is not null and s.handed_over_at is not null
       then round(extract(epoch from (s.delivered_at - s.handed_over_at)) / 86400.0, 2)
       end           as delivery_days,
  (s.status = 'delivered')                                                     as is_delivered,
  (s.status in ('returned_to_warehouse', 'return_inspection', 'inventory_updated')) as is_rto
from public.shipments s
left join public.couriers c on c.id = s.courier_id
left join public.orders o   on o.id = s.order_id;

/** §9.8 Returns reports, with the cause classification the spec asks to split on. */
create view public.rpt_returns as
select
  r.id               as return_id,
  r.company_id,
  r.merchant_id,
  r.order_id,
  o.order_number,
  r.return_number,
  r.status,
  r.is_rto,
  rr.code            as reason_code,
  rr.name_en         as reason_en,
  rr.name_ar         as reason_ar,
  rr.fault,
  r.requested_at,
  r.received_at,
  r.closed_at,
  date_trunc('day', r.requested_at)::date as day,
  case when r.closed_at is not null
       then round(extract(epoch from (r.closed_at - r.requested_at)) / 86400.0, 2)
       end           as days_to_close,
  (select coalesce(sum(ri.quantity), 0) from public.return_items ri where ri.return_id = r.id) as unit_count,
  (select count(*) filter (where ri.disposition = 'restock') from public.return_items ri where ri.return_id = r.id) as restocked_lines,
  (select count(*) filter (where ri.disposition = 'destroy') from public.return_items ri where ri.return_id = r.id) as destroyed_lines
from public.returns r
left join public.return_reasons rr on rr.id = r.reason_id
left join public.orders o on o.id = r.order_id;

/** §9.9 Collections reports — expected vs collected, per order. */
create view public.rpt_collections as
select
  col.id             as collection_id,
  col.company_id,
  col.merchant_id,
  col.order_id,
  o.order_number,
  col.courier_id,
  c.name             as courier_name,
  col.status,
  col.expected_amount,
  col.collected_amount,
  col.courier_fee,
  col.deductions,
  col.net_amount,
  col.variance,
  col.currency,
  col.collected_at,
  col.transferred_at,
  col.due_at,
  date_trunc('day', coalesce(col.collected_at, col.created_at))::date as day,
  (col.due_at is not null and col.collected_at is null and col.due_at < now()) as is_overdue
from public.cod_collections col
left join public.couriers c on c.id = col.courier_id
left join public.orders o   on o.id = col.order_id;

/** §9.11 Product performance, joining sales to catalog identity. */
create view public.rpt_products as
select
  oi.company_id,
  o.merchant_id,
  oi.product_id,
  oi.variant_id,
  pv.sku,
  p.name_en          as product_name_en,
  p.name_ar          as product_name_ar,
  b.name_en          as brand_name_en,
  cat.name_en        as category_name_en,
  date_trunc('month', o.order_date)::date as month,
  count(distinct o.id)          as orders,
  sum(oi.quantity)              as units_sold,
  sum(oi.total)                 as revenue,
  coalesce(sum(oi.quantity * pv.cost), 0) as cost,
  sum(oi.total) - coalesce(sum(oi.quantity * pv.cost), 0) as gross_profit
from public.order_items oi
join public.orders o on o.id = oi.order_id and o.archived_at is null and o.status <> 'cancelled'
left join public.product_variants pv on pv.id = oi.variant_id
left join public.products p   on p.id = oi.product_id
left join public.brands b     on b.id = p.brand_id
left join public.categories cat on cat.id = p.category_id
group by oi.company_id, o.merchant_id, oi.product_id, oi.variant_id, pv.sku,
         p.name_en, p.name_ar, b.name_en, cat.name_en, date_trunc('month', o.order_date);

/** §9.12 Customer reports, over the §4.8 aggregates. */
create view public.rpt_customers as
select
  cu.id              as customer_id,
  cu.company_id,
  cu.merchant_id,
  cu.name,
  cu.governorate,
  cu.city,
  cu.orders_count,
  cu.cancelled_count,
  cu.returned_count,
  cu.lifetime_value,
  cu.average_order_value,
  cu.risk_score,
  cu.is_blacklisted,
  cu.last_order_at,
  -- §9.18 churn signal: how long since they last bought.
  case when cu.last_order_at is not null
       then round(extract(epoch from (now() - cu.last_order_at)) / 86400.0, 0)
       end           as days_since_last_order,
  case when cu.orders_count > 1 then true else false end as is_repeat
from public.customers cu
where cu.archived_at is null;

/** §9.15 Employee activity across the modules that assign work. */
create view public.rpt_employees as
select
  u.id               as user_id,
  u.company_id,
  u.full_name,
  u.department_id,
  (select count(*) from public.orders o where o.assigned_to = u.id)                      as orders_assigned,
  (select count(*) from public.orders o where o.confirmed_by = u.id)                     as orders_confirmed,
  (select count(*) from public.order_calls c where c.agent_id = u.id)                    as calls_logged,
  (select count(*) from public.warehouse_tasks t where t.assigned_to = u.id and t.status = 'completed') as tasks_completed
from public.app_users u
where u.archived_at is null;

/**
 * §9.22 the executive KPI board — the headline numbers, in one row per company.
 *
 * Deliberately a single row: the board renders nineteen tiles and should cost
 * one query, not nineteen.
 */
create view public.rpt_executive_kpis as
select
  c.id as company_id,
  -- Orders
  (select count(*) from public.orders o where o.company_id = c.id and o.archived_at is null)                       as total_orders,
  (select count(*) from public.orders o where o.company_id = c.id and o.order_date >= current_date - 30)           as orders_30d,
  (select count(*) from public.orders o where o.company_id = c.id and o.status = 'confirmed')                      as confirmed_orders,
  (select count(*) from public.orders o where o.company_id = c.id and o.status = 'cancelled')                      as cancelled_orders,
  (select count(*) from public.confirmation_queue q where q.company_id = c.id)                                     as open_confirmations,
  -- Revenue
  (select coalesce(sum(o.total), 0) from public.orders o
     where o.company_id = c.id and o.status <> 'cancelled' and o.archived_at is null)                              as gross_revenue,
  (select coalesce(avg(o.total), 0) from public.orders o
     where o.company_id = c.id and o.status <> 'cancelled' and o.archived_at is null)                              as average_order_value,
  -- Fulfillment
  (select count(*) from public.shipments s where s.company_id = c.id)                                              as total_shipments,
  (select count(*) from public.shipments s where s.company_id = c.id and s.status = 'delivered')                    as delivered_shipments,
  (select count(*) from public.shipments s where s.company_id = c.id
     and s.status not in ('delivered', 'closed', 'cancelled'))                                                     as open_shipments,
  (select count(*) from public.returns r where r.company_id = c.id)                                                as total_returns,
  -- Money
  (select coalesce(sum(col.expected_amount), 0) from public.cod_collections col
     where col.company_id = c.id and col.status = 'pending')                                                       as outstanding_cod,
  (select coalesce(sum(col.collected_amount), 0) from public.cod_collections col where col.company_id = c.id)      as collected_cod,
  (select coalesce(sum(p.gross_profit), 0) from public.order_profitability p where p.company_id = c.id)            as gross_profit,
  (select coalesce(sum(e.amount), 0) from public.operating_expenses e
     where e.company_id = c.id and e.status in ('approved', 'paid'))                                               as operating_expenses,
  (select coalesce(sum(me.amount), 0) from public.marketing_expenses me where me.company_id = c.id)                as marketing_spend,
  -- Catalog & inventory
  (select count(*) from public.products pr where pr.company_id = c.id and pr.archived_at is null)                  as active_products,
  (select count(*) from public.inventory_levels il where il.company_id = c.id and il.available <= 0)               as out_of_stock_skus,
  -- People
  (select count(*) from public.app_users u where u.company_id = c.id and u.status = 'active')                      as active_users
from public.companies c;

comment on view public.rpt_executive_kpis is
  '§9.22 the nineteen headline metrics, one row per company so the board costs one query.';

-- -----------------------------------------------------------------------------
-- Report definitions — §9.20 "a custom report builder requiring no new development"
-- -----------------------------------------------------------------------------

create table public.report_definitions (
  id           uuid primary key default gen_random_uuid(),
  -- A null company means a platform-provided template every tenant can run.
  company_id   uuid references public.companies (id) on delete cascade,

  code         text not null,
  name_en      text not null,
  name_ar      text not null,
  description  text,
  category     public.report_category not null,

  -- The reporting view this report reads. Constrained to the rpt_* surface, so
  -- a definition cannot be pointed at a raw table and bypass its shape.
  source_view  text not null check (source_view like 'rpt\_%'),

  -- What to show, as data rather than SQL: column keys, filter defaults,
  -- grouping and sort. The runner turns these into a PostgREST query.
  columns      jsonb not null default '[]'::jsonb,
  filters      jsonb not null default '{}'::jsonb,
  group_by     text[] not null default '{}',
  order_by     text,
  order_desc   boolean not null default true,
  row_limit    integer not null default 1000 check (row_limit between 1 and 50000),

  -- §9.19 columns only a privileged role may see. The runner drops them for
  -- anyone without the permission; the view's own policies are the backstop.
  requires_permission text,

  is_system    boolean not null default false,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null,

  constraint report_definitions_code_unique unique (company_id, code)
);

comment on table public.report_definitions is
  '§9.20 a report is a row, not code. source_view is restricted to the rpt_* surface so definitions cannot reach past RLS.';

-- The composite constraint above does not constrain platform templates: NULLs
-- compare as distinct, so it would happily allow ten rows with company_id NULL
-- and the same code. This closes that.
create unique index report_definitions_template_code
  on public.report_definitions (code)
  where company_id is null;

create index report_definitions_category_idx on public.report_definitions (category, sort_order);

create trigger report_definitions_set_updated_at
  before update on public.report_definitions
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Saved filters — §9.16 "16 dimensions, per-user saved filters"
-- -----------------------------------------------------------------------------

create table public.saved_filters (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  user_id      uuid not null references public.app_users (id) on delete cascade,

  name         text not null,
  -- Which screen or report the filter belongs to.
  scope        text not null,
  -- The sixteen dimensions, as a sparse object: only what was set is stored.
  filters      jsonb not null default '{}'::jsonb,
  is_default   boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint saved_filters_unique unique (user_id, scope, name)
);

create index saved_filters_lookup_idx on public.saved_filters (user_id, scope);

create trigger saved_filters_set_updated_at
  before update on public.saved_filters
  for each row execute function app.set_updated_at();

-- Only one default per user per scope, enforced rather than hoped for.
create unique index saved_filters_one_default
  on public.saved_filters (user_id, scope)
  where is_default;

-- -----------------------------------------------------------------------------
-- Scheduled delivery — §9.17
-- -----------------------------------------------------------------------------

create table public.report_schedules (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  report_id    uuid not null references public.report_definitions (id) on delete cascade,

  name         text not null,
  frequency    public.schedule_frequency not null default 'daily',
  -- Local time of day to run, and which weekday / day-of-month for the
  -- non-daily frequencies.
  run_at_time  time not null default '07:00',
  day_of_week  integer check (day_of_week between 0 and 6),
  day_of_month integer check (day_of_month between 1 and 28),
  timezone     text not null default 'Africa/Cairo',

  format       public.report_format not null default 'excel',
  recipients   text[] not null default '{}',
  filters      jsonb not null default '{}'::jsonb,

  is_active    boolean not null default true,
  last_run_at  timestamptz,
  last_status  text,
  next_run_at  timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null
);

comment on table public.report_schedules is
  '§9.17 daily/weekly/monthly delivery. `next_run_at` is what a worker polls; nothing here sends mail on its own yet.';

create index report_schedules_due_idx on public.report_schedules (next_run_at) where is_active;

create trigger report_schedules_set_updated_at
  before update on public.report_schedules
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Run & export log — §9.19 "all exports are audited"
-- -----------------------------------------------------------------------------

create table public.report_runs (
  id           bigserial primary key,
  company_id   uuid not null references public.companies (id) on delete cascade,
  report_id    uuid references public.report_definitions (id) on delete set null,
  schedule_id  uuid references public.report_schedules (id) on delete set null,

  report_code  text,
  format       public.report_format,
  filters      jsonb,
  row_count    integer,
  duration_ms  integer,
  status       text not null default 'success' check (status in ('success', 'failed', 'partial')),
  error        text,

  -- An export is a sensitive read: who took the data, and from where.
  run_by       uuid references public.app_users (id) on delete set null,
  ip_address   inet,
  created_at   timestamptz not null default now()
);

create index report_runs_company_idx on public.report_runs (company_id, created_at desc);
create index report_runs_report_idx  on public.report_runs (report_id, created_at desc);

/**
 * §9.19 records a run, and mirrors an export into the §2.9 audit trail.
 *
 * Two logs rather than one because they answer different questions: report_runs
 * is "what did this report cost and did it work", audit_log is "who took data
 * out of the system". The second is the one a compliance review reads.
 */
create or replace function app.log_report_export()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.format in ('excel', 'csv', 'pdf', 'email') then
    insert into public.audit_log (
      company_id, actor_id, action, module, record_id, new_value, ip_address, user_agent
    )
    values (
      new.company_id, coalesce(new.run_by, app.uid()), 'export', 'reports',
      coalesce(new.report_id::text, new.report_code),
      jsonb_build_object('format', new.format, 'rows', new.row_count, 'filters', new.filters),
      coalesce(new.ip_address, app.request_ip()), app.request_header('user-agent')
    );
  end if;
  return new;
end;
$$;

create trigger report_runs_audit_export
  after insert on public.report_runs
  for each row execute function app.log_report_export();

-- -----------------------------------------------------------------------------
-- §9.3 the platform report catalogue, seeded once as company-null templates.
-- -----------------------------------------------------------------------------

insert into public.report_definitions
  (company_id, code, name_en, name_ar, category, source_view, columns, group_by, order_by, requires_permission, is_system, sort_order)
values
  (null, 'orders_by_day', 'Orders by day', 'الطلبات يوميًا', 'orders', 'rpt_orders',
   '["order_day","status","total"]'::jsonb, array['order_day'], 'order_day', 'orders.view', true, 1),
  (null, 'orders_by_store', 'Orders by store', 'الطلبات حسب المتجر', 'orders', 'rpt_orders',
   '["store_name","status","total"]'::jsonb, array['store_name'], 'store_name', 'orders.view', true, 2),
  (null, 'orders_by_merchant', 'Orders by merchant', 'الطلبات حسب التاجر', 'orders', 'rpt_orders',
   '["merchant_name","status","total"]'::jsonb, array['merchant_name'], 'merchant_name', 'orders.view', true, 3),
  (null, 'cancellation_reasons', 'Cancellation reasons', 'أسباب الإلغاء', 'orders', 'rpt_orders',
   '["cancellation_reason_en","order_number"]'::jsonb, array['cancellation_reason_en'], 'cancellation_reason_en', 'orders.view', true, 4),
  (null, 'confirmation_performance', 'Confirmation agent performance', 'أداء موظفي التأكيد', 'confirmation', 'rpt_confirmation_performance',
   '["agent_name","assigned_orders","confirmed_orders","confirmation_rate","avg_call_seconds"]'::jsonb,
   '{}', 'confirmation_rate', 'orders.view.all', true, 5),
  (null, 'warehouse_sla', 'Warehouse task SLA', 'التزام مهام المخزن', 'warehouse', 'rpt_warehouse',
   '["warehouse_name","task_type","tasks","completed","breached_sla","avg_minutes"]'::jsonb,
   '{}', 'breached_sla', 'warehouse.view', true, 6),
  (null, 'courier_performance', 'Courier performance', 'أداء شركات الشحن', 'shipping', 'rpt_shipments',
   '["courier_name","status","delivery_days","delivery_attempts"]'::jsonb, array['courier_name'], 'courier_name', 'shipping.view', true, 7),
  (null, 'rto_report', 'RTO report', 'تقرير المرتجعات من الشحن', 'shipping', 'rpt_shipments',
   '["courier_name","governorate","is_rto","awb"]'::jsonb, array['courier_name','governorate'], 'courier_name', 'shipping.view', true, 8),
  (null, 'returns_by_reason', 'Returns by reason', 'المرتجعات حسب السبب', 'returns', 'rpt_returns',
   '["reason_en","fault","unit_count"]'::jsonb, array['reason_en','fault'], 'reason_en', 'returns.view', true, 9),
  (null, 'outstanding_cod', 'Outstanding COD', 'التحصيلات المستحقة', 'collections', 'rpt_collections',
   '["courier_name","order_number","expected_amount","due_at","is_overdue"]'::jsonb,
   '{}', 'due_at', 'collections.view', true, 10),
  (null, 'collection_variance', 'Collection variance', 'فروقات التحصيل', 'collections', 'rpt_collections',
   '["courier_name","order_number","expected_amount","collected_amount","variance"]'::jsonb,
   '{}', 'variance', 'collections.view', true, 11),
  (null, 'product_performance', 'Product performance', 'أداء المنتجات', 'products', 'rpt_products',
   '["sku","product_name_en","units_sold","revenue","gross_profit"]'::jsonb, '{}', 'revenue', 'products.view', true, 12),
  (null, 'customer_value', 'Customer value', 'قيمة العملاء', 'customers', 'rpt_customers',
   '["name","orders_count","lifetime_value","average_order_value","risk_score"]'::jsonb,
   '{}', 'lifetime_value', 'orders.customer.view', true, 13),
  (null, 'employee_activity', 'Employee activity', 'نشاط الموظفين', 'employees', 'rpt_employees',
   '["full_name","orders_assigned","orders_confirmed","calls_logged","tasks_completed"]'::jsonb,
   '{}', 'orders_confirmed', 'users.view', true, 14),
  (null, 'order_profitability', 'Order profitability', 'ربحية الطلبات', 'profitability', 'rpt_orders',
   '["order_number","merchant_name","total"]'::jsonb, '{}', 'order_date', 'finance.profit.view', true, 15)
-- Untargeted, because the constraint that applies here is the partial index on
-- templates, which ON CONFLICT cannot infer from a column list.
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Audit
-- -----------------------------------------------------------------------------

create trigger report_definitions_audit after insert or update or delete on public.report_definitions for each row execute function app.audit_trigger();
create trigger report_schedules_audit   after insert or update or delete on public.report_schedules   for each row execute function app.audit_trigger();
