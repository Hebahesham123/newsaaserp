/**
 * Database types for the Phase 1 schema.
 *
 * Hand-written to mirror `supabase/migrations/*.sql`. Once a Supabase project
 * exists, regenerate with `npm run db:types` and this file is replaced by the
 * generated output — the shape is compatible.
 */

// --- enums (0001_foundation.sql) --------------------------------------------

export type CompanyStatus =
  | 'draft' | 'under_review' | 'active' | 'suspended'
  | 'temporarily_blocked' | 'subscription_expired' | 'cancelled' | 'archived';

export type MerchantStatus =
  | 'lead' | 'contracting' | 'onboarding' | 'ready_for_go_live' | 'active'
  | 'temporarily_suspended' | 'payment_overdue' | 'on_hold'
  | 'contract_terminated' | 'archived';

export type StoreStatus =
  | 'draft' | 'not_connected' | 'connection_in_progress' | 'connected' | 'active'
  | 'connection_error' | 'temporarily_suspended' | 'disconnected' | 'archived';

export type UserStatus =
  | 'invited' | 'activation_pending' | 'active' | 'on_leave'
  | 'temporarily_suspended' | 'blocked' | 'resigned' | 'terminated' | 'archived';

export type OperatingModel =
  | 'own_store' | 'multi_store' | 'fulfillment_center' | 'operations_only' | 'marketplace';

export type ChannelPlatform =
  | 'shopify' | 'woocommerce' | 'amazon' | 'noon' | 'custom_store' | 'mobile_app'
  | 'pos' | 'branch' | 'social_commerce' | 'manual' | 'wholesale' | 'other_marketplace';

export type MerchantService =
  | 'order_management' | 'order_confirmation' | 'customer_service' | 'warehousing'
  | 'goods_receiving' | 'picking_packing' | 'shipping' | 'shipment_followup'
  | 'return_management' | 'collection_management' | 'marketplace_management'
  | 'product_management' | 'inventory_management' | 'affiliate_management'
  | 'reporting_only' | 'full_operations';

export type WarehouseType =
  | 'main' | 'fulfillment' | 'retail_store' | 'branch'
  | 'marketplace' | 'returns' | 'temporary' | 'damaged';

export type DataScopeType =
  | 'all_company' | 'merchant' | 'store' | 'warehouse' | 'team'
  | 'assigned_only' | 'own_records' | 'date_range';

export type FieldVisibility = 'visible' | 'masked' | 'hidden';

export type AuditAction =
  | 'create' | 'update' | 'archive' | 'delete' | 'status_change' | 'permission_change'
  | 'team_membership_change' | 'login' | 'logout' | 'login_failed' | 'password_change'
  | 'store_connect' | 'store_disconnect' | 'integration_change'
  | 'export' | 'sensitive_view' | 'financial_change' | 'approve' | 'reject';

export type SyncEntity =
  | 'orders' | 'customers' | 'products' | 'variants' | 'prices' | 'inventory'
  | 'discounts' | 'cancellations' | 'payment_status' | 'fulfillment_status'
  | 'returns' | 'tracking_numbers' | 'taxes' | 'addresses';

export type SyncTrigger = 'webhook' | 'scheduled' | 'manual' | 'retry';
export type SyncStatus = 'running' | 'success' | 'partial' | 'failed';

export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'whatsapp' | 'push';
export type NotificationSeverity = 'info' | 'warning' | 'critical';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type ChannelProviderId = 'mock' | 'shopify' | 'woocommerce' | 'amazon' | 'noon' | 'custom';

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

/** Row shape → table definition. `Req` names the columns required on insert. */
type Table<Row, Req extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Req> & Partial<Omit<Row, Req>>;
  Update: Partial<Row>;
  Relationships: [];
};

type Auditable = {
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  archived_at: string | null;
  archived_by: string | null;
};

// --- rows -------------------------------------------------------------------

export type CompanyRow = Auditable & {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  trade_name: string | null;
  logo_url: string | null;
  business_type: string | null;
  country: string | null;
  region: string | null;
  address: string | null;
  tax_registration_number: string | null;
  commercial_registration_number: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  base_currency: string;
  timezone: string;
  default_locale: string;
  tax_structure: Json;
  account_manager_id: string | null;
  status: CompanyStatus;
  operating_model: OperatingModel;
  subscription_start_date: string | null;
  subscription_end_date: string | null;
  subscription_plan: string | null;
  max_users: number | null;
  max_stores: number | null;
  max_monthly_orders: number | null;
  internal_notes: string | null;
  settings: Json;
};

export type MerchantRow = Auditable & {
  id: string;
  company_id: string;
  code: string;
  name: string;
  trade_name: string | null;
  merchant_type: string | null;
  account_manager_id: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  address: string | null;
  tax_registration_number: string | null;
  commercial_registration_number: string | null;
  currency: string;
  status: MerchantStatus;
  contract_date: string | null;
  go_live_date: string | null;
  services: MerchantService[];
  operating_model: OperatingModel;
  credit_limit: number | null;
  payment_terms: string | null;
  settlement_cycle: string | null;
  commission_percentage: number | null;
  service_pricing: Json;
  internal_notes: string | null;
  settings: Json;
};

