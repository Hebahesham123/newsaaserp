-- =============================================================================
-- Green ERP — 0017 Shipping RLS, permissions & seed data  (spec §6)
--
-- COD money is the sensitive surface here. Reading a collection is one
-- permission; reconciling a courier statement and approving a variance are two
-- more, deliberately separate, because §2.7.4 requires maker ≠ checker on
-- anything financial.
-- =============================================================================

alter table public.couriers                enable row level security;
alter table public.courier_zones           enable row level security;
alter table public.shipments               enable row level security;
alter table public.shipment_events         enable row level security;
alter table public.courier_instructions    enable row level security;
alter table public.delay_rules             enable row level security;
alter table public.return_reasons          enable row level security;
alter table public.returns                 enable row level security;
alter table public.return_items            enable row level security;
alter table public.cod_collections         enable row level security;
alter table public.courier_statements      enable row level security;
alter table public.courier_statement_lines enable row level security;

-- -----------------------------------------------------------------------------
-- Permissions — §6
-- -----------------------------------------------------------------------------

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('shipping.view',              'shipping', 'shipments',        'view',      'View shipments',              'عرض الشحنات',                     false, false, 4000),
  ('shipping.create',            'shipping', 'shipments',        'create',    'Create shipment / AWB',       'إنشاء شحنة',                      false, false, 4001),
  ('shipping.update',            'shipping', 'shipments',        'edit',      'Update shipment status',      'تحديث حالة الشحنة',               false, false, 4002),
  ('shipping.cancel',            'shipping', 'shipments',        'configure', 'Cancel shipment',             'إلغاء الشحنة',                    false, false, 4003),
  ('shipping.instructions',      'shipping', 'instructions',     'create',    'Send courier instructions',   'إرسال إفادات لشركة الشحن',        false, false, 4004),
  ('couriers.view',              'shipping', 'couriers',         'view',      'View couriers',               'عرض شركات الشحن',                 false, false, 4005),
  ('couriers.manage',            'shipping', 'couriers',         'configure', 'Manage couriers and rates',   'إدارة شركات الشحن والأسعار',      true,  false, 4006),
  ('couriers.scorecard.view',    'shipping', 'courier_scorecard','view',      'View courier performance',    'عرض أداء شركات الشحن',            false, false, 4007),
  ('returns.view',               'shipping', 'returns',          'view',      'View returns',                'عرض المرتجعات',                   false, false, 4008),
  ('returns.create',             'shipping', 'returns',          'create',    'Register a return',           'تسجيل مرتجع',                     false, false, 4009),
  ('returns.inspect',            'shipping', 'return_inspection','approve',   'Inspect and dispose returns', 'فحص المرتجعات وتحديد الإجراء',    false, false, 4010),
  ('returns.reasons.manage',     'shipping', 'return_reasons',   'configure', 'Manage return reasons',       'إدارة أسباب المرتجع',             false, false, 4011),
  ('collections.view',           'shipping', 'collections',      'view',      'View COD collections',        'عرض التحصيلات',                   true,  false, 4012),
  ('collections.record',         'shipping', 'collections',      'edit',      'Record a collection',         'تسجيل تحصيل',                     true,  false, 4013),
  ('collections.reconcile',      'shipping', 'reconciliation',   'configure', 'Reconcile courier statements','تسوية كشوف شركات الشحن',          true,  false, 4014),
  ('collections.approve',        'shipping', 'reconciliation',   'approve',   'Approve settlement variance', 'اعتماد فروقات التسوية',           true,  true,  4015),
  ('shipping.delays.manage',     'shipping', 'delay_rules',      'configure', 'Manage delay rules',          'إدارة قواعد التأخير',             false, false, 4016)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Role grants
-- -----------------------------------------------------------------------------

select app.grant_perms_to_template('super_admin',   array['*']);
select app.grant_perms_to_template('system_admin',  array['shipping.*', 'couriers.*', 'returns.*', 'collections.*']);
select app.grant_perms_to_template('company_admin', array['shipping.*', 'couriers.*', 'returns.*', 'collections.*']);

select app.grant_perms_to_template('operations_manager', array[
  'shipping.*', 'couriers.view', 'couriers.manage', 'couriers.scorecard.view',
  'returns.*', 'collections.view', 'collections.record', 'collections.reconcile'
]);

select app.grant_perms_to_template('warehouse_manager', array[
  'shipping.view', 'shipping.create', 'shipping.update', 'shipping.instructions',
  'couriers.view', 'returns.view', 'returns.create', 'returns.inspect'
]);

-- §6.8 inspection is this role's whole job.
select app.grant_perms_to_template('returns_agent', array[
  'shipping.view', 'returns.view', 'returns.create', 'returns.inspect', 'couriers.view'
]);

