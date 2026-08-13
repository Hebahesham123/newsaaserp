-- =============================================================================
-- Green ERP — 0001 Foundation
-- Extensions, private helper schema, shared enums, common triggers.
-- Spec: §1.8 (account structure), §1.10 (design principles)
-- =============================================================================

create extension if not exists "pgcrypto"   with schema extensions;
create extension if not exists "pg_trgm"    with schema extensions;
create extension if not exists "btree_gin"  with schema extensions;

-- Private schema for security-definer helpers. Deliberately NOT exposed through
-- PostgREST, so RLS helpers cannot be called or probed from the browser.
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Status enums — these sets are declared as fixed in the spec.
-- Anything the spec calls "configurable" (order statuses, cancellation reasons,
-- return reasons) is modelled as a per-company reference table instead, never
-- as an enum. See §1.10 "Customization".
-- -----------------------------------------------------------------------------

-- §2.2.3 Company Statuses
create type public.company_status as enum (
  'draft', 'under_review', 'active', 'suspended',
  'temporarily_blocked', 'subscription_expired', 'cancelled', 'archived'
);

-- §2.3.4 Merchant Statuses
create type public.merchant_status as enum (
  'lead', 'contracting', 'onboarding', 'ready_for_go_live', 'active',
  'temporarily_suspended', 'payment_overdue', 'on_hold',
  'contract_terminated', 'archived'
);

-- §2.4.3 Store Statuses
create type public.store_status as enum (
  'draft', 'not_connected', 'connection_in_progress', 'connected', 'active',
  'connection_error', 'temporarily_suspended', 'disconnected', 'archived'
);

-- §2.5.3 User Statuses
create type public.user_status as enum (
  'invited', 'activation_pending', 'active', 'on_leave',
  'temporarily_suspended', 'blocked', 'resigned', 'terminated', 'archived'
);

-- §1.4 System Operating Models
create type public.operating_model as enum (
  'own_store', 'multi_store', 'fulfillment_center', 'operations_only', 'marketplace'
);

-- §1.6 / §2.4.1 Order sources & sales channel platforms
create type public.channel_platform as enum (
  'shopify', 'woocommerce', 'amazon', 'noon', 'custom_store', 'mobile_app',
  'pos', 'branch', 'social_commerce', 'manual', 'wholesale', 'other_marketplace'
);

-- §2.3.3 Merchant Service Types
create type public.merchant_service as enum (
  'order_management', 'order_confirmation', 'customer_service', 'warehousing',
  'goods_receiving', 'picking_packing', 'shipping', 'shipment_followup',
  'return_management', 'collection_management', 'marketplace_management',
  'product_management', 'inventory_management', 'affiliate_management',
  'reporting_only', 'full_operations'
);

-- §5.3 Warehouse Types (stubbed in Phase 1, expanded in Phase 4)
create type public.warehouse_type as enum (
  'main', 'fulfillment', 'retail_store', 'branch',
  'marketplace', 'returns', 'temporary', 'damaged'
);

-- §2.7.1 Data Permissions
create type public.data_scope_type as enum (
  'all_company', 'merchant', 'store', 'warehouse', 'team',
  'assigned_only', 'own_records', 'date_range'
);

-- §2.7.1 Field-Level Permissions / §2.7.3 Sensitive Customer Data
create type public.field_visibility as enum ('visible', 'masked', 'hidden');

-- §2.9.1 Logged Activities
create type public.audit_action as enum (
  'create', 'update', 'archive', 'delete', 'status_change', 'permission_change',
  'team_membership_change', 'login', 'logout', 'login_failed', 'password_change',
  'store_connect', 'store_disconnect', 'integration_change',
  'export', 'sensitive_view', 'financial_change', 'approve', 'reject'
);

-- §2.4.4 Store Synchronization
create type public.sync_entity as enum (
  'orders', 'customers', 'products', 'variants', 'prices', 'inventory',
  'discounts', 'cancellations', 'payment_status', 'fulfillment_status',
  'returns', 'tracking_numbers', 'taxes', 'addresses'
);
create type public.sync_trigger as enum ('webhook', 'scheduled', 'manual', 'retry');
create type public.sync_status  as enum ('running', 'success', 'partial', 'failed');

-- §2.10 Notifications and Alerts
create type public.notification_channel as enum ('in_app', 'email', 'sms', 'whatsapp', 'push');
create type public.notification_severity as enum ('info', 'warning', 'critical');

-- §2.7.4 Segregation of Duties
create type public.approval_status as enum ('pending', 'approved', 'rejected', 'cancelled');

-- -----------------------------------------------------------------------------
-- Shared triggers
-- -----------------------------------------------------------------------------

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.set_updated_at is
  'Stamps updated_at on every UPDATE. Attached to all mutable business tables.';
