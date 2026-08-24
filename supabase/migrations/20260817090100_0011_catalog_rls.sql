-- =============================================================================
-- Green ERP — 0011 Catalog RLS, permissions and grants  (spec §3.12, §3.13)
--
-- §3.13 rule 19: "A merchant must not access another merchant's products." So
-- every policy below is company-scoped AND merchant-scoped: the merchant data
-- scope from §2.7.1 is what keeps two merchants inside one company apart.
-- =============================================================================

alter table public.brands                   enable row level security;
alter table public.categories               enable row level security;
alter table public.units_of_measure         enable row level security;
alter table public.suppliers                enable row level security;
alter table public.collections              enable row level security;
alter table public.product_attributes       enable row level security;
alter table public.products                 enable row level security;
alter table public.product_variants         enable row level security;
alter table public.product_collections      enable row level security;
alter table public.product_channel_mappings enable row level security;
alter table public.product_prices           enable row level security;
alter table public.product_costs            enable row level security;
alter table public.bundle_components        enable row level security;
alter table public.price_history            enable row level security;

-- -----------------------------------------------------------------------------
-- New permissions — §3.12.  Each is independently grantable, as required.
-- -----------------------------------------------------------------------------

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('products.view',            'products', 'product_list',    'view',      'View products',               'عرض المنتجات',                    false, false, 1000),
  ('products.create',          'products', 'product_form',    'create',    'Create product',              'إنشاء منتج',                      false, false, 1001),
  ('products.edit',            'products', 'product_form',    'edit',      'Edit product',                'تعديل منتج',                      false, false, 1002),
  ('products.archive',         'products', 'product_list',    'archive',   'Archive product',             'أرشفة منتج',                      false, true,  1003),
  ('products.status',          'products', 'product_list',    'configure', 'Change product status',       'تغيير حالة المنتج',               false, false, 1004),
  ('products.approve',         'products', 'product_list',    'approve',   'Approve products',            'اعتماد المنتجات',                 false, false, 1005),
  ('products.price.edit',      'products', 'pricing',         'edit',      'Change prices',               'تعديل الأسعار',                   true,  false, 1006),
  ('products.cost.view',       'products', 'costs',           'view',      'View costs',                  'عرض التكلفة',                     true,  false, 1007),
  ('products.cost.edit',       'products', 'costs',           'edit',      'Edit costs',                  'تعديل التكلفة',                   true,  true,  1008),
  ('products.map',             'products', 'channel_mapping', 'configure', 'Map products to channels',    'ربط المنتج بقنوات البيع',         false, false, 1009),
  ('products.import',          'products', 'product_import',  'create',    'Import products',             'استيراد المنتجات',                false, false, 1010),
  ('products.export',          'products', 'product_list',    'export',    'Export products',             'تصدير المنتجات',                  false, false, 1011),
  ('products.bundles.manage',  'products', 'bundles',         'configure', 'Manage bundles and kits',     'إدارة الحزم والمجموعات',          false, false, 1012),
  ('products.identifiers.edit','products', 'product_form',    'edit',      'Edit barcodes and SKUs',      'تعديل الباركود والكود',           true,  false, 1013),
  ('products.price.history',   'products', 'price_history',   'view',      'View price history',          'عرض سجل تغير الأسعار',            true,  false, 1014),
  ('catalog.manage',           'products', 'catalog',         'configure', 'Manage brands and categories','إدارة العلامات والتصنيفات',       false, false, 1015),
  ('suppliers.view',           'products', 'suppliers',       'view',      'View suppliers',              'عرض الموردين',                    false, false, 1016),
  ('suppliers.manage',         'products', 'suppliers',       'configure', 'Manage suppliers',            'إدارة الموردين',                  false, false, 1017)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Extend the default roles (§2.6.2) with the catalog permissions each needs.
-- grant_perms_to_template is idempotent, so re-granting the wildcards is safe.
-- -----------------------------------------------------------------------------

select app.grant_perms_to_template('super_admin',  array['*']);
select app.grant_perms_to_template('system_admin', array['products.*', 'catalog.*', 'suppliers.*']);
select app.grant_perms_to_template('company_admin', array['products.*', 'catalog.*', 'suppliers.*']);

-- A merchant admin runs their own catalog, but cost visibility stays separate
-- (§2.7.2 keeps every financial permission independently grantable).
select app.grant_perms_to_template('merchant_admin', array[
  'products.view', 'products.create', 'products.edit', 'products.status',
  'products.price.edit', 'products.map', 'products.import', 'products.export',
  'products.bundles.manage', 'products.price.history', 'catalog.manage', 'suppliers.view'
]);

select app.grant_perms_to_template('store_manager', array[
  'products.view', 'products.edit', 'products.map', 'products.export', 'catalog.manage'
]);

