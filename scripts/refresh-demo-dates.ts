/**
 * Rolls the demo data forward so it lands in the present.
 *
 * The seed writes orders relative to the day it runs. A week later every
 * "today" tile on the dashboard reads zero and the system looks broken, which
 * is the opposite of what demo data is for — you cannot judge a screen whose
 * numbers are all zero because the clock moved on.
 *
 * So this shifts every business timestamp by one constant delta, chosen to put
 * the most recent order at right now. One delta for every table matters: the
 * gaps between an order, its confirmation and its handover are what the
 * processing-time average is computed from, and shifting each column by its own
 * amount would quietly invent a different dataset.
 *
 * `updated_at` is deliberately not shifted — it is maintained by a trigger and
 * means "when this row was last written", which is genuinely now.
 *
 * Safe to run repeatedly. Running it when the data is already current shifts by
 * roughly zero.
 *
 *   npm run db:refresh-dates
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

/** Business timestamps per table. `updated_at` is owned by a trigger, so it is absent. */
const SHIFTABLE: Record<string, string[]> = {
  orders: [
    'order_date',
    'assigned_at',
    'confirmed_at',
    'cancelled_at',
    'ready_at',
    'last_call_at',
    'next_callback_at',
    'created_at',
  ],
  shipments: [
    'handed_over_at',
    'picked_up_at',
    'delivered_at',
    'returned_at',
    'last_update_at',
    'promised_at',
    'created_at',
  ],
  sync_log: ['started_at', 'finished_at'],
};

function shift(value: string | null, deltaMs: number): string | null {
  if (!value) return null;
  return new Date(new Date(value).getTime() + deltaMs).toISOString();
}

async function main() {
  const { data: newest, error: newestError } = await db
    .from('orders')
    .select('order_date')
    .order('order_date', { ascending: false })
    .limit(1);

  if (newestError) {
    console.error('Could not read orders:', newestError.message);
    process.exit(1);
  }

  const latest = newest?.[0]?.order_date;
  if (!latest) {
    console.log('No orders found — run `npm run db:seed` first.');
    return;
  }

  const deltaMs = Date.now() - new Date(latest).getTime();
  const days = Math.round(deltaMs / 86_400_000);

  if (Math.abs(deltaMs) < 60_000) {
    console.log('Demo data is already current — nothing to shift.');
    return;
  }

  console.log(`Newest order is ${new Date(latest).toISOString().slice(0, 10)}.`);
  console.log(`Shifting every demo timestamp forward by ${days} day(s).\n`);

  for (const [table, columns] of Object.entries(SHIFTABLE)) {
    const { data: rows, error } = await db.from(table).select(['id', ...columns].join(', '));

    if (error) {
      console.log(`  ${table.padEnd(12)} skipped — ${error.message}`);
      continue;
    }

    let changed = 0;
    let failed = 0;

    for (const row of (rows ?? []) as unknown as Record<string, string | null>[]) {
      const patch: Record<string, string | null> = {};
      for (const column of columns) {
        const next = shift(row[column], deltaMs);
        if (next !== null) patch[column] = next;
      }
      if (Object.keys(patch).length === 0) continue;

      const { error: updateError } = await db.from(table).update(patch).eq('id', row.id!);
      if (updateError) {
        // A business-rule trigger refusing the write is worth seeing, not hiding.
        if (failed === 0) console.log(`  ${table.padEnd(12)} ${updateError.message}`);
        failed += 1;
      } else {
        changed += 1;
      }
    }

    console.log(`  ${table.padEnd(12)} ${changed} row(s) moved${failed > 0 ? `, ${failed} refused` : ''}`);
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count: todayCount } = await db
    .from('orders')
    .select('*', { head: true, count: 'exact' })
    .gte('order_date', todayStart.toISOString());

  console.log(`\nOrders dated today: ${todayCount ?? 0}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
