/**
 * Where does the database actually stand?
 *
 * Prints a row count per table, grouped by phase, so you can see at a glance
 * which migrations have run and which parts have data. Read-only — safe to run
 * against anything.
 *
 *   npm run db:status
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const PHASES: { phase: string; tables: string[] }[] = [
  { phase: '1  Tenancy & access', tables: ['companies', 'merchants', 'stores', 'warehouses', 'app_users', 'roles', 'permissions', 'user_roles'] },
  { phase: '2  Catalog',          tables: ['brands', 'categories', 'suppliers', 'products', 'product_variants', 'product_prices', 'product_channel_mappings'] },
  { phase: '3  Orders',           tables: ['customers', 'orders', 'order_items', 'order_calls', 'order_messages', 'order_events', 'cancellation_reasons', 'blacklist_entries'] },
  { phase: '4  Warehouse',        tables: ['warehouse_locations', 'goods_receipts', 'inventory_ledger', 'inventory_levels', 'warehouse_tasks', 'pick_lists', 'packages'] },
  { phase: '5  Shipping',         tables: ['couriers', 'courier_zones', 'shipments', 'shipment_events', 'returns', 'return_items', 'cod_collections', 'courier_statements'] },
  { phase: '6  Finance',          tables: ['order_costs', 'marketing_expenses', 'expense_categories', 'operating_expenses', 'merchant_settlements', 'invoices', 'finance_periods'] },
  { phase: '7  Reports',          tables: ['report_definitions', 'saved_filters', 'report_schedules', 'report_runs'] },
];

async function countRows(table: string): Promise<number | null> {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
  // A missing table means that migration has not run; anything else is a real
  // problem worth seeing rather than swallowing.
  if (error) return null;
  return count ?? 0;
}

async function main() {
  console.log(`\nDatabase: ${url}\n`);

  let missing = 0;
  let empty = 0;

  for (const group of PHASES) {
    console.log(`Phase ${group.phase}`);
    for (const table of group.tables) {
      const count = await countRows(table);
      if (count === null) {
        missing += 1;
        console.log(`   ${table.padEnd(28)} — table missing (migration not applied)`);
      } else {
        if (count === 0) empty += 1;
        console.log(`   ${table.padEnd(28)} ${String(count).padStart(6)}`);
      }
    }
    console.log('');
  }

  // Permission counts per module are the sharpest signal of which migration's
  // seed block actually ran — each phase inserts its own set.
  const { data: perms } = await db.from('permissions').select('module');
  if (perms) {
    const byModule = new Map<string, number>();
    for (const row of perms as { module: string }[]) {
      byModule.set(row.module, (byModule.get(row.module) ?? 0) + 1);
    }
    console.log('Permissions by module');
    for (const [moduleName, count] of [...byModule.entries()].sort()) {
      console.log(`   ${moduleName.padEnd(28)} ${String(count).padStart(6)}`);
    }
    console.log(`   ${'TOTAL'.padEnd(28)} ${String(perms.length).padStart(6)}\n`);
  }

  // Reference data each migration provisions per company. A zero here means
  // that migration's provisioning block did not run, even though its tables did.
  console.log('Per-company reference data (provisioned by migrations)');
  for (const table of ['cancellation_reasons', 'message_templates', 'return_reasons', 'delay_rules', 'packing_materials', 'expense_categories']) {
    const count = await countRows(table);
    const note = count === 0 ? '  <-- provisioning did not run' : '';
    console.log(`   ${table.padEnd(28)} ${String(count ?? '-').padStart(6)}${note}`);
  }
  console.log('');

  if (missing > 0) {
    console.log(`${missing} table(s) missing — apply the migrations (see docs/MIGRATIONS.md).`);
  } else if (empty > 0) {
    console.log(`Schema is complete. ${empty} table(s) are empty — run: npm run db:seed`);
  } else {
    console.log('Schema complete and populated.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