select app.grant_perms_to_template('operations_manager', array[
  'products.view', 'products.edit', 'products.status', 'products.export',
  'products.map', 'catalog.manage', 'suppliers.view'
]);

-- Warehouse and inventory staff read the catalog; they do not price it.
select app.grant_perms_to_template('warehouse_manager',    array['products.view', 'products.export', 'suppliers.view']);
select app.grant_perms_to_template('inventory_controller', array['products.view', 'products.edit', 'products.export', 'suppliers.view', 'suppliers.manage']);
select app.grant_perms_to_template('receiving_agent',      array['products.view', 'suppliers.view']);
select app.grant_perms_to_template('picker',               array['products.view']);
select app.grant_perms_to_template('packer',               array['products.view']);
select app.grant_perms_to_template('returns_agent',        array['products.view']);

-- Confirmation and service staff need to see what was ordered, nothing more.
select app.grant_perms_to_template('confirmation_team_leader', array['products.view']);
select app.grant_perms_to_template('confirmation_agent',       array['products.view']);
select app.grant_perms_to_template('customer_service_agent',   array['products.view']);

-- Finance reads cost and margin; it does not edit the catalog.
select app.grant_perms_to_template('accountant', array[
  'products.view', 'products.cost.view', 'products.price.history', 'products.export'
]);

select app.grant_perms_to_template('marketing_manager', array[
  'products.view', 'products.price.edit', 'products.price.history', 'catalog.manage', 'products.export'
]);

select app.grant_perms_to_template('quality_auditor', array['products.view', 'products.cost.view', 'products.price.history']);
select app.grant_perms_to_template('reports_viewer',  array['products.view']);
select app.grant_perms_to_template('api_user',        array['products.view', 'products.map']);

-- -----------------------------------------------------------------------------
-- Reference data — readable company-wide, written behind catalog.manage.
-- -----------------------------------------------------------------------------

create policy brands_select on public.brands
  for select to authenticated
  using (app.same_company(company_id) and app.can_access_merchant(merchant_id));

create policy brands_write on public.brands
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('catalog.manage'))
  with check (app.same_company(company_id) and app.has_perm('catalog.manage'));

create policy categories_select on public.categories
  for select to authenticated using (app.same_company(company_id));

create policy categories_write on public.categories
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('catalog.manage'))
  with check (app.same_company(company_id) and app.has_perm('catalog.manage'));

create policy units_select on public.units_of_measure
  for select to authenticated using (app.same_company(company_id));

create policy units_write on public.units_of_measure
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('catalog.manage'))
  with check (app.same_company(company_id) and app.has_perm('catalog.manage'));

create policy collections_select on public.collections
  for select to authenticated
  using (app.same_company(company_id) and app.can_access_merchant(merchant_id));

create policy collections_write on public.collections
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('catalog.manage'))
  with check (app.same_company(company_id) and app.has_perm('catalog.manage'));

create policy product_attributes_select on public.product_attributes
  for select to authenticated using (app.same_company(company_id));

create policy product_attributes_write on public.product_attributes
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('catalog.manage'))
  with check (app.same_company(company_id) and app.has_perm('catalog.manage'));

-- Suppliers carry their own permission pair — purchasing data is not catalog data.
create policy suppliers_select on public.suppliers
  for select to authenticated
  using (app.same_company(company_id) and app.can_access_merchant(merchant_id) and app.has_perm('suppliers.view'));

create policy suppliers_write on public.suppliers
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('suppliers.manage'))
  with check (app.same_company(company_id) and app.has_perm('suppliers.manage'));

-- -----------------------------------------------------------------------------
-- Products — §3.13 rule 19 enforced through in_scope('merchant', …)
-- -----------------------------------------------------------------------------

create policy products_select on public.products
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('products.view')
  );

create policy products_insert on public.products
  for insert to authenticated
  with check (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('products.create')
  );

create policy products_update on public.products
  for update to authenticated
  using (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('products.edit')
  )
  with check (app.same_company(company_id) and app.in_scope('merchant', merchant_id));

-- No DELETE policy: §3.13 rule 9 requires archiving, never deletion.

create policy product_variants_select on public.product_variants
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('products.view')
  );

create policy product_variants_write on public.product_variants
  for all to authenticated
  using (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('products.edit')
  )
  with check (
    app.same_company(company_id)
    and app.in_scope('merchant', merchant_id)
    and app.has_perm('products.edit')
  );

-- A product's own visibility decides its collection membership visibility.
create policy product_collections_select on public.product_collections
  for select to authenticated
  using (exists (
    select 1 from public.products p
    where p.id = product_id and app.same_company(p.company_id) and app.in_scope('merchant', p.merchant_id)
  ));

