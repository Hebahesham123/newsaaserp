-- =============================================================================
-- Green ERP — 0013 Orders RLS, permissions & seed data  (spec §4)
--
-- Two access rules distinguish this module from the catalog:
--
--  1. A confirmation agent sees the orders assigned to them, not the company's
--     whole order book. `orders.view.all` lifts that restriction for team
--     leaders and managers, so the narrow case is the default and the broad one
--     is an explicit grant.
--
--  2. Nothing here grants DELETE. §4.15 rule 2 forbids deleting an order, and
--     the calls, messages and timeline attached to it are evidence of how the
--     customer was treated.
-- =============================================================================

alter table public.customers            enable row level security;
alter table public.cancellation_reasons enable row level security;
alter table public.blacklist_entries    enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_events         enable row level security;
alter table public.order_calls          enable row level security;
alter table public.order_messages       enable row level security;
alter table public.message_templates    enable row level security;

-- -----------------------------------------------------------------------------
-- Permissions — §4, following §2.7.2: every sensitive capability is separately
-- grantable rather than bundled into a single "orders" permission.
-- -----------------------------------------------------------------------------

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('orders.view',                 'orders', 'order_list',        'view',      'View assigned orders',        'عرض الطلبات المسندة',            false, false, 2000),
  ('orders.view.all',             'orders', 'order_list',        'view',      'View all orders',             'عرض كل الطلبات',                 false, false, 2001),
  ('orders.create',               'orders', 'order_form',        'create',    'Create order',                'إنشاء طلب',                      false, false, 2002),
  ('orders.edit',                 'orders', 'order_form',        'edit',      'Edit order',                  'تعديل الطلب',                    false, false, 2003),
  ('orders.edit.after_warehouse', 'orders', 'order_form',        'edit',      'Edit order after warehouse handover', 'تعديل الطلب بعد التحويل للمخزن', true,  true,  2004),
  ('orders.assign',               'orders', 'assignment',        'configure', 'Assign orders',               'توزيع الطلبات',                  false, false, 2005),
  ('orders.confirm',              'orders', 'confirmation',      'approve',   'Confirm order',               'تأكيد الطلب',                    false, false, 2006),
  ('orders.cancel',               'orders', 'confirmation',      'configure', 'Cancel order',                'إلغاء الطلب',                    false, false, 2007),
  ('orders.release',              'orders', 'confirmation',      'approve',   'Send order to warehouse',     'تحويل الطلب للمخزن',             false, false, 2008),
  ('orders.archive',              'orders', 'order_list',        'archive',   'Archive cancelled order',     'أرشفة الطلب الملغي',             false, true,  2009),
  ('orders.call.log',             'orders', 'call_history',      'create',    'Log calls',                   'تسجيل المكالمات',                false, false, 2010),
  ('orders.call.recording',       'orders', 'call_history',      'view',      'Play call recordings',        'الاستماع لتسجيلات المكالمات',    true,  false, 2011),
  ('orders.message.send',         'orders', 'whatsapp',          'create',    'Send WhatsApp messages',      'إرسال رسائل واتساب',             false, false, 2012),
  ('orders.customer.view',        'orders', 'customer_360',      'view',      'View Customer 360',           'عرض ملف العميل',                 false, false, 2013),
  ('orders.customer.edit',        'orders', 'customer_360',      'edit',      'Edit customer records',       'تعديل بيانات العملاء',           false, false, 2014),
  ('orders.blacklist.view',       'orders', 'blacklist',         'view',      'View blacklist',              'عرض القائمة السوداء',            false, false, 2015),
  ('orders.blacklist.manage',     'orders', 'blacklist',         'configure', 'Manage blacklist',            'إدارة القائمة السوداء',          true,  false, 2016),
  ('orders.duplicates.view',      'orders', 'duplicate_orders',  'view',      'Review duplicate orders',     'مراجعة الطلبات المكررة',         false, false, 2017),
  ('orders.reasons.manage',       'orders', 'cancel_reasons',    'configure', 'Manage cancellation reasons', 'إدارة أسباب الإلغاء',            false, false, 2018),
  ('orders.templates.manage',     'orders', 'message_templates', 'configure', 'Manage message templates',    'إدارة قوالب الرسائل',            false, false, 2019),
  ('orders.export',               'orders', 'order_list',        'export',    'Export orders',               'تصدير الطلبات',                  false, false, 2020)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Role grants (§2.6.2). A confirmation agent gets exactly what §4.7 says they
