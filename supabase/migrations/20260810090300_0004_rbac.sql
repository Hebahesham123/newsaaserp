-- =============================================================================
-- Green ERP — 0004 Role-Based Access Control
-- Four permission levels: screen · action · data · field  (spec §2.6, §2.7)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permission catalogue — global, immutable, seeded in 0008.
-- A permission code is `<module>.<action>`, e.g. 'merchants.create'.
-- -----------------------------------------------------------------------------
create table public.permissions (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  module       text not null,          -- companies | merchants | stores | users | ...
  screen       text,                   -- screen this permission gates (§2.7.1 screen level)
  action       text not null,          -- view | create | edit | delete | approve | export | ...
  label_en     text not null,
  label_ar     text not null,
  description  text,

  -- §2.7.2 sensitive financial permissions must be controlled separately and
  -- may require additional approval when enabled (§2.13 rule 13).
  is_sensitive        boolean not null default false,
  requires_approval   boolean not null default false,

  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

comment on table public.permissions is
  '§2.7.1 catalogue of screen and action permissions. Global (not per-company) so the permission matrix is comparable across tenants.';

create index permissions_module_idx on public.permissions (module, sort_order);

-- -----------------------------------------------------------------------------
-- Roles — §2.6
-- company_id NULL = system template, cloned into each company on provisioning.
-- -----------------------------------------------------------------------------
create table public.roles (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies (id) on delete cascade,
  merchant_id  uuid references public.merchants (id) on delete cascade,

  code         text not null,
  name_en      text not null,
  name_ar      text not null,
  description  text,

  is_system_template boolean not null default false,
  is_active          boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_users (id) on delete set null,
  updated_by   uuid references public.app_users (id) on delete set null
);

comment on table public.roles is
  '§2.6.1 a named set of permissions assigned by job responsibility. Templates (company_id IS NULL) are cloned per company by app.provision_company_roles().';

-- One code per company; templates are unique among themselves.
create unique index roles_company_code_unique  on public.roles (company_id, code) where company_id is not null;
create unique index roles_template_code_unique on public.roles (code)             where company_id is null;
create index roles_company_idx on public.roles (company_id);

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function app.set_updated_at();

create table public.role_permissions (
  role_id       uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  granted_at    timestamptz not null default now(),
  granted_by    uuid references public.app_users (id) on delete set null,
  primary key (role_id, permission_id)
);

create index role_permissions_permission_idx on public.role_permissions (permission_id);

create table public.user_roles (
  user_id     uuid not null references public.app_users (id) on delete cascade,
  role_id     uuid not null references public.roles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.app_users (id) on delete set null,
  primary key (user_id, role_id)
);

create index user_roles_role_idx on public.user_roles (role_id);

-- -----------------------------------------------------------------------------
-- Data permissions — §2.7.1 "Data Permissions"
--
-- Semantics: absence of a row for a scope type means UNRESTRICTED within the
-- user's company. Presence of one or more rows restricts to exactly those ids.
-- This makes "Company Admin sees everything" the natural default and keeps the
-- restriction explicit rather than requiring an exhaustive grant list.
-- -----------------------------------------------------------------------------
create table public.user_data_scopes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.app_users (id) on delete cascade,
  scope_type  public.data_scope_type not null,

  -- Referenced entity for merchant/store/warehouse/team scopes; NULL for the
  -- behavioural scopes (assigned_only, own_records, all_company).
  scope_id    uuid,

  -- §2.7.1 "Records within a defined date range"
  valid_from  date,
  valid_to    date,

  created_at  timestamptz not null default now(),
  created_by  uuid references public.app_users (id) on delete set null,

  constraint user_data_scopes_unique unique (user_id, scope_type, scope_id),
  constraint user_data_scopes_id_check check (
    (scope_type in ('merchant', 'store', 'warehouse', 'team') and scope_id is not null)
    or (scope_type in ('all_company', 'assigned_only', 'own_records', 'date_range') and scope_id is null)
  )
);

comment on table public.user_data_scopes is
  '§2.7.1 data-level permissions. No row for a scope type = unrestricted within the company; one or more rows = restricted to those ids.';

create index user_data_scopes_user_idx on public.user_data_scopes (user_id, scope_type);

-- -----------------------------------------------------------------------------
-- Field-level permissions — §2.7.1 "Field-Level Permissions", §2.7.3
-- -----------------------------------------------------------------------------
create table public.role_field_policies (
  id          uuid primary key default gen_random_uuid(),
  role_id     uuid not null references public.roles (id) on delete cascade,
  entity      text not null,                  -- 'orders' | 'customers' | 'products' | ...
  field       text not null,                  -- 'phone' | 'address' | 'cost' | ...
  visibility  public.field_visibility not null default 'visible',
  can_edit    boolean not null default false,

  -- §2.7.3 "Partial masking of customer phone numbers should be supported"
  mask_pattern text,                          -- e.g. '01#####**89'

  created_at  timestamptz not null default now(),
  constraint role_field_policies_unique unique (role_id, entity, field)
);

comment on table public.role_field_policies is
  '§2.7.1/§2.7.3 field visibility and masking per role. The most restrictive policy across a user''s roles wins.';

create index role_field_policies_role_idx on public.role_field_policies (role_id, entity);

-- -----------------------------------------------------------------------------
-- Segregation of duties — §2.7.4
-- The maker/checker primitive. Phase 4 (stock adjustments), Phase 5 (returns)
-- and Phase 6 (settlements, invoices) all raise approval_requests through this.
-- -----------------------------------------------------------------------------
create table public.approval_requests (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,

  request_type   text not null,               -- 'stock_adjustment' | 'settlement' | 'invoice' | ...
  entity         text not null,
  entity_id      uuid,
  payload        jsonb not null default '{}'::jsonb,
  reason         text,

  status         public.approval_status not null default 'pending',

  requested_by   uuid not null references public.app_users (id) on delete restrict,
  requested_at   timestamptz not null default now(),
  decided_by     uuid references public.app_users (id) on delete restrict,
  decided_at     timestamptz,
  decision_note  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- §2.7.4: the same user cannot create and approve a sensitive transaction.
  constraint approval_requests_sod_check check (decided_by is null or decided_by <> requested_by)
);

comment on constraint approval_requests_sod_check on public.approval_requests is
  '§2.7.4 segregation of duties — maker may not be checker. Enforced in the database so no code path can bypass dual control.';

create index approval_requests_company_status_idx on public.approval_requests (company_id, status);
create index approval_requests_entity_idx         on public.approval_requests (entity, entity_id);

create trigger approval_requests_set_updated_at
  before update on public.approval_requests
  for each row execute function app.set_updated_at();
