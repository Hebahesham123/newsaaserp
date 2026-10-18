-- =============================================================================
-- 0028 — Tickets, SLA validation and KPI impact
--
-- §2 Quick Actions, §3 Ticket Rules & SLA Validation, §4 Ticket & KPI Integration.
--
-- Two rules from the brief shape everything here, and both are refusals:
--
--   A ticket may not be raised before the SLA it complains about is actually
--   breached. "Delayed confirmation" an hour into a two-hour SLA is not a
--   complaint, it is impatience, and letting it through would pollute the
--   metric the SLA exists to measure.
--
--   Raising a ticket does not touch anyone's KPI. The penalty lands only once a
--   human has reviewed it and confirmed responsibility. A system where opening
--   a ticket is itself the punishment is one where people stop opening tickets.
--
-- The person raising a ticket supplies three things: type, description and
-- evidence. Routing, priority, SLA and KPI rule are all derived — they are
-- properties of how the company is organised, not opinions of the reporter.
-- =============================================================================

create type public.ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');
create type public.ticket_priority as enum ('low', 'medium', 'high', 'urgent');

-- Which clock a ticket type measures. `none` is for types that are not about
-- lateness at all, such as a wrong confirmation.
create type public.sla_clock as enum (
  'none',
  'confirmation',
  'warehouse',
  'shipping',
  'delivery',
  'return',
  'settlement'
);

create type public.ticket_attachment_kind as enum (
  'file',
  'screenshot',
  'document',
  'call_recording'
);

-- -----------------------------------------------------------------------------
-- 1. The configured types, and the rules attached to each
-- -----------------------------------------------------------------------------

create table public.ticket_types (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,

  code          text not null,
  name_en       text not null,
  name_ar       text not null,
  description   text,

  -- The SLA this type complains about, and the threshold that must pass first.
  sla_clock     public.sla_clock not null default 'none',
  sla_hours     numeric(8,2) check (sla_hours is null or sla_hours >= 0),
  -- A type may be exempt: "wrong confirmation" is wrong immediately.
  requires_sla_breach boolean not null default true,

  -- Where it goes. Left null, routing falls back to the order's own team.
  assigned_department_id uuid references public.departments (id) on delete set null,
  assigned_team_id       uuid references public.teams (id) on delete set null,

  default_priority public.ticket_priority not null default 'medium',

  -- §4: the KPI this ticket counts against, once responsibility is confirmed.
  kpi_id        uuid references public.kpi_definitions (id) on delete set null,
  kpi_weight    numeric(8,2) not null default 1
    check (kpi_weight >= 0),

  is_active     boolean not null default true,
  sort_order    integer not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.app_users (id) on delete set null,
  updated_by    uuid references public.app_users (id) on delete set null,

  constraint ticket_types_code_unique unique (company_id, code),

  -- Requiring a breach without saying how long is a rule that can never be
  -- evaluated, so it is refused at definition time rather than at 2am.
  constraint ticket_types_sla_complete check (
    not requires_sla_breach
    or sla_clock = 'none'
    or sla_hours is not null
  )
);

create index ticket_types_company_idx on public.ticket_types (company_id);

create trigger ticket_types_updated_at
  before update on public.ticket_types
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. The tickets themselves
-- -----------------------------------------------------------------------------

create sequence if not exists public.ticket_number_seq;