-- do on an order and nothing that would let them see the whole book.
-- -----------------------------------------------------------------------------

select app.grant_perms_to_template('super_admin',  array['*']);
select app.grant_perms_to_template('system_admin',  array['orders.*']);
select app.grant_perms_to_template('company_admin', array['orders.*']);

select app.grant_perms_to_template('merchant_admin', array[
  'orders.view', 'orders.view.all', 'orders.create', 'orders.edit', 'orders.cancel',
  'orders.customer.view', 'orders.duplicates.view', 'orders.export'
]);

select app.grant_perms_to_template('operations_manager', array[
  'orders.view', 'orders.view.all', 'orders.create', 'orders.edit', 'orders.assign',
  'orders.confirm', 'orders.cancel', 'orders.release', 'orders.archive',
  'orders.call.log', 'orders.message.send', 'orders.customer.view', 'orders.customer.edit',
  'orders.blacklist.view', 'orders.blacklist.manage', 'orders.duplicates.view',
  'orders.reasons.manage', 'orders.templates.manage', 'orders.export'
]);

select app.grant_perms_to_template('store_manager', array[
  'orders.view', 'orders.view.all', 'orders.create', 'orders.edit',
  'orders.customer.view', 'orders.duplicates.view', 'orders.export'
]);

-- §4.6 the team leader distributes work; §4.7 they can also work an order.
select app.grant_perms_to_template('confirmation_team_leader', array[
  'orders.view', 'orders.view.all', 'orders.create', 'orders.edit', 'orders.assign',
  'orders.confirm', 'orders.cancel', 'orders.release',
  'orders.call.log', 'orders.call.recording', 'orders.message.send',
  'orders.customer.view', 'orders.customer.edit',
  'orders.blacklist.view', 'orders.blacklist.manage',
  'orders.duplicates.view', 'orders.reasons.manage', 'orders.templates.manage', 'orders.export'
]);

-- The narrow case: their own queue, the actions in §4.7, and no order book.
select app.grant_perms_to_template('confirmation_agent', array[
  'orders.view', 'orders.edit', 'orders.confirm', 'orders.cancel',
  'orders.call.log', 'orders.message.send',
  'orders.customer.view', 'orders.customer.edit',
  'orders.blacklist.view', 'orders.duplicates.view'
]);

select app.grant_perms_to_template('customer_service_agent', array[
  'orders.view', 'orders.view.all', 'orders.edit',
  'orders.call.log', 'orders.message.send',
  'orders.customer.view', 'orders.customer.edit', 'orders.blacklist.view'
]);

-- Warehouse staff read released orders; they never confirm or cancel them.
select app.grant_perms_to_template('warehouse_manager',    array['orders.view', 'orders.view.all', 'orders.export']);
select app.grant_perms_to_template('inventory_controller', array['orders.view', 'orders.view.all']);
select app.grant_perms_to_template('picker',               array['orders.view', 'orders.view.all']);
select app.grant_perms_to_template('packer',               array['orders.view', 'orders.view.all']);
select app.grant_perms_to_template('returns_agent',        array['orders.view', 'orders.view.all', 'orders.customer.view']);

