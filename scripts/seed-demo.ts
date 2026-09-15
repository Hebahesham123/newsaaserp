/**
 * Demo dataset — a plausible mid-size fulfillment operation.
 *
 * Runs with the service role so it can write across tenants and populate the
 * log tables that have no client INSERT policy. Idempotent: everything is keyed
 * on a natural code, so re-running updates in place rather than duplicating.
 *
 *   npm run db:seed
 *   npm run db:seed -- --with-logins    also creates auth accounts for the demo staff
 *   npm run db:seed -- --phase1-only    tenant scaffold only, no catalog/orders/stock
 *
 * Phases 2-7 (catalog, orders, stock, shipping, finance, reporting) are seeded
 * by `seed-operations.ts`, which this calls at the end.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { seedOperations } from './seed-operations';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}

const withLogins = process.argv.includes('--with-logins');
const DEMO_PASSWORD = 'GreenErp!2026';

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

/** Fails loudly — a silent seed error produces a half-populated demo. */
function check<T>(label: string, { data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) {
    console.error(`\n✗ ${label}: ${error.message}`);
    process.exit(1);
  }
  return data as T;
}

type Row = Record<string, unknown>;

type StaffSeed = {
  employee_code: string;
  full_name: string;
  email: string;
  phone: string;
  job_title: string;
  role: string;
  department: string | null;
  team: string | null;
  status: string;
  locale: string;
  login: boolean;
  user_type: string;
  merchant?: string;
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
const iso = (d: Date) => d.toISOString();
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/* -------------------------------------------------------------------------- */
/* 1. Companies                                                               */
/* -------------------------------------------------------------------------- */

const COMPANIES: Row[] = [
  {
    code: 'GRN-EG',
    name_en: 'Green Ops Egypt',
    name_ar: 'جرين أوبس مصر',
    trade_name: 'Green Ops',
    business_type: 'Fulfillment & operations provider',
    country: 'Egypt',
    region: 'Cairo',
    address: '12 El Nasr Road, Nasr City, Cairo',
    tax_registration_number: '512-884-201',
    commercial_registration_number: 'CR-2019-44821',
    email: 'ops@greenops.example',
    phone: '+20 2 2670 4400',
    website: 'https://greenops.example',
    base_currency: 'EGP',
    status: 'active',
    operating_model: 'fulfillment',
    subscription_plan: 'Scale',
    subscription_start_date: dateOnly(daysAgo(420)),
    subscription_end_date: dateOnly(daysAgo(-180)),
    max_users: 120,
    max_stores: 60,
    max_monthly_orders: 250_000,
    internal_notes: 'Anchor tenant. Runs picking, packing and COD collection for 5 merchants.',
    settings: {
      working_days: [0, 1, 2, 3, 4],
      sla: { confirmation_hours: 4, dispatch_hours: 24 },
      numbering: { order: 'ORD-{YY}{MM}-{SEQ}' },
    },
  },
  {
    code: 'GRN-GULF',
    name_en: 'Green Ops Gulf',
    name_ar: 'جرين أوبس الخليج',
    trade_name: 'Green Ops Gulf',
    business_type: 'Regional fulfillment arm',
    country: 'United Arab Emirates',
    region: 'Dubai',
    address: 'Warehouse 7, Dubai Investment Park 2',
    email: 'gulf@greenops.example',
    phone: '+971 4 885 2100',
    base_currency: 'AED',
    status: 'under_review',
    operating_model: 'ecommerce_store_management',
    subscription_plan: 'Growth',
    subscription_start_date: dateOnly(daysAgo(60)),
    subscription_end_date: dateOnly(daysAgo(-305)),
    max_users: 40,
    max_stores: 15,
    max_monthly_orders: 40_000,
    internal_notes: 'Onboarding. Awaiting trade licence before go-live.',
    settings: { working_days: [0, 1, 2, 3, 4] },
  },
];

async function seedCompanies() {
  const ids: Record<string, string> = {};
  for (const company of COMPANIES) {
    const rows = check(
      `company ${company.code}`,
      await db.from('companies').upsert(company, { onConflict: 'code' }).select('id, code'),
    );
    ids[rows[0].code] = rows[0].id;
  }
  return ids;
}

/* -------------------------------------------------------------------------- */
/* 2. Merchants                                                               */
/* -------------------------------------------------------------------------- */

const MERCHANTS: Row[] = [
  {
    code: 'NRA',
    name: 'Nara Cosmetics',
    trade_name: 'NARA',
    merchant_type: 'Beauty & personal care',
    contact_person: 'Yasmin Fouad',
    email: 'yasmin@nara.example',
    phone: '+20 100 224 8871',
    country: 'Egypt',
    address: 'Sheikh Zayed, 6th of October',
    currency: 'EGP',
    status: 'active',
    contract_date: dateOnly(daysAgo(390)),
    go_live_date: dateOnly(daysAgo(360)),
    services: ['order_management', 'order_confirmation', 'warehousing', 'picking_packing', 'shipping', 'collection_management'],
    operating_model: 'ecommerce_store_management',
    credit_limit: 450000,
    payment_terms: 'Net 15',
    settlement_cycle: 'weekly',
    commission_percentage: 8.5,
    service_pricing: { storage_per_cbm: 85, pick: 3.5, pack: 4.25, receiving_per_unit: 1.1, return_handling: 12 },
    internal_notes: 'Highest volume merchant. Peak on payday weekends.',
  },
  {
    code: 'ATL',
    name: 'Atlas Activewear',
    trade_name: 'Atlas',
    merchant_type: 'Apparel',
    contact_person: 'Karim Adel',
    email: 'karim@atlas.example',
    phone: '+20 111 908 3320',
    country: 'Egypt',
    address: 'Maadi, Cairo',
    currency: 'EGP',
    status: 'active',
    contract_date: dateOnly(daysAgo(300)),
    go_live_date: dateOnly(daysAgo(268)),
    services: ['order_management', 'warehousing', 'picking_packing', 'shipping', 'return_management'],
    operating_model: 'ecommerce_store_management',
    credit_limit: 260000,
    payment_terms: 'Net 30',
    settlement_cycle: 'monthly',
    commission_percentage: 7.25,
    service_pricing: { storage_per_cbm: 78, pick: 3.2, pack: 3.9, return_handling: 15 },
  },
  {
    code: 'DTL',
    name: 'Dates & Tea Co.',
    trade_name: 'D&T',
    merchant_type: 'Food & beverage',
    contact_person: 'Mona Saleh',
    email: 'mona@datesandtea.example',
    phone: '+20 122 774 1190',
    country: 'Egypt',
    currency: 'EGP',
    status: 'active',
    contract_date: dateOnly(daysAgo(210)),
    go_live_date: dateOnly(daysAgo(180)),
    services: ['order_management', 'order_confirmation', 'customer_service', 'warehousing', 'shipping'],
    operating_model: 'ecommerce_store_management',
    credit_limit: 120000,
    payment_terms: 'Net 15',
    settlement_cycle: 'weekly',
    commission_percentage: 9,
    service_pricing: { storage_per_cbm: 92, pick: 3.5, pack: 4 },
  },
  {
    code: 'HLM',
    name: 'Helm Electronics',
    trade_name: 'Helm',
    merchant_type: 'Consumer electronics',
    contact_person: 'Tarek Nabil',
    email: 'tarek@helm.example',
    phone: '+20 128 330 5567',
    country: 'Egypt',
    currency: 'EGP',
    status: 'payment_overdue',
    contract_date: dateOnly(daysAgo(150)),
    go_live_date: dateOnly(daysAgo(120)),
    services: ['order_management', 'warehousing', 'picking_packing', 'shipping', 'shipment_followup'],
    operating_model: 'ecommerce_store_management',
    credit_limit: 600000,
    payment_terms: 'Net 30',
    settlement_cycle: 'monthly',
    commission_percentage: 6,
    service_pricing: { storage_per_cbm: 110, pick: 4.5, pack: 6.5 },
    internal_notes: 'Two invoices past due. Collections notified.',
  },
  {
    code: 'BLM',
    name: 'Bloom Home',
    trade_name: 'Bloom',
    merchant_type: 'Home & living',
    contact_person: 'Salma Hegazy',
    email: 'salma@bloomhome.example',
    phone: '+20 106 118 7742',
    country: 'Egypt',
    currency: 'EGP',
    status: 'onboarding',
    contract_date: dateOnly(daysAgo(28)),
    services: ['warehousing', 'goods_receiving', 'picking_packing'],
    operating_model: 'ecommerce_store_management',
    settlement_cycle: 'monthly',
    commission_percentage: 7.5,
    service_pricing: { storage_per_cbm: 80 },
    internal_notes: 'Stock arriving next week; not yet live.',
  },
];

async function seedMerchants(companyId: string) {
  const ids: Record<string, string> = {};
  for (const merchant of MERCHANTS) {
    const rows = check(
      `merchant ${String(merchant.code)}`,
      await db
        .from('merchants')
        .upsert({ ...merchant, company_id: companyId }, { onConflict: 'company_id,code' })
        .select('id, code'),
    );
    ids[rows[0].code] = rows[0].id;
  }
  return ids;
}

/* -------------------------------------------------------------------------- */
/* 3. Warehouses                                                              */
/* -------------------------------------------------------------------------- */

async function seedWarehouses(companyId: string, merchants: Record<string, string>) {
  const rows = [
    {
      code: 'WH-CAI-01',
      name: 'Cairo Main DC',
      warehouse_type: 'main',
      country: 'Egypt',
      region: 'Cairo',
      address: 'Industrial Zone, Obour City',
      phone: '+20 2 4610 8800',
      is_active: true,
      settings: { capacity_cbm: 4200, dock_doors: 6 },
    },
    {
      code: 'WH-GIZ-02',
      name: 'Giza Fulfillment Hub',
      warehouse_type: 'fulfillment',
      country: 'Egypt',
      region: 'Giza',
      address: 'Kilo 28, Cairo-Alex Desert Road',
      is_active: true,
      settings: { capacity_cbm: 2600, dock_doors: 4 },
    },
    {
      code: 'WH-NRA-03',
      name: 'Nara Dedicated Store',
      warehouse_type: 'fulfillment',
      dedicated_merchant_id: merchants.NRA,
      country: 'Egypt',
      region: 'Cairo',
      is_active: true,
      settings: { capacity_cbm: 900, temperature_controlled: true },
    },
    {
      code: 'WH-RET-04',
      name: 'Returns & Inspection',
      warehouse_type: 'returns',
      country: 'Egypt',
      region: 'Cairo',
      is_active: true,
      settings: { capacity_cbm: 400 },
    },
  ];

  const ids: Record<string, string> = {};
  for (const warehouse of rows) {
    const result = check(
      `warehouse ${warehouse.code}`,
      await db
        .from('warehouses')
        .upsert({ ...warehouse, company_id: companyId }, { onConflict: 'company_id,code' })
        .select('id, code'),
    );
    ids[result[0].code] = result[0].id;
  }
  return ids;
}

/* -------------------------------------------------------------------------- */
/* 4. Stores                                                                  */
/* -------------------------------------------------------------------------- */

async function seedStores(
  companyId: string,
  merchants: Record<string, string>,
  warehouses: Record<string, string>,
) {
  const rows = [
    {
      code: 'NRA-SHOP', name: 'Nara — Online Store', merchant: 'NRA', platform: 'shopify',
      store_url: 'https://nara-cosmetics.myshopify.com', status: 'active', sync_enabled: true,
      default_warehouse_id: warehouses['WH-NRA-03'], last_sync_at: iso(hoursAgo(1)), last_sync_status: 'success',
      connected_at: iso(daysAgo(358)), order_import_method: 'webhook',
    },
    {
      code: 'NRA-APP', name: 'Nara — Mobile App', merchant: 'NRA', platform: 'mobile_app',
      status: 'active', sync_enabled: true, default_warehouse_id: warehouses['WH-NRA-03'],
      last_sync_at: iso(hoursAgo(3)), last_sync_status: 'success', connected_at: iso(daysAgo(240)),
    },
    {
      code: 'NRA-NOON', name: 'Nara — noon', merchant: 'NRA', platform: 'noon',
      status: 'connection_error', sync_enabled: true, last_sync_at: iso(hoursAgo(9)),
      last_sync_status: 'failed', last_sync_error: 'Marketplace returned 401 — access token rejected',
      connected_at: iso(daysAgo(120)),
    },
    {
      code: 'ATL-SHOP', name: 'Atlas — Online Store', merchant: 'ATL', platform: 'shopify',
      store_url: 'https://atlas-activewear.myshopify.com', status: 'active', sync_enabled: true,
      default_warehouse_id: warehouses['WH-CAI-01'], last_sync_at: iso(hoursAgo(2)),
      last_sync_status: 'partial', connected_at: iso(daysAgo(266)),
    },
    {
      code: 'ATL-POS', name: 'Atlas — Maadi Branch', merchant: 'ATL', platform: 'pos',
      status: 'active', sync_enabled: false, default_warehouse_id: warehouses['WH-CAI-01'],
      connected_at: iso(daysAgo(200)),
    },
    {
      code: 'DTL-WOO', name: 'Dates & Tea — WooCommerce', merchant: 'DTL', platform: 'woocommerce',
      store_url: 'https://datesandtea.example', status: 'active', sync_enabled: true,
      default_warehouse_id: warehouses['WH-GIZ-02'], last_sync_at: iso(hoursAgo(5)),
      last_sync_status: 'success', connected_at: iso(daysAgo(178)),
    },
    {
      code: 'DTL-SOC', name: 'Dates & Tea — Instagram', merchant: 'DTL', platform: 'social_commerce',
      status: 'connected', sync_enabled: false, connected_at: iso(daysAgo(90)),
    },
    {
      code: 'HLM-AMZ', name: 'Helm — Amazon EG', merchant: 'HLM', platform: 'amazon',
      status: 'temporarily_suspended', sync_enabled: false, default_warehouse_id: warehouses['WH-GIZ-02'],
      last_sync_at: iso(daysAgo(4)), last_sync_status: 'failed', connected_at: iso(daysAgo(118)),
      notes: 'Suspended while the merchant settles overdue invoices.',
    },
    {
      code: 'HLM-SHOP', name: 'Helm — Online Store', merchant: 'HLM', platform: 'shopify',
      store_url: 'https://helm-electronics.myshopify.com', status: 'active', sync_enabled: true,
      default_warehouse_id: warehouses['WH-GIZ-02'], last_sync_at: iso(hoursAgo(6)),
      last_sync_status: 'success', connected_at: iso(daysAgo(115)),
    },
    {
      code: 'BLM-CUS', name: 'Bloom Home — Custom Store', merchant: 'BLM', platform: 'custom_store',
      store_url: 'https://bloomhome.example', status: 'draft', sync_enabled: false,
    },
  ];

  const ids: Record<string, string> = {};
  for (const { merchant, ...store } of rows) {
    const result = check(
      `store ${store.code}`,
      await db
        .from('stores')
        .upsert(
          {
            ...store,
            company_id: companyId,
            merchant_id: merchants[merchant],
            currency: 'EGP',
            provider: 'mock',
          },
          { onConflict: 'company_id,code' },
        )
        .select('id, code'),
    );
    ids[result[0].code] = result[0].id;
  }
  return ids;
}

/* -------------------------------------------------------------------------- */
/* 5. Departments, shifts, teams                                              */
/* -------------------------------------------------------------------------- */

async function seedDepartments(companyId: string) {
  const rows = [
    { code: 'OPS', name_en: 'Operations', name_ar: 'العمليات', description: 'End-to-end order operations' },
    { code: 'CONF', name_en: 'Order Confirmation', name_ar: 'تأكيد الطلبات', description: 'Calls and confirms inbound orders' },
    { code: 'WH', name_en: 'Warehouse', name_ar: 'المخزن', description: 'Receiving, picking, packing, dispatch' },
    { code: 'CS', name_en: 'Customer Service', name_ar: 'خدمة العملاء', description: 'Customer enquiries and complaints' },
    { code: 'FIN', name_en: 'Finance', name_ar: 'المالية', description: 'Settlements, collections and invoicing' },
    { code: 'QA', name_en: 'Quality', name_ar: 'الجودة', description: 'Call quality and dispatch accuracy audits' },
  ];

  const ids: Record<string, string> = {};
  for (const department of rows) {
    const result = check(
      `department ${department.code}`,
      await db
        .from('departments')
        .upsert({ ...department, company_id: companyId, is_active: true }, { onConflict: 'company_id,code' })
        .select('id, code'),
    );
    ids[result[0].code] = result[0].id;
  }
  return ids;
}

async function seedShifts(companyId: string, departments: Record<string, string>) {
  const rows = [
    { name: 'Morning · 09:00-17:00', start_time: '09:00', end_time: '17:00', working_days: [0, 1, 2, 3, 4], break_start: '13:00', break_end: '13:45', department_id: departments.CONF, workload_capacity: 120 },
    { name: 'Evening · 15:00-23:00', start_time: '15:00', end_time: '23:00', working_days: [0, 1, 2, 3, 4], break_start: '19:00', break_end: '19:30', department_id: departments.CONF, workload_capacity: 90 },
    { name: 'Warehouse Day · 08:00-18:00', start_time: '08:00', end_time: '18:00', working_days: [0, 1, 2, 3, 4, 5], break_start: '12:30', break_end: '13:15', department_id: departments.WH, workload_capacity: 400 },
    { name: 'Weekend Cover · 10:00-18:00', start_time: '10:00', end_time: '18:00', working_days: [5, 6], department_id: departments.CS, workload_capacity: 60 },
  ];

  const ids: Record<string, string> = {};
  for (const shift of rows) {
    const existing = check(
      `shift lookup ${shift.name}`,
      await db.from('shifts').select('id').eq('company_id', companyId).eq('name', shift.name).limit(1),
    );

    if (existing.length) {
      check(`shift update ${shift.name}`, await db.from('shifts').update(shift).eq('id', existing[0].id).select('id'));
      ids[shift.name] = existing[0].id;
    } else {
      const created = check(
        `shift ${shift.name}`,
        await db.from('shifts').insert({ ...shift, company_id: companyId, is_active: true }).select('id'),
      );
      ids[shift.name] = created[0].id;
    }
  }
  return ids;
}

async function seedTeams(
  companyId: string,
  departments: Record<string, string>,
  shifts: Record<string, string>,
  stores: Record<string, string>,
  merchants: Record<string, string>,
) {
  const rows = [
    {
      code: 'CONF-A', name: 'Confirmation Team A', department_id: departments.CONF,
      shift_id: shifts['Morning · 09:00-17:00'],
      assigned_store_ids: [stores['NRA-SHOP'], stores['NRA-APP']],
      assigned_merchant_ids: [merchants.NRA],
      order_types: ['cod', 'prepaid'], assigned_regions: ['Cairo', 'Giza'],
      max_workload_capacity: 140, targets: { calls_per_day: 90, confirmation_rate: 0.82 },
      assignment_workflow: { strategy: 'round_robin', reassign_after_minutes: 45 },
    },
    {
      code: 'CONF-B', name: 'Confirmation Team B', department_id: departments.CONF,
      shift_id: shifts['Evening · 15:00-23:00'],
      assigned_store_ids: [stores['ATL-SHOP'], stores['DTL-WOO']],
      assigned_merchant_ids: [merchants.ATL, merchants.DTL],
      order_types: ['cod'], assigned_regions: ['Alexandria', 'Delta'],
      max_workload_capacity: 110, targets: { calls_per_day: 80, confirmation_rate: 0.78 },
      assignment_workflow: { strategy: 'least_loaded', reassign_after_minutes: 60 },
    },
    {
      code: 'WH-PICK', name: 'Picking & Packing', department_id: departments.WH,
      shift_id: shifts['Warehouse Day · 08:00-18:00'],
      assigned_store_ids: [], assigned_merchant_ids: [],
      order_types: [], assigned_regions: [], max_workload_capacity: 500,
      targets: { units_per_hour: 65, accuracy: 0.995 },
    },
    {
      code: 'CS-CARE', name: 'Customer Care', department_id: departments.CS,
      shift_id: shifts['Weekend Cover · 10:00-18:00'],
      assigned_store_ids: [], assigned_merchant_ids: [],
      order_types: [], assigned_regions: [], max_workload_capacity: 70,
      targets: { first_response_minutes: 15 },
    },
  ];

  const ids: Record<string, string> = {};
  for (const team of rows) {
    const result = check(
      `team ${team.code}`,
      await db
        .from('teams')
        .upsert({ ...team, company_id: companyId, is_active: true }, { onConflict: 'company_id,code' })
        .select('id, code'),
    );
    ids[result[0].code] = result[0].id;
  }
  return ids;
}

/* -------------------------------------------------------------------------- */
/* 6. Staff                                                                   */
/* -------------------------------------------------------------------------- */

const STAFF: StaffSeed[] = [
  { employee_code: 'EMP-001', full_name: 'Amira Zaki', email: 'amira.zaki@greenops.example', phone: '+20 100 551 2210', job_title: 'Company Administrator', role: 'company_admin', department: 'OPS', team: null, status: 'active', locale: 'ar', login: true, user_type: 'company' },
  { employee_code: 'EMP-002', full_name: 'Hossam El Din', email: 'hossam.eldin@greenops.example', phone: '+20 100 774 8890', job_title: 'Operations Manager', role: 'operations_manager', department: 'OPS', team: null, status: 'active', locale: 'ar', login: true, user_type: 'company' },
  { employee_code: 'EMP-003', full_name: 'Nourhan Mostafa', email: 'nourhan.mostafa@greenops.example', phone: '+20 111 220 3341', job_title: 'Confirmation Team Leader', role: 'confirmation_team_leader', department: 'CONF', team: 'CONF-A', status: 'active', locale: 'ar', login: true, user_type: 'company' },
  { employee_code: 'EMP-004', full_name: 'Mahmoud Serag', email: 'mahmoud.serag@greenops.example', phone: '+20 122 118 9902', job_title: 'Confirmation Agent', role: 'confirmation_agent', department: 'CONF', team: 'CONF-A', status: 'active', locale: 'ar', login: true, user_type: 'company' },
  { employee_code: 'EMP-005', full_name: 'Rana Kamal', email: 'rana.kamal@greenops.example', phone: '+20 128 664 7710', job_title: 'Confirmation Agent', role: 'confirmation_agent', department: 'CONF', team: 'CONF-A', status: 'active', locale: 'ar', login: false, user_type: 'company' },
  { employee_code: 'EMP-006', full_name: 'Omar Sherif', email: 'omar.sherif@greenops.example', phone: '+20 106 903 5528', job_title: 'Confirmation Agent', role: 'confirmation_agent', department: 'CONF', team: 'CONF-B', status: 'on_leave', locale: 'ar', login: false, user_type: 'company' },
  { employee_code: 'EMP-007', full_name: 'Dalia Ashraf', email: 'dalia.ashraf@greenops.example', phone: '+20 109 337 4416', job_title: 'Warehouse Manager', role: 'warehouse_manager', department: 'WH', team: 'WH-PICK', status: 'active', locale: 'ar', login: true, user_type: 'company' },
  { employee_code: 'EMP-008', full_name: 'Sayed Ibrahim', email: 'sayed.ibrahim@greenops.example', phone: '+20 100 442 1173', job_title: 'Picker', role: 'picker', department: 'WH', team: 'WH-PICK', status: 'active', locale: 'ar', login: false, user_type: 'company' },
  { employee_code: 'EMP-009', full_name: 'Mostafa Gamal', email: 'mostafa.gamal@greenops.example', phone: '+20 112 887 6650', job_title: 'Packer', role: 'packer', department: 'WH', team: 'WH-PICK', status: 'active', locale: 'ar', login: false, user_type: 'company' },
  { employee_code: 'EMP-010', full_name: 'Heba Selim', email: 'heba.selim@greenops.example', phone: '+20 127 550 8834', job_title: 'Inventory Controller', role: 'inventory_controller', department: 'WH', team: null, status: 'active', locale: 'ar', login: false, user_type: 'company' },
  { employee_code: 'EMP-011', full_name: 'Youssef Ramy', email: 'youssef.ramy@greenops.example', phone: '+20 101 229 3374', job_title: 'Customer Service Agent', role: 'customer_service_agent', department: 'CS', team: 'CS-CARE', status: 'active', locale: 'en', login: false, user_type: 'company' },
  { employee_code: 'EMP-012', full_name: 'Mariam Fathy', email: 'mariam.fathy@greenops.example', phone: '+20 115 664 2201', job_title: 'Accountant', role: 'accountant', department: 'FIN', team: null, status: 'active', locale: 'ar', login: true, user_type: 'company' },
  { employee_code: 'EMP-013', full_name: 'Khaled Anwar', email: 'khaled.anwar@greenops.example', phone: '+20 120 774 9915', job_title: 'Collection Officer', role: 'collection_officer', department: 'FIN', team: null, status: 'active', locale: 'ar', login: false, user_type: 'company' },
  { employee_code: 'EMP-014', full_name: 'Injy Hatem', email: 'injy.hatem@greenops.example', phone: '+20 114 220 6673', job_title: 'Quality Auditor', role: 'quality_auditor', department: 'QA', team: null, status: 'active', locale: 'en', login: false, user_type: 'company' },
  { employee_code: 'EMP-015', full_name: 'Ziad Refaat', email: 'ziad.refaat@greenops.example', phone: '+20 102 881 4407', job_title: 'Shipping Manager', role: 'shipping_manager', department: 'OPS', team: null, status: 'active', locale: 'ar', login: false, user_type: 'company' },
  { employee_code: 'EMP-016', full_name: 'Farida Wagih', email: 'farida.wagih@greenops.example', phone: '+20 108 335 2294', job_title: 'Reports Analyst', role: 'reports_viewer', department: 'OPS', team: null, status: 'invited', locale: 'en', login: false, user_type: 'company' },
  { employee_code: 'EMP-017', full_name: 'Bassem Nader', email: 'bassem.nader@greenops.example', phone: '+20 103 447 1128', job_title: 'Returns Agent', role: 'returns_agent', department: 'WH', team: null, status: 'temporarily_suspended', locale: 'ar', login: false, user_type: 'company' },
  { employee_code: 'MER-001', full_name: 'Yasmin Fouad', email: 'yasmin.fouad@nara.example', phone: '+20 100 224 8871', job_title: 'Merchant Admin — Nara', role: 'merchant_admin', department: null, team: null, status: 'active', locale: 'ar', login: false, user_type: 'merchant', merchant: 'NRA' },
  { employee_code: 'MER-002', full_name: 'Karim Adel', email: 'karim.adel@atlas.example', phone: '+20 111 908 3320', job_title: 'Merchant Admin — Atlas', role: 'merchant_admin', department: null, team: null, status: 'active', locale: 'ar', login: false, user_type: 'merchant', merchant: 'ATL' },
];

async function seedStaff(
  companyId: string,
  departments: Record<string, string>,
  teams: Record<string, string>,
  merchants: Record<string, string>,
) {
  const roleRows = check(
    'company roles',
    await db.from('roles').select('id, code').eq('company_id', companyId),
  );
  const roleByCode = new Map(roleRows.map((r) => [r.code, r.id]));

  const ids: Record<string, string> = {};

  for (const person of STAFF) {
    const record = {
      company_id: companyId,
      merchant_id: person.merchant ? merchants[person.merchant] : null,
      is_platform_admin: false,
      full_name: person.full_name,
      email: person.email,
      phone: person.phone,
      employee_code: person.employee_code,
      job_title: person.job_title,
      department_id: person.department ? departments[person.department] : null,
      team_id: person.team ? teams[person.team] : null,
      locale: person.locale,
      timezone: 'Africa/Cairo',
      status: person.status,
      user_type: person.user_type,
      hire_date: dateOnly(daysAgo(120 + person.employee_code.charCodeAt(6) * 3)),
      system_access_start_date: dateOnly(daysAgo(118)),
      working_hours: { start: '09:00', end: '17:00' },
      working_days: [0, 1, 2, 3, 4],
      performance_target: person.job_title.includes('Agent') ? { calls_per_day: 85 } : {},
      max_assigned_orders: person.job_title.includes('Agent') ? 60 : null,
      notification_preferences: { in_app: true, email: person.status === 'active' },
      last_login_at: person.status === 'active' ? iso(hoursAgo(2 + (person.employee_code.charCodeAt(6) % 40))) : null,
    };

    const result = check(
      `staff ${person.employee_code}`,
      await db.from('app_users').upsert(record, { onConflict: 'company_id,employee_code' }).select('id'),
    );

    const userId = result[0].id;
    ids[person.employee_code] = userId;

    const roleId = roleByCode.get(person.role);
    if (roleId) {
      check(
        `role link ${person.employee_code}`,
        await db.from('user_roles').upsert({ user_id: userId, role_id: roleId }, { onConflict: 'user_id,role_id', ignoreDuplicates: true }).select('user_id'),
      );
    }

    // §2.7.1 data scopes — merchant admins see only their own merchant.
    if (person.merchant) {
      check(
        `scope ${person.employee_code}`,
        await db
          .from('user_data_scopes')
          .upsert(
            { user_id: userId, scope_type: 'merchant', scope_id: merchants[person.merchant] },
            { onConflict: 'user_id,scope_type,scope_id', ignoreDuplicates: true },
          )
          .select('id'),
      );
    }
  }

  // Managers and team leaders, now that every id exists.
  const managerOf: Record<string, string> = {
    'EMP-003': 'EMP-002', 'EMP-004': 'EMP-003', 'EMP-005': 'EMP-003', 'EMP-006': 'EMP-003',
    'EMP-007': 'EMP-002', 'EMP-008': 'EMP-007', 'EMP-009': 'EMP-007', 'EMP-010': 'EMP-007',
    'EMP-011': 'EMP-002', 'EMP-012': 'EMP-001', 'EMP-013': 'EMP-012', 'EMP-014': 'EMP-001',
    'EMP-015': 'EMP-002', 'EMP-017': 'EMP-007',
  };
  for (const [employee, manager] of Object.entries(managerOf)) {
    check(
      `manager ${employee}`,
      await db.from('app_users').update({ manager_id: ids[manager] }).eq('id', ids[employee]).select('id'),
    );
  }

  check('department managers', await db.from('departments').update({ manager_id: ids['EMP-002'] }).eq('company_id', companyId).eq('code', 'OPS').select('id'));
  check('department managers CONF', await db.from('departments').update({ manager_id: ids['EMP-003'] }).eq('company_id', companyId).eq('code', 'CONF').select('id'));
  check('department managers WH', await db.from('departments').update({ manager_id: ids['EMP-007'] }).eq('company_id', companyId).eq('code', 'WH').select('id'));
  check('department managers FIN', await db.from('departments').update({ manager_id: ids['EMP-012'] }).eq('company_id', companyId).eq('code', 'FIN').select('id'));
  check('department managers QA', await db.from('departments').update({ manager_id: ids['EMP-014'] }).eq('company_id', companyId).eq('code', 'QA').select('id'));
  check('department managers CS', await db.from('departments').update({ manager_id: ids['EMP-011'] }).eq('company_id', companyId).eq('code', 'CS').select('id'));

  check('team leader CONF-A', await db.from('teams').update({ leader_id: ids['EMP-003'] }).eq('company_id', companyId).eq('code', 'CONF-A').select('id'));
  check('team leader CONF-B', await db.from('teams').update({ leader_id: ids['EMP-003'] }).eq('company_id', companyId).eq('code', 'CONF-B').select('id'));
  check('team leader WH-PICK', await db.from('teams').update({ leader_id: ids['EMP-007'] }).eq('company_id', companyId).eq('code', 'WH-PICK').select('id'));
  check('team leader CS-CARE', await db.from('teams').update({ leader_id: ids['EMP-011'] }).eq('company_id', companyId).eq('code', 'CS-CARE').select('id'));

  check('warehouse manager 1', await db.from('warehouses').update({ manager_id: ids['EMP-007'] }).eq('company_id', companyId).eq('code', 'WH-CAI-01').select('id'));
  check('warehouse manager 2', await db.from('warehouses').update({ manager_id: ids['EMP-010'] }).eq('company_id', companyId).eq('code', 'WH-GIZ-02').select('id'));
  check('company account manager', await db.from('companies').update({ account_manager_id: ids['EMP-001'] }).eq('id', companyId).select('id'));
  check('merchant account manager', await db.from('merchants').update({ account_manager_id: ids['EMP-002'] }).eq('company_id', companyId).select('id'));

  return ids;
}

/** Team and shift membership rows (§2.8.2, §2.8.3). */
async function seedMemberships(staff: Record<string, string>, teams: Record<string, string>, shifts: Record<string, string>) {
  const teamMembers = [
    ['CONF-A', 'EMP-003'], ['CONF-A', 'EMP-004'], ['CONF-A', 'EMP-005'],
    ['CONF-B', 'EMP-006'], ['WH-PICK', 'EMP-007'], ['WH-PICK', 'EMP-008'],
    ['WH-PICK', 'EMP-009'], ['CS-CARE', 'EMP-011'],
  ];
  for (const [team, employee] of teamMembers) {
    check(
      `team member ${team}/${employee}`,
      await db.from('team_members').upsert({ team_id: teams[team], user_id: staff[employee] }, { onConflict: 'team_id,user_id', ignoreDuplicates: true }).select('team_id'),
    );
  }

  const shiftMembers = [
    ['Morning · 09:00-17:00', 'EMP-003'], ['Morning · 09:00-17:00', 'EMP-004'],
    ['Morning · 09:00-17:00', 'EMP-005'], ['Evening · 15:00-23:00', 'EMP-006'],
    ['Warehouse Day · 08:00-18:00', 'EMP-008'], ['Warehouse Day · 08:00-18:00', 'EMP-009'],
    ['Weekend Cover · 10:00-18:00', 'EMP-011'],
  ];
  for (const [shift, employee] of shiftMembers) {
    check(
      `shift member ${shift}/${employee}`,
      await db.from('shift_members').upsert({ shift_id: shifts[shift], user_id: staff[employee] }, { onConflict: 'shift_id,user_id', ignoreDuplicates: true }).select('shift_id'),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* 7. Logs, notifications, approvals                                          */
/* -------------------------------------------------------------------------- */

async function seedSyncLog(companyId: string, stores: Record<string, string>, staff: Record<string, string>) {
  check('clear sync_log', await db.from('sync_log').delete().eq('company_id', companyId).select('id'));

  const entities = ['orders', 'products', 'inventory', 'prices', 'customers'] as const;
  const rows: Record<string, unknown>[] = [];

  const profile: [string, number, 'success' | 'partial' | 'failed'][] = [
    ['NRA-SHOP', 26, 'success'], ['NRA-APP', 14, 'success'], ['NRA-NOON', 8, 'failed'],
    ['ATL-SHOP', 18, 'partial'], ['DTL-WOO', 16, 'success'], ['HLM-SHOP', 12, 'success'],
    ['HLM-AMZ', 5, 'failed'],
  ];

  for (const [storeCode, runs, bias] of profile) {
    for (let i = 0; i < runs; i++) {
      const entity = entities[i % entities.length];
      // Most runs succeed; the biased outcome shows up every few runs so the
      // health charts have something other than a flat line.
      const status = i % 5 === 0 ? bias : i % 7 === 0 ? 'partial' : 'success';
      const received = 40 + ((i * 37) % 260);
      const failed = status === 'success' ? 0 : status === 'partial' ? Math.max(1, Math.round(received * 0.06)) : received;
      const startedAt = hoursAgo(i * 7 + 1);
      const duration = 900 + ((i * 613) % 7400);

      rows.push({
        company_id: companyId,
        store_id: stores[storeCode],
        entity,
        trigger_source: i % 4 === 0 ? 'manual' : i % 3 === 0 ? 'scheduled' : 'webhook',
        status,
        records_received: received,
        records_succeeded: received - failed,
        records_failed: failed,
        error_details: status === 'success' ? null : {
          message: status === 'failed' ? 'Channel rejected the request (401)' : 'Some records failed validation',
          sample: status === 'failed' ? ['auth.token_expired'] : ['sku_not_found: ATL-TSH-XL', 'price_missing: DTL-BOX-6'],
        },
        duration_ms: duration,
        retry_count: status === 'failed' ? 2 : 0,
        initiated_by: i % 4 === 0 ? staff['EMP-002'] : null,
        started_at: iso(startedAt),
        finished_at: iso(new Date(startedAt.getTime() + duration)),
      });
    }
  }

  check('sync_log', await db.from('sync_log').insert(rows).select('id'));
  return rows.length;
}

async function seedNotifications(companyId: string, staff: Record<string, string>, stores: Record<string, string>) {
  check('clear notifications', await db.from('notifications').delete().eq('company_id', companyId).select('id'));

  const rows = [
    { recipient: 'EMP-002', event_code: 'store.connection_failed', severity: 'critical', title_en: 'Nara — noon connection failed', title_ar: 'فشل الاتصال بمتجر نون', body_en: 'The marketplace rejected the access token. Reconnect the store to resume syncing.', body_ar: 'تم رفض رمز الوصول. أعد ربط المتجر لاستئناف المزامنة.', entity: 'stores', entity_id: stores['NRA-NOON'], link: `/stores/${stores['NRA-NOON']}`, hoursAgo: 9 },
    { recipient: 'EMP-002', event_code: 'sync.partial_failure', severity: 'warning', title_en: 'Atlas store sync completed with errors', title_ar: 'اكتملت مزامنة أطلس مع أخطاء', body_en: '11 of 184 records failed validation.', body_ar: 'فشل التحقق من 11 من 184 سجلاً.', entity: 'stores', entity_id: stores['ATL-SHOP'], link: `/stores/${stores['ATL-SHOP']}`, hoursAgo: 2 },
    { recipient: 'EMP-012', event_code: 'merchant.payment_overdue', severity: 'critical', title_en: 'Helm Electronics is payment overdue', title_ar: 'مدفوعات هيلم إلكترونيكس متأخرة', body_en: 'Two invoices are past due. Store synchronization has been suspended.', body_ar: 'فاتورتان متأخرتان. تم إيقاف مزامنة المتجر.', entity: 'merchants', entity_id: null, link: '/merchants', hoursAgo: 26 },
    { recipient: 'EMP-001', event_code: 'company.subscription_expiring', severity: 'warning', title_en: 'Subscription renews in 180 days', title_ar: 'يتم تجديد الاشتراك بعد 180 يوماً', body_en: 'Plan: Scale. Review seat and store limits before renewal.', body_ar: 'الباقة: Scale. راجع حدود المستخدمين والمتاجر قبل التجديد.', entity: 'companies', entity_id: null, link: '/companies', hoursAgo: 50 },
    { recipient: 'EMP-001', event_code: 'approval.pending', severity: 'info', title_en: '3 approval requests are waiting', title_ar: '3 طلبات اعتماد في الانتظار', body_en: 'Stock adjustments and a settlement need a second pair of eyes.', body_ar: 'تسويات المخزون والتسوية المالية تحتاج مراجعة ثانية.', entity: 'approval_requests', entity_id: null, link: '/approvals', hoursAgo: 5 },
    { recipient: 'EMP-003', event_code: 'team.capacity_reached', severity: 'warning', title_en: 'Confirmation Team A at 94% capacity', title_ar: 'فريق التأكيد أ عند 94% من طاقته', body_en: '132 of 140 orders assigned. Consider spilling over to Team B.', body_ar: 'تم تعيين 132 من 140 طلباً. يمكن تحويل الفائض إلى الفريق ب.', entity: 'teams', entity_id: null, link: '/teams', hoursAgo: 1 },
    { recipient: 'EMP-007', event_code: 'warehouse.returns_backlog', severity: 'warning', title_en: 'Returns inspection backlog: 48 units', title_ar: 'تراكم فحص المرتجعات: 48 وحدة', body_en: 'Oldest item has been waiting 3 days.', body_ar: 'أقدم عنصر ينتظر 3 أيام.', entity: 'warehouses', entity_id: null, link: '/warehouses', hoursAgo: 7 },
    { recipient: 'EMP-002', event_code: 'user.login_locked', severity: 'info', title_en: 'Bassem Nader is temporarily suspended', title_ar: 'تم إيقاف باسم نادر مؤقتاً', body_en: 'Account suspended pending review.', body_ar: 'تم إيقاف الحساب في انتظار المراجعة.', entity: 'app_users', entity_id: null, link: '/users', hoursAgo: 70 },
  ];

  const payload = rows.map((row, index) => ({
    company_id: companyId,
    recipient_id: staff[row.recipient],
    event_code: row.event_code,
    severity: row.severity,
    title_en: row.title_en,
    title_ar: row.title_ar,
    body_en: row.body_en,
    body_ar: row.body_ar,
    entity: row.entity,
    entity_id: row.entity_id,
    link: row.link,
    channels: row.severity === 'critical' ? ['in_app', 'email'] : ['in_app'],
    delivered_channels: ['in_app'],
    read_at: index > 4 ? iso(hoursAgo(row.hoursAgo - 1)) : null,
    created_at: iso(hoursAgo(row.hoursAgo)),
  }));

  check('notifications', await db.from('notifications').insert(payload).select('id'));
  return payload.length;
}

async function seedApprovals(companyId: string, staff: Record<string, string>) {
  check('clear approvals', await db.from('approval_requests').delete().eq('company_id', companyId).select('id'));

  const rows = [
    { request_type: 'stock_adjustment', entity: 'inventory_adjustments', reason: 'Cycle count variance in Cairo Main DC — 14 units of NRA-SER-30 unaccounted.', payload: { warehouse: 'WH-CAI-01', sku: 'NRA-SER-30', delta: -14 }, status: 'pending', requested_by: 'EMP-010', decided_by: null, daysAgo: 1 },
    { request_type: 'stock_adjustment', entity: 'inventory_adjustments', reason: 'Damaged stock write-off after shelf collapse.', payload: { warehouse: 'WH-GIZ-02', sku: 'ATL-TSH-XL', delta: -22 }, status: 'pending', requested_by: 'EMP-008', decided_by: null, daysAgo: 2 },
    { request_type: 'settlement', entity: 'merchant_settlements', reason: 'Weekly settlement for Nara Cosmetics, cycle ending Thursday.', payload: { merchant: 'NRA', gross: 412880.5, fees: 35094.83, net: 377785.67 }, status: 'pending', requested_by: 'EMP-012', decided_by: null, daysAgo: 3 },
    { request_type: 'permission_change', entity: 'user_roles', reason: 'Grant finance.view_merchant_balance to the collections officer.', payload: { user: 'EMP-013', permission: 'finance.view_merchant_balance' }, status: 'approved', requested_by: 'EMP-012', decided_by: 'EMP-001', decision_note: 'Approved — required for the COD reconciliation report.', daysAgo: 9 },
    { request_type: 'merchant_pricing', entity: 'merchants', reason: 'Reduce Atlas pick fee from 3.5 to 3.2 EGP per unit.', payload: { merchant: 'ATL', field: 'service_pricing.pick', from: 3.5, to: 3.2 }, status: 'approved', requested_by: 'EMP-002', decided_by: 'EMP-001', decision_note: 'Approved for the next settlement cycle.', daysAgo: 14 },
    { request_type: 'stock_adjustment', entity: 'inventory_adjustments', reason: 'Requested write-off of 90 units without a cycle count reference.', payload: { warehouse: 'WH-CAI-01', sku: 'HLM-PWB-10', delta: -90 }, status: 'rejected', requested_by: 'EMP-009', decided_by: 'EMP-007', decision_note: 'Rejected — run a cycle count first and resubmit with evidence.', daysAgo: 18 },
  ];

  const payload = rows.map((row) => ({
    company_id: companyId,
    request_type: row.request_type,
    entity: row.entity,
    entity_id: null,
    payload: row.payload,
    reason: row.reason,
    status: row.status,
    requested_by: staff[row.requested_by],
    requested_at: iso(daysAgo(row.daysAgo)),
    decided_by: row.decided_by ? staff[row.decided_by] : null,
    decided_at: row.decided_by ? iso(daysAgo(row.daysAgo - 1)) : null,
    decision_note: row.decision_note ?? null,
  }));

  check('approvals', await db.from('approval_requests').insert(payload).select('id'));
  return payload.length;
}

async function seedLoginAttempts(staff: Record<string, string>) {
  const ids = Object.values(staff);
  check('clear login attempts', await db.from('login_attempts').delete().in('user_id', ids).select('id'));

  const people = STAFF.filter((p) => p.status === 'active');
  const rows: Record<string, unknown>[] = [];

  people.forEach((person, personIndex) => {
    for (let i = 0; i < 4; i++) {
      const failed = personIndex % 5 === 0 && i === 0;
      rows.push({
        user_id: staff[person.employee_code],
        email: person.email,
        succeeded: !failed,
        failure_reason: failed ? 'Invalid login credentials' : null,
        ip_address: `41.${40 + (personIndex % 60)}.${10 + i}.${100 + personIndex}`,
        device: i % 2 === 0 ? 'Desktop' : 'Mobile',
        browser: i % 3 === 0 ? 'Chrome 141' : i % 3 === 1 ? 'Edge 141' : 'Safari 19',
        user_agent: 'Mozilla/5.0 (seeded demo history)',
        is_new_device: i === 3,
        attempted_at: iso(hoursAgo(i * 26 + personIndex + 1)),
      });
    }
  });

  check('login attempts', await db.from('login_attempts').insert(rows).select('id'));
  return rows.length;
}

/* -------------------------------------------------------------------------- */
/* 8. Optional auth accounts for the demo staff                               */
/* -------------------------------------------------------------------------- */

async function seedLogins() {
  const wanted = STAFF.filter((p) => p.login);
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = new Map((list?.users ?? []).map((u) => [u.email?.toLowerCase(), u.id]));

  for (const person of wanted) {
    const already = existing.get(person.email.toLowerCase());
    if (already) {
      const { error } = await db.auth.admin.updateUserById(already, {
        password: DEMO_PASSWORD,
        email_confirm: true,
      });
      if (error) console.warn(`  ! ${person.email}: ${error.message}`);
      else console.log(`  ↻ ${person.email} (password reset)`);
      continue;
    }

    // The app_users row is already 'active' from the seed above, so the signup
    // trigger's invite path will not claim it. Flip it to 'invited' for the
    // moment of creation and let the trigger link and reactivate it.
    await db.from('app_users').update({ status: 'invited', auth_user_id: null }).eq('email', person.email);

    const { error } = await db.auth.admin.createUser({
      email: person.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: person.full_name },
    });

    if (error) {
      console.warn(`  ! ${person.email}: ${error.message}`);
      await db.from('app_users').update({ status: person.status }).eq('email', person.email);
    } else {
      console.log(`  + ${person.email}`);
      if (person.status !== 'active') {
        await db.from('app_users').update({ status: person.status }).eq('email', person.email);
      }
    }
  }
}

/* -------------------------------------------------------------------------- */

async function main() {
  console.log('Seeding Green ERP demo data\n');

  const companies = await seedCompanies();
  const companyId = companies['GRN-EG'];
  console.log(`✓ companies         ${Object.keys(companies).length}`);

  const merchants = await seedMerchants(companyId);
  console.log(`✓ merchants         ${Object.keys(merchants).length}`);

  const warehouses = await seedWarehouses(companyId, merchants);
  console.log(`✓ warehouses        ${Object.keys(warehouses).length}`);

  const stores = await seedStores(companyId, merchants, warehouses);
  console.log(`✓ stores            ${Object.keys(stores).length}`);

  const departments = await seedDepartments(companyId);
  console.log(`✓ departments       ${Object.keys(departments).length}`);

  const shifts = await seedShifts(companyId, departments);
  console.log(`✓ shifts            ${Object.keys(shifts).length}`);

  const teams = await seedTeams(companyId, departments, shifts, stores, merchants);
  console.log(`✓ teams             ${Object.keys(teams).length}`);

  const staff = await seedStaff(companyId, departments, teams, merchants);
  console.log(`✓ users             ${Object.keys(staff).length}`);

  await seedMemberships(staff, teams, shifts);
  console.log('✓ memberships');

  console.log(`✓ sync runs         ${await seedSyncLog(companyId, stores, staff)}`);
  console.log(`✓ notifications     ${await seedNotifications(companyId, staff, stores)}`);
  console.log(`✓ approvals         ${await seedApprovals(companyId, staff)}`);
  console.log(`✓ login history     ${await seedLoginAttempts(staff)}`);

  // Phases 2-7 live in their own module: the tenant above is the stage, and
  // this is the operation that runs on it.
  if (!process.argv.includes('--phase1-only')) {
    console.log('');
    await seedOperations({ db, companyId, merchants, stores, warehouses, staff });
  }

  if (withLogins) {
    console.log('\nAuth accounts:');
    await seedLogins();
    console.log(`\nAll demo logins use the password: ${DEMO_PASSWORD}`);
  } else {
    console.log('\nRe-run with --with-logins to create sign-in accounts for the demo staff.');
  }

  console.log('\nDone.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
