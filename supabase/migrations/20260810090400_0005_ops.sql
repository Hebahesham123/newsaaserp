-- =============================================================================
-- Green ERP — 0005 Operational logs
-- Audit log, login attempts, sync log, notifications.  Spec §2.4.5, §2.9, §2.10
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Audit log — §2.9.2 Audit Log Fields
-- Written exclusively by database triggers so no application path can skip it.
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id             bigserial primary key,

  company_id     uuid,
  merchant_id    uuid,
  actor_id       uuid references public.app_users (id) on delete set null,

  action         public.audit_action not null,
  module         text not null,                -- table / logical module
  record_id      text,

  old_value      jsonb,
  new_value      jsonb,
  changed_fields text[],

  ip_address     inet,
  device         text,
  browser        text,
  user_agent     text,

  change_reason  text,                         -- §2.9.2 "Change reason when required"
  approval_request_id uuid references public.approval_requests (id) on delete set null,
  approved_by    uuid references public.app_users (id) on delete set null,

  occurred_at    timestamptz not null default now()
);

comment on table public.audit_log is
  '§2.9 append-only activity trail. Populated by app.audit_trigger(); no UPDATE or DELETE policy exists for any client role.';

create index audit_log_company_time_idx on public.audit_log (company_id, occurred_at desc);
create index audit_log_actor_idx        on public.audit_log (actor_id, occurred_at desc);
create index audit_log_record_idx       on public.audit_log (module, record_id);
create index audit_log_action_idx       on public.audit_log (action, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Login attempts — §2.5.4 "Complete login attempt history"
-- -----------------------------------------------------------------------------
create table public.login_attempts (
  id           bigserial primary key,
  user_id      uuid references public.app_users (id) on delete set null,
  email        text,
  succeeded    boolean not null,
  failure_reason text,
  ip_address   inet,
  device       text,
  browser      text,
  user_agent   text,
  is_new_device boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index login_attempts_email_idx on public.login_attempts (lower(email), attempted_at desc);
create index login_attempts_user_idx  on public.login_attempts (user_id, attempted_at desc);

-- -----------------------------------------------------------------------------
-- Synchronization log — §2.4.5 Synchronization Log
-- -----------------------------------------------------------------------------
create table public.sync_log (
  id               bigserial primary key,
  company_id       uuid not null references public.companies (id) on delete cascade,
  store_id         uuid not null references public.stores (id) on delete cascade,

  entity           public.sync_entity not null,
  trigger_source   public.sync_trigger not null,
  status           public.sync_status not null default 'running',

  records_received integer not null default 0,
  records_succeeded integer not null default 0,
  records_failed   integer not null default 0,

  error_details    jsonb,
  duration_ms      integer,
  retry_count      integer not null default 0,

  initiated_by     uuid references public.app_users (id) on delete set null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);

comment on table public.sync_log is
  '§2.4.5 one row per synchronization run, with counts, errors, duration, initiator and retry count.';

create index sync_log_store_time_idx on public.sync_log (store_id, started_at desc);
create index sync_log_company_idx    on public.sync_log (company_id, started_at desc);
create index sync_log_status_idx     on public.sync_log (status) where status in ('failed', 'partial');

-- -----------------------------------------------------------------------------
-- Notifications — §2.10 Notifications and Alerts
-- -----------------------------------------------------------------------------
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies (id) on delete cascade,
  recipient_id  uuid references public.app_users (id) on delete cascade,

  event_code    text not null,                 -- 'store.connection_failed' | 'company.subscription_expiring' | ...
  severity      public.notification_severity not null default 'info',
  title_en      text not null,
  title_ar      text not null,
  body_en       text,
  body_ar       text,

  entity        text,
  entity_id     uuid,
  link          text,

  channels      public.notification_channel[] not null default '{in_app}',
  delivered_channels public.notification_channel[] not null default '{}',

  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx    on public.notifications (recipient_id) where read_at is null;
create index notifications_company_idx   on public.notifications (company_id, created_at desc);