select app.grant_perms_to_template('accountant',       array['orders.view', 'orders.view.all', 'orders.export']);
select app.grant_perms_to_template('marketing_manager', array['orders.view', 'orders.view.all', 'orders.export']);
select app.grant_perms_to_template('quality_auditor',  array['orders.view', 'orders.view.all', 'orders.call.recording', 'orders.export']);
select app.grant_perms_to_template('reports_viewer',   array['orders.view', 'orders.view.all']);
select app.grant_perms_to_template('api_user',         array['orders.view', 'orders.view.all', 'orders.create']);

-- -----------------------------------------------------------------------------
-- Visibility helper — §4.6 assignment scoping.
--
-- A single function, because the same rule has to hold on orders, items, calls,
-- messages and the timeline. Duplicating the condition across nine policies is
-- how one of them ends up subtly different.
-- -----------------------------------------------------------------------------

create or replace function app.can_see_order(
  p_company_id uuid,
  p_merchant_id uuid,
  p_store_id uuid,
  p_assigned_to uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.same_company(p_company_id)
     and app.in_scope('merchant', p_merchant_id)
     and app.can_access_store(p_store_id)
     and (
       app.has_perm('orders.view.all')
       or p_assigned_to = app.uid()
       -- An unassigned order has to be visible to whoever will pick it up.
       or (p_assigned_to is null and app.has_perm('orders.assign'))
     );
$$;

comment on function app.can_see_order is
  '§4.6 row visibility: company + merchant scope + store scope, then either orders.view.all or ownership of the order.';

-- -----------------------------------------------------------------------------
-- Orders
-- -----------------------------------------------------------------------------

create policy orders_select on public.orders
  for select to authenticated
  using (app.has_perm('orders.view') and app.can_see_order(company_id, merchant_id, store_id, assigned_to));

create policy orders_insert on public.orders
  for insert to authenticated
  with check (
    app.same_company(company_id)
    and app.has_perm('orders.create')
    and app.in_scope('merchant', merchant_id)
  );

-- One UPDATE policy covers edit, assign, confirm, cancel and release: the
-- *transition* rules are enforced by the trigger in 0012, which cannot be
-- bypassed, while the policy answers the simpler question of who may touch the
-- row at all.
create policy orders_update on public.orders
  for all to authenticated
  using (
    app.can_see_order(company_id, merchant_id, store_id, assigned_to)
    and (
      app.has_perm('orders.edit')
      or app.has_perm('orders.assign')
      or app.has_perm('orders.confirm')
      or app.has_perm('orders.cancel')
      or app.has_perm('orders.release')
      or app.has_perm('orders.archive')
    )
  )
  with check (app.same_company(company_id));

-- -----------------------------------------------------------------------------
-- Order items — visibility follows the parent order.
-- -----------------------------------------------------------------------------

create policy order_items_select on public.order_items
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id
      and app.has_perm('orders.view')
      and app.can_see_order(o.company_id, o.merchant_id, o.store_id, o.assigned_to)
  ));

create policy order_items_write on public.order_items
  for all to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id
      and app.has_perm('orders.edit')
      and app.can_see_order(o.company_id, o.merchant_id, o.store_id, o.assigned_to)
  ))
  with check (exists (
    select 1 from public.orders o
    where o.id = order_id
      and app.has_perm('orders.edit')
      and app.can_see_order(o.company_id, o.merchant_id, o.store_id, o.assigned_to)
  ));

-- -----------------------------------------------------------------------------
-- Timeline — readable with the order, insertable for notes, never mutable.
-- -----------------------------------------------------------------------------

create policy order_events_select on public.order_events
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id
      and app.has_perm('orders.view')
      and app.can_see_order(o.company_id, o.merchant_id, o.store_id, o.assigned_to)
  ));

-- §4.7 "إضافة ملاحظات" — an agent may add a note; nothing may rewrite history,
-- so there is deliberately no UPDATE or DELETE policy here.
create policy order_events_insert on public.order_events
  for insert to authenticated
  with check (
    event_type = 'note'
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and app.has_perm('orders.view')
        and app.can_see_order(o.company_id, o.merchant_id, o.store_id, o.assigned_to)
    )
  );

