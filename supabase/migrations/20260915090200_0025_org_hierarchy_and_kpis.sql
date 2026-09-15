-- =============================================================================
-- Green ERP — 0025 Department hierarchy & departmental KPIs
--
-- Two related changes:
--
--  1. **Departments become a tree.** A `parent_id` rather than a main/sub flag,
--     because the brief asks for arbitrary depth later and a two-level model
--     would have to be rebuilt to get there. Cycles are refused by trigger:
--     a department cannot end up as its own ancestor.
--
--  2. **KPIs hang off the parent department.** A definition is owned by the
--     department that cares about it; each entry targets one subject — a
--     sub-department, a team, a role or a person — for one period.
--
-- Achievement is *derived*, never stored. Whether a KPI is doing well depends
-- on its direction (a response time improves by falling, a confirmation rate by
-- rising), so a stored percentage would silently go stale the moment someone
-- corrected the direction. `kpi_performance` computes it instead.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Hierarchy
-- -----------------------------------------------------------------------------

alter table public.departments
  add column parent_id uuid references public.departments (id) on delete restrict;

comment on column public.departments.parent_id is
  'Null means a main department. Any depth is permitted; app.assert_department_acyclic refuses cycles.';

create index departments_parent_idx on public.departments (parent_id) where parent_id is not null;

/**
 * A department may not be its own ancestor.
 *
 * Walks up the proposed chain rather than checking only the immediate parent,
 * because the illegal case that actually happens is a three-deep loop created
 * by re-parenting a grandparent under its own grandchild.
 */
create or replace function app.assert_department_acyclic()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cursor uuid := new.parent_id;
  v_depth  integer := 0;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A department cannot be its own parent'
      using errcode = 'check_violation';
  end if;

  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'That parent is a descendant of this department, which would create a cycle'
        using errcode = 'check_violation';
    end if;

    v_depth := v_depth + 1;
    -- A guard against a pre-existing loop turning this into an infinite walk.
    if v_depth > 20 then
      raise exception 'Department hierarchy is deeper than 20 levels; refusing to walk further'
        using errcode = 'check_violation';
    end if;

    select parent_id into v_cursor from public.departments where id = v_cursor;
  end loop;

  return new;
end;
$$;

create trigger departments_acyclic
  before insert or update of parent_id on public.departments
  for each row execute function app.assert_department_acyclic();

/**
 * The tree, flattened — depth and a sortable path, so the UI can render an
 * indented list without recursing per row.
 */
create view public.department_tree as
with recursive walk as (
  select
    d.id, d.company_id, d.parent_id, d.code, d.name_en, d.name_ar,
    d.manager_id, d.is_active, d.archived_at,
    0 as depth,
    d.name_en::text as path,
    array[d.id] as ancestry
  from public.departments d
  where d.parent_id is null

  union all

  select
    c.id, c.company_id, c.parent_id, c.code, c.name_en, c.name_ar,
    c.manager_id, c.is_active, c.archived_at,
    w.depth + 1,
    w.path || ' / ' || c.name_en,
    w.ancestry || c.id
  from public.departments c
  join walk w on w.id = c.parent_id
)
select
  w.*,
  -- The department at the top of this branch; KPIs are owned there.
  w.ancestry[1] as root_id,
  (select count(*) from public.departments ch where ch.parent_id = w.id) as child_count,
  (select count(*) from public.app_users u where u.department_id = w.id and u.archived_at is null) as user_count
from walk w;

comment on view public.department_tree is
  'Departments with depth, a readable path and their root. `root_id` is the parent department a KPI belongs to.';

-- -----------------------------------------------------------------------------
-- 2. KPI definitions
-- -----------------------------------------------------------------------------

create type public.kpi_frequency as enum ('daily', 'weekly', 'monthly', 'quarterly');

-- Whether a bigger number is better. Response time and complaint count improve
-- by falling; confirmation rate improves by rising.
create type public.kpi_direction as enum ('higher_is_better', 'lower_is_better');

-- What a KPI is measured against.
create type public.kpi_subject as enum ('department', 'team', 'user', 'role');

