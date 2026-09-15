# Running the migrations

All 24 migration files, in the order they must run. They are ordinary SQL and are ordered by filename —
the timestamp prefix *is* the order, so never rename them.

> **Read this first.** These files have been parsed and cross-checked (no duplicate table, type, view,
> index or policy names; balanced dollar-quoting; every referenced column verified against the schema
> that precedes it) but **they have never been executed against a live Postgres**. Run them against a
> scratch database first, not against anything you care about.

---

## The files, in order

| # | File | Phase | What it creates |
|---|---|---|---|
| 1 | `20260810090000_0001_foundation.sql` | 0 | Extensions, `app` schema, shared enums, `set_updated_at` |
| 2 | `20260810090100_0002_tenancy.sql` | 1 | `companies`, `merchants`, `stores`, `warehouses` |
| 3 | `20260810090200_0003_identity.sql` | 1 | `app_users`, `departments`, `teams`, `shifts` |
| 4 | `20260810090300_0004_rbac.sql` | 1 | `permissions`, `roles`, `role_permissions`, field policies |
| 5 | `20260810090400_0005_ops.sql` | 1 | `audit_log`, `login_attempts`, `sync_log`, `notifications`, approvals |
| 6 | `20260810090500_0006_access_helpers.sql` | 1 | `app.uid()`, `app.has_perm()`, `app.in_scope()`, audit triggers |
| 7 | `20260810090600_0007_rls.sql` | 1 | RLS policies + grants for Phase 1 |
| 8 | `20260810090700_0008_seed_rbac.sql` | 1 | 24 default roles and their permissions |
| 9 | `20260810090800_0009_auth_bootstrap.sql` | 1 | Supabase Auth wiring, invite-only signup |
| 10 | `20260817090000_0010_catalog.sql` | 2 | 14 catalog tables (§3) |
| 11 | `20260817090100_0011_catalog_rls.sql` | 2 | Catalog RLS + 18 permissions |
| 12 | `20260823090000_0012_orders.sql` | 3 | 9 order tables + `confirmation_queue` (§4) |
| 13 | `20260823090100_0013_orders_rls.sql` | 3 | Order RLS + 21 permissions + reasons/templates seed |
| 14 | `20260823090200_0014_warehouse.sql` | 4 | 12 warehouse tables + `stock_on_hand` (§5) |
| 15 | `20260823090300_0015_warehouse_rls.sql` | 4 | Warehouse RLS + 17 permissions + packing materials |
| 16 | `20260823090400_0016_shipping.sql` | 5 | 12 shipping tables + `delayed_shipments` (§6) |
| 17 | `20260823090500_0017_shipping_rls.sql` | 5 | Shipping RLS + 17 permissions + return reasons/delay rules |
| 18 | `20260823090600_0018_finance.sql` | 6 | 9 finance tables + 4 profitability views (§7) |
| 19 | `20260823090700_0019_finance_rls.sql` | 6 | Finance RLS + 17 permissions + expense categories |
| 20 | `20260823090800_0020_reports.sql` | 7 | 4 report tables + 10 `rpt_*` views + 15 templates (§9) |
| 21 | `20260823090900_0021_reports_rls.sql` | 7 | Report RLS + 7 permissions |
| 22 | `20260824090000_0022_fix_barcode_upsert.sql` | — | Fixes the rule-5 barcode trigger on upsert paths |
| 23 | `20260915090000_0023_plans_and_modules.sql` | — | Operating models 5→3, plans, features, entitlements, limit enforcement |
| 24 | `20260915090100_0024_plans_rls_and_seed.sql` | — | Plan RLS + 4 permissions + the feature catalogue and starting grid |

**Totals:** 87 tables · 67 enum types · 22 views · 223 indexes and unique constraints · 164 RLS policies
· 114 permission codes across 24 roles.

---

## Option A — Supabase CLI (recommended)

Applies every file in order and records what ran, so re-running is safe.