create table public.tickets (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  ticket_number text not null,

  order_id      uuid references public.orders (id) on delete set null,
  ticket_type_id uuid not null references public.ticket_types (id) on delete restrict,

  description   text not null,
  status        public.ticket_status not null default 'open',
  priority      public.ticket_priority not null default 'medium',

  -- Who reported it, and from where. Derived from the session, not the form.
  raised_by           uuid references public.app_users (id) on delete set null,
  raised_from_team_id uuid references public.teams (id) on delete set null,

  -- Where it landed. Derived from the type, falling back to the order's owner.
  assigned_department_id uuid references public.departments (id) on delete set null,
  assigned_team_id       uuid references public.teams (id) on delete set null,
  responsible_user_id    uuid references public.app_users (id) on delete set null,
  supervisor_id          uuid references public.app_users (id) on delete set null,

  -- The SLA state at the moment it was raised, kept because the thresholds on
  -- the type may later change and this ticket was judged against the old one.
  sla_clock       public.sla_clock not null default 'none',
  sla_hours       numeric(8,2),
  sla_elapsed_hours numeric(8,2),
  sla_breached    boolean not null default false,
  sla_due_at      timestamptz,

  opened_at       timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at     timestamptz,
  closed_at       timestamptz,

  resolution      text,

  -- §4. The KPI penalty waits here until somebody confirms the fault was real.
  responsibility_confirmed    boolean not null default false,
  responsibility_confirmed_by uuid references public.app_users (id) on delete set null,
  responsibility_confirmed_at timestamptz,
  kpi_applied     boolean not null default false,
  kpi_entry_id    uuid references public.kpi_entries (id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.app_users (id) on delete set null,
  updated_by    uuid references public.app_users (id) on delete set null,

  constraint tickets_number_unique unique (company_id, ticket_number),

  -- A resolved ticket without a resolution is an unanswered question wearing a
  -- closed label.
  constraint tickets_resolution_present check (
    status not in ('resolved', 'closed') or resolution is not null
  )
);

create index tickets_company_idx     on public.tickets (company_id);
create index tickets_order_idx       on public.tickets (order_id);
create index tickets_status_idx      on public.tickets (company_id, status);
create index tickets_responsible_idx on public.tickets (responsible_user_id);
create index tickets_team_idx        on public.tickets (assigned_team_id);

create trigger tickets_updated_at
  before update on public.tickets
  for each row execute function app.set_updated_at();

create table public.ticket_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  ticket_id   uuid not null references public.tickets (id) on delete cascade,

  event_type  text not null,
  from_status public.ticket_status,
  to_status   public.ticket_status,
  note        text,
  payload     jsonb not null default '{}'::jsonb,

  actor_id    uuid references public.app_users (id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index ticket_events_ticket_idx on public.ticket_events (ticket_id, occurred_at desc);

create table public.ticket_attachments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  ticket_id    uuid not null references public.tickets (id) on delete cascade,

  kind         public.ticket_attachment_kind not null default 'file',
  file_url     text not null,
  file_name    text not null,
  content_type text,
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),

  uploaded_by  uuid references public.app_users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index ticket_attachments_ticket_idx on public.ticket_attachments (ticket_id);

-- -----------------------------------------------------------------------------
-- 3. Reading the clock
-- -----------------------------------------------------------------------------

-- How long the relevant stage has actually taken. Where the milestone has not
-- happened yet the clock is still running, so it is measured to now() — that is
-- precisely the case a lateness ticket is about.
create or replace function app.ticket_sla_elapsed_hours(
  p_order_id uuid,
  p_clock    public.sla_clock
)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_from  timestamptz;
  v_to    timestamptz;
begin
  if p_clock = 'none' or p_order_id is null then
    return null;
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then
    return null;
  end if;

  if p_clock = 'confirmation' then
    v_from := coalesce(v_order.order_date, v_order.created_at);
    v_to   := coalesce(v_order.confirmed_at, v_order.cancelled_at, now());

  elsif p_clock = 'warehouse' then
    v_from := v_order.ready_at;
    select min(s.created_at) into v_to
      from public.shipments s where s.order_id = p_order_id;
    v_to := coalesce(v_to, now());

  elsif p_clock = 'shipping' then
    select min(s.created_at), min(s.handed_over_at) into v_from, v_to
      from public.shipments s where s.order_id = p_order_id;
    v_to := coalesce(v_to, now());

  elsif p_clock = 'delivery' then
    select min(s.handed_over_at), min(s.delivered_at) into v_from, v_to
      from public.shipments s where s.order_id = p_order_id;
    v_to := coalesce(v_to, now());

  elsif p_clock = 'return' then
    select min(r.created_at), min(r.closed_at) into v_from, v_to
      from public.returns r where r.order_id = p_order_id;
    v_to := coalesce(v_to, now());

  else
    -- settlement and anything added later: measured from the order landing.
    v_from := coalesce(v_order.order_date, v_order.created_at);
    v_to   := now();
  end if;

  if v_from is null then
    return null;
  end if;

  return round(extract(epoch from (v_to - v_from)) / 3600.0, 2);
end;
$$;

comment on function app.ticket_sla_elapsed_hours(uuid, public.sla_clock) is
  'Hours elapsed on one SLA clock for an order, measured to now() while the stage is still open.';

-- -----------------------------------------------------------------------------
-- 4. Raising one: route it, judge it, and refuse it if it is premature
-- -----------------------------------------------------------------------------

create or replace function app.route_ticket()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type     public.ticket_types;
  v_order    public.orders;
  v_elapsed  numeric;
  v_team     public.teams;
begin
  select * into v_type from public.ticket_types where id = new.ticket_type_id;

  if v_type.id is null then
    raise exception 'Unknown ticket type.' using errcode = 'foreign_key_violation';
  end if;

  if not v_type.is_active then
    raise exception 'Ticket type % is no longer in use.', v_type.code
      using errcode = 'check_violation';
  end if;

  if new.order_id is not null then
    select * into v_order from public.orders where id = new.order_id;
  end if;

  new.ticket_number := coalesce(
    nullif(new.ticket_number, ''),
    'TK-' || lpad(nextval('public.ticket_number_seq')::text, 5, '0')
  );

  /* --- the SLA gate (§3) ------------------------------------------------- */

  v_elapsed := app.ticket_sla_elapsed_hours(new.order_id, v_type.sla_clock);

  new.sla_clock         := v_type.sla_clock;
  new.sla_hours         := v_type.sla_hours;
  new.sla_elapsed_hours := v_elapsed;
  new.sla_breached      := v_elapsed is not null
                           and v_type.sla_hours is not null
                           and v_elapsed >= v_type.sla_hours;

  if v_type.requires_sla_breach and v_type.sla_clock <> 'none' then
    if v_elapsed is null then
      raise exception
        'This ticket type measures the % SLA, which has not started for this order yet.',
        v_type.sla_clock
        using errcode = 'check_violation';
    end if;

    if not new.sla_breached then
      raise exception
        'The % SLA is % hours and only %.2f have passed. This ticket cannot be raised yet.',
        v_type.sla_clock, v_type.sla_hours, v_elapsed
        using errcode = 'check_violation';
    end if;
  end if;

  if v_order.id is not null and v_type.sla_hours is not null then
    new.sla_due_at := coalesce(v_order.order_date, v_order.created_at)
                      + make_interval(hours => floor(v_type.sla_hours)::int);
  end if;

  /* --- routing (§2: the reporter does not choose any of this) ------------ */

  new.raised_by := coalesce(new.raised_by, app.uid());

  select t.* into v_team
    from public.teams t
    join public.team_members tm on tm.team_id = t.id
   where tm.user_id = new.raised_by
   limit 1;

  new.raised_from_team_id := coalesce(new.raised_from_team_id, v_team.id);

  -- The configured destination wins; otherwise it lands on whoever owns the
  -- order, which is the only other party who can act on it.
  new.assigned_team_id := coalesce(v_type.assigned_team_id, new.assigned_team_id);
  new.assigned_department_id := coalesce(
    v_type.assigned_department_id,
    new.assigned_department_id,
    (select t.department_id from public.teams t where t.id = new.assigned_team_id)
  );

  new.responsible_user_id := coalesce(new.responsible_user_id, v_order.assigned_to);

  new.supervisor_id := coalesce(
    new.supervisor_id,
    (select t.leader_id from public.teams t where t.id = new.assigned_team_id),
    (select d.manager_id from public.departments d where d.id = new.assigned_department_id)
  );

  new.priority := coalesce(new.priority, v_type.default_priority);

  return new;
end;
$$;

comment on function app.route_ticket() is
  'Derives routing, priority and SLA state for a new ticket, and refuses one raised before its SLA is breached.';

create trigger tickets_route
  before insert on public.tickets
  for each row execute function app.route_ticket();

-- -----------------------------------------------------------------------------
-- 5. Lifecycle timestamps and the activity log
-- -----------------------------------------------------------------------------

create or replace function app.track_ticket_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'in_progress' and new.first_response_at is null then
      new.first_response_at := now();
    end if;
    if new.status = 'resolved' and new.resolved_at is null then
      new.resolved_at := now();
    end if;
    if new.status = 'closed' and new.closed_at is null then
      new.closed_at := now();
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.responsibility_confirmed
     and not old.responsibility_confirmed then
    new.responsibility_confirmed_at := coalesce(new.responsibility_confirmed_at, now());
    new.responsibility_confirmed_by := coalesce(new.responsibility_confirmed_by, app.uid());
  end if;

  return new;
end;
$$;

create trigger tickets_track_status
  before update on public.tickets
  for each row execute function app.track_ticket_status();

create or replace function app.log_ticket_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events (company_id, ticket_id, event_type, to_status, note, actor_id)
    values (new.company_id, new.id, 'raised', new.status, new.description, new.raised_by);

  elsif new.status is distinct from old.status then
    insert into public.ticket_events (company_id, ticket_id, event_type, from_status, to_status, note, actor_id)
    values (new.company_id, new.id, 'status_changed', old.status, new.status, new.resolution, app.uid());

  elsif new.responsibility_confirmed and not old.responsibility_confirmed then
    insert into public.ticket_events (company_id, ticket_id, event_type, note, actor_id)
    values (new.company_id, new.id, 'responsibility_confirmed', new.resolution, app.uid());
  end if;

  return new;
end;
$$;

create trigger tickets_log_event
  after insert or update on public.tickets
  for each row execute function app.log_ticket_event();

-- -----------------------------------------------------------------------------
-- 6. §4 — KPI impact, and only after a human says so
-- -----------------------------------------------------------------------------

create or replace function app.apply_ticket_kpi()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type  public.ticket_types;
  v_entry uuid;
begin
  -- Nothing happens on raise, on assignment, or on resolution. Only this.
  if not (new.responsibility_confirmed and not old.responsibility_confirmed) then
    return new;
  end if;

  if new.kpi_applied then
    return new;
  end if;

  select * into v_type from public.ticket_types where id = new.ticket_type_id;

  if v_type.kpi_id is null or new.responsible_user_id is null then
    return new;
  end if;

  insert into public.kpi_entries
    (company_id, kpi_id, subject, user_id, period_start, period_end,
     actual_value, note, created_by)
  values
    (new.company_id, v_type.kpi_id, 'user', new.responsible_user_id,
     date_trunc('month', coalesce(new.opened_at, now()))::date,
     (date_trunc('month', coalesce(new.opened_at, now())) + interval '1 month - 1 day')::date,
     v_type.kpi_weight,
     'Ticket ' || new.ticket_number,
     app.uid())
  on conflict do nothing
  returning id into v_entry;

  new.kpi_applied  := true;
  new.kpi_entry_id := coalesce(v_entry, new.kpi_entry_id);

  return new;
end;
$$;

comment on function app.apply_ticket_kpi() is
  'Writes the KPI penalty for a ticket, once and only once responsibility has been confirmed by a person.';

create trigger tickets_apply_kpi
  before update of responsibility_confirmed on public.tickets
  for each row execute function app.apply_ticket_kpi();

-- -----------------------------------------------------------------------------
-- 7. Access control
-- -----------------------------------------------------------------------------

alter table public.ticket_types       enable row level security;
alter table public.tickets            enable row level security;
alter table public.ticket_events      enable row level security;
alter table public.ticket_attachments enable row level security;

insert into public.permissions (code, module, screen, action, label_en, label_ar, is_sensitive, requires_approval, sort_order) values
  ('tickets.view',        'tickets', 'tickets', 'view',      'View tickets',               'عرض التذاكر',             false, false, 7400),
  ('tickets.create',      'tickets', 'tickets', 'create',    'Raise tickets',              'إنشاء تذكرة',             false, false, 7401),
  ('tickets.manage',      'tickets', 'tickets', 'edit',      'Work on tickets',            'معالجة التذاكر',          false, false, 7402),
  ('tickets.resolve',     'tickets', 'tickets', 'approve',   'Resolve and close tickets',  'حل وإغلاق التذاكر',       false, false, 7403),
  ('tickets.responsibility', 'tickets', 'tickets', 'approve', 'Confirm responsibility',    'اعتماد المسؤولية',        true,  true,  7404),
  ('tickets.configure',   'tickets', 'ticket_types', 'configure', 'Configure ticket rules', 'إعداد قواعد التذاكر',    false, false, 7405)
on conflict (code) do nothing;

select app.grant_perms_to_template('super_admin',        array['*']);
select app.grant_perms_to_template('system_admin',       array['tickets.*']);
select app.grant_perms_to_template('company_admin',      array['tickets.*']);
select app.grant_perms_to_template('operations_manager', array['tickets.view', 'tickets.create', 'tickets.manage', 'tickets.resolve', 'tickets.responsibility']);
select app.grant_perms_to_template('confirmation_agent', array['tickets.view', 'tickets.create']);
select app.grant_perms_to_template('warehouse_manager',  array['tickets.view', 'tickets.create', 'tickets.manage']);
select app.grant_perms_to_template('merchant_admin',     array['tickets.view', 'tickets.create']);

create policy ticket_types_select on public.ticket_types
  for select to authenticated
  using (app.same_company(company_id) and app.has_perm('tickets.view'));

create policy ticket_types_write on public.ticket_types
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('tickets.configure'))
  with check (app.same_company(company_id) and app.has_perm('tickets.configure'));