select app.grant_perms_to_template('packer',            array['shipping.view', 'shipping.create', 'couriers.view']);
select app.grant_perms_to_template('picker',            array['shipping.view']);
select app.grant_perms_to_template('receiving_agent',   array['shipping.view', 'returns.view']);
select app.grant_perms_to_template('inventory_controller', array['shipping.view', 'returns.view', 'returns.inspect']);

select app.grant_perms_to_template('customer_service_agent', array[
  'shipping.view', 'shipping.instructions', 'returns.view', 'returns.create', 'couriers.view'
]);

select app.grant_perms_to_template('confirmation_agent',       array['shipping.view']);
select app.grant_perms_to_template('confirmation_team_leader', array['shipping.view', 'shipping.instructions', 'returns.view']);

-- Finance reconciles and approves; it does not create shipments.
select app.grant_perms_to_template('accountant', array[
  'shipping.view', 'couriers.view', 'couriers.scorecard.view', 'returns.view',
  'collections.view', 'collections.record', 'collections.reconcile'
]);

select app.grant_perms_to_template('merchant_admin', array[
  'shipping.view', 'couriers.view', 'couriers.scorecard.view', 'returns.view', 'collections.view'
]);

select app.grant_perms_to_template('store_manager',   array['shipping.view', 'returns.view']);
select app.grant_perms_to_template('marketing_manager', array['shipping.view']);
select app.grant_perms_to_template('quality_auditor', array['shipping.view', 'returns.view', 'collections.view', 'couriers.scorecard.view']);
select app.grant_perms_to_template('reports_viewer',  array['shipping.view', 'returns.view', 'couriers.scorecard.view']);
select app.grant_perms_to_template('api_user',        array['shipping.view', 'shipping.update']);

-- -----------------------------------------------------------------------------
-- Policies
-- -----------------------------------------------------------------------------

create policy couriers_select on public.couriers
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('couriers.view'));

create policy couriers_write on public.couriers
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('couriers.manage'))
  with check (app.same_company(company_id) and app.has_perm('couriers.manage'));

create policy courier_zones_select on public.courier_zones
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('couriers.view'));

create policy courier_zones_write on public.courier_zones
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('couriers.manage'))
  with check (app.same_company(company_id) and app.has_perm('couriers.manage'));

create policy shipments_select on public.shipments
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('shipping.view')
  );

create policy shipments_write on public.shipments
  for all to authenticated
  using (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and (app.has_perm('shipping.create') or app.has_perm('shipping.update') or app.has_perm('shipping.cancel'))
  )
  with check (app.same_company(company_id) and app.in_scope('merchant', merchant_id));

-- History follows the shipment and is never editable.
create policy shipment_events_select on public.shipment_events
  for select to authenticated
  using (exists (
    select 1 from public.shipments s
    where s.id = shipment_id
      and app.same_company(s.company_id)
      and app.in_scope('merchant', s.merchant_id)
      and app.has_perm('shipping.view')
  ));

-- Manual status corrections (§6.4) are the one client-written event.
create policy shipment_events_insert on public.shipment_events
  for insert to authenticated
  with check (
    app.has_perm('shipping.update')
    and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and app.same_company(s.company_id)
    )
  );

create policy courier_instructions_select on public.courier_instructions
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('shipping.view'));

create policy courier_instructions_write on public.courier_instructions
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('shipping.instructions'))
  with check (app.same_company(company_id) and app.has_perm('shipping.instructions'));

create policy delay_rules_select on public.delay_rules
  for select to authenticated using (app.same_company(company_id));

create policy delay_rules_write on public.delay_rules
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('shipping.delays.manage'))
  with check (app.same_company(company_id) and app.has_perm('shipping.delays.manage'));

create policy return_reasons_select on public.return_reasons
  for select to authenticated using (app.same_company(company_id));

create policy return_reasons_write on public.return_reasons
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('returns.reasons.manage'))
  with check (app.same_company(company_id) and app.has_perm('returns.reasons.manage'));

create policy returns_select on public.returns
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('returns.view')
  );

create policy returns_write on public.returns
  for all to authenticated
  using (
    app.same_company(company_id)
    and (app.has_perm('returns.create') or app.has_perm('returns.inspect'))
  )
  with check (app.same_company(company_id) and app.in_scope('merchant', merchant_id));

create policy return_items_select on public.return_items
  for select to authenticated
  using (exists (
    select 1 from public.returns r
    where r.id = return_id
      and app.same_company(r.company_id)
      and app.in_scope('merchant', r.merchant_id)
      and app.has_perm('returns.view')
  ));

create policy return_items_write on public.return_items
  for all to authenticated
  using (exists (
    select 1 from public.returns r
    where r.id = return_id
      and app.same_company(r.company_id)
      and (app.has_perm('returns.create') or app.has_perm('returns.inspect'))
  ))
  with check (exists (
    select 1 from public.returns r
    where r.id = return_id
      and app.same_company(r.company_id)
      and (app.has_perm('returns.create') or app.has_perm('returns.inspect'))
  ));