create table public.kpi_definitions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  -- The department that owns and reviews this KPI. Normally a parent.
  department_id uuid not null references public.departments (id) on delete cascade,

  code          text not null,
  name_en       text not null,
  name_ar       text not null,
  description   text,

  unit          text,
  frequency     public.kpi_frequency not null default 'monthly',
  direction     public.kpi_direction not null default 'higher_is_better',

  -- The default target, inherited by an entry that does not set its own.
  default_target numeric(14,2),

  is_active     boolean not null default true,
  sort_order    integer not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.app_users (id) on delete set null,
  updated_by    uuid references public.app_users (id) on delete set null,

  constraint kpi_definitions_code_unique unique (department_id, code)
);

comment on table public.kpi_definitions is
  'A measure owned by a department. Entries below record one period of it for one subject.';

create index kpi_definitions_department_idx on public.kpi_definitions (department_id, sort_order);

create trigger kpi_definitions_set_updated_at
  before update on public.kpi_definitions
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. KPI entries — one measurement, one subject, one period
-- -----------------------------------------------------------------------------

create table public.kpi_entries (
  id            uuid primary key default gen_random_uuid(),
  kpi_id        uuid not null references public.kpi_definitions (id) on delete cascade,
  company_id    uuid not null references public.companies (id) on delete restrict,

  subject       public.kpi_subject not null,
  -- Exactly one of the four is populated, enforced below.
  department_id uuid references public.departments (id) on delete cascade,
  team_id       uuid references public.teams (id) on delete cascade,
  user_id       uuid references public.app_users (id) on delete cascade,
  role_id       uuid references public.roles (id) on delete cascade,

  period_start  date not null,
  period_end    date not null,

  target_value  numeric(14,2),
  actual_value  numeric(14,2),

  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.app_users (id) on delete set null,
  updated_by    uuid references public.app_users (id) on delete set null,

  constraint kpi_entries_period check (period_end >= period_start),

  -- The subject column must match the declared subject, and only that one may
  -- be set. Without this, a row could claim to measure a team while carrying a
  -- user id, and every report downstream would disagree with itself.
  constraint kpi_entries_subject_check check (
    (subject = 'department' and department_id is not null and team_id is null and user_id is null and role_id is null) or
    (subject = 'team'       and team_id is not null and department_id is null and user_id is null and role_id is null) or
    (subject = 'user'       and user_id is not null and department_id is null and team_id is null and role_id is null) or
    (subject = 'role'       and role_id is not null and department_id is null and team_id is null and user_id is null)
  )
);

comment on table public.kpi_entries is
  'One KPI, one subject, one period. Achievement is computed in kpi_performance, never stored.';

create index kpi_entries_kpi_idx    on public.kpi_entries (kpi_id, period_start desc);
create index kpi_entries_period_idx on public.kpi_entries (company_id, period_start desc);

-- One measurement per subject per period, so a correction updates rather than
-- silently doubling. Partial indexes because only one subject column is set.
create unique index kpi_entries_department_unique on public.kpi_entries (kpi_id, department_id, period_start) where department_id is not null;
create unique index kpi_entries_team_unique       on public.kpi_entries (kpi_id, team_id, period_start)       where team_id is not null;
create unique index kpi_entries_user_unique       on public.kpi_entries (kpi_id, user_id, period_start)       where user_id is not null;
create unique index kpi_entries_role_unique       on public.kpi_entries (kpi_id, role_id, period_start)       where role_id is not null;

create trigger kpi_entries_set_updated_at
  before update on public.kpi_entries
  for each row execute function app.set_updated_at();

/**
 * Achievement and status, derived.
 *
 * Direction is what makes this worth computing rather than storing: for a
 * lower-is-better KPI the ratio inverts, so a stored percentage would be wrong
 * the moment a definition's direction was corrected.
 */
create view public.kpi_performance as
select
  e.id            as entry_id,
  e.company_id,
  k.id            as kpi_id,
  k.code,
  k.name_en,
  k.name_ar,
  k.unit,
  k.frequency,
  k.direction,
  k.department_id as owner_department_id,
  e.subject,
  e.department_id,
  e.team_id,
  e.user_id,
  e.role_id,
  e.period_start,
  e.period_end,
  coalesce(e.target_value, k.default_target) as target_value,
  e.actual_value,
  case
    when e.actual_value is null then null
    when coalesce(e.target_value, k.default_target) is null
      or coalesce(e.target_value, k.default_target) = 0 then null
    when k.direction = 'higher_is_better'
      then round(e.actual_value / coalesce(e.target_value, k.default_target) * 100, 1)
    -- Lower is better: hitting half the target time is 200% achievement.
    when e.actual_value = 0 then null
    else round(coalesce(e.target_value, k.default_target) / e.actual_value * 100, 1)
  end as achievement_pct,
  case
    when e.actual_value is null then 'pending'
    when coalesce(e.target_value, k.default_target) is null then 'untargeted'
    when k.direction = 'higher_is_better' then
      case
        when e.actual_value >= coalesce(e.target_value, k.default_target)       then 'achieved'
        when e.actual_value >= coalesce(e.target_value, k.default_target) * 0.8 then 'at_risk'
        else 'missed'
      end
    else
      case
        when e.actual_value <= coalesce(e.target_value, k.default_target)       then 'achieved'
        when e.actual_value <= coalesce(e.target_value, k.default_target) * 1.2 then 'at_risk'
        else 'missed'
      end
  end as status