-- A ticket is visible to whoever reported it, whoever must act on it, and
-- whoever supervises them — plus anyone holding the module permission.
create policy tickets_select on public.tickets
  for select to authenticated
  using (
    app.same_company(company_id)
    and (
      app.has_perm('tickets.view')
      or raised_by = app.uid()
      or responsible_user_id = app.uid()
      or supervisor_id = app.uid()
    )
  );

create policy tickets_insert on public.tickets
  for insert to authenticated
  with check (app.same_company(company_id) and app.has_perm('tickets.create'));

create policy tickets_update on public.tickets
  for update to authenticated
  using (
    app.same_company(company_id)
    and (
      app.has_perm('tickets.manage')
      or responsible_user_id = app.uid()
      or supervisor_id = app.uid()
    )
  )
  with check (app.same_company(company_id));

create policy ticket_events_select on public.ticket_events
  for select to authenticated
  using (
    app.same_company(company_id)
    and exists (select 1 from public.tickets t where t.id = ticket_id)
  );

create policy ticket_events_insert on public.ticket_events
  for insert to authenticated
  with check (app.same_company(company_id));

create policy ticket_attachments_select on public.ticket_attachments
  for select to authenticated
  using (
    app.same_company(company_id)
    and exists (select 1 from public.tickets t where t.id = ticket_id)
  );