-- §2.7.2 collections are money: reading them is its own sensitive permission.
create policy cod_collections_select on public.cod_collections
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('collections.view')
  );

create policy cod_collections_write on public.cod_collections
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('collections.record'))
  with check (app.same_company(company_id) and app.has_perm('collections.record'));

create policy courier_statements_select on public.courier_statements
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('collections.view'));

create policy courier_statements_write on public.courier_statements
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('collections.reconcile'))
  with check (app.same_company(company_id) and app.has_perm('collections.reconcile'));

create policy courier_statement_lines_select on public.courier_statement_lines
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('collections.view'));

create policy courier_statement_lines_write on public.courier_statement_lines
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('collections.reconcile'))
  with check (app.same_company(company_id) and app.has_perm('collections.reconcile'));

-- -----------------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------------

alter view public.delayed_shipments  set (security_invoker = on);
alter view public.courier_scorecard  set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Grants — no DELETE on anything with financial or delivery history.
-- -----------------------------------------------------------------------------

grant select, insert, update on
  public.couriers, public.courier_zones, public.shipments, public.courier_instructions,
  public.delay_rules, public.return_reasons, public.returns, public.return_items,
  public.cod_collections, public.courier_statements, public.courier_statement_lines
to authenticated;

grant select, insert on public.shipment_events to authenticated;
grant select on public.delayed_shipments, public.courier_scorecard to authenticated;

grant usage on sequence
  public.shipment_number_seq, public.return_number_seq, public.statement_number_seq
to authenticated;

grant execute on function public.apply_return_disposition(uuid) to authenticated;
grant execute on function public.reconcile_courier_statement(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Backfill role clones for existing companies.
-- -----------------------------------------------------------------------------

do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_roles(v_company);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- §6.9 / §6.6 configurable starting sets, per company.
-- -----------------------------------------------------------------------------

create or replace function app.provision_company_shipping_defaults(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.return_reasons (company_id, code, name_en, name_ar, fault, sort_order)
  select p_company_id, r.code, r.name_en, r.name_ar, r.fault, r.ord
  from (values
    ('customer_refused',   'Customer refused delivery', 'العميل رفض الاستلام',    'customer',  1),
    ('customer_absent',    'Customer unavailable',      'العميل غير متواجد',      'customer',  2),
    ('wrong_address',      'Incorrect address',         'العنوان غير صحيح',       'customer',  3),
    ('wrong_phone',        'Incorrect phone number',    'رقم الهاتف غير صحيح',    'customer',  4),
    ('late_delivery',      'Delivery was late',         'تأخير في التوصيل',       'courier',   5),
    ('not_as_described',   'Product not as described',  'المنتج غير مطابق',       'merchant',  6),
    ('damaged',            'Product damaged',           'المنتج تالف',            'product',   7),
    ('wrong_size',         'Wrong size',                'المقاس غير مناسب',       'customer',  8),
    ('wrong_colour',       'Wrong colour',              'اللون غير مناسب',        'customer',  9),
    ('courier_error',      'Courier error',             'خطأ من شركة الشحن',      'courier',  10),
    ('warehouse_error',    'Warehouse error',           'خطأ من المخزن',          'warehouse', 11),
    ('other',              'Other reason',              'سبب آخر',                'other',    12)
  ) as r(code, name_en, name_ar, fault, ord)
  on conflict (company_id, code) do nothing;

  -- §6.6 the spec's own worked examples, as editable rules.
  insert into public.delay_rules (company_id, code, name_en, name_ar, applies_to_status, threshold_hours, max_attempts, severity)
  select p_company_id, d.code, d.name_en, d.name_ar, d.status::public.shipment_status, d.hours, d.attempts, d.severity::public.notification_severity
  from (values
    ('no_pickup_24h',  'Not picked up within 24h',      'لم يتم الاستلام خلال 24 ساعة',  'ready_to_ship', 24,  null, 'warning'),
    ('no_movement_48h','No movement for 48h',           'بدون حركة لمدة 48 ساعة',        null,            48,  null, 'warning'),
    ('in_city_72h',    'In governorate over 72h',       'داخل المحافظة أكثر من 72 ساعة', 'in_transit',    72,  null, 'critical'),
    ('attempts_3',     'More than 3 delivery attempts', 'أكثر من 3 محاولات تسليم',       null,             1,     3, 'critical')
  ) as d(code, name_en, name_ar, status, hours, attempts, severity)
  on conflict (company_id, code) do nothing;
end;
$$;

create or replace function app.provision_shipping_defaults_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.provision_company_shipping_defaults(new.id);
  return new;
end;
$$;

create trigger companies_provision_shipping_defaults
  after insert on public.companies
  for each row execute function app.provision_shipping_defaults_trigger();

do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_shipping_defaults(v_company);
  end loop;
end $$;
