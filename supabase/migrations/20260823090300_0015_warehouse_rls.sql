-- =============================================================================
-- Green ERP — 0015 Warehouse RLS, permissions & seed data  (spec §5)
--
-- Access here is scoped by *warehouse* as well as by company and merchant: a
-- picker at the Cairo warehouse has no business reading Alexandria's stock.
-- `app.can_access_warehouse` already exists from Phase 1 and is used throughout.
--
-- No client role is granted UPDATE or DELETE on `inventory_ledger` (§5.10).
-- =============================================================================

alter table public.warehouse_locations enable row level security;
alter table public.inventory_ledger    enable row level security;
alter table public.inventory_levels    enable row level security;
alter table public.goods_receipts      enable row level security;
alter table public.goods_receipt_items enable row level security;
alter table public.warehouse_tasks     enable row level security;
alter table public.pick_lists          enable row level security;
alter table public.pick_list_items     enable row level security;
alter table public.packing_materials   enable row level security;
alter table public.packages            enable row level security;
alter table public.package_items       enable row level security;
alter table public.fulfillment_fees    enable row level security;

-- -----------------------------------------------------------------------------
-- Permissions — §5
-- -----------------------------------------------------------------------------

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('warehouse.view',             'warehouse', 'warehouse_dashboard', 'view',      'View warehouse',              'عرض المخزن',                      false, false, 3000),
  ('warehouse.locations.manage', 'warehouse', 'locations',           'configure', 'Manage locations',            'إدارة المواقع',                   false, false, 3001),
  ('inventory.view',             'warehouse', 'inventory',           'view',      'View inventory',              'عرض المخزون',                     false, false, 3002),
  ('inventory.receive',          'warehouse', 'receiving',           'create',    'Receive goods',               'استلام البضاعة',                  false, false, 3003),
  ('inventory.qc',               'warehouse', 'quality_check',       'approve',   'Quality check',               'فحص الجودة',                      false, false, 3004),
  ('inventory.putaway',          'warehouse', 'put_away',            'create',    'Put away stock',              'تخزين المنتجات',                  false, false, 3005),
  ('inventory.adjust',           'warehouse', 'adjustments',         'edit',      'Adjust stock',                'تسوية المخزون',                   true,  true,  3006),
  ('inventory.transfer',         'warehouse', 'transfers',           'create',    'Transfer between warehouses', 'التحويل بين المخازن',             false, true,  3007),
  ('inventory.count',            'warehouse', 'stock_count',         'create',    'Stock counting',              'الجرد',                           false, false, 3008),
  ('inventory.ledger.view',      'warehouse', 'inventory_ledger',    'view',      'View inventory ledger',       'عرض حركات المخزون',               false, false, 3009),
  ('warehouse.tasks.view',       'warehouse', 'tasks',               'view',      'View warehouse tasks',        'عرض مهام المخزن',                 false, false, 3010),
  ('warehouse.tasks.assign',     'warehouse', 'tasks',               'configure', 'Assign warehouse tasks',      'توزيع مهام المخزن',               false, false, 3011),
  ('warehouse.pick',             'warehouse', 'picking',             'create',    'Pick orders',                 'تجهيز الطلبات',                   false, false, 3012),
  ('warehouse.pack',             'warehouse', 'packing',             'create',    'Pack orders',                 'تغليف الطلبات',                   false, false, 3013),
  ('warehouse.dispatch',         'warehouse', 'dispatch',            'approve',   'Hand over to courier',        'تسليم شركة الشحن',                false, false, 3014),
  ('warehouse.fees.manage',      'warehouse', 'fulfillment_fees',    'configure', 'Manage fulfillment fees',     'إدارة أسعار خدمات التنفيذ',       true,  false, 3015),
  ('warehouse.productivity.view','warehouse', 'productivity',        'view',      'View staff productivity',     'عرض إنتاجية الموظفين',            false, false, 3016)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Role grants (§2.6.2)
-- -----------------------------------------------------------------------------

select app.grant_perms_to_template('super_admin',   array['*']);
select app.grant_perms_to_template('system_admin',  array['warehouse.*', 'inventory.*']);
select app.grant_perms_to_template('company_admin', array['warehouse.*', 'inventory.*']);

select app.grant_perms_to_template('operations_manager', array['warehouse.*', 'inventory.*']);
select app.grant_perms_to_template('warehouse_manager',  array['warehouse.*', 'inventory.*']);

select app.grant_perms_to_template('inventory_controller', array[
  'warehouse.view', 'inventory.view', 'inventory.receive', 'inventory.qc',
  'inventory.putaway', 'inventory.adjust', 'inventory.transfer', 'inventory.count',
  'inventory.ledger.view', 'warehouse.tasks.view'
]);

select app.grant_perms_to_template('receiving_agent', array[
  'warehouse.view', 'inventory.view', 'inventory.receive', 'inventory.putaway',
  'warehouse.tasks.view'
]);

