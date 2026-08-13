-- =============================================================================
-- Green ERP — 0003 Identity
-- Users, departments, teams, shifts.  Spec §2.5, §2.8
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Application users — §2.5.2 User Master Data
--
-- 1:1 with auth.users. Kept separate because the spec requires ~25 business
-- attributes, org-chart relationships and per-company isolation that do not
-- belong in Supabase's auth schema.
-- -----------------------------------------------------------------------------
create table public.app_users (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid unique references auth.users (id) on delete set null,

  -- NULL company_id = platform-level operator (System Owner / System Admin, §1.7).
  -- Every other user is scoped to exactly one company.
  company_id        uuid references public.companies (id) on delete restrict,
  merchant_id       uuid references public.merchants (id) on delete restrict,

  is_platform_admin boolean not null default false,

  full_name         text not null,
  email             text not null,
  phone             text,
  employee_code     text,
  job_title         text,
  avatar_url        text,

  department_id     uuid,                       -- FK added below
  team_id           uuid,                       -- FK added below
  manager_id        uuid references public.app_users (id) on delete set null,

  locale            text not null default 'ar',
  timezone          text not null default 'Africa/Cairo',

  hire_date              date,
  system_access_start_date date,

  user_type         text,
  status            public.user_status not null default 'invited',

  -- §2.5.2 working pattern & capacity — consumed by Phase 3 order assignment
  working_hours     jsonb   not null default '{}'::jsonb,
  working_days      smallint[] not null default '{}',   -- 0=Sunday … 6=Saturday
  performance_target jsonb  not null default '{}'::jsonb,
  max_assigned_orders integer check (max_assigned_orders is null or max_assigned_orders > 0),

  notification_preferences jsonb not null default '{}'::jsonb,

  -- §2.5.4 Authentication and Security
  last_login_at        timestamptz,
  failed_login_count   integer not null default 0,
  locked_until         timestamptz,
  two_factor_method    text,
  must_reset_password  boolean not null default false,
  allowed_ip_ranges    text[],

  notes             text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  archived_at       timestamptz,
  archived_by       uuid,

  constraint app_users_locale_check check (locale in ('ar', 'en')),
  constraint app_users_employee_code_unique unique (company_id, employee_code),
  -- Platform admins are company-less; everyone else must belong to a company.
  constraint app_users_scope_check check (
    (is_platform_admin and company_id is null) or (not is_platform_admin and company_id is not null)
  )
);

comment on table public.app_users is
  'Employee, manager, merchant or other authorized system user (§1.8). Users with recorded transactions are archived, never deleted (§2.13 rule 21).';
comment on column public.app_users.is_platform_admin is
  '§1.7 System Owner / System Administrator. Spans all companies; bypasses tenant RLS via app.is_platform_admin().';

create index app_users_company_idx  on public.app_users (company_id);
create index app_users_merchant_idx on public.app_users (merchant_id) where merchant_id is not null;
create index app_users_status_idx   on public.app_users (company_id, status);
create index app_users_email_idx    on public.app_users (lower(email));
create index app_users_name_trgm_idx on public.app_users using gin (full_name extensions.gin_trgm_ops);

create trigger app_users_set_updated_at
  before update on public.app_users
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Departments — §2.8.1
-- -----------------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  code        text not null,
  name_ar     text not null,
  name_en     text not null,
  manager_id  uuid references public.app_users (id) on delete set null,
  description text,
  is_active   boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  archived_at timestamptz,
  archived_by uuid,

  constraint departments_code_unique unique (company_id, code)
);

create index departments_company_idx on public.departments (company_id);

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Shifts — §2.8.3
-- -----------------------------------------------------------------------------
create table public.shifts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  name              text not null,
  start_time        time not null,
  end_time          time not null,
  working_days      smallint[] not null default '{}',
  break_start       time,
  break_end         time,
  timezone          text not null default 'Africa/Cairo',
  department_id     uuid references public.departments (id) on delete set null,
  workload_capacity integer check (workload_capacity is null or workload_capacity > 0),
  handover_rules    jsonb not null default '{}'::jsonb,
  is_active         boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  archived_at       timestamptz,
  archived_by       uuid
);

create index shifts_company_idx on public.shifts (company_id);

create trigger shifts_set_updated_at
  before update on public.shifts
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Teams — §2.8.2
-- -----------------------------------------------------------------------------
create table public.teams (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  department_id     uuid references public.departments (id) on delete set null,
  code              text not null,
  name              text not null,
  leader_id         uuid references public.app_users (id) on delete set null,
  shift_id          uuid references public.shifts (id) on delete set null,

  -- Routing dimensions the team handles. Consumed by Phase 3 smart assignment (§4.6).
  assigned_store_ids    uuid[] not null default '{}',
  assigned_merchant_ids uuid[] not null default '{}',
  order_types           text[] not null default '{}',
  assigned_regions      text[] not null default '{}',

  max_workload_capacity integer check (max_workload_capacity is null or max_workload_capacity > 0),
  targets               jsonb not null default '{}'::jsonb,
  assignment_workflow   jsonb not null default '{}'::jsonb,
  is_active             boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  archived_at       timestamptz,
  archived_by       uuid,

  constraint teams_code_unique unique (company_id, code)
);

create index teams_company_idx    on public.teams (company_id);
create index teams_department_idx on public.teams (department_id);

create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function app.set_updated_at();

create table public.team_members (
  team_id   uuid not null references public.teams (id) on delete cascade,
  user_id   uuid not null references public.app_users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_members_user_idx on public.team_members (user_id);

create table public.shift_members (
  shift_id  uuid not null references public.shifts (id) on delete cascade,
  user_id   uuid not null references public.app_users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (shift_id, user_id)
);

create index shift_members_user_idx on public.shift_members (user_id);

-- -----------------------------------------------------------------------------
-- Deferred FKs — these columns were declared before app_users existed.
-- -----------------------------------------------------------------------------
alter table public.app_users
  add constraint app_users_department_fk foreign key (department_id) references public.departments (id) on delete set null,
  add constraint app_users_team_fk       foreign key (team_id)       references public.teams (id)       on delete set null;

alter table public.companies
  add constraint companies_account_manager_fk foreign key (account_manager_id) references public.app_users (id) on delete set null;

alter table public.merchants
  add constraint merchants_account_manager_fk foreign key (account_manager_id) references public.app_users (id) on delete set null;

alter table public.warehouses
  add constraint warehouses_manager_fk foreign key (manager_id) references public.app_users (id) on delete set null;

alter table public.stores
  add constraint stores_manager_fk foreign key (store_manager_id) references public.app_users (id) on delete set null;