export type WarehouseRow = Auditable & {
  id: string;
  company_id: string;
  code: string;
  name: string;
  warehouse_type: WarehouseType;
  dedicated_merchant_id: string | null;
  country: string | null;
  region: string | null;
  address: string | null;
  phone: string | null;
  manager_id: string | null;
  is_active: boolean;
  settings: Json;
};

export type StoreRow = Auditable & {
  id: string;
  company_id: string;
  merchant_id: string;
  code: string;
  name: string;
  platform: ChannelPlatform;
  store_url: string | null;
  country: string | null;
  currency: string;
  locale: string;
  timezone: string;
  status: StoreStatus;
  connected_at: string | null;
  last_sync_at: string | null;
  last_sync_status: SyncStatus | null;
  last_sync_error: string | null;
  order_import_method: string;
  product_sync_method: string;
  inventory_sync_method: string;
  price_sync_method: string;
  master_source: Json;
  sync_enabled: boolean;
  tax_settings: Json;
  shipping_settings: Json;
  payment_settings: Json;
  default_warehouse_id: string | null;
  default_courier_id: string | null;
  confirmation_policy: Json;
  cancellation_policy: Json;
  return_policy: Json;
  store_manager_id: string | null;
  notes: string | null;
  provider: ChannelProviderId;
};

export type AppUserRow = Auditable & {
  id: string;
  auth_user_id: string | null;
  company_id: string | null;
  merchant_id: string | null;
  is_platform_admin: boolean;
  full_name: string;
  email: string;
  phone: string | null;
  employee_code: string | null;
  job_title: string | null;
  avatar_url: string | null;
  department_id: string | null;
  team_id: string | null;
  manager_id: string | null;
  locale: string;
  timezone: string;
  hire_date: string | null;
  system_access_start_date: string | null;
  user_type: string | null;
  status: UserStatus;
  working_hours: Json;
  working_days: number[];
  performance_target: Json;
  max_assigned_orders: number | null;
  notification_preferences: Json;
  last_login_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
  two_factor_method: string | null;
  must_reset_password: boolean;
  allowed_ip_ranges: string[] | null;
  notes: string | null;
};

export type DepartmentRow = Auditable & {
  id: string;
  company_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  manager_id: string | null;
  description: string | null;
  is_active: boolean;
};

export type ShiftRow = Auditable & {
  id: string;
  company_id: string;
  name: string;
  start_time: string;
  end_time: string;
  working_days: number[];
  break_start: string | null;
  break_end: string | null;
  timezone: string;
  department_id: string | null;
  workload_capacity: number | null;
  handover_rules: Json;
  is_active: boolean;
};

export type TeamRow = Auditable & {
  id: string;
  company_id: string;
  department_id: string | null;
  code: string;
  name: string;
  leader_id: string | null;
  shift_id: string | null;
  assigned_store_ids: string[];
  assigned_merchant_ids: string[];
  order_types: string[];
  assigned_regions: string[];
  max_workload_capacity: number | null;
  targets: Json;
  assignment_workflow: Json;
  is_active: boolean;
};

export type PermissionRow = {
  id: string;
  code: string;
  module: string;
  screen: string | null;
  action: string;
  label_en: string;
  label_ar: string;
  description: string | null;
  is_sensitive: boolean;
  requires_approval: boolean;
  sort_order: number;
  created_at: string;
};

