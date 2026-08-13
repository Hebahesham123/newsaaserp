-- =============================================================================
-- Green ERP — 0008 RBAC seed
-- Permission catalogue (§2.7) and the 24 default roles (§2.6.2).
-- =============================================================================

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  -- Companies (§2.2, §2.14)
  ('companies.view',              'companies', 'company_list',      'view',    'View companies',            'عرض الشركات',                     false, false, 100),
  ('companies.create',            'companies', 'company_form',      'create',  'Create company',            'إنشاء شركة',                      false, false, 101),
  ('companies.edit',              'companies', 'company_form',      'edit',    'Edit company',              'تعديل شركة',                      false, false, 102),
  ('companies.archive',           'companies', 'company_list',      'archive', 'Archive company',           'أرشفة شركة',                      false, true,  103),
  ('companies.settings',          'companies', 'company_settings',  'configure','Manage company settings',  'إدارة إعدادات الشركة',            false, false, 104),
  ('companies.export',            'companies', 'company_list',      'export',  'Export companies',          'تصدير الشركات',                   false, false, 105),
  ('subscriptions.manage',        'companies', 'subscriptions',     'configure','Manage subscriptions and plans','إدارة الاشتراكات والباقات',  false, false, 106),

  -- Merchants (§2.3)
  ('merchants.view',              'merchants', 'merchant_list',     'view',    'View merchants',            'عرض التجار',                      false, false, 200),
  ('merchants.create',            'merchants', 'merchant_form',     'create',  'Create merchant',           'إنشاء تاجر',                      false, false, 201),
  ('merchants.edit',              'merchants', 'merchant_form',     'edit',    'Edit merchant',             'تعديل تاجر',                      false, false, 202),
  ('merchants.archive',           'merchants', 'merchant_list',     'archive', 'Archive merchant',          'أرشفة تاجر',                      false, true,  203),
  ('merchants.onboard',           'merchants', 'merchant_onboarding','configure','Run merchant onboarding', 'إعداد تاجر جديد',                 false, false, 204),
  ('merchants.export',            'merchants', 'merchant_list',     'export',  'Export merchants',          'تصدير التجار',                    false, false, 205),
  ('merchants.pricing.view',      'merchants', 'merchant_detail',   'view',    'View merchant service pricing','عرض أسعار خدمات التاجر',       true,  false, 206),
  ('merchants.pricing.edit',      'merchants', 'merchant_detail',   'edit',    'Edit merchant service pricing','تعديل أسعار خدمات التاجر',     true,  true,  207),

  -- Stores (§2.4)
  ('stores.view',                 'stores',    'store_list',        'view',    'View stores',               'عرض المتاجر',                     false, false, 300),
  ('stores.create',               'stores',    'store_form',        'create',  'Create store',              'إنشاء متجر',                      false, false, 301),
  ('stores.edit',                 'stores',    'store_form',        'edit',    'Edit store',                'تعديل متجر',                      false, false, 302),
  ('stores.archive',              'stores',    'store_list',        'archive', 'Archive store',             'أرشفة متجر',                      false, true,  303),
  ('stores.connect',              'stores',    'store_form',        'configure','Connect store to channel', 'ربط متجر بقناة بيع',              false, false, 304),
  ('stores.disconnect',           'stores',    'store_detail',      'configure','Disconnect store',         'إلغاء ربط متجر',                  false, true,  305),
  ('stores.credentials.manage',   'stores',    'store_detail',      'configure','Manage channel credentials','إدارة بيانات الربط',             true,  false, 306),
  ('stores.sync.trigger',         'stores',    'store_detail',      'send',    'Trigger manual sync',       'تشغيل مزامنة يدوية',              false, false, 307),
  ('stores.sync.view',            'stores',    'sync_log',          'view',    'View synchronization log',  'عرض سجل المزامنة',                false, false, 308),

  -- Warehouses (§5.3, stubbed in Phase 1)
  ('warehouses.view',             'warehouses','warehouse_list',    'view',    'View warehouses',           'عرض المخازن',                     false, false, 400),
  ('warehouses.create',           'warehouses','warehouse_form',    'create',  'Create warehouse',          'إنشاء مخزن',                      false, false, 401),
  ('warehouses.edit',             'warehouses','warehouse_form',    'edit',    'Edit warehouse',            'تعديل مخزن',                      false, false, 402),

  -- Users (§2.5)
  ('users.view',                  'users',     'user_list',         'view',    'View users',                'عرض المستخدمين',                  false, false, 500),
  ('users.create',                'users',     'user_form',         'create',  'Create user',               'إنشاء مستخدم',                    false, false, 501),
  ('users.edit',                  'users',     'user_form',         'edit',    'Edit user',                 'تعديل مستخدم',                    false, false, 502),
  ('users.archive',               'users',     'user_list',         'archive', 'Archive user',              'أرشفة مستخدم',                    false, true,  503),
  ('users.assign_roles',          'users',     'user_form',         'configure','Assign roles and data scopes','تعيين الأدوار والصلاحيات',     true,  false, 504),
  ('users.reset_password',        'users',     'user_detail',       'reset',   'Force password reset',      'إعادة تعيين كلمة المرور',         false, false, 505),
  ('users.terminate_sessions',    'users',     'user_detail',       'configure','Terminate active sessions','إنهاء الجلسات النشطة',            false, false, 506),
  ('users.export',                'users',     'user_list',         'export',  'Export users',              'تصدير المستخدمين',                false, false, 507),

  -- Roles and permissions (§2.6, §2.7)
  ('roles.view',                  'roles',     'role_list',         'view',    'View roles',                'عرض الأدوار',                     false, false, 600),
  ('roles.manage',                'roles',     'permission_matrix', 'configure','Create and edit roles and permissions','إدارة الأدوار والصلاحيات', true, false, 601),

  -- Org structure (§2.8)
  ('departments.view',            'org',       'departments',       'view',    'View departments',          'عرض الأقسام',                     false, false, 700),
  ('departments.manage',          'org',       'departments',       'configure','Manage departments',       'إدارة الأقسام',                   false, false, 701),
  ('teams.view',                  'org',       'teams',             'view',    'View teams',                'عرض الفرق',                       false, false, 702),
  ('teams.manage',                'org',       'teams',             'configure','Manage teams',             'إدارة الفرق',                     false, false, 703),
  ('shifts.view',                 'org',       'shifts',            'view',    'View shifts',               'عرض الورديات',                    false, false, 704),
  ('shifts.manage',               'org',       'shifts',            'configure','Manage shifts',            'إدارة الورديات',                  false, false, 705),

  -- Audit and approvals (§2.9, §2.7.4)
  ('audit.view',                  'audit',     'activity_log',      'view',    'View activity and audit log','عرض سجل النشاط',                 true,  false, 800),
  ('audit.export',                'audit',     'activity_log',      'export',  'Export audit log',          'تصدير سجل النشاط',                true,  false, 801),
  ('approvals.view',              'approvals', 'approvals',         'view',    'View approval requests',    'عرض طلبات الاعتماد',              false, false, 810),
  ('approvals.decide',            'approvals', 'approvals',         'approve', 'Approve or reject requests','اعتماد أو رفض الطلبات',           true,  false, 811),

  -- Sensitive financial permissions (§2.7.2) — declared in Phase 1, enforced by
  -- the Finance module in Phase 6. Each is independently grantable, as required.
  ('finance.view_product_cost',   'finance',   null,                'view',    'View product cost',         'عرض تكلفة المنتج',                true,  false, 900),
  ('finance.view_selling_price',  'finance',   null,                'view',    'View selling price',        'عرض سعر البيع',                   true,  false, 901),
  ('finance.view_profit_margin',  'finance',   null,                'view',    'View profit margin',        'عرض هامش الربح',                  true,  false, 902),
  ('finance.view_marketing_expenses','finance',null,                'view',    'View marketing expenses',   'عرض مصروفات التسويق',             true,  false, 903),
  ('finance.view_shipping_cost',  'finance',   null,                'view',    'View shipping cost',        'عرض تكلفة الشحن',                 true,  false, 904),
  ('finance.view_collections',    'finance',   null,                'view',    'View collections',          'عرض التحصيلات',                   true,  false, 905),
  ('finance.view_merchant_balance','finance',  null,                'view',    'View merchant balance',     'عرض رصيد التاجر',                 true,  false, 906),
  ('finance.view_affiliate_commissions','finance',null,             'view',    'View affiliate commissions','عرض عمولات المسوقين',             true,  false, 907),
  ('finance.edit_entries',        'finance',   null,                'edit',    'Edit financial entries',    'تعديل القيود المالية',            true,  true,  908),
  ('finance.approve_settlements', 'finance',   null,                'approve', 'Approve settlements',       'اعتماد التسويات',                 true,  true,  909),
  ('finance.generate_invoices',   'finance',   null,                'create',  'Generate invoices',         'إصدار الفواتير',                  true,  false, 910),
  ('finance.export',              'finance',   null,                'export',  'Export financial data',     'تصدير البيانات المالية',          true,  false, 911),

  -- Sensitive customer data (§2.7.3) — enforced as field policies in Phase 3.
  ('customers.view_phone',        'customers', null,                'view',    'View customer phone',       'عرض رقم هاتف العميل',             true,  false, 950),
  ('customers.view_address',      'customers', null,                'view',    'View customer address',     'عرض عنوان العميل',                true,  false, 951),
  ('customers.view_email',        'customers', null,                'view',    'View customer email',       'عرض بريد العميل',                 true,  false, 952),
  ('customers.view_call_recordings','customers',null,               'view',    'View call recordings',      'عرض التسجيلات الصوتية',           true,  false, 953),
  ('customers.view_order_history','customers', null,                'view',    'View customer order history','عرض سجل طلبات العميل',           true,  false, 954),
  ('customers.view_internal_notes','customers',null,                'view',    'View internal notes',       'عرض الملاحظات الداخلية',          true,  false, 955),
  ('customers.view_payment_data', 'customers', null,                'view',    'View payment data',         'عرض بيانات الدفع',                true,  false, 956),
  ('customers.view_risk_score',   'customers', null,                'view',    'View customer risk score',  'عرض تقييم مخاطر العميل',          true,  false, 957),

  -- Reports (§9.19) — the report engine arrives in Phase 7; the gates exist now.
  ('reports.view',                'reports',   'reports_center',    'view',    'View reports',              'عرض التقارير',                    false, false, 980),
  ('reports.export',              'reports',   'reports_center',    'export',  'Export reports',            'تصدير التقارير',                  false, false, 981),
  ('reports.schedule',            'reports',   'scheduled_reports', 'configure','Schedule reports',         'جدولة التقارير',                  false, false, 982),
  ('reports.share',               'reports',   'reports_center',    'send',    'Share reports',             'مشاركة التقارير',                 false, false, 983)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Default roles — §2.6.2. Created as system templates (company_id IS NULL) and