create policy product_collections_write on public.product_collections
  for all to authenticated
  using (exists (
    select 1 from public.products p
    where p.id = product_id and app.same_company(p.company_id) and app.in_scope('merchant', p.merchant_id)
  ) and app.has_perm('catalog.manage'))
  with check (exists (
    select 1 from public.products p
    where p.id = product_id and app.same_company(p.company_id) and app.in_scope('merchant', p.merchant_id)
  ) and app.has_perm('catalog.manage'));

-- -----------------------------------------------------------------------------
-- Channel mapping — §3.5.  Needs access to both the product and the store.
-- -----------------------------------------------------------------------------

create policy pcm_select on public.product_channel_mappings
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.can_access_store(store_id)
    and app.has_perm('products.view')
  );

create policy pcm_write on public.product_channel_mappings
  for all to authenticated
  using (
    app.same_company(company_id)
    and app.can_access_store(store_id)
    and app.has_perm('products.map')
  )
  with check (
    app.same_company(company_id)
    and app.can_access_store(store_id)
    and app.has_perm('products.map')
    and exists (
      select 1 from public.products p
      where p.id = product_id and app.in_scope('merchant', p.merchant_id)
    )
  );

-- -----------------------------------------------------------------------------
-- Prices and costs — separate permissions, per §2.7.2 and §3.12
-- -----------------------------------------------------------------------------

create policy product_prices_select on public.product_prices
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.has_perm('products.view')
    and exists (
      select 1 from public.products p
      where p.id = product_id and app.in_scope('merchant', p.merchant_id)
    )
  );

create policy product_prices_write on public.product_prices
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('products.price.edit'))
  with check (
    app.same_company(company_id)
    and app.has_perm('products.price.edit')
    and exists (
      select 1 from public.products p
      where p.id = product_id and app.in_scope('merchant', p.merchant_id)
    )
  );

-- Cost is sensitive: seeing it needs products.cost.view, not products.view.
create policy product_costs_select on public.product_costs
  for select to authenticated
  using (
    app.same_company(company_id)
    and app.has_perm('products.cost.view')
    and exists (
      select 1 from public.products p
      where p.id = product_id and app.in_scope('merchant', p.merchant_id)
    )
  );

create policy product_costs_write on public.product_costs
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('products.cost.edit'))
  with check (
    app.same_company(company_id)
    and app.has_perm('products.cost.edit')
    and exists (
      select 1 from public.products p
      where p.id = product_id and app.in_scope('merchant', p.merchant_id)
    )
  );

-- -----------------------------------------------------------------------------
-- Bundles — §3.9
-- -----------------------------------------------------------------------------

create policy bundle_components_select on public.bundle_components
  for select to authenticated
  using (exists (
    select 1 from public.products p
    where p.id = bundle_product_id
      and app.same_company(p.company_id)
      and app.in_scope('merchant', p.merchant_id)
      and app.has_perm('products.view')
  ));

create policy bundle_components_write on public.bundle_components
  for all to authenticated
  using (exists (
    select 1 from public.products p
    where p.id = bundle_product_id
      and app.same_company(p.company_id)
      and app.in_scope('merchant', p.merchant_id)
      and app.has_perm('products.bundles.manage')
  ))
  with check (exists (
    select 1 from public.products p
    where p.id = bundle_product_id
      and app.same_company(p.company_id)
      and app.in_scope('merchant', p.merchant_id)
      and app.has_perm('products.bundles.manage')
  ));

-- -----------------------------------------------------------------------------
-- Price history — append-only, written by triggers, read behind its own gate.
-- -----------------------------------------------------------------------------

create policy price_history_select on public.price_history
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('products.price.history'));

-- -----------------------------------------------------------------------------
-- Views inherit RLS from their base tables only with security_invoker.
-- -----------------------------------------------------------------------------

alter view public.mapped_variants    set (security_invoker = on);
alter view public.unmapped_products  set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Grants. RLS narrows rows; grants decide which verbs exist at all.
-- DELETE is granted only on the link tables, where removing a row is the whole
-- operation — everything else archives (§3.13 rule 9).
-- -----------------------------------------------------------------------------

grant select, insert, update on
  public.brands, public.categories, public.units_of_measure, public.suppliers,
  public.collections, public.product_attributes, public.products, public.product_variants
to authenticated;

grant select, insert, update, delete on
  public.product_collections, public.product_channel_mappings,
  public.product_prices, public.product_costs, public.bundle_components
to authenticated;

grant select on public.price_history, public.mapped_variants, public.unmapped_products to authenticated;

grant execute on function public.variant_sellable(uuid) to authenticated;
grant execute on function public.bundle_cost(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Backfill existing tenants.
--
-- grant_perms_to_template above only touches the platform templates. Companies
-- provisioned before this migration already hold cloned roles, so those clones
-- would never see the catalog permissions. provision_company_roles inserts only
-- what is missing, which makes re-running it per company exactly the backfill.
-- -----------------------------------------------------------------------------
do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_roles(v_company);
  end loop;
end $$;
