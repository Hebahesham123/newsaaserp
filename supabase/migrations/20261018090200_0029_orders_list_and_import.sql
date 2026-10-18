-- =============================================================================
-- 0029 — Saved views, column preferences, address lookups and bulk import
--
-- §6 Customize Columns, §8 Saved Views, §11 Date Range, Bulk Order Import, and
-- the dependent Governorate / City dropdowns that Manual Order Creation needs.
--
-- Two ideas worth stating because they shape the tables:
--
-- A saved view is not a saved filter. The brief asks for filters, columns and
-- sorting to travel together, because "Delayed Confirmation" is useless if it
-- restores the rows but not the columns that made them readable. So this
-- extends `saved_filters` rather than adding a parallel table — a view is a
-- filter that also remembers how it was being looked at.
--
-- An import is not a transaction. Rows are validated and stored individually,
-- so that twenty good rows are not discarded because of five bad ones, and the
-- person fixing the file can see exactly which line failed and why.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. §8 Saved Views — filters, columns and sorting as one saved thing
-- -----------------------------------------------------------------------------

alter table public.saved_filters
  add column columns    jsonb not null default '[]'::jsonb,
  add column sort       jsonb not null default '{}'::jsonb,
  add column date_range jsonb not null default '{}'::jsonb,
  -- A view a team shares, rather than one person's. It still obeys the
  -- viewer's own data scope: sharing the definition never shares the rows.
  add column is_shared  boolean not null default false;

comment on column public.saved_filters.columns is
  'Ordered list of column keys. Empty means the screen default.';
comment on column public.saved_filters.date_range is
  'The §11 selection: {"preset":"last_7_days"} or {"field":"order_date","from":…,"to":…}.';
comment on column public.saved_filters.is_shared is
  'Shares the view definition with the company. Rows still follow the viewer''s own data scope.';

-- -----------------------------------------------------------------------------
-- 2. §6 Customize Columns — the preference, saved automatically
-- -----------------------------------------------------------------------------

-- Deliberately separate from saved views. A view is chosen; this is simply how
-- a person last left the screen, and it should follow them without being named.
create table public.user_table_preferences (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies (id) on delete cascade,
  user_id     uuid not null references public.app_users (id) on delete cascade,

  -- Which table: 'orders', 'customers', …
  screen      text not null,
  -- Ordered column keys. Order is the display order; absence means hidden.
  columns     jsonb not null default '[]'::jsonb,
  density     text not null default 'comfortable'
    check (density in ('compact', 'comfortable')),
  page_size   integer not null default 10 check (page_size between 5 and 200),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint user_table_preferences_unique unique (user_id, screen)
);

create trigger user_table_preferences_updated_at
  before update on public.user_table_preferences
  for each row execute function app.set_updated_at();

comment on table public.user_table_preferences is
  'Per-user, per-screen column visibility and order. Which columns are offered at all is decided by permissions, not here.';

-- -----------------------------------------------------------------------------
-- 3. Governorates and cities — the dependent dropdowns
-- -----------------------------------------------------------------------------