-- cloned into each company by app.provision_company_roles().
-- -----------------------------------------------------------------------------
insert into public.roles (company_id, code, name_en, name_ar, description, is_system_template) values
  (null, 'super_admin',              'Super Admin',              'مدير النظام الأعلى',        'Full platform access across all companies', true),
  (null, 'system_admin',             'System Admin',             'مدير النظام',               'Platform administration',                   true),
  (null, 'company_admin',            'Company Admin',            'مدير الشركة',               'Full access within one company',            true),
  (null, 'merchant_admin',           'Merchant Admin',           'مدير التاجر',               'Full access to one merchant''s data',       true),
  (null, 'store_manager',            'Store Manager',            'مدير المتجر',               'Manages one or more stores',                true),
  (null, 'operations_manager',       'Operations Manager',       'مدير العمليات',             'Oversees end-to-end operations',            true),
  (null, 'confirmation_team_leader', 'Confirmation Team Leader', 'مدير فريق التأكيد',         'Leads the order confirmation team',         true),
  (null, 'confirmation_agent',       'Confirmation Agent',       'موظف تأكيد الطلبات',        'Confirms assigned orders',                  true),
  (null, 'customer_service_agent',   'Customer Service Agent',   'موظف خدمة العملاء',         'Handles customer enquiries',                true),
  (null, 'warehouse_manager',        'Warehouse Manager',        'مدير المخزن',               'Manages warehouse operations',              true),
  (null, 'receiving_agent',          'Receiving Agent',          'موظف استلام',               'Receives inbound goods',                    true),
  (null, 'picker',                   'Picker',                   'موظف تجهيز',                'Executes picking tasks',                    true),
  (null, 'packer',                   'Packer',                   'موظف تغليف',                'Executes packing tasks',                    true),
  (null, 'inventory_controller',     'Inventory Controller',     'موظف جرد',                  'Controls stock accuracy',                   true),
  (null, 'shipping_manager',         'Shipping Manager',         'مدير الشحن',                'Manages couriers and dispatch',             true),
  (null, 'followup_agent',           'Follow-up Agent',          'موظف متابعة الشحنات',       'Follows up shipments',                      true),
  (null, 'returns_agent',            'Returns Agent',            'موظف المرتجعات',            'Processes returns',                         true),
  (null, 'accountant',               'Accountant',               'موظف الحسابات',             'Financial records and settlements',         true),
  (null, 'collection_officer',       'Collection Officer',       'موظف التحصيلات',            'Tracks COD collections',                    true),
  (null, 'marketing_manager',        'Marketing Manager',        'مدير التسويق',              'Campaigns and marketing spend',             true),
  (null, 'affiliate_manager',        'Affiliate Manager',        'مدير المسوقين بالعمولة',    'Manages affiliates and commissions',        true),
  (null, 'quality_auditor',          'Quality Auditor',          'مدير الجودة',               'Quality assurance and inspection',          true),
  (null, 'reports_viewer',           'Reports Viewer',           'مستخدم تقارير فقط',         'Read-only reporting access',                true),
  (null, 'api_user',                 'API User',                 'مستخدم واجهات برمجية',      'Machine-to-machine integration account',    true)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Template permission assignment.