from public.kpi_entries e
join public.kpi_definitions k on k.id = e.kpi_id;

comment on view public.kpi_performance is
  'KPI entries with achievement and status derived from the definition direction. The KPI tab and department comparison read this.';

-- -----------------------------------------------------------------------------
-- 4. Access control
-- -----------------------------------------------------------------------------

alter table public.kpi_definitions enable row level security;
alter table public.kpi_entries     enable row level security;

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('kpi.view',    'org', 'department_kpi', 'view',      'View department KPIs',   'عرض مؤشرات الأداء',        false, false, 7100),
  ('kpi.manage',  'org', 'department_kpi', 'configure', 'Define and target KPIs', 'تعريف وتحديد المؤشرات',   false, false, 7101),
  ('kpi.record',  'org', 'department_kpi', 'edit',      'Record KPI results',     'تسجيل نتائج المؤشرات',    false, false, 7102)
on conflict (code) do nothing;

select app.grant_perms_to_template('super_admin',   array['*']);
select app.grant_perms_to_template('system_admin',  array['kpi.*']);
select app.grant_perms_to_template('company_admin', array['kpi.*']);

-- §KPI: defining and targeting is the manager's job; everyone else reads.
select app.grant_perms_to_template('operations_manager',       array['kpi.view', 'kpi.manage', 'kpi.record']);
select app.grant_perms_to_template('warehouse_manager',        array['kpi.view', 'kpi.manage', 'kpi.record']);
select app.grant_perms_to_template('confirmation_team_leader', array['kpi.view', 'kpi.manage', 'kpi.record']);
select app.grant_perms_to_template('store_manager',            array['kpi.view', 'kpi.record']);
select app.grant_perms_to_template('marketing_manager',        array['kpi.view', 'kpi.manage', 'kpi.record']);
select app.grant_perms_to_template('quality_auditor',          array['kpi.view']);
select app.grant_perms_to_template('reports_viewer',           array['kpi.view']);
select app.grant_perms_to_template('accountant',               array['kpi.view']);

create policy kpi_definitions_select on public.kpi_definitions
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('kpi.view'));

create policy kpi_definitions_write on public.kpi_definitions
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('kpi.manage'))
  with check (app.same_company(company_id) and app.has_perm('kpi.manage'));

create policy kpi_entries_select on public.kpi_entries
  for select to authenticated
  using (
    app.same_company(company_id)
    and (
      app.has_perm('kpi.view')
      -- Everyone can see their own numbers even without the department-wide
      -- permission; being measured without being told is indefensible.
      or user_id = app.uid()
    )
  );

create policy kpi_entries_write on public.kpi_entries
  for all to authenticated
  using (app.same_company(company_id) and (app.has_perm('kpi.manage') or app.has_perm('kpi.record')))
  with check (app.same_company(company_id) and (app.has_perm('kpi.manage') or app.has_perm('kpi.record')));

alter view public.department_tree  set (security_invoker = on);
alter view public.kpi_performance  set (security_invoker = on);

grant select, insert, update, delete on public.kpi_definitions, public.kpi_entries to authenticated;
grant select on public.department_tree, public.kpi_performance to authenticated;

create trigger kpi_definitions_audit after insert or update or delete on public.kpi_definitions for each row execute function app.audit_trigger();
create trigger kpi_entries_audit     after insert or update or delete on public.kpi_entries     for each row execute function app.audit_trigger();

do $$
declare
  v_company uuid;
begin
  for v_company in select id from public.companies loop
    perform app.provision_company_roles(v_company);
  end loop;
end $$;