-- `company_id is null` means platform-provided. A company may add its own
-- areas without being able to edit the shared list.
create table public.governorates (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,

  code       text not null,
  name_en    text not null,
  name_ar    text not null,

  is_active  boolean not null default true,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index governorates_global_code_unique
  on public.governorates (code) where company_id is null;
create unique index governorates_company_code_unique
  on public.governorates (company_id, code) where company_id is not null;

create table public.cities (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies (id) on delete cascade,
  governorate_id  uuid not null references public.governorates (id) on delete cascade,

  code            text not null,
  name_en         text not null,
  name_ar         text not null,

  is_active       boolean not null default true,
  sort_order      integer not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint cities_code_unique unique (governorate_id, code)
);

create index cities_governorate_idx on public.cities (governorate_id);

-- Egypt's governorates, as the shared list every company starts from.
insert into public.governorates (company_id, code, name_en, name_ar, sort_order) values
  (null, 'CAI', 'Cairo',          'القاهرة',        1),
  (null, 'GIZ', 'Giza',           'الجيزة',         2),
  (null, 'ALX', 'Alexandria',     'الإسكندرية',     3),
  (null, 'QLY', 'Qalyubia',       'القليوبية',      4),
  (null, 'SHR', 'Sharqia',        'الشرقية',        5),
  (null, 'DKH', 'Dakahlia',       'الدقهلية',       6),
  (null, 'BHR', 'Beheira',        'البحيرة',        7),
  (null, 'GHR', 'Gharbia',        'الغربية',        8),
  (null, 'MNF', 'Monufia',        'المنوفية',       9),
  (null, 'KFS', 'Kafr El Sheikh', 'كفر الشيخ',     10),
  (null, 'DMT', 'Damietta',       'دمياط',         11),
  (null, 'PTS', 'Port Said',      'بورسعيد',       12),
  (null, 'ISM', 'Ismailia',       'الإسماعيلية',   13),
  (null, 'SUZ', 'Suez',           'السويس',        14),
  (null, 'NSN', 'North Sinai',    'شمال سيناء',    15),
  (null, 'SSN', 'South Sinai',    'جنوب سيناء',    16),
  (null, 'BNS', 'Beni Suef',      'بني سويف',      17),
  (null, 'FYM', 'Faiyum',         'الفيوم',        18),
  (null, 'MNY', 'Minya',          'المنيا',        19),
  (null, 'AST', 'Asyut',          'أسيوط',         20),
  (null, 'SHG', 'Sohag',          'سوهاج',         21),
  (null, 'QNA', 'Qena',           'قنا',           22),
  (null, 'LXR', 'Luxor',          'الأقصر',        23),
  (null, 'ASW', 'Aswan',          'أسوان',         24),
  (null, 'RSH', 'Red Sea',        'البحر الأحمر',  25),
  (null, 'NVL', 'New Valley',     'الوادي الجديد', 26),
  (null, 'MTR', 'Matrouh',        'مطروح',         27)
on conflict do nothing;

-- Enough areas for the three governorates that carry most order volume, so the
-- dependent dropdown has something real to depend on.
insert into public.cities (company_id, governorate_id, code, name_en, name_ar, sort_order)
select null, g.id, c.code, c.name_en, c.name_ar, c.sort_order
from public.governorates g
join (values
  ('CAI', 'MAADI',      'Maadi',          'المعادي',          1),
  ('CAI', 'NASR',       'Nasr City',      'مدينة نصر',        2),
  ('CAI', 'HELIOPOLIS', 'Heliopolis',     'مصر الجديدة',      3),
  ('CAI', 'ZAMALEK',    'Zamalek',        'الزمالك',          4),
  ('CAI', 'DOWNTOWN',   'Downtown',       'وسط البلد',        5),
  ('CAI', 'SHOUBRA',    'Shoubra',        'شبرا',             6),
  ('CAI', 'NEWCAIRO',   'New Cairo',      'القاهرة الجديدة',  7),
  ('CAI', 'TAGAMOA',    'Fifth Settlement','التجمع الخامس',   8),
  ('CAI', 'HELWAN',     'Helwan',         'حلوان',            9),
  ('CAI', 'ABBASIA',    'Abbasia',        'العباسية',        10),
  ('GIZ', 'DOKKI',      'Dokki',          'الدقي',            1),
  ('GIZ', 'MOHANDESEEN','Mohandeseen',    'المهندسين',        2),
  ('GIZ', 'HARAM',      'Haram',          'الهرم',            3),
  ('GIZ', 'FAISAL',     'Faisal',         'فيصل',             4),
  ('GIZ', 'SHEIKHZAYED','Sheikh Zayed',   'الشيخ زايد',       5),
  ('GIZ', 'OCTOBER',    '6th of October', 'السادس من أكتوبر', 6),
  ('GIZ', 'IMBABA',     'Imbaba',         'إمبابة',           7),
  ('GIZ', 'AGOUZA',     'Agouza',         'العجوزة',          8),
  ('ALX', 'SMOUHA',     'Smouha',         'سموحة',            1),
  ('ALX', 'MIAMI',      'Miami',          'ميامي',            2),
  ('ALX', 'SIDIBISHR',  'Sidi Bishr',     'سيدي بشر',         3),
  ('ALX', 'STANLEY',    'Stanley',        'ستانلي',           4),
  ('ALX', 'MONTAZA',    'Montaza',        'المنتزه',          5),
  ('ALX', 'AGAMI',      'Agami',          'العجمي',           6)
) as c(gov_code, code, name_en, name_ar, sort_order)
  on c.gov_code = g.code
where g.company_id is null
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 4. Bulk Order Import
-- -----------------------------------------------------------------------------

create type public.import_status as enum (
  'uploaded',
  'validating',
  'validated',
  'importing',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled'
);

create table public.order_imports (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,

  file_name     text not null,
  file_size     bigint check (file_size is null or file_size >= 0),

  status        public.import_status not null default 'uploaded',

  total_rows    integer not null default 0 check (total_rows >= 0),
  valid_rows    integer not null default 0 check (valid_rows >= 0),
  error_rows    integer not null default 0 check (error_rows >= 0),
  total_items   integer not null default 0 check (total_items >= 0),
  created_orders integer not null default 0 check (created_orders >= 0),

  -- §Import History: who, when, and what came of it.
  uploaded_by   uuid references public.app_users (id) on delete set null,
  uploaded_at   timestamptz not null default now(),
  validated_at  timestamptz,
  imported_at   timestamptz,

  error_summary text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index order_imports_company_idx on public.order_imports (company_id, uploaded_at desc);

create trigger order_imports_updated_at
  before update on public.order_imports
  for each row execute function app.set_updated_at();

create table public.order_import_rows (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  import_id   uuid not null references public.order_imports (id) on delete cascade,

  -- The line in the uploaded file, so an error message can point at it.
  row_number  integer not null check (row_number > 0),
  -- Groups the lines of one multi-product order, from the file's own reference.
  order_reference text,

  raw         jsonb not null default '{}'::jsonb,

  is_valid    boolean not null default false,
  -- [{"field":"sku","message":"SKU 'ABC1234' not found"}]
  errors      jsonb not null default '[]'::jsonb,

  -- Set once the row has actually produced something.
  order_id    uuid references public.orders (id) on delete set null,

  created_at  timestamptz not null default now(),

  constraint order_import_rows_unique unique (import_id, row_number)
);

create index order_import_rows_import_idx on public.order_import_rows (import_id, row_number);
create index order_import_rows_invalid_idx on public.order_import_rows (import_id)
  where is_valid = false;

-- Keeps the batch counters honest without the application having to remember.
create or replace function app.refresh_import_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_import uuid := coalesce(new.import_id, old.import_id);
begin
  update public.order_imports i
     set total_rows = sub.total,
         valid_rows = sub.valid,
         error_rows = sub.invalid,
         created_orders = sub.created,
         updated_at = now()
    from (
      select count(*)                                  as total,
             count(*) filter (where is_valid)          as valid,
             count(*) filter (where not is_valid)      as invalid,
             count(distinct order_id)                  as created
      from public.order_import_rows
      where import_id = v_import
    ) sub
   where i.id = v_import;

  return coalesce(new, old);
end;
$$;

create trigger order_import_rows_refresh_counts
  after insert or update or delete on public.order_import_rows
  for each row execute function app.refresh_import_counts();

-- -----------------------------------------------------------------------------
-- 5. Access control
-- -----------------------------------------------------------------------------

alter table public.user_table_preferences enable row level security;
alter table public.governorates           enable row level security;
alter table public.cities                 enable row level security;
alter table public.order_imports          enable row level security;
alter table public.order_import_rows      enable row level security;

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('orders.import',        'orders', 'orders', 'import',    'Import orders in bulk',   'استيراد الأوردرات',      false, false, 7500),
  ('orders.export',        'orders', 'orders', 'export',    'Export orders',           'تصدير الأوردرات',        true,  false, 7501),
  ('orders.bulk_actions',  'orders', 'orders', 'edit',      'Run bulk actions',        'إجراءات جماعية',         false, false, 7502),
  ('settings.areas.manage','companies', 'areas', 'configure','Manage governorates and areas', 'إدارة المحافظات والمناطق', false, false, 7503)
on conflict (code) do nothing;

select app.grant_perms_to_template('super_admin',        array['*']);
select app.grant_perms_to_template('system_admin',       array['orders.import', 'orders.export', 'orders.bulk_actions', 'settings.areas.manage']);
select app.grant_perms_to_template('company_admin',      array['orders.import', 'orders.export', 'orders.bulk_actions', 'settings.areas.manage']);
select app.grant_perms_to_template('operations_manager', array['orders.import', 'orders.export', 'orders.bulk_actions']);
select app.grant_perms_to_template('store_manager',      array['orders.export']);
select app.grant_perms_to_template('merchant_admin',     array['orders.export']);

-- A preference is personal. There is no "view other people's column layout".
create policy user_table_preferences_own on public.user_table_preferences
  for all to authenticated
  using (user_id = app.uid())
  with check (user_id = app.uid());

-- The shared list is readable by everyone; a company's own additions only by
-- that company.
create policy governorates_select on public.governorates
  for select to authenticated
  using (company_id is null or app.same_company(company_id));

create policy governorates_write on public.governorates
  for all to authenticated
  using (company_id is not null and app.same_company(company_id) and app.has_perm('settings.areas.manage'))
  with check (company_id is not null and app.same_company(company_id) and app.has_perm('settings.areas.manage'));

create policy cities_select on public.cities
  for select to authenticated
  using (company_id is null or app.same_company(company_id));

create policy cities_write on public.cities
  for all to authenticated
  using (company_id is not null and app.same_company(company_id) and app.has_perm('settings.areas.manage'))
  with check (company_id is not null and app.same_company(company_id) and app.has_perm('settings.areas.manage'));

create policy order_imports_select on public.order_imports
  for select to authenticated
  using (app.same_company(company_id) and (app.has_perm('orders.import') or uploaded_by = app.uid()));

create policy order_imports_write on public.order_imports
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('orders.import'))
  with check (app.same_company(company_id) and app.has_perm('orders.import'));

create policy order_import_rows_all on public.order_import_rows
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('orders.import'))
  with check (app.same_company(company_id) and app.has_perm('orders.import'));