export type RoleRow = {
  id: string;
  company_id: string | null;
  merchant_id: string | null;
  code: string;
  name_en: string;
  name_ar: string;
  description: string | null;
  is_system_template: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type RolePermissionRow = {
  role_id: string;
  permission_id: string;
  granted_at: string;
  granted_by: string | null;
};

export type UserRoleRow = {
  user_id: string;
  role_id: string;
  assigned_at: string;
  assigned_by: string | null;
};

export type UserDataScopeRow = {
  id: string;
  user_id: string;
  scope_type: DataScopeType;
  scope_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string;
  created_by: string | null;
};

export type RoleFieldPolicyRow = {
  id: string;
  role_id: string;
  entity: string;
  field: string;
  visibility: FieldVisibility;
  can_edit: boolean;
  mask_pattern: string | null;
  created_at: string;
};

export type ApprovalRequestRow = {
  id: string;
  company_id: string;
  request_type: string;
  entity: string;
  entity_id: string | null;
  payload: Json;
  reason: string | null;
  status: ApprovalStatus;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
};

export type AuditLogRow = {
  id: number;
  company_id: string | null;
  merchant_id: string | null;
  actor_id: string | null;
  action: AuditAction;
  module: string;
  record_id: string | null;
  old_value: Json;
  new_value: Json;
  changed_fields: string[] | null;
  ip_address: string | null;
  device: string | null;
  browser: string | null;
  user_agent: string | null;
  change_reason: string | null;
  approval_request_id: string | null;
  approved_by: string | null;
  occurred_at: string;
};

export type LoginAttemptRow = {
  id: number;
  user_id: string | null;
  email: string | null;
  succeeded: boolean;
  failure_reason: string | null;
  ip_address: string | null;
  device: string | null;
  browser: string | null;
  user_agent: string | null;
  is_new_device: boolean;
  attempted_at: string;
};

export type SyncLogRow = {
  id: number;
  company_id: string;
  store_id: string;
  entity: SyncEntity;
  trigger_source: SyncTrigger;
  status: SyncStatus;
  records_received: number;
  records_succeeded: number;
  records_failed: number;
  error_details: Json;
  duration_ms: number | null;
  retry_count: number;
  initiated_by: string | null;
  started_at: string;
  finished_at: string | null;
};

export type NotificationRow = {
  id: string;
  company_id: string | null;
  recipient_id: string | null;
  event_code: string;
  severity: NotificationSeverity;
  title_en: string;
  title_ar: string;
  body_en: string | null;
  body_ar: string | null;
  entity: string | null;
  entity_id: string | null;
  link: string | null;
  channels: NotificationChannel[];
  delivered_channels: NotificationChannel[];
  read_at: string | null;
  created_at: string;
};

export type StoreCredentialRow = {
  store_id: string;
  company_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  api_key_enc: string | null;
  api_secret_enc: string | null;
  webhook_secret_enc: string | null;
  shop_domain: string | null;
  scopes: string[] | null;
  installed_at: string | null;
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TeamMemberRow = { team_id: string; user_id: string; joined_at: string };
export type ShiftMemberRow = { shift_id: string; user_id: string; joined_at: string };

// --- database ---------------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      companies: Table<CompanyRow, 'code' | 'name_ar' | 'name_en'>;
      merchants: Table<MerchantRow, 'company_id' | 'code' | 'name'>;
      warehouses: Table<WarehouseRow, 'company_id' | 'code' | 'name'>;
      stores: Table<StoreRow, 'company_id' | 'merchant_id' | 'code' | 'name' | 'platform'>;
      app_users: Table<AppUserRow, 'full_name' | 'email'>;
      departments: Table<DepartmentRow, 'company_id' | 'code' | 'name_ar' | 'name_en'>;
      teams: Table<TeamRow, 'company_id' | 'code' | 'name'>;
      shifts: Table<ShiftRow, 'company_id' | 'name' | 'start_time' | 'end_time'>;
      team_members: Table<TeamMemberRow, 'team_id' | 'user_id'>;
      shift_members: Table<ShiftMemberRow, 'shift_id' | 'user_id'>;
      permissions: Table<PermissionRow, 'code' | 'module' | 'action' | 'label_en' | 'label_ar'>;
      roles: Table<RoleRow, 'code' | 'name_en' | 'name_ar'>;
      role_permissions: Table<RolePermissionRow, 'role_id' | 'permission_id'>;
      user_roles: Table<UserRoleRow, 'user_id' | 'role_id'>;
      user_data_scopes: Table<UserDataScopeRow, 'user_id' | 'scope_type'>;
      role_field_policies: Table<RoleFieldPolicyRow, 'role_id' | 'entity' | 'field'>;
      approval_requests: Table<ApprovalRequestRow, 'company_id' | 'request_type' | 'entity' | 'requested_by'>;
      audit_log: Table<AuditLogRow, 'action' | 'module'>;
      login_attempts: Table<LoginAttemptRow, 'succeeded'>;
      sync_log: Table<SyncLogRow, 'company_id' | 'store_id' | 'entity' | 'trigger_source'>;
      notifications: Table<NotificationRow, 'event_code' | 'title_en' | 'title_ar'>;
      store_credentials: Table<StoreCredentialRow, 'store_id' | 'company_id'>;
    };
    Views: {
      syncable_stores: { Row: StoreRow; Relationships: [] };
    };
    Functions: {
      my_permission_codes: { Args: Record<string, never>; Returns: string[] };
      my_field_policies: {
        Args: Record<string, never>;
        Returns: {
          entity: string;
          field: string;
          visibility: FieldVisibility;
          can_edit: boolean;
          mask_pattern: string | null;
        }[];
      };
      record_login_attempt: {
        Args: {
          p_email: string;
          p_succeeded: boolean;
          p_failure_reason?: string | null;
          p_ip?: string | null;
          p_user_agent?: string | null;
        };
        Returns: undefined;
      };
    };
    Enums: {
      company_status: CompanyStatus;
      merchant_status: MerchantStatus;
      store_status: StoreStatus;
      user_status: UserStatus;
      operating_model: OperatingModel;
      channel_platform: ChannelPlatform;
      merchant_service: MerchantService;
      warehouse_type: WarehouseType;
      data_scope_type: DataScopeType;
      field_visibility: FieldVisibility;
      audit_action: AuditAction;
      sync_entity: SyncEntity;
      sync_trigger: SyncTrigger;
      sync_status: SyncStatus;
      notification_channel: NotificationChannel;
      notification_severity: NotificationSeverity;
      approval_status: ApprovalStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