```bash
# Local Postgres in Docker
npx supabase start
npx supabase db reset          # drops, recreates, runs all 24 in order

# Or against a hosted project
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

`npm run db:reset` and `npm run db:push` are the same commands.

## Option B — psql

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260810090000_0001_foundation.sql \
  -f supabase/migrations/20260810090100_0002_tenancy.sql \
  -f supabase/migrations/20260810090200_0003_identity.sql \
  -f supabase/migrations/20260810090300_0004_rbac.sql \
  -f supabase/migrations/20260810090400_0005_ops.sql \
  -f supabase/migrations/20260810090500_0006_access_helpers.sql \
  -f supabase/migrations/20260810090600_0007_rls.sql \
  -f supabase/migrations/20260810090700_0008_seed_rbac.sql \
  -f supabase/migrations/20260810090800_0009_auth_bootstrap.sql \
  -f supabase/migrations/20260817090000_0010_catalog.sql \
  -f supabase/migrations/20260817090100_0011_catalog_rls.sql \
  -f supabase/migrations/20260823090000_0012_orders.sql \
  -f supabase/migrations/20260823090100_0013_orders_rls.sql \
  -f supabase/migrations/20260823090200_0014_warehouse.sql \
  -f supabase/migrations/20260823090300_0015_warehouse_rls.sql \
  -f supabase/migrations/20260823090400_0016_shipping.sql \
  -f supabase/migrations/20260823090500_0017_shipping_rls.sql \
  -f supabase/migrations/20260823090600_0018_finance.sql \
  -f supabase/migrations/20260823090700_0019_finance_rls.sql \
  -f supabase/migrations/20260823090800_0020_reports.sql \
  -f supabase/migrations/20260823090900_0021_reports_rls.sql
```

`-v ON_ERROR_STOP=1` matters: without it psql keeps going after a failure and leaves a half-built
schema that is harder to diagnose than a clean stop.

**PowerShell** — the backslash continuations above are bash. Use this instead:

```powershell
$files = Get-ChildItem supabase\migrations\*.sql | Sort-Object Name
foreach ($f in $files) {
  Write-Host "==> $($f.Name)"
  psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f $f.FullName
  if ($LASTEXITCODE -ne 0) { Write-Error "FAILED at $($f.Name)"; break }
}
```

## Option C — Supabase Studio SQL editor

Paste each file's contents in order and run them one at a time. Slower, but it shows you exactly which
statement fails if one does. Do not paste several files into one editor tab — you lose the file
boundary that tells you where an error came from.

---

## After the migrations

1. **Create the first user.** Sign up through Supabase Auth, then insert the matching `app_users` row
   with `is_platform_admin = true`. Signup is invite-only by design (§2.5.1), so the bootstrap row has
   to be inserted directly:

   ```sql
   insert into public.app_users (auth_user_id, full_name, email, status, is_platform_admin)
   values ('<auth.users.id>', 'Platform Admin', '<your email>', 'active', true);
   ```

2. **Point the app at the database** — copy `.env.example` to `.env.local` and fill in the Supabase URL
   and anon key.

3. **Regenerate types** once the schema is live, replacing the hand-written file:

   ```bash
   npm run db:types
   ```

4. **Load demo data** with `npm run db:seed`. This now covers **all seven phases** — a catalog, three
   weeks of orders in every lifecycle state, stock, shipments, returns, COD money and a set of books.
   See `docs/DEMO-DATA.md` for what it creates and what each record is there to demonstrate.

   ```bash
   npm run db:seed                       # everything
   npm run db:seed -- --with-logins      # plus sign-in accounts for the demo staff
   npm run db:seed -- --phase1-only      # tenant scaffold only
   ```

   It is idempotent: every record carries an explicit code or number, so re-running updates in place.
   Stock is the one thing that could double on a re-run, so ledger rows are inserted with
   `ignoreDuplicates` and are a no-op the second time.

---

## What to test first

The migrations encode a lot of behaviour in triggers, and none of it has been executed. In rough order
of how expensive a bug would be:

| Check | Why it matters |
|---|---|
| **RLS isolation** — sign in as company A, confirm you cannot read any row of company B | The whole tenancy model. Test every table, not a sample. |
| `app.has_perm()` recursion | Policies that query the tables they protect are the classic RLS deadlock. The `SECURITY DEFINER` helpers exist to avoid it — confirm they do. |
| Order rules (§4.15) | Try to release an unconfirmed order, cancel without a reason, delete an order. All three must fail. |
| Inventory ledger (§5.10) | Try to `update` and `delete` a ledger row. Both must fail. Then confirm `post_inventory_movement` keeps `inventory_levels` exactly equal to the sum of its ledger rows. |
| Segregation of duties (§2.7.4) | Raise and approve an expense as the same user. Must fail. Same for settlements. |
| Invoice lock (§7.12 rule 5) | Approve an invoice, then try to delete it or change its total. Both must fail. |
| Trigger cascade cost | `orders` alone carries several triggers; check that a bulk order import does not become pathologically slow. |