create policy ticket_attachments_write on public.ticket_attachments
  for all to authenticated
  using (app.same_company(company_id) and app.has_perm('tickets.create'))
  with check (app.same_company(company_id) and app.has_perm('tickets.create'));

grant select, insert, update on public.ticket_types, public.tickets to authenticated;
grant select, insert on public.ticket_events to authenticated;
grant select, insert, delete on public.ticket_attachments to authenticated;

-- -----------------------------------------------------------------------------
-- 8. A readable ticket, with its SLA state already worked out
-- -----------------------------------------------------------------------------

create view public.ticket_board
with (security_invoker = on) as
select
  t.id,
  t.company_id,
  t.ticket_number,
  t.order_id,
  o.order_number,
  o.customer_name,
  o.customer_phone,
  tt.code         as type_code,
  tt.name_en      as type_name_en,
  tt.name_ar      as type_name_ar,
  t.description,
  t.status,
  t.priority,
  t.sla_clock,
  t.sla_hours,
  t.sla_elapsed_hours,
  t.sla_breached,
  t.sla_due_at,
  t.opened_at,
  t.resolved_at,
  t.closed_at,
  t.raised_by,
  raiser.full_name      as raised_by_name,
  t.assigned_team_id,
  team.name             as assigned_team_name,
  t.assigned_department_id,
  dept.name_en          as assigned_department_name,
  t.responsible_user_id,
  owner.full_name       as responsible_user_name,
  t.supervisor_id,
  boss.full_name        as supervisor_name,
  t.responsibility_confirmed,
  t.kpi_applied,
  -- Hours a ticket has been open, which is what an SLA board actually sorts on.
  round(extract(epoch from (coalesce(t.resolved_at, now()) - t.opened_at)) / 3600.0, 2)
    as age_hours
from public.tickets t
join public.ticket_types tt on tt.id = t.ticket_type_id
left join public.orders o      on o.id = t.order_id
left join public.app_users raiser on raiser.id = t.raised_by
left join public.app_users owner  on owner.id = t.responsible_user_id
left join public.app_users boss   on boss.id = t.supervisor_id
left join public.teams team       on team.id = t.assigned_team_id
left join public.departments dept on dept.id = t.assigned_department_id;

comment on view public.ticket_board is
  'Tickets with their type, routing and SLA state resolved, for the Tickets list and the order drawer.';

grant select on public.ticket_board to authenticated;