-- -----------------------------------------------------------------------------
-- Calls and messages — §4.10, §4.9
-- -----------------------------------------------------------------------------

create policy order_calls_select on public.order_calls
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id
      and app.has_perm('orders.view')
      and app.can_see_order(o.company_id, o.merchant_id, o.store_id, o.assigned_to)
  ));

create policy order_calls_insert on public.order_calls
  for insert to authenticated
  with check (
    app.has_perm('orders.call.log')
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and app.can_see_order(o.company_id, o.merchant_id, o.store_id, o.assigned_to)
    )
  );

create policy order_messages_select on public.order_messages
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id
      and app.has_perm('orders.view')
      and app.can_see_order(o.company_id, o.merchant_id, o.store_id, o.assigned_to)
  ));

create policy order_messages_insert on public.order_messages
  for insert to authenticated
  with check (
    app.has_perm('orders.message.send')
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and app.can_see_order(o.company_id, o.merchant_id, o.store_id, o.assigned_to)
    )
  );

-- -----------------------------------------------------------------------------
-- Customers — §4.8
-- -----------------------------------------------------------------------------

create policy customers_select on public.customers
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('orders.customer.view'));

create policy customers_write on public.customers
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('orders.customer.edit'))
  with check (app.same_company(company_id) and app.has_perm('orders.customer.edit'));

-- -----------------------------------------------------------------------------
-- Reference data — cancellation reasons, blacklist, templates
-- -----------------------------------------------------------------------------

-- Every agent needs to read the reasons to cancel an order; only a manager
-- configures them (§4.11).
create policy cancellation_reasons_select on public.cancellation_reasons
  for select to authenticated using (app.same_company(company_id));

create policy cancellation_reasons_write on public.cancellation_reasons
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('orders.reasons.manage'))
  with check (app.same_company(company_id) and app.has_perm('orders.reasons.manage'));

create policy blacklist_select on public.blacklist_entries
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('orders.blacklist.view'));

create policy blacklist_write on public.blacklist_entries
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('orders.blacklist.manage'))
  with check (app.same_company(company_id) and app.has_perm('orders.blacklist.manage'));

create policy message_templates_select on public.message_templates
  for select to authenticated using (app.same_company(company_id));

create policy message_templates_write on public.message_templates
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('orders.templates.manage'))
  with check (app.same_company(company_id) and app.has_perm('orders.templates.manage'));

-- -----------------------------------------------------------------------------
-- Views inherit the caller's policies rather than the definer's.
-- -----------------------------------------------------------------------------

alter view public.confirmation_queue set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Grants. No DELETE anywhere in this module (§4.15 rule 2).
-- -----------------------------------------------------------------------------

grant select, insert, update on
  public.orders, public.customers, public.cancellation_reasons,
  public.blacklist_entries, public.message_templates
to authenticated;

-- Items are the one place a row genuinely disappears: removing a line from an
-- order during confirmation is §4.7 "تعديل المنتجات", and the removal is
-- recorded on the timeline by trigger before the row goes.
grant select, insert, update, delete on public.order_items to authenticated;

grant select, insert on public.order_events, public.order_calls, public.order_messages to authenticated;

grant select on public.confirmation_queue to authenticated;

grant usage on sequence public.order_number_seq to authenticated;

