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
  | 'ecommerce_store_management' | 'fulfillment' | 'operations_only';

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

// --- catalog enums (0010_catalog.sql, spec §3) -------------------------------

// §3.11 Product Statuses
export type ProductStatus =
  | 'draft' | 'under_review' | 'active' | 'inactive' | 'unavailable' | 'out_of_stock'
  | 'temporarily_suspended' | 'discontinued' | 'archived' | 'sync_error' | 'unmapped';

// §3.3 Product Types
export type ProductType =
  | 'simple' | 'variant' | 'bundle' | 'kit' | 'composite' | 'digital' | 'service'
  | 'marketplace' | 'made_to_order' | 'batch_controlled' | 'serial_controlled';

// §3.7 Pricing Management
export type PriceType =
  | 'base' | 'compare_at' | 'wholesale' | 'store' | 'merchant' | 'marketplace'
  | 'country' | 'affiliate' | 'promotional' | 'bundle' | 'time_based' | 'quantity_based';

// §3.8 Cost Management
export type CostComponent =
  | 'purchase' | 'manufacturing' | 'freight' | 'customs' | 'packaging' | 'storage'
  | 'fulfillment' | 'marketplace_commission' | 'affiliate_commission'
  | 'payment_gateway' | 'customer_shipping' | 'other';

// §3.9 Bundle and Kit Management
export type BundleType = 'fixed' | 'dynamic';

// §3.5 mapping state
export type MappingStatus = 'mapped' | 'unmapped' | 'conflict' | 'error';

// --- order enums (0012_orders.sql, spec §4) ----------------------------------

// §4.2 Order Sources
export type OrderSource =
  | 'shopify' | 'woocommerce' | 'amazon' | 'noon' | 'custom_api' | 'mobile_app'
  | 'pos' | 'excel_import' | 'manual' | 'social_commerce' | 'whatsapp' | 'call_center';

// §4.3 Order Lifecycle
export type OrderStatus =
  | 'new' | 'imported' | 'pending_review'
  | 'duplicate_check' | 'fraud_check' | 'customer_history_review'
  | 'pending_assignment' | 'assigned' | 'first_call' | 'second_call' | 'third_call'
  | 'whatsapp_confirmation' | 'callback' | 'confirmed' | 'cancelled'
  | 'ready_for_warehouse';

export type OrderStage = 'intake' | 'verification' | 'confirmation' | 'warehouse';

// §4.4 payment data
export type PaymentMethod =
  | 'cod' | 'card' | 'wallet' | 'bank_transfer' | 'payment_link' | 'installment' | 'other';

export type OrderPaymentStatus =
  | 'pending' | 'authorized' | 'paid' | 'partially_paid' | 'refunded' | 'voided' | 'failed';

// §4.6 Order Assignment
export type AssignmentMethod = 'manual' | 'round_robin' | 'smart' | 'ai' | 'self';

// §4.10 Call Management
export type CallOutcome =
  | 'confirmed' | 'cancelled' | 'no_answer' | 'busy' | 'switched_off' | 'wrong_number'
  | 'invalid_number' | 'callback_requested' | 'postponed' | 'voicemail';

export type CallDirection = 'outbound' | 'inbound';

// §4.9 WhatsApp Integration
export type MessageChannel = 'whatsapp' | 'sms' | 'email';
export type MessageDirection = 'outbound' | 'inbound';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

// §4.13 Blacklist
export type BlacklistScope = 'phone' | 'address' | 'email';

// §4.15 rule 4 — order timeline
export type OrderEventType =
  | 'created' | 'status_change' | 'assigned' | 'call' | 'message' | 'note'
  | 'items_changed' | 'customer_changed' | 'address_changed' | 'confirmed'
  | 'cancelled' | 'duplicate_flagged' | 'risk_flagged' | 'sync';

// --- warehouse enums (0014_warehouse.sql, spec §5) ---------------------------

export type LocationLevel = 'zone' | 'aisle' | 'rack' | 'shelf' | 'bin';

export type LocationArea =
  | 'storage' | 'receiving' | 'qc' | 'picking' | 'packing' | 'dispatch' | 'returns' | 'damaged';

export type WarehouseStage =
  | 'receiving' | 'quality_check' | 'put_away' | 'available' | 'reserved'
  | 'picking' | 'packing' | 'final_quality_check' | 'ready_to_ship'
  | 'courier_handover' | 'shipment_created' | 'completed';

export type InventoryTxnType =
  | 'receiving' | 'put_away' | 'reservation' | 'picking' | 'packing' | 'shipment'
  | 'return' | 'damage' | 'adjustment' | 'warehouse_transfer' | 'inventory_count';

export type InventoryBucket =
  | 'available' | 'reserved' | 'picking' | 'packed' | 'in_transit' | 'returned' | 'damaged' | 'expired';

export type WarehouseTaskType =
  | 'receiving' | 'put_away' | 'picking' | 'packing' | 'quality_check'
  | 'transfer' | 'inventory_count' | 'courier_handover';

export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type PickingStrategy = 'single' | 'batch' | 'wave' | 'zone';
export type StockStrategy = 'fifo' | 'fefo' | 'lifo';
export type ReceiptStatus = 'draft' | 'in_progress' | 'quality_check' | 'put_away' | 'completed' | 'cancelled';
export type QcResult = 'pending' | 'passed' | 'failed' | 'partial';
export type FulfillmentService = 'receiving' | 'storage' | 'picking' | 'packing' | 'shipping' | 'returns';

// --- shipping enums (0016_shipping.sql, spec §6) -----------------------------

export type ShipmentStatus =
  | 'ready_to_ship' | 'handed_to_courier' | 'in_transit' | 'out_for_delivery'
  | 'delivered' | 'delivery_failed' | 'second_attempt' | 'third_attempt'
  | 'returned_to_warehouse' | 'return_inspection' | 'inventory_updated'
  | 'closed' | 'cancelled' | 'lost';

export type CourierInstructionType =
  | 'retry_delivery' | 'contact_customer' | 'change_phone' | 'change_address'
  | 'change_delivery_date' | 'deliver_at_time' | 'cancel_shipment'
  | 'request_return' | 'expedite_return';

export type InstructionStatus = 'sent' | 'acknowledged' | 'executed' | 'rejected' | 'expired';

export type ReturnStatus =
  | 'requested' | 'courier_return' | 'returned_to_warehouse' | 'quality_inspection'
  | 'inventory_decision' | 'merchant_notified' | 'financially_settled' | 'closed' | 'cancelled';