-- A picker sees stock and their own tasks; they do not adjust inventory.
select app.grant_perms_to_template('picker', array[
  'warehouse.view', 'inventory.view', 'warehouse.tasks.view', 'warehouse.pick'
]);

select app.grant_perms_to_template('packer', array[
  'warehouse.view', 'inventory.view', 'warehouse.tasks.view', 'warehouse.pack'
]);

select app.grant_perms_to_template('returns_agent', array[
  'warehouse.view', 'inventory.view', 'inventory.receive', 'warehouse.tasks.view'
]);

select app.grant_perms_to_template('merchant_admin', array[
  'warehouse.view', 'inventory.view', 'inventory.ledger.view'
]);

select app.grant_perms_to_template('store_manager',   array['inventory.view']);
select app.grant_perms_to_template('accountant',      array['inventory.view', 'inventory.ledger.view']);
select app.grant_perms_to_template('quality_auditor', array['warehouse.view', 'inventory.view', 'inventory.ledger.view', 'warehouse.productivity.view']);
select app.grant_perms_to_template('reports_viewer',  array['warehouse.view', 'inventory.view']);
select app.grant_perms_to_template('api_user',        array['inventory.view']);

-- -----------------------------------------------------------------------------
-- Policies
--
-- The shared shape: same company, warehouse in scope, and the right permission.
-- -----------------------------------------------------------------------------

create policy warehouse_locations_select on public.warehouse_locations
  for select to authenticated
  using (app.same_company(company_id) and app.can_access_warehouse(warehouse_id) and app.has_perm('warehouse.view'));

create policy warehouse_locations_write on public.warehouse_locations
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('warehouse.locations.manage'))
  with check (app.same_company(company_id) and app.has_perm('warehouse.locations.manage'));

-- §5.10 read-only to clients. Rows are written through post_inventory_movement,
-- which is SECURITY DEFINER and enforces its own tenant check.
create policy inventory_ledger_select on public.inventory_ledger
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.can_access_warehouse(warehouse_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('inventory.ledger.view')
  );

create policy inventory_levels_select on public.inventory_levels
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.can_access_warehouse(warehouse_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('inventory.view')
  );

-- Only the reorder point is client-editable; the buckets are derived (§5.8).
create policy inventory_levels_update on public.inventory_levels
  for update to authenticated
  using (app.same_company(company_id) and app.has_perm('inventory.adjust'))
  with check (app.same_company(company_id) and app.has_perm('inventory.adjust'));

create policy goods_receipts_select on public.goods_receipts
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.can_access_warehouse(warehouse_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('inventory.view')
  );

create policy goods_receipts_write on public.goods_receipts
  for all to authenticated
  using (app.same_company(company_id) and app.can_access_warehouse(warehouse_id) and app.has_perm('inventory.receive'))
  with check (app.same_company(company_id) and app.has_perm('inventory.receive'));

create policy goods_receipt_items_select on public.goods_receipt_items
  for select to authenticated
  using (exists (
    select 1 from public.goods_receipts r
    where r.id = receipt_id
      and app.same_company(r.company_id)
      and app.can_access_warehouse(r.warehouse_id)
      and app.has_perm('inventory.view')
  ));

create policy goods_receipt_items_write on public.goods_receipt_items
  for all to authenticated
  using (exists (
    select 1 from public.goods_receipts r
    where r.id = receipt_id
      and app.same_company(r.company_id)
      and (app.has_perm('inventory.receive') or app.has_perm('inventory.qc'))
  ))
  with check (exists (
    select 1 from public.goods_receipts r
    where r.id = receipt_id
      and app.same_company(r.company_id)
      and (app.has_perm('inventory.receive') or app.has_perm('inventory.qc'))
  ));

-- §5.11 a warehouse operative sees the tasks assigned to them; a supervisor
-- with the assign permission sees the whole board.
create policy warehouse_tasks_select on public.warehouse_tasks
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.can_access_warehouse(warehouse_id)
    and app.has_perm('warehouse.tasks.view')
    and (app.has_perm('warehouse.tasks.assign') or assigned_to = app.uid() or assigned_to is null)
  );

create policy warehouse_tasks_write on public.warehouse_tasks
  for all to authenticated
  using (
    app.same_company(company_id)
    and (app.has_perm('warehouse.tasks.assign') or assigned_to = app.uid())
  )
  with check (app.same_company(company_id));

create policy pick_lists_select on public.pick_lists
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.can_access_warehouse(warehouse_id)
    and app.has_perm('warehouse.tasks.view')
  );

create policy pick_lists_write on public.pick_lists
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('warehouse.pick'))
  with check (app.same_company(company_id) and app.has_perm('warehouse.pick'));