-- Patterns accept '*' as a wildcard, e.g. 'stores.*'.
-- -----------------------------------------------------------------------------
create or replace function app.grant_perms_to_template(p_role_code text, p_patterns text[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id
  from public.roles r
  cross join public.permissions p
  where r.code = p_role_code
    and r.company_id is null
    and exists (
      select 1 from unnest(p_patterns) pat
      where p.code like replace(pat, '*', '%')
    )
  on conflict do nothing;
$$;

select app.grant_perms_to_template('super_admin',  array['*']);
select app.grant_perms_to_template('system_admin', array['companies.*','merchants.*','stores.*','users.*','roles.*','org.*','audit.*','approvals.*','subscriptions.*','warehouses.*','departments.*','teams.*','shifts.*','reports.*']);

select app.grant_perms_to_template('company_admin', array[
  'companies.view','companies.edit','companies.settings','companies.export',
  'merchants.*','stores.*','warehouses.*','users.*','roles.*',
  'departments.*','teams.*','shifts.*','audit.*','approvals.*','reports.*',
  'finance.*','customers.*','subscriptions.manage'
]);

select app.grant_perms_to_template('merchant_admin', array[
  'merchants.view','stores.view','stores.sync.view','warehouses.view',
  'users.view','reports.view','reports.export',
  'finance.view_selling_price','finance.view_collections','finance.view_merchant_balance',
  'customers.view_phone','customers.view_address','customers.view_order_history'
]);

select app.grant_perms_to_template('store_manager', array[
  'stores.view','stores.edit','stores.sync.trigger','stores.sync.view',
  'merchants.view','users.view','reports.view','reports.export',
  'customers.view_phone','customers.view_address','customers.view_order_history'
]);

select app.grant_perms_to_template('operations_manager', array[
  'merchants.view','stores.view','stores.sync.view','stores.sync.trigger','warehouses.*',
  'users.view','departments.view','teams.*','shifts.*','approvals.*',
  'reports.view','reports.export','audit.view',
  'customers.view_phone','customers.view_address','customers.view_order_history','customers.view_risk_score'
]);

select app.grant_perms_to_template('confirmation_team_leader', array[
  'merchants.view','stores.view','users.view','teams.view','teams.manage','shifts.view',
  'reports.view','reports.export',
  'customers.view_phone','customers.view_address','customers.view_order_history',
  'customers.view_internal_notes','customers.view_risk_score','customers.view_call_recordings'
]);

select app.grant_perms_to_template('confirmation_agent', array[
  'stores.view','reports.view',
  'customers.view_phone','customers.view_address','customers.view_order_history','customers.view_internal_notes'
]);

select app.grant_perms_to_template('customer_service_agent', array[
  'stores.view','reports.view',
  'customers.view_phone','customers.view_address','customers.view_email','customers.view_order_history','customers.view_internal_notes'
]);

select app.grant_perms_to_template('warehouse_manager',    array['warehouses.*','merchants.view','stores.view','users.view','teams.view','shifts.*','approvals.view','reports.view','reports.export']);
select app.grant_perms_to_template('receiving_agent',      array['warehouses.view','reports.view']);
select app.grant_perms_to_template('picker',               array['warehouses.view']);
select app.grant_perms_to_template('packer',               array['warehouses.view']);
select app.grant_perms_to_template('inventory_controller', array['warehouses.view','warehouses.edit','reports.view','reports.export','approvals.view']);
select app.grant_perms_to_template('shipping_manager',     array['stores.view','merchants.view','warehouses.view','reports.view','reports.export','finance.view_shipping_cost']);
select app.grant_perms_to_template('followup_agent',       array['stores.view','reports.view','customers.view_phone','customers.view_address']);
select app.grant_perms_to_template('returns_agent',        array['warehouses.view','stores.view','reports.view','customers.view_phone','customers.view_address']);

select app.grant_perms_to_template('accountant', array[
  'merchants.view','merchants.pricing.view','stores.view','reports.view','reports.export',
  'finance.view_product_cost','finance.view_selling_price','finance.view_profit_margin',
  'finance.view_marketing_expenses','finance.view_shipping_cost','finance.view_collections',
  'finance.view_merchant_balance','finance.view_affiliate_commissions',
  'finance.edit_entries','finance.generate_invoices','finance.export'
]);
-- Deliberately NOT granted finance.approve_settlements — §2.7.4 requires the
-- creator of a settlement to be a different user from its approver.

select app.grant_perms_to_template('collection_officer', array[
  'stores.view','merchants.view','reports.view','reports.export','finance.view_collections'
]);

select app.grant_perms_to_template('marketing_manager', array[
  'stores.view','merchants.view','reports.view','reports.export','reports.schedule',
  'finance.view_marketing_expenses','finance.view_selling_price'
]);

select app.grant_perms_to_template('affiliate_manager', array[
  'stores.view','merchants.view','reports.view','reports.export','finance.view_affiliate_commissions'
]);

select app.grant_perms_to_template('quality_auditor', array[
  'warehouses.view','stores.view','merchants.view','audit.view','audit.export',
  'reports.view','reports.export','approvals.view','approvals.decide'
]);

select app.grant_perms_to_template('reports_viewer', array['reports.view','reports.export']);
select app.grant_perms_to_template('api_user',       array['stores.view','stores.sync.trigger','stores.sync.view']);

-- -----------------------------------------------------------------------------
-- Default field policies for sensitive customer data (§2.7.3).
-- Partial phone masking is required by the spec; agents who need to dial but
-- not to exfiltrate see a masked number.
-- -----------------------------------------------------------------------------
insert into public.role_field_policies (role_id, entity, field, visibility, can_edit, mask_pattern)
select r.id, v.entity, v.field, v.visibility::public.field_visibility, v.can_edit, v.mask_pattern
from public.roles r
join (values
  ('picker',               'customers', 'phone',   'hidden', false, null),
  ('packer',               'customers', 'phone',   'hidden', false, null),
  ('receiving_agent',      'customers', 'phone',   'hidden', false, null),
  ('reports_viewer',       'customers', 'phone',   'masked', false, '###****##'),
  ('followup_agent',       'customers', 'phone',   'masked', false, '###****##'),
  ('marketing_manager',    'customers', 'phone',   'hidden', false, null),
  ('accountant',           'customers', 'phone',   'masked', false, '###****##')
) as v(role_code, entity, field, visibility, can_edit, mask_pattern)
  on v.role_code = r.code
where r.company_id is null
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Company provisioning — clone templates into a new company automatically.
-- Platform-only roles (super_admin, system_admin) are not cloned.
-- -----------------------------------------------------------------------------
create or replace function app.provision_company_roles(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.roles (company_id, code, name_en, name_ar, description, is_system_template, is_active)
  select p_company_id, t.code, t.name_en, t.name_ar, t.description, false, true
  from public.roles t
  where t.company_id is null
    and t.is_system_template
    and t.code not in ('super_admin', 'system_admin')
    and not exists (
      select 1 from public.roles existing
      where existing.company_id = p_company_id and existing.code = t.code
    );

  insert into public.role_permissions (role_id, permission_id)
  select nr.id, rp.permission_id
  from public.roles nr
  join public.roles t             on t.code = nr.code and t.company_id is null
  join public.role_permissions rp on rp.role_id = t.id
  where nr.company_id = p_company_id
  on conflict do nothing;

  insert into public.role_field_policies (role_id, entity, field, visibility, can_edit, mask_pattern)
  select nr.id, fp.entity, fp.field, fp.visibility, fp.can_edit, fp.mask_pattern
  from public.roles nr
  join public.roles t                on t.code = nr.code and t.company_id is null
  join public.role_field_policies fp on fp.role_id = t.id
  where nr.company_id = p_company_id
  on conflict do nothing;
end;
$$;

create or replace function app.on_company_created()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.provision_company_roles(new.id);
  return new;
end;
$$;

create trigger companies_provision_roles
  after insert on public.companies
  for each row execute function app.on_company_created();

comment on function app.provision_company_roles is
  '§2.6.2 clones the 22 company-level default roles, their permissions and field policies into a new company. Fired automatically by companies_provision_roles.';