export type ReturnDisposition =
  | 'restock' | 'repack' | 'repair' | 'outlet' | 'destroy' | 'return_to_merchant';

export type CollectionStatus =
  | 'pending' | 'collected' | 'in_transfer' | 'settled' | 'short' | 'over' | 'missing' | 'waived';

export type StatementStatus = 'draft' | 'matched' | 'variance' | 'approved' | 'paid' | 'disputed';
export type CourierProvider = 'manual' | 'bosta' | 'aramex' | 'mylerz' | 'jt' | 'custom';

// --- finance enums (0018_finance.sql, spec §7) -------------------------------

export type CostCategory = 'product' | 'operations' | 'shipping' | 'marketing' | 'other';

export type OrderCostType =
  | 'purchase' | 'manufacturing'
  | 'picking' | 'packing' | 'packaging_material' | 'storage'
  | 'courier_fee' | 'return_shipping' | 'return_handling'
  | 'ads_meta' | 'ads_google' | 'ads_tiktok' | 'affiliate_commission' | 'influencer' | 'coupon_discount'
  | 'payment_gateway' | 'bank_charges' | 'customer_service' | 'other';

export type MarketingPlatform = 'meta' | 'google' | 'tiktok' | 'snapchat' | 'influencer' | 'affiliate' | 'other';
export type InvoiceStatus = 'draft' | 'approved' | 'paid' | 'cancelled';
export type SettlementStatus = 'draft' | 'calculated' | 'approved' | 'paid' | 'disputed';
export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';
export type SettlementCycle = 'daily' | 'weekly' | 'biweekly' | 'monthly';

// --- report enums (0020_reports.sql, spec §9) --------------------------------

export type ReportCategory =
  | 'orders' | 'confirmation' | 'warehouse' | 'inventory' | 'shipping' | 'returns'
  | 'collections' | 'financial' | 'profitability' | 'products' | 'customers'
  | 'merchants' | 'affiliates' | 'employees' | 'executive';

export type ReportFormat = 'excel' | 'csv' | 'pdf' | 'print' | 'email';
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

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


// --- organisation hierarchy & KPIs (0025) ------------------------------------

export type KpiFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';
export type KpiDirection = 'higher_is_better' | 'lower_is_better';
export type KpiSubject = 'department' | 'team' | 'user' | 'role';

/** Departments flattened, with depth and a readable path for the tree view. */
export type DepartmentTreeRow = {
  id: string;
  company_id: string;
  parent_id: string | null;
  code: string;
  name_en: string;
  name_ar: string;
  manager_id: string | null;
  is_active: boolean;
  archived_at: string | null;
  depth: number;
  path: string;
  ancestry: string[];
  root_id: string;
  child_count: number;
  user_count: number;
};