grant select, insert, update, delete on public.user_table_preferences to authenticated;
grant select on public.governorates, public.cities to authenticated;
grant insert, update, delete on public.governorates, public.cities to authenticated;
grant select, insert, update, delete on public.order_imports, public.order_import_rows to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Demo ticket types, so the Raise Ticket flow has rules to obey
-- -----------------------------------------------------------------------------

-- Provisioned per company on creation, alongside the other defaults. Without
-- these the ticket screen is a form with an empty Issue Type list.
create or replace function app.provision_company_ticket_types(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.ticket_types
    (company_id, code, name_en, name_ar, sla_clock, sla_hours, requires_sla_breach, default_priority, sort_order)
  values
    (p_company_id, 'delayed_confirmation', 'Delayed confirmation', 'تأخر التأكيد',       'confirmation', 2,  true,  'high',   1),
    (p_company_id, 'wrong_confirmation',   'Wrong confirmation',   'تأكيد خاطئ',         'none',         null, false, 'high',   2),
    (p_company_id, 'warehouse_delay',      'Warehouse delay',      'تأخر المخزن',        'warehouse',    12, true,  'medium', 3),
    (p_company_id, 'shipping_delay',       'Shipping delay',       'تأخر الشحن',         'shipping',     24, true,  'medium', 4),
    (p_company_id, 'delivery_delay',       'Delivery delay',       'تأخر التسليم',       'delivery',     72, true,  'high',   5),
    (p_company_id, 'return_delay',         'Return delay',         'تأخر الاسترجاع',     'return',       48, true,  'medium', 6),
    (p_company_id, 'settlement_issue',     'Settlement issue',     'مشكلة في التسوية',   'settlement',   168, true, 'low',    7)
  on conflict (company_id, code) do nothing;
end;
$$;

create or replace function app.provision_ticket_types_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.provision_company_ticket_types(new.id);
  return new;
end;
$$;

create trigger companies_provision_ticket_types
  after insert on public.companies
  for each row execute function app.provision_ticket_types_trigger();

-- Backfill the companies that already exist.
do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_ticket_types(v_company);
  end loop;
end;
$$;