grant execute on function public.find_duplicate_orders(uuid) to authenticated;
grant execute on function public.next_confirmation_agent(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Backfill existing tenants.
--
-- grant_perms_to_template only touches the platform templates. Companies
-- provisioned before this migration already hold cloned roles, which would
-- otherwise never see the order permissions. provision_company_roles inserts
-- only what is missing, so re-running it per company is exactly the backfill.
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
-- Configurable reference data, provisioned per company.
--
-- §4.11 lists these as examples, so they are seeded as a starting point a
-- company can rename, deactivate or extend — not as a fixed set. Written as a
-- function rather than a one-off insert so a company created next year gets the
-- same starting point as one created today.
-- -----------------------------------------------------------------------------

create or replace function app.provision_company_order_defaults(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
insert into public.cancellation_reasons (company_id, code, name_en, name_ar, is_customer_fault, requires_note, sort_order)
select c.id, r.code, r.name_en, r.name_ar, r.fault, r.needs_note, r.ord
from public.companies c
cross join (values
  ('customer_refused',   'Customer refused',        'رفض العميل',              true,  false, 1),
  ('wrong_number',       'Invalid phone number',    'رقم غير صحيح',            false, false, 2),
  ('wrong_address',      'Invalid address',         'عنوان غير صحيح',          false, false, 3),
  ('duplicate',          'Duplicate order',         'طلب مكرر',                false, false, 4),
  ('out_of_stock',       'Product unavailable',     'منتج غير متوفر',          false, false, 5),
  ('price',              'Price objection',         'السعر',                   true,  false, 6),
  ('delivery_time',      'Delivery time too long',  'وقت التوصيل',             true,  false, 7),
  ('out_of_coverage',    'Outside coverage area',   'خارج نطاق التغطية',       false, false, 8),
  ('ordered_by_mistake', 'Ordered by mistake',      'طلب بالخطأ',              true,  false, 9),
  ('no_answer',          'Unreachable after retries', 'تعذر الوصول للعميل',    false, false, 10),
  ('other',              'Other reason',            'سبب آخر',                 false, true,  11)
) as r(code, name_en, name_ar, fault, needs_note, ord)
where c.id = p_company_id
on conflict (company_id, code) do nothing;

-- §4.9 bilingual confirmation templates, ready to send on day one.
insert into public.message_templates (company_id, code, name, channel, body_ar, body_en, variables, sort_order)
select c.id, t.code, t.name, 'whatsapp', t.body_ar, t.body_en, t.vars, t.ord
from public.companies c
cross join (values
  ('order_confirmation', 'Order confirmation',
   'مرحباً {customer_name}، نود تأكيد طلبك رقم {order_number} بقيمة {total} {currency}. برجاء الرد بـ "تم" للتأكيد.',
   'Hello {customer_name}, please confirm your order {order_number} for {total} {currency}. Reply "YES" to confirm.',
   array['customer_name', 'order_number', 'total', 'currency'], 1),
  ('location_request', 'Location request',
   'مرحباً {customer_name}، برجاء مشاركة موقعك على الخريطة لتسهيل توصيل طلبك رقم {order_number}.',
   'Hello {customer_name}, please share your map location so we can deliver order {order_number}.',
   array['customer_name', 'order_number'], 2),
  ('payment_link', 'Payment link',
   'مرحباً {customer_name}، يمكنك دفع قيمة طلبك رقم {order_number} من خلال الرابط: {payment_link}',
   'Hello {customer_name}, you can pay for order {order_number} here: {payment_link}',
   array['customer_name', 'order_number', 'payment_link'], 3),
  ('no_answer_followup', 'Missed call follow-up',
   'حاولنا الاتصال بك بخصوص طلبك رقم {order_number} ولم نتمكن من الوصول إليك. برجاء التواصل معنا.',
   'We tried to reach you about order {order_number} but could not get through. Please contact us.',
   array['order_number'], 4)
) as t(code, name, body_ar, body_en, vars, ord)
where c.id = p_company_id
on conflict (company_id, code) do nothing;
end;
$$;

comment on function app.provision_company_order_defaults is
  '§4.11 / §4.9 starting set of cancellation reasons and message templates for a company. Idempotent.';

-- New companies get them at creation…
create or replace function app.provision_order_defaults_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.provision_company_order_defaults(new.id);
  return new;
end;
$$;

create trigger companies_provision_order_defaults
  after insert on public.companies
  for each row execute function app.provision_order_defaults_trigger();

-- …and every company that already exists gets them now.
do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_order_defaults(v_company);
  end loop;
end $$;