export type KpiDefinitionRow = {
  id: string;
  company_id: string;
  department_id: string;
  code: string;
  name_en: string;
  name_ar: string;
  description: string | null;
  unit: string | null;
  frequency: KpiFrequency;
  direction: KpiDirection;
  default_target: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type KpiEntryRow = {
  id: string;
  kpi_id: string;
  company_id: string;
  subject: KpiSubject;
  department_id: string | null;
  team_id: string | null;
  user_id: string | null;
  role_id: string | null;
  period_start: string;
  period_end: string;
  target_value: number | null;
  actual_value: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

/** Achievement and status are derived from the definition direction, never stored. */
export type KpiPerformanceRow = {
  entry_id: string;
  company_id: string;
  kpi_id: string;
  code: string;
  name_en: string;
  name_ar: string;
  unit: string | null;
  frequency: KpiFrequency;
  direction: KpiDirection;
  owner_department_id: string;
  subject: KpiSubject;
  department_id: string | null;
  team_id: string | null;
  user_id: string | null;
  role_id: string | null;
  period_start: string;
  period_end: string;
  target_value: number | null;
  actual_value: number | null;
  achievement_pct: number | null;
  status: 'pending' | 'untargeted' | 'achieved' | 'at_risk' | 'missed';
};

// --- users, customers & affiliates (0026) ------------------------------------

/** Warehouse is deliberately absent: warehouse access is a data scope. */
export type UserType = 'company' | 'merchant' | 'affiliate' | 'store' | 'supplier';

export type AffiliateStatus = 'pending' | 'active' | 'suspended' | 'terminated';
export type CommissionModel = 'percentage' | 'fixed_per_order' | 'tiered';

export type AffiliateRow = Auditable & {
  id: string;
  company_id: string;
  merchant_id: string | null;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  referral_code: string;
  status: AffiliateStatus;
  commission_model: CommissionModel;
  commission_rate: number | null;
  pays_on_delivery: boolean;
  payout_details: string | null;
  notes: string | null;
};

export type AffiliateCommissionRow = {
  id: string;
  company_id: string;
  affiliate_id: string;
  order_id: string;
  order_total: number;
  commission_amount: number;
  currency: string;
  status: 'pending' | 'payable' | 'paid' | 'cancelled';
  earned_on: string;
  paid_at: string | null;
  payout_reference: string | null;
  created_at: string;
  updated_at: string;
};

export type AffiliatePerformanceRow = {
  affiliate_id: string;
  company_id: string;
  merchant_id: string | null;
  name: string;
  referral_code: string;
  status: AffiliateStatus;
  referred_orders: number;
  confirmed_orders: number;
  cancelled_orders: number;
  referred_revenue: number;
  confirmation_rate: number | null;
  commission_total: number;
  commission_paid: number;
  commission_outstanding: number;
};

export type CustomerLinkRow = {
  id: string;
  customer_id: string;
  company_id: string;
  merchant_id: string | null;
  store_id: string | null;
  first_order_at: string | null;
  last_order_at: string | null;
  orders_count: number;
  total_spent: number;
  created_at: string;
  updated_at: string;
};

/** One row per customer identity, with the breadth of their relationships. */
export type CustomerDirectoryRow = {
  customer_id: string;
  company_id: string;
  name: string;
  phone: string;
  email: string | null;
  alt_phone: string | null;
  governorate: string | null;
  city: string | null;
  address: string | null;
  preferred_language: string;
  notes: string | null;
  orders_count: number;
  cancelled_count: number;
  total_spent: number;
  risk_score: number;
  is_blacklisted: boolean;
  last_order_at: string | null;
  store_count: number;
  merchant_count: number;
  store_names: string | null;
};

// --- plans, modules & entitlements (0023/0024) -------------------------------

/** A module gates an area of the product; a feature sits inside one; a limit is a number. */
export type FeatureKind = 'module' | 'feature' | 'limit';
export type FeatureTier = 'basic' | 'standard' | 'advanced';

export type FeatureRow = {
  id: string;
  code: string;
  kind: FeatureKind;
  module_code: string | null;
  name_en: string;
  name_ar: string;
  description: string | null;
  unit: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type PlanRow = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  description: string | null;
  operating_model: OperatingModel | null;
  monthly_price: number | null;
  currency: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type PlanEntitlementRow = {
  id: string;
  plan_id: string;
  feature_id: string;
  is_included: boolean;
  /** Not in the plan, but purchasable — activated per company. */
  is_addon: boolean;
  tier: FeatureTier | null;
  /** Null on an included limit means unlimited. */
  limit_value: number | null;
  created_at: string;
  updated_at: string;
};

export type CompanyEntitlementRow = {
  id: string;
  company_id: string;
  feature_id: string;
  is_included: boolean;
  tier: FeatureTier | null;
  limit_value: number | null;
  starts_on: string | null;
  ends_on: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

/**
 * Resolved entitlements per company — override, then plan, then nothing.
 * This is what the dashboard and navigation read to decide what exists.
 */
export type CompanyFeatureRow = {
  company_id: string;
  feature_code: string;
  kind: FeatureKind;
  module_code: string | null;
  name_en: string;
  name_ar: string;
  unit: string | null;
  sort_order: number;
  is_active: boolean;
  limit_value: number | null;
  tier: FeatureTier | null;
  is_addon: boolean;
};

export type CompanyRow = Auditable & {
  id: string;
  code: string;
  /** §Plans — null means the legacy max_* columns still govern this company. */
  plan_id: string | null;
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
  /** Typed and anchored by 0026; the entity columns below must agree with it. */
  user_type: UserType;
  affiliate_id: string | null;
  store_id: string | null;
  supplier_id: string | null;
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
  /** Null means a main department. Any depth is permitted (0025). */
  parent_id: string | null;
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

// --- catalog rows (0010_catalog.sql, spec §3) --------------------------------

export type BrandRow = Auditable & {
  id: string;
  company_id: string;
  merchant_id: string | null;
  code: string;
  name_en: string;
  name_ar: string;
  logo_url: string | null;
  description: string | null;
  is_active: boolean;
};

export type CategoryRow = Auditable & {
  id: string;
  company_id: string;
  parent_id: string | null;
  code: string;
  name_en: string;
  name_ar: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

export type UnitOfMeasureRow = {
  id: string;
  company_id: string;
  code: string;
  name_en: string;
  name_ar: string;
  allows_fractions: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SupplierRow = Auditable & {
  id: string;
  company_id: string;
  merchant_id: string | null;
  code: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  address: string | null;
  payment_terms: string | null;
  lead_time_days: number | null;
  notes: string | null;
  is_active: boolean;
};

export type CollectionRow = {
  id: string;
  company_id: string;
  merchant_id: string | null;
  code: string;
  name_en: string;
  name_ar: string;
  description: string | null;
  is_seasonal: boolean;
  season_start: string | null;
  season_end: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ProductAttributeRow = {
  id: string;
  company_id: string;
  code: string;
  name_en: string;
  name_ar: string;
  values: string[];
  is_variant_axis: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ProductRow = Auditable & {
  id: string;
  company_id: string;
  merchant_id: string;
  brand_id: string | null;
  category_id: string | null;
  supplier_id: string | null;
  uom_id: string | null;
  sku: string;
  barcode: string | null;
  name_en: string;
  name_ar: string;
  short_description: string | null;
  description: string | null;
  product_type: ProductType;
  status: ProductStatus;
  weight_grams: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  country_of_origin: string | null;
  base_price: number | null;
  base_cost: number | null;
  currency: string;
  tax_rate: number | null;
  tax_included: boolean;
  min_sale_quantity: number;
  max_sale_quantity: number | null;
  is_sellable: boolean;
  is_stock_item: boolean;
  is_batch_tracked: boolean;
  is_expiry_tracked: boolean;
  is_serial_tracked: boolean;
  shelf_life_days: number | null;
  tags: string[];
  images: Json;
  is_seasonal: boolean;
  attributes: Json;
  approved_at: string | null;
  approved_by: string | null;
  internal_notes: string | null;
};

export type ProductVariantRow = Auditable & {
  id: string;
  product_id: string;
  company_id: string;
  merchant_id: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  options: Json;
  price: number | null;
  cost: number | null;
  weight_grams: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  image_url: string | null;
  position: number;
  is_active: boolean;
  is_default: boolean;
};

export type ProductCollectionRow = {
  collection_id: string;
  product_id: string;
  position: number;
  added_at: string;
};

export type ProductChannelMappingRow = {
  id: string;
  company_id: string;
  product_id: string;
  variant_id: string | null;
  store_id: string;
  external_product_id: string | null;
  external_variant_id: string | null;
  external_sku: string | null;
  asin: string | null;
  marketplace_fulfillment_sku: string | null;
  external_barcode: string | null;
  external_url: string | null;
  status: MappingStatus;
  last_synced_at: string | null;
  last_error: string | null;
  master_source: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ProductPriceRow = {
  id: string;
  company_id: string;
  product_id: string;
  variant_id: string | null;
  price_type: PriceType;
  amount: number;
  currency: string;
  store_id: string | null;
  merchant_id: string | null;
  country: string | null;
  min_quantity: number | null;
  valid_from: string | null;
  valid_to: string | null;
  priority: number;
  is_active: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ProductCostRow = {
  id: string;
  company_id: string;
  product_id: string;
  variant_id: string | null;
  component: CostComponent;
  amount: number;
  currency: string;
  is_percentage: boolean;
  effective_from: string | null;
  effective_to: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type BundleComponentRow = {
  id: string;
  bundle_product_id: string;
  component_variant_id: string;
  quantity: number;
  is_required: boolean;
  position: number;
  created_at: string;
};

export type PriceHistoryRow = {
  id: number;
  company_id: string | null;
  product_id: string | null;
  variant_id: string | null;
  kind: 'price' | 'cost';
  price_type: PriceType | null;
  component: CostComponent | null;
  scope: string | null;
  old_amount: number | null;
  new_amount: number | null;
  currency: string | null;
  changed_by: string | null;
  change_reason: string | null;
  changed_at: string;
};

export type UnmappedProductRow = {
  id: string;
  company_id: string;
  merchant_id: string;
  sku: string;
  name_en: string;
  name_ar: string;
  status: ProductStatus;
  base_price: number | null;
  barcode: string | null;
  variant_count: number;
  mapping_count: number;
};

export type MappedVariantRow = {
  variant_id: string;
  product_id: string;
  company_id: string;
  merchant_id: string;
  store_id: string;
  external_variant_id: string | null;
  mapping_status: MappingStatus;
};

// --- order rows (0012_orders.sql, spec §4) -----------------------------------

export type CustomerRow = Auditable & {
  id: string;
  company_id: string;
  merchant_id: string | null;
  phone: string;
  alt_phone: string | null;
  name: string;
  email: string | null;
  governorate: string | null;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  preferred_language: string;
  orders_count: number;
  delivered_count: number;
  returned_count: number;
  cancelled_count: number;
  lifetime_value: number;
  average_order_value: number;
  last_order_at: string | null;
  last_call_at: string | null;
  last_message_at: string | null;
  risk_score: number;
  is_blacklisted: boolean;
  blacklist_reason: string | null;
  tags: string[];
  notes: string | null;
};

export type CancellationReasonRow = {
  id: string;
  company_id: string;
  code: string;
  name_en: string;
  name_ar: string;
  is_customer_fault: boolean;
  requires_note: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type BlacklistEntryRow = {
  id: string;
  company_id: string;
  scope: BlacklistScope;
  value: string;
  reason: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type OrderRow = Auditable & {
  id: string;
  company_id: string;
  merchant_id: string;
  store_id: string | null;
  customer_id: string | null;
  order_number: string;
  external_order_number: string | null;
  external_id: string | null;
  order_date: string;
  source: OrderSource;
  campaign_ref: string | null;
  affiliate_ref: string | null;
  status: OrderStatus;
  stage: OrderStage;
  customer_name: string;
  customer_phone: string;
  customer_alt_phone: string | null;
  customer_email: string | null;
  governorate: string | null;
  city: string | null;
  address: string | null;
  address_notes: string | null;
  latitude: number | null;
  longitude: number | null;
  maps_url: string | null;
  payment_method: PaymentMethod;
  payment_status: OrderPaymentStatus;
  currency: string;
  subtotal: number;
  discount_total: number;
  shipping_fees: number;
  tax_total: number;
  total: number;
  cod_amount: number | null;
  assigned_to: string | null;
  assigned_at: string | null;
  assigned_by: string | null;
  assignment_method: AssignmentMethod | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason_id: string | null;
  cancellation_note: string | null;
  ready_at: string | null;
  warehouse_id: string | null;
  call_attempts: number;
  last_call_at: string | null;
  next_callback_at: string | null;
  risk_score: number;
  is_duplicate: boolean;
  duplicate_of_id: string | null;
  notes: string | null;
  internal_notes: string | null;
  tags: string[];
  attachments: Json;
  raw: Json | null;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  company_id: string;
  product_id: string | null;
  variant_id: string | null;
  sku: string | null;
  name: string;
  variant_name: string | null;
  external_line_id: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  tax: number;
  /** Generated column — never sent on insert. */
  total: number;
  position: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderEventRow = {
  id: number;
  order_id: string;
  company_id: string;
  event_type: OrderEventType;
  from_status: OrderStatus | null;
  to_status: OrderStatus | null;
  summary: string | null;
  detail: Json | null;
  actor_id: string | null;
  created_at: string;
};

export type OrderCallRow = {
  id: string;
  order_id: string;
  company_id: string;
  customer_id: string | null;
  direction: CallDirection;
  attempt_number: number;
  phone: string;
  started_at: string;
  duration_seconds: number | null;
  outcome: CallOutcome;
  recording_url: string | null;
  notes: string | null;
  callback_at: string | null;
  agent_id: string | null;
  created_at: string;
};

export type OrderMessageRow = {
  id: string;
  order_id: string;
  company_id: string;
  customer_id: string | null;
  channel: MessageChannel;
  direction: MessageDirection;
  status: MessageStatus;
  template_code: string | null;
  language: string;
  body: string | null;
  media_url: string | null;
  payload: Json | null;
  external_message_id: string | null;
  error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  agent_id: string | null;
  created_at: string;
};

export type MessageTemplateRow = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  channel: MessageChannel;
  body_ar: string;
  body_en: string;
  variables: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ConfirmationQueueRow = {
  id: string;
  company_id: string;
  merchant_id: string;
  store_id: string | null;
  order_number: string;
  order_date: string;
  status: OrderStatus;
  stage: OrderStage;
  customer_name: string;
  customer_phone: string;
  governorate: string | null;
  total: number;
  currency: string;
  assigned_to: string | null;
  call_attempts: number;
  next_callback_at: string | null;
  risk_score: number;
  is_duplicate: boolean;
  age_hours: number;
};

/** Return shape of `find_duplicate_orders` (§4.12). */
export type DuplicateOrderRow = {
  order_id: string;
  order_number: string;
  order_date: string;
  status: OrderStatus;
  match_reason: string | null;
};

// --- warehouse rows (0014_warehouse.sql, spec §5) ----------------------------

export type WarehouseLocationRow = Auditable & {
  id: string;
  company_id: string;
  warehouse_id: string;
  parent_id: string | null;
  level: LocationLevel;
  area: LocationArea;
  code: string;
  name: string | null;
  sort_order: number;
  max_units: number | null;
  max_weight_kg: number | null;
  is_pickable: boolean;
  is_active: boolean;
};

export type InventoryLedgerRow = {
  id: number;
  company_id: string;
  merchant_id: string;
  warehouse_id: string;
  location_id: string | null;
  variant_id: string;
  product_id: string | null;
  txn_number: string;
  txn_type: InventoryTxnType;
  bucket: InventoryBucket;
  /** Signed: negative out of a bucket, positive into one. */
  quantity: number;
  batch_number: string | null;
  expiry_date: string | null;
  serial_number: string | null;
  unit_cost: number | null;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  notes: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  created_by: string | null;
};

export type InventoryLevelRow = {
  id: string;
  company_id: string;
  merchant_id: string;
  warehouse_id: string;
  variant_id: string;
  product_id: string | null;
  available: number;
  reserved: number;
  picking: number;
  packed: number;
  in_transit: number;
  returned: number;
  damaged: number;
  expired: number;
  reorder_point: number | null;
  last_movement_at: string | null;
  updated_at: string;
};

export type GoodsReceiptRow = {
  id: string;
  company_id: string;
  merchant_id: string;
  warehouse_id: string;
  supplier_id: string | null;
  receipt_number: string;
  status: ReceiptStatus;
  purchase_order_number: string | null;
  invoice_number: string | null;
  received_at: string;
  received_by: string | null;
  source_warehouse_id: string | null;
  qc_result: QcResult;
  qc_notes: string | null;
  qc_by: string | null;
  qc_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type GoodsReceiptItemRow = {
  id: string;
  receipt_id: string;
  company_id: string;
  variant_id: string;
  expected_quantity: number | null;
  received_quantity: number;
  accepted_quantity: number;
  damaged_quantity: number;
  batch_number: string | null;
  expiry_date: string | null;
  unit_cost: number | null;
  location_id: string | null;
  put_away_at: string | null;
  put_away_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type WarehouseTaskRow = {
  id: string;
  company_id: string;
  warehouse_id: string;
  task_number: string;
  task_type: WarehouseTaskType;
  status: TaskStatus;
  priority: TaskPriority;
  order_id: string | null;
  receipt_id: string | null;
  pick_list_id: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  sla_minutes: number | null;
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  completion_notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type PickListRow = {
  id: string;
  company_id: string;
  warehouse_id: string;
  pick_number: string;
  strategy: PickingStrategy;
  status: TaskStatus;
  wave_key: string | null;
  zone_id: string | null;
  assigned_to: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type PickListItemRow = {
  id: string;
  pick_list_id: string;
  company_id: string;
  order_id: string;
  order_item_id: string | null;
  variant_id: string;
  location_id: string | null;
  requested_quantity: number;
  picked_quantity: number;
  pick_sequence: number;
  picked_at: string | null;
  picked_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PackingMaterialRow = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  unit_cost: number;
  currency: string;
  max_weight_kg: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PackageRow = {
  id: string;
  company_id: string;
  warehouse_id: string;
  order_id: string;
  package_number: string;
  material_id: string | null;
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  material_cost: number;
  qc_result: QcResult;
  qc_by: string | null;
  qc_at: string | null;
  packed_by: string | null;
  packed_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PackageItemRow = {
  id: string;
  package_id: string;
  company_id: string;
  variant_id: string;
  order_item_id: string | null;
  quantity: number;
  created_at: string;
};

export type FulfillmentFeeRow = {
  id: string;
  company_id: string;
  merchant_id: string;
  service: FulfillmentService;
  fee_per_event: number | null;
  fee_per_unit: number | null;
  currency: string;
  effective_from: string | null;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type StockOnHandRow = {
  company_id: string;
  merchant_id: string;
  warehouse_id: string;
  variant_id: string;
  product_id: string | null;
  sku: string;
  name_en: string | null;
  name_ar: string | null;
  available: number;
  reserved: number;
  picking: number;
  packed: number;
  in_transit: number;
  returned: number;
  damaged: number;
  expired: number;
  on_hand: number;
  reorder_point: number | null;
  needs_reorder: boolean;
  last_movement_at: string | null;
};

// --- shipping rows (0016_shipping.sql, spec §6) ------------------------------

export type CourierRow = Auditable & {
  id: string;
  company_id: string;
  code: string;
  name: string;
  provider: CourierProvider;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  tracking_url_template: string | null;
  api_base_url: string | null;
  cod_fee_percentage: number | null;
  cod_fee_flat: number | null;
  settlement_cycle_days: number | null;
  currency: string;
  is_active: boolean;
};

export type ShipmentRow = {
  id: string;
  company_id: string;
  merchant_id: string;
  order_id: string;
  courier_id: string | null;
  warehouse_id: string | null;
  package_id: string | null;
  shipment_number: string;
  awb: string | null;
  tracking_url: string | null;
  status: ShipmentStatus;
  handed_over_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  returned_at: string | null;
  last_update_at: string | null;
  delivery_attempts: number;
  courier_agent_name: string | null;
  failure_reason: string | null;
  promised_at: string | null;
  governorate: string | null;
  city: string | null;
  cod_amount: number;
  shipping_fee: number;
  currency: string;
  weight_kg: number | null;
  notes: string | null;
  raw: Json | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ShipmentEventRow = {
  id: number;
  shipment_id: string;
  company_id: string;
  from_status: ShipmentStatus | null;
  to_status: ShipmentStatus | null;
  courier_status_text: string | null;
  description: string | null;
  location: string | null;
  occurred_at: string;
  source: string;
  actor_id: string | null;
  created_at: string;
};

export type ReturnReasonRow = {
  id: string;
  company_id: string;
  code: string;
  name_en: string;
  name_ar: string;
  fault: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ReturnRow = {
  id: string;
  company_id: string;
  merchant_id: string;
  order_id: string;
  shipment_id: string | null;
  warehouse_id: string | null;
  return_number: string;
  status: ReturnStatus;
  reason_id: string | null;
  is_rto: boolean;
  requested_at: string;
  received_at: string | null;
  inspected_at: string | null;
  inspected_by: string | null;
  merchant_notified_at: string | null;
  settled_at: string | null;
  closed_at: string | null;
  inspection_notes: string | null;
  photos: Json;
  refund_amount: number | null;
  currency: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ReturnItemRow = {
  id: string;
  return_id: string;
  company_id: string;
  order_item_id: string | null;
  variant_id: string;
  quantity: number;
  condition: string | null;
  packaging_ok: boolean | null;
  accessories_ok: boolean | null;
  damage_notes: string | null;
  disposition: ReturnDisposition | null;
  disposition_at: string | null;
  disposition_by: string | null;
  stock_posted_at: string | null;
  created_at: string;
  updated_at: string;
};

/** §6.10. Named `cod_collections` in the database — §3.6 owns `collections`. */
export type CodCollectionRow = {
  id: string;
  company_id: string;
  merchant_id: string;
  order_id: string;
  shipment_id: string | null;
  courier_id: string | null;
  status: CollectionStatus;
  expected_amount: number;
  collected_amount: number | null;
  courier_fee: number;
  deductions: number;
  /** Generated column. */
  net_amount: number;
  /** Generated column. */
  variance: number;
  currency: string;
  collected_at: string | null;
  transferred_at: string | null;
  transfer_reference: string | null;
  due_at: string | null;
  statement_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type CourierStatementRow = {
  id: string;
  company_id: string;
  courier_id: string;
  statement_number: string;
  status: StatementStatus;
  period_start: string;
  period_end: string;
  declared_total: number;
  matched_total: number;
  /** Generated column. */
  variance_total: number;
  currency: string;
  bank_reference: string | null;
  transferred_at: string | null;
  transferred_amount: number | null;
  approved_at: string | null;
  approved_by: string | null;
  approval_note: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

/** §6.6 shipments currently breaching a delay rule. */
export type DelayedShipmentRow = {
  shipment_id: string;
  company_id: string;
  merchant_id: string;
  order_id: string;
  courier_id: string | null;
  shipment_number: string;
  awb: string | null;
  status: ShipmentStatus;
  governorate: string | null;
  delivery_attempts: number;
  last_update_at: string | null;
  rule_id: string;
  rule_code: string;
  rule_name_en: string;
  rule_name_ar: string;
  severity: NotificationSeverity;
  hours_since_update: number;
};

export type CourierScorecardRow = {
  courier_id: string;
  company_id: string;
  name: string;
  shipments: number;
  delivered: number;
  returned: number;
  delivery_rate: number | null;
  return_rate: number | null;
  avg_delivery_days: number | null;
  avg_return_days: number | null;
  avg_attempts: number | null;
};

// --- finance rows (0018_finance.sql, spec §7) --------------------------------

export type OrderCostRow = {
  id: string;
  company_id: string;
  merchant_id: string;
  order_id: string;
  category: CostCategory;
  cost_type: OrderCostType;
  amount: number;
  currency: string;
  source: string;
  reference_type: string | null;
  reference_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type MarketingExpenseRow = {
  id: string;
  company_id: string;
  merchant_id: string | null;
  store_id: string | null;
  product_id: string | null;
  platform: MarketingPlatform;
  campaign_ref: string | null;
  campaign_name: string | null;
  spent_on: string;
  amount: number;
  currency: string;
  external_id: string | null;
  imported_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type ExpenseCategoryRow = {
  id: string;
  company_id: string;
  code: string;
  name_en: string;
  name_ar: string;
  is_direct: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type OperatingExpenseRow = {
  id: string;
  company_id: string;
  merchant_id: string | null;
  warehouse_id: string | null;
  category_id: string;
  expense_number: string;
  status: ExpenseStatus;
  description: string;
  incurred_on: string;
  amount: number;
  currency: string;
  vendor: string | null;
  reference: string | null;
  attachment_url: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_note: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type MerchantSettlementRow = {
  id: string;
  company_id: string;
  merchant_id: string;
  settlement_number: string;
  status: SettlementStatus;
  cycle: SettlementCycle;
  period_start: string;
  period_end: string;
  total_orders: number;
  delivered_orders: number;
  returned_orders: number;
  gross_sales: number;
  storage_cost: number;
  picking_cost: number;
  packing_cost: number;
  shipping_cost: number;
  returns_cost: number;
  commission: number;
  other_deductions: number;
  collected_amount: number;
  /** Generated column. */
  total_deductions: number;
  /** Generated column. */
  net_payable: number;
  currency: string;
  calculated_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type InvoiceRow = {
  id: string;
  company_id: string;
  merchant_id: string | null;
  settlement_id: string | null;
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  tax_amount: number;
  discount: number;
  total: number;
  currency: string;
  approved_at: string | null;
  approved_by: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type InvoiceLineRow = {
  id: string;
  invoice_id: string;
  company_id: string;
  service: FulfillmentService | null;
  description: string;
  quantity: number;
  unit_price: number;
  /** Generated column. */
  line_total: number;
  position: number;
  created_at: string;
};

export type FinancePeriodRow = {
  id: string;
  company_id: string;
  period_start: string;
  period_end: string;
  is_closed: boolean;
  closed_at: string | null;
  closed_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderProfitabilityRow = {
  order_id: string;
  company_id: string;
  merchant_id: string;
  store_id: string | null;
  order_number: string;
  order_date: string;
  status: OrderStatus;
  campaign_ref: string | null;
  currency: string;
  revenue: number;
  product_cost: number;
  operations_cost: number;
  shipping_cost: number;
  marketing_cost: number;
  other_cost: number;
  total_cost: number;
  gross_profit: number;
  margin_percentage: number | null;
};

// --- report rows (0020_reports.sql, spec §9) ---------------------------------

export type ReportDefinitionRow = {
  id: string;
  company_id: string | null;
  code: string;
  name_en: string;
  name_ar: string;
  description: string | null;
  category: ReportCategory;
  source_view: string;
  columns: Json;
  filters: Json;
  group_by: string[];
  order_by: string | null;
  order_desc: boolean;
  row_limit: number;
  requires_permission: string | null;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type SavedFilterRow = {
  id: string;
  company_id: string;
  user_id: string;
  name: string;
  scope: string;
  filters: Json;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type ReportScheduleRow = {
  id: string;
  company_id: string;
  report_id: string;
  name: string;
  frequency: ScheduleFrequency;
  run_at_time: string;
  day_of_week: number | null;
  day_of_month: number | null;
  timezone: string;
  format: ReportFormat;
  recipients: string[];
  filters: Json;
  is_active: boolean;
  last_run_at: string | null;
  last_status: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type ReportRunRow = {
  id: number;
  company_id: string;
  report_id: string | null;
  schedule_id: string | null;
  report_code: string | null;
  format: ReportFormat | null;
  filters: Json;
  row_count: number | null;
  duration_ms: number | null;
  status: string;
  error: string | null;
  run_by: string | null;
  ip_address: string | null;
  created_at: string;
};

/** §9.22 the executive board, one row per company. */
export type ExecutiveKpiRow = {
  company_id: string;
  total_orders: number;
  orders_30d: number;
  confirmed_orders: number;
  cancelled_orders: number;
  open_confirmations: number;
  gross_revenue: number;
  average_order_value: number;
  total_shipments: number;
  delivered_shipments: number;
  open_shipments: number;
  total_returns: number;
  outstanding_cod: number;
  collected_cod: number;
  gross_profit: number;
  operating_expenses: number;
  marketing_spend: number;
  active_products: number;
  out_of_stock_skus: number;
  active_users: number;
};

// --- database ---------------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      companies: Table<CompanyRow, 'code' | 'name_ar' | 'name_en'>;

      // plans & entitlements — 0023/0024
      features: Table<FeatureRow, 'code' | 'kind' | 'name_en' | 'name_ar'>;
      plans: Table<PlanRow, 'code' | 'name_en' | 'name_ar'>;
      plan_entitlements: Table<PlanEntitlementRow, 'plan_id' | 'feature_id'>;
      company_entitlements: Table<CompanyEntitlementRow, 'company_id' | 'feature_id'>;

      // organisation & KPIs — 0025
      kpi_definitions: Table<KpiDefinitionRow, 'company_id' | 'department_id' | 'code' | 'name_en' | 'name_ar'>;
      kpi_entries: Table<KpiEntryRow, 'kpi_id' | 'company_id' | 'subject' | 'period_start' | 'period_end'>;

      // users, customers & affiliates — 0026
      affiliates: Table<AffiliateRow, 'company_id' | 'code' | 'name' | 'referral_code'>;
      affiliate_commissions: Table<AffiliateCommissionRow, 'company_id' | 'affiliate_id' | 'order_id'>;
      customer_links: Table<CustomerLinkRow, 'customer_id' | 'company_id'>;
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

      // catalog — §3
      brands: Table<BrandRow, 'company_id' | 'code' | 'name_en' | 'name_ar'>;
      categories: Table<CategoryRow, 'company_id' | 'code' | 'name_en' | 'name_ar'>;
      units_of_measure: Table<UnitOfMeasureRow, 'company_id' | 'code' | 'name_en' | 'name_ar'>;
      suppliers: Table<SupplierRow, 'company_id' | 'code' | 'name'>;
      collections: Table<CollectionRow, 'company_id' | 'code' | 'name_en' | 'name_ar'>;
      product_attributes: Table<ProductAttributeRow, 'company_id' | 'code' | 'name_en' | 'name_ar'>;
      products: Table<ProductRow, 'company_id' | 'merchant_id' | 'sku' | 'name_en' | 'name_ar'>;
      product_variants: Table<ProductVariantRow, 'product_id' | 'sku'>;
      product_collections: Table<ProductCollectionRow, 'collection_id' | 'product_id'>;
      product_channel_mappings: Table<ProductChannelMappingRow, 'company_id' | 'product_id' | 'store_id'>;
      product_prices: Table<ProductPriceRow, 'company_id' | 'product_id' | 'amount'>;
      product_costs: Table<ProductCostRow, 'company_id' | 'product_id' | 'component' | 'amount'>;
      bundle_components: Table<BundleComponentRow, 'bundle_product_id' | 'component_variant_id'>;
      price_history: Table<PriceHistoryRow, 'kind'>;

      // orders — §4
      customers: Table<CustomerRow, 'company_id' | 'phone' | 'name'>;
      cancellation_reasons: Table<CancellationReasonRow, 'company_id' | 'code' | 'name_en' | 'name_ar'>;
      blacklist_entries: Table<BlacklistEntryRow, 'company_id' | 'scope' | 'value' | 'reason'>;
      orders: Table<
        OrderRow,
        'company_id' | 'merchant_id' | 'source' | 'customer_name' | 'customer_phone'
      >;
      order_items: {
        Row: OrderItemRow;
        /** `total` is a generated column — the database rejects a supplied value. */
        Insert: Pick<OrderItemRow, 'order_id' | 'company_id' | 'name' | 'quantity' | 'unit_price'> &
          Partial<
            Omit<
              OrderItemRow,
              'order_id' | 'company_id' | 'name' | 'quantity' | 'unit_price' | 'total'
            >
          >;
        Update: Partial<Omit<OrderItemRow, 'total'>>;
        Relationships: [];
      };
      order_events: Table<OrderEventRow, 'order_id' | 'company_id' | 'event_type'>;
      order_calls: Table<OrderCallRow, 'order_id' | 'company_id' | 'phone' | 'outcome'>;
      order_messages: Table<OrderMessageRow, 'order_id' | 'company_id'>;
      message_templates: Table<MessageTemplateRow, 'company_id' | 'code' | 'name' | 'body_ar' | 'body_en'>;

      // warehouse — §5
      warehouse_locations: Table<WarehouseLocationRow, 'company_id' | 'warehouse_id' | 'level' | 'code'>;
      /** §5.10 append-only: rows arrive through post_inventory_movement, never a direct insert. */
      inventory_ledger: { Row: InventoryLedgerRow; Insert: never; Update: never; Relationships: [] };
      /** §5.8 derived from the ledger; only `reorder_point` is client-writable. */
      inventory_levels: {
        Row: InventoryLevelRow;
        Insert: never;
        Update: Partial<Pick<InventoryLevelRow, 'reorder_point'>>;
        Relationships: [];
      };
      goods_receipts: Table<GoodsReceiptRow, 'company_id' | 'merchant_id' | 'warehouse_id'>;
      goods_receipt_items: Table<GoodsReceiptItemRow, 'receipt_id' | 'company_id' | 'variant_id'>;
      warehouse_tasks: Table<WarehouseTaskRow, 'company_id' | 'warehouse_id' | 'task_type'>;
      pick_lists: Table<PickListRow, 'company_id' | 'warehouse_id'>;
      pick_list_items: Table<
        PickListItemRow,
        'pick_list_id' | 'company_id' | 'order_id' | 'variant_id' | 'requested_quantity'
      >;
      packing_materials: Table<PackingMaterialRow, 'company_id' | 'code' | 'name'>;
      packages: Table<PackageRow, 'company_id' | 'warehouse_id' | 'order_id'>;
      package_items: Table<PackageItemRow, 'package_id' | 'company_id' | 'variant_id' | 'quantity'>;
      fulfillment_fees: Table<FulfillmentFeeRow, 'company_id' | 'merchant_id' | 'service'>;

      // shipping — §6
      couriers: Table<CourierRow, 'company_id' | 'code' | 'name'>;
      shipments: Table<ShipmentRow, 'company_id' | 'merchant_id' | 'order_id'>;
      shipment_events: Table<ShipmentEventRow, 'shipment_id' | 'company_id'>;
      courier_instructions: Table<
        { id: string; company_id: string; shipment_id: string; instruction: CourierInstructionType;
          status: InstructionStatus; detail: Json | null; note: string | null; sent_by: string | null;
          sent_at: string; executed_at: string | null; courier_response: string | null;
          created_at: string; updated_at: string },
        'company_id' | 'shipment_id' | 'instruction'
      >;
      return_reasons: Table<ReturnReasonRow, 'company_id' | 'code' | 'name_en' | 'name_ar'>;
      returns: Table<ReturnRow, 'company_id' | 'merchant_id' | 'order_id'>;
      return_items: Table<ReturnItemRow, 'return_id' | 'company_id' | 'variant_id' | 'quantity'>;
      cod_collections: Table<CodCollectionRow, 'company_id' | 'merchant_id' | 'order_id'>;
      courier_statements: Table<
        CourierStatementRow,
        'company_id' | 'courier_id' | 'period_start' | 'period_end'
      >;
      courier_statement_lines: Table<
        { id: string; statement_id: string; company_id: string; awb: string | null;
          external_order_ref: string | null; declared_amount: number; declared_fee: number;
          collection_id: string | null; order_id: string | null; match_status: string;
          variance: number | null; note: string | null; created_at: string },
        'statement_id' | 'company_id'
      >;
      delay_rules: Table<
        { id: string; company_id: string; code: string; name_en: string; name_ar: string;
          applies_to_status: ShipmentStatus | null; threshold_hours: number; max_attempts: number | null;
          severity: NotificationSeverity; is_active: boolean; created_at: string; updated_at: string },
        'company_id' | 'code' | 'name_en' | 'name_ar' | 'threshold_hours'
      >;
      courier_zones: Table<
        { id: string; company_id: string; courier_id: string; governorate: string; city: string | null;
          shipping_fee: number; return_fee: number; promised_days: number | null; is_active: boolean;
          created_at: string; updated_at: string },
        'company_id' | 'courier_id' | 'governorate'
      >;

      // finance — §7
      finance_periods: Table<FinancePeriodRow, 'company_id' | 'period_start' | 'period_end'>;
      order_costs: Table<
        OrderCostRow,
        'company_id' | 'merchant_id' | 'order_id' | 'category' | 'cost_type' | 'amount'
      >;
      marketing_expenses: Table<MarketingExpenseRow, 'company_id' | 'platform' | 'spent_on' | 'amount'>;
      expense_categories: Table<ExpenseCategoryRow, 'company_id' | 'code' | 'name_en' | 'name_ar'>;
      operating_expenses: Table<
        OperatingExpenseRow,
        'company_id' | 'category_id' | 'description' | 'incurred_on' | 'amount'
      >;
      merchant_settlements: Table<
        MerchantSettlementRow,
        'company_id' | 'merchant_id' | 'period_start' | 'period_end'
      >;
      merchant_settlement_lines: Table<
        { id: string; settlement_id: string; company_id: string; order_id: string | null;
          description: string; order_value: number; collected: number; fees: number; net: number;
          created_at: string },
        'settlement_id' | 'company_id' | 'description'
      >;
      invoices: Table<InvoiceRow, 'company_id'>;
      invoice_lines: Table<InvoiceLineRow, 'invoice_id' | 'company_id' | 'description'>;

      // reports — §9
      report_definitions: Table<
        ReportDefinitionRow,
        'code' | 'name_en' | 'name_ar' | 'category' | 'source_view'
      >;
      saved_filters: Table<SavedFilterRow, 'company_id' | 'user_id' | 'name' | 'scope'>;
      report_schedules: Table<ReportScheduleRow, 'company_id' | 'report_id' | 'name'>;
      report_runs: Table<ReportRunRow, 'company_id'>;
    };
    Views: {
      syncable_stores: { Row: StoreRow; Relationships: [] };
      unmapped_products: { Row: UnmappedProductRow; Relationships: [] };
      mapped_variants: { Row: MappedVariantRow; Relationships: [] };
      confirmation_queue: { Row: ConfirmationQueueRow; Relationships: [] };
      company_features: { Row: CompanyFeatureRow; Relationships: [] };
      department_tree: { Row: DepartmentTreeRow; Relationships: [] };
      kpi_performance: { Row: KpiPerformanceRow; Relationships: [] };
      affiliate_performance: { Row: AffiliatePerformanceRow; Relationships: [] };
      customer_directory: { Row: CustomerDirectoryRow; Relationships: [] };
      stock_on_hand: { Row: StockOnHandRow; Relationships: [] };
      courier_scorecard: { Row: CourierScorecardRow; Relationships: [] };
      delayed_shipments: { Row: DelayedShipmentRow; Relationships: [] };
      order_profitability: { Row: OrderProfitabilityRow; Relationships: [] };
      rpt_executive_kpis: { Row: ExecutiveKpiRow; Relationships: [] };
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
      /** §3.13 rule 7 — may this variant be sold right now? */
      variant_sellable: { Args: { p_variant_id: string }; Returns: boolean };
      /** Is this capability active for the company? Override wins over plan. */
      company_has_feature: { Args: { p_company_id: string; p_feature_code: string }; Returns: boolean };
      /** Numeric limit for a company, or null for unlimited. */
      company_limit: { Args: { p_company_id: string; p_feature_code: string }; Returns: number | null };
      /** §4.12 duplicate candidates for one order. */
      find_duplicate_orders: { Args: { p_order_id: string }; Returns: DuplicateOrderRow[] };
      /** §4.6 round-robin target for the next assignment. */
      next_confirmation_agent: { Args: { p_company_id: string }; Returns: string | null };
      /** §5.10 the only supported way to move stock. */
      post_inventory_movement: {
        Args: {
          p_variant_id: string;
          p_warehouse_id: string;
          p_txn_type: InventoryTxnType;
          p_quantity: number;
          p_from_bucket?: InventoryBucket | null;
          p_to_bucket?: InventoryBucket | null;
          p_reference_type?: string | null;
          p_reference_id?: string | null;
          p_location_id?: string | null;
          p_reason?: string | null;
        };
        Returns: void;
      };
      /** §5.9 reserve a confirmed order; returns any shortfall per variant. */
      reserve_order_stock: {
        Args: { p_order_id: string; p_warehouse_id: string };
        Returns: { variant_id: string; requested: number; reserved: number; shortfall: number }[];
      };
      release_order_stock: { Args: { p_order_id: string; p_warehouse_id: string }; Returns: void };
      put_away_receipt_item: { Args: { p_item_id: string; p_location_id: string }; Returns: void };
      confirm_pick: { Args: { p_item_id: string; p_quantity: number }; Returns: void };
      /** §6.8 post an inspected return's disposition to stock. */
      apply_return_disposition: { Args: { p_item_id: string }; Returns: void };
      /** §6.11 match a courier statement against our collections. */
      reconcile_courier_statement: {
        Args: { p_statement_id: string };
        Returns: { matched_count: number; variance_count: number; not_found_count: number }[];
      };
      /** §7.7 rebuild a merchant statement from the period's data. */
      calculate_merchant_settlement: { Args: { p_settlement_id: string }; Returns: void };
      /** §7.3 rebuild the derived cost lines for an order. */
      rebuild_order_costs: { Args: { p_order_id: string }; Returns: void };
      /** §3.9 — bundle cost rolled up from its components. */
      bundle_cost: { Args: { p_bundle_product_id: string }; Returns: number };
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
      product_status: ProductStatus;
      product_type: ProductType;
      price_type: PriceType;
      cost_component: CostComponent;
      bundle_type: BundleType;
      mapping_status: MappingStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