create policy pick_list_items_select on public.pick_list_items
  for select to authenticated
  using (exists (
    select 1 from public.pick_lists l
    where l.id = pick_list_id
      and app.same_company(l.company_id)
      and app.can_access_warehouse(l.warehouse_id)
      and app.has_perm('warehouse.tasks.view')
  ));

create policy pick_list_items_write on public.pick_list_items
  for all to authenticated
  using (exists (
    select 1 from public.pick_lists l
    where l.id = pick_list_id and app.same_company(l.company_id) and app.has_perm('warehouse.pick')
  ))
  with check (exists (
    select 1 from public.pick_lists l
    where l.id = pick_list_id and app.same_company(l.company_id) and app.has_perm('warehouse.pick')
  ));

create policy packing_materials_select on public.packing_materials
  for select to authenticated using (app.same_company(company_id));

create policy packing_materials_write on public.packing_materials
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('warehouse.locations.manage'))
  with check (app.same_company(company_id) and app.has_perm('warehouse.locations.manage'));

create policy packages_select on public.packages
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.can_access_warehouse(warehouse_id)
    and app.has_perm('warehouse.view')
  );

create policy packages_write on public.packages
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('warehouse.pack'))
  with check (app.same_company(company_id) and app.has_perm('warehouse.pack'));

create policy package_items_select on public.package_items
  for select to authenticated
  using (exists (
    select 1 from public.packages p
    where p.id = package_id and app.same_company(p.company_id) and app.has_perm('warehouse.view')
  ));

create policy package_items_write on public.package_items
  for all to authenticated
  using (exists (
    select 1 from public.packages p
    where p.id = package_id and app.same_company(p.company_id) and app.has_perm('warehouse.pack')
  ))
  with check (exists (
    select 1 from public.packages p
    where p.id = package_id and app.same_company(p.company_id) and app.has_perm('warehouse.pack')
  ));

-- §5.20 fee schedules are commercial terms; reading them is merchant-scoped and
-- writing them is a manager's job.
create policy fulfillment_fees_select on public.fulfillment_fees
  for select to authenticated
  using (app.same_company(company_id) and app.in_scope('merchant', merchant_id));

create policy fulfillment_fees_write on public.fulfillment_fees
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('warehouse.fees.manage'))
  with check (app.same_company(company_id) and app.has_perm('warehouse.fees.manage'));

-- -----------------------------------------------------------------------------
-- Views inherit the caller's policies.
-- -----------------------------------------------------------------------------

alter view public.stock_on_hand          set (security_invoker = on);
alter view public.warehouse_productivity set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Grants. The ledger is SELECT-only; movements go through the function.
-- -----------------------------------------------------------------------------

grant select, insert, update on
  public.warehouse_locations, public.goods_receipts, public.goods_receipt_items,
  public.warehouse_tasks, public.pick_lists, public.pick_list_items,
  public.packing_materials, public.packages, public.fulfillment_fees
to authenticated;

grant select, insert, delete on public.package_items to authenticated;

grant select on public.inventory_ledger to authenticated;
grant select, update on public.inventory_levels to authenticated;
grant select on public.stock_on_hand, public.warehouse_productivity to authenticated;

grant usage on sequence
  public.inventory_txn_seq, public.receipt_number_seq,
  public.warehouse_task_seq, public.pick_list_seq, public.package_number_seq
to authenticated;

grant execute on function public.post_inventory_movement(
  uuid, uuid, public.inventory_txn_type, numeric,
  public.inventory_bucket, public.inventory_bucket, text, uuid, uuid, text
) to authenticated;
grant execute on function public.reserve_order_stock(uuid, uuid) to authenticated;
grant execute on function public.release_order_stock(uuid, uuid) to authenticated;
grant execute on function public.put_away_receipt_item(uuid, uuid) to authenticated;
grant execute on function public.confirm_pick(uuid, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- Backfill: existing companies' cloned roles need the new permissions.
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
-- §5.16 a starting set of packing materials per company.
-- -----------------------------------------------------------------------------

create or replace function app.provision_company_warehouse_defaults(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.packing_materials (company_id, code, name, unit_cost, max_weight_kg)
  select p_company_id, m.code, m.name, m.cost, m.max_kg
  from (values
    ('BOX-S',   'Small box',    3.50, 2.0),
    ('BOX-M',   'Medium box',   5.00, 8.0),
    ('BOX-L',   'Large box',    8.00, 20.0),
    ('FLYER',   'Poly mailer',  1.75, 1.0),
    ('BUBBLE',  'Bubble wrap',  0.90, null)
  ) as m(code, name, cost, max_kg)
  on conflict (company_id, code) do nothing;
end;
$$;

create or replace function app.provision_warehouse_defaults_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.provision_company_warehouse_defaults(new.id);
  return new;
end;
$$;

create trigger companies_provision_warehouse_defaults
  after insert on public.companies
  for each row execute function app.provision_warehouse_defaults_trigger();

do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_warehouse_defaults(v_company);
  end loop;
end $$;
