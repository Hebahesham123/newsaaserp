# Green ERP — Phased Delivery Roadmap

**Product:** Integrated E-Commerce Operations & Fulfillment Management Platform
**Source spec:** `docs/spec/green-erp-spec-sections-1-9.pdf` (439 pages, bilingual AR/EN)
**Stack:** Next.js (App Router, TypeScript) · Supabase (Postgres + Auth + RLS + Storage + Realtime + Edge Functions) · Tailwind CSS

---

## Guiding constraints from the spec

These are non-negotiable and shape every phase:

| Constraint | Spec ref | Implementation consequence |
|---|---|---|
| Multi-tenant with **total data separation** between companies | §1.9, §2.1, §2.13 | Every table carries `company_id`; RLS on every table; no service-role calls from the browser |
| Hierarchy: System → Company → Merchant → Store → Warehouse → User | §1.8 | Scope columns propagate down; permission scoping resolves at each level |
| 4-level permissions: **screen · action · data · field** | §2.7.1 | Permission codes + data-scope rules + field masking policies |
| Full audit trail on every mutation | §1.10, §2.9 | Generic `audit_log` written by DB triggers, not app code |
| Configurable statuses, cancellation reasons, workflows, reports | §1.10 | Statuses live in reference tables per company, not hardcoded enums |
| Arabic + English, RTL + LTR | §1.9, §2.15 | i18n and direction from Phase 1 — retrofitting RTL is expensive |
| Records with history are **archived, never deleted** | §2.13, §3.13 | Soft-delete/archive columns everywhere; hard delete blocked by policy |
| Segregation of duties (maker ≠ checker) on sensitive txns | §2.7.4 | Approval workflow primitives in the core, used by Finance/Inventory |
| 5 operating models (own store, multi-store, fulfillment centre, ops-only, marketplace) | §1.4 | Company-level `operating_model` drives which modules/fees activate |

---

## Phase overview

| Phase | Name | Spec sections | Ships |
|---|---|---|---|
| **0** ✅ | Foundations & scaffold | — | Repo, tooling, CI, local Supabase, conventions |
| **1** ✅ | Tenancy, identity & access | §1, §2 | Companies, merchants, stores, users, roles, 4-level permissions, audit log |
| **2** ✅ | Catalog & pricing | §3 | Products, variants, bundles, channel mapping, prices, costs |
| **3** ✅ | Orders & Confirmation Center | §4 | Order lifecycle, assignment, calls, Customer 360, duplicates, fraud, **Shopify sync** |
| **4** ✅ | Warehouse, inventory & fulfillment | §5 | Locations, receiving, put-away, reservation, pick/pack, tasks, ledger |
| **5** ✅ | Shipping, returns & COD collections | §6 | Courier integrations, AWB tracking, RTO, returns inspection, COD reconciliation |
| **6** ✅ | Finance, settlements & profitability | §7 | Order cost structure, expenses, merchant/courier settlements, invoices, P&L |
| **7** ✅ | Reports & BI | §9 | Report engine, 14 dashboards, scheduled exports, drill-down, global filters |
| **8** ⛔ | *(blocked)* Marketing, affiliate & customer service | §8 *(absent from the PDF)* | Campaigns, affiliates/commissions, tickets, marketplace mgmt, workflow builder, AI |

Phases 1→7 are sequential by data dependency. Phase 8 slots in once you send Section 8; extension points are reserved in Phases 1, 2, 6 and 7 for it.

---

## Phase 0 — Foundations & scaffold ✅

**Goal:** a repo anyone can clone and run against a local Postgres in one command.

- [x] Next.js App Router + TypeScript + Tailwind, `src/` layout, `@/*` alias
- [x] Supabase client wiring — browser, server component, route handler, and admin clients
- [x] Local Supabase stack (`supabase/config.toml`) + migration folder
- [x] Env contract (`.env.example`) with placeholders for Shopify (filled in later)
- [x] Conventions: `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`
- [x] Lint + typecheck + build scripts

**Exit criteria:** `npm run build` passes; `npm run db:reset` provisions a clean schema.

---

## Phase 1 — Tenancy, identity & access *(spec §1, §2)*

**Goal:** the security substrate. Nothing else can be built safely first — every later table inherits its isolation rules from here.

### Data
- `companies` — master data (§2.2.2), 8 statuses (§2.2.3), per-company `settings` JSONB (§2.2.4), subscription limits
- `merchants` — master data (§2.3.2), service types (§2.3.3), statuses (§2.3.4)
- `stores` — sales channels (§2.4.1): Shopify, WooCommerce, Amazon, Noon, custom, POS, branch, social, manual, wholesale; 9 statuses (§2.4.3); encrypted credential vault
- `warehouses` — 8 types (§5.3), stubbed here, filled out in Phase 4
- `app_users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_data_scopes`
- `departments`, `teams`, `team_members`, `shifts` (§2.8)
- `audit_log` (§2.9.2), `login_attempts`, `sync_log` (§2.4.5), `notifications` (§2.10)

### Behaviour
- Supabase Auth + invite flow; user statuses (§2.5.3); 2FA-ready; session/lockout policy (§2.5.4)
- 24 default roles seeded (§2.6.2)
- Permission engine: **screen / action / data / field** (§2.7.1); sensitive financial permissions isolated (§2.7.2); customer-PII masking incl. partial phone masking (§2.7.3)
- Segregation-of-duties primitive: `approval_requests` with maker ≠ checker enforcement (§2.7.4)
- Audit triggers on every business table; sensitive exports logged (§2.13)
- Cascade rules: suspend company → block new operations; suspend merchant → halt store sync (§2.13)

### Screens (§2.14)
Company list/create/detail/settings · Merchant list/create/detail/onboarding · Store list/connect/detail · Sync log · User list/create/profile · Role list/create · **Permission matrix** · Teams · Departments · Shifts · Activity log · Login-attempt log · Notification center · Subscription & plans

**Exit criteria** = spec §2.15 acceptance criteria, verbatim: company CRUD + archive; multi-merchant per company; multi-store per merchant; role assignment; all four permission levels enforced; unauthorized access blocked; every change audited; store connects and syncs; sync errors visible; suspension halts dependent operations; AR + EN; search/filter/export; masking honours permissions; teams and shifts assignable.

---

## Phase 2 — Catalog & pricing *(spec §3)* ✅

**Delivered:** 14 tables + RLS (`0010_catalog.sql`, `0011_catalog_rls.sql`), 18 §3.12 permissions granted
across the 24 default roles, server actions for every entity, and the screens:
`/products` (list, status control, approve, archive) · `/products/[id]` (variants, price matrix, cost
components, channel mapping, bundle composition, collections, price history) · `/products/unmapped`
(§3.14 queue, reads the `unmapped_products` view) · `/catalog` (brands, categories, collections, units,
attributes) · `/suppliers` · `/price-history`.

- Product master + 11 product types (§3.3); variants with independent SKU/barcode/price/cost/stock/image (§3.4)
- **Channel mapping** — one master product ↔ Shopify variant ID, Woo product ID, Amazon ASIN/seller SKU, Noon SKU, barcode, marketplace fulfilment SKU (§3.5). Unmapped/duplicate detection surfaced as a work queue.
- Catalog: brands, categories, collections, tags, attributes, UoM, suppliers (§3.6)
- 11 price types incl. store/merchant/marketplace/country/affiliate/time-based/quantity-based, with full price-history log (§3.7)
- 12 cost components feeding Phase 6 profitability (§3.8)
- Fixed + dynamic bundles/kits with component-level stock deduction (§3.9)
- Product/price sync with a declared **master source per data type** to prevent conflicts (§3.10)
- 11 product statuses (§3.11); 13 isolated permissions (§3.12); 12 business rules (§3.13)

**Exit criteria:** SKU unique per merchant; duplicate barcodes blocked; product with history archives rather than deletes; publish blocked without a price; inventory sync blocked before mapping; bundle deducts components.

---

## Phase 3 — Orders & Confirmation Center *(spec §4)* — **includes Shopify** ✅

**Delivered:** 9 tables + 1 view + RLS (`0012_orders.sql`, `0013_orders_rls.sql`), 21 §4 permissions
granted across the 24 default roles, and the screens: `/orders` · `/orders/[id]` (the §4.5
single-screen workspace: products, calls, WhatsApp, duplicates, timeline, Customer 360 panel) ·
`/confirmation` (§4.7 queue over the `confirmation_queue` view, with my-queue / all / callbacks-due) ·
`/customers` + `/customers/[id]` (§4.8) · `/duplicates` (§4.12) · `/blacklist` (§4.13) ·
`/cancellation-reasons` (§4.11) · `/message-templates` (§4.9).

Channel orders are now persisted for real: `src/lib/channels/orders.ts` maps a `ChannelOrder` onto
`orders` + `order_items`, keyed on `(store_id, external_id)` so webhook redelivery is idempotent, and
refuses to revert work an agent has already done on an order past intake.

**§4.15 business rules are enforced by database triggers, not application code** — unconfirmed orders
cannot reach the warehouse, orders cannot be deleted, only cancelled orders archive, cancellations
require a reason, line edits after warehouse handover need `orders.edit.after_warehouse`, totals
recalculate on every line change, and every call, message, edit and status change lands in
`order_events`.

**Not built:** no WhatsApp provider is connected, so §4.9 messages are recorded and queued rather than
transmitted; §4.14 AI features (best call time, best agent, confirmation likelihood) are out of scope
until there is history to train on.

- 12 order sources with source/store/merchant/campaign/affiliate recorded on every order (§4.2)
- 4-stage lifecycle: intake → verification → confirmation → ready-for-warehouse (§4.3)
- Order detail single-screen workspace (§4.5) + **Customer 360°** (§4.8)
- Assignment: manual, round-robin, smart (governorate/store/merchant/product/language/value/priority), AI-ranked (§4.6)
- Confirmation workflow: calls with recordings + outcomes, WhatsApp templates, payment links, location requests, callbacks (§4.7, §4.9, §4.10)
- Configurable cancellation reasons (§4.11); duplicate detection (§4.12); blacklist + risk scoring (§4.13)

### Shopify integration — built now, credentials plugged in later
An adapter-per-channel design (`ChannelProvider` interface) so Shopify, WooCommerce, Amazon and Noon are interchangeable:

1. **Adapter interface + Shopify implementation** against the documented Admin GraphQL API — written in full now.
2. **Mock provider** with realistic fixtures + a webhook simulator, so the entire order pipeline is developed and tested end-to-end without an account.
3. **Credential vault** on `stores` (encrypted); OAuth callback + HMAC-verified webhook route handlers built and unit-tested against Shopify's documented signature scheme.
4. **When you send credentials:** set env vars, run the OAuth install, flip the store's provider from `mock` to `shopify`. No application code changes.

Sync coverage per §2.4.4: orders, customers, products, variants, prices, inventory, discounts, cancellations, payment status, fulfilment status, returns, tracking numbers, taxes, addresses — via real-time webhooks, scheduled sync, manual sync, and automatic retry with backoff.

**Exit criteria:** orders flow from mock Shopify → confirmation → confirmed → ready-for-warehouse, with a swap-in path proven by contract tests that run against both mock and real adapters.

---

## Phase 4 — Warehouse, inventory & fulfillment *(spec §5)* ✅

**Delivered:** 12 tables + 2 views (`0014_warehouse.sql`, `0015_warehouse_rls.sql`), 17 permissions,
and the screens `/inventory`, `/inventory/ledger`, `/warehouse-tasks`.

The load-bearing decision: **`inventory_ledger` is the truth and `inventory_levels` is a cache of it.**
§5.10 makes the ledger the master record and forbids deleting an approved movement, so all eight §5.8
buckets are maintained by trigger from signed ledger rows, and the ledger refuses UPDATE and DELETE at
the trigger level as well as by grant. Stock moves only through `post_inventory_movement`, which writes
a balanced pair of rows for a bucket transfer and refuses to drive a bucket negative.

**Not built as UI:** receiving/put-away, pick lists and packing have complete schema and SQL functions
(`put_away_receipt_item`, `confirm_pick`, `reserve_order_stock`) but no screens yet.

- Location hierarchy Warehouse → Zone → Aisle → Rack → Shelf → Bin with unique location codes; special areas (receiving, QC, picking, packing, dispatch, returns, damaged) (§5.2)
- 13-stage warehouse workflow with per-stage timestamps and operator (§5.4)
- Receiving + QC + put-away with FIFO/FEFO/LIFO strategy and auto-location suggestion (§5.5–5.7)
- 8 quantity buckets per SKU: available, reserved, picking, packed, in-transit, returned, damaged, expired (§5.8)
- Reservation rules incl. bundle component reservation (§5.9)
- **Immutable `inventory_ledger`** — 11 transaction types, no deletion after approval (§5.10)
- Warehouse task engine: 8 task types with SLA, assignment, productivity measurement (§5.11, §5.21)
- Picking strategies: single, batch, wave, zone (§5.12) + pick-path optimisation (§5.14)
- Packing, materials costing, final QC, shipment prep, manifest (§5.15–5.18)
- **Fulfillment-centre mode**: per-merchant inventory isolation, per-merchant service fees (receiving/storage/picking/packing/shipping/returns), periodic statements (§5.20)
- 12 KPIs (§5.24)

---

## Phase 5 — Shipping, returns & COD collections *(spec §6)* ✅

**Delivered:** 12 tables + 2 views (`0016_shipping.sql`, `0017_shipping_rls.sql`), 17 permissions,
and the screens `/shipments`, `/returns`, `/collections`.

Couriers are adapters exactly like channels — `couriers.provider` mirrors `stores.provider`, with
`manual` as a first-class provider rather than a missing one. Handing a COD shipment to a courier opens
its collection by trigger, so a shipment booked by webhook is tracked identically to one booked by hand.
§6.6 delay monitoring is a **view**, not a job: computed on read, so it cannot go stale.

**Note:** the COD table is `cod_collections`, not `collections` — §3.6 already owns that name for
merchandising collections.

**Not built as UI:** courier CRUD, return inspection/disposition and statement reconciliation have
schema and functions (`apply_return_disposition`, `reconcile_courier_statement`) but no forms yet.

- Courier adapter interface mirroring the channel adapter design; AWB creation, label generation, status webhooks
- Shipment workflow to Delivered / RTO with full status history (§6.3, §6.4)
- Courier instructions with response tracking (§6.5); delay monitoring rules → alerts (§6.6)
- Returns lifecycle + inspection with 6 dispositions: restock, repack, repair, outlet, destroy, return-to-merchant (§6.7, §6.8)
- Configurable return reasons (§6.9)
- **COD collections + reconciliation**: order ↔ collection ↔ courier statement ↔ bank transfer matching, with short/over/missing/variance detection (§6.10, §6.11)
- Courier scorecards feeding AI courier selection (§6.12)

---

## Phase 6 — Finance, settlements & profitability *(spec §7)* ✅

**Delivered:** 9 tables + 4 views (`0018_finance.sql`, `0019_finance_rls.sql`), 17 permissions, and the
screens `/expenses`, `/settlements`, `/invoices`, `/profitability`.

**Profit is derived, never stored.** §7.12 rule 6 requires profitability to recalculate whenever a cost
component changes; a stored column would need every writer to remember, so `order_profitability` is a
view over `order_costs` and cannot fall behind. §2.7.4 is enforced in the database: the same user cannot
raise and approve an expense, or prepare and approve a settlement, and a settlement cannot be approved
before it is calculated (§7.12 rule 2).

**Not built as UI:** expense/invoice creation forms, marketing-spend entry and period close.

> Scope note from the spec itself: this is **operational finance, not a general ledger**. Not Odoo/SAP — an e-commerce operations P&L.

- Order cost structure: product + operations + shipping + marketing + gateway/bank/CS (§7.3)
- Marketing expense capture per campaign/store/merchant/product, with Meta/Google import hooks (§7.4)
- Collections register (§7.5); courier settlement with variance approval (§7.6)
- **Merchant settlement statements** — daily/weekly/monthly per contract (§7.7)
- Invoicing with draft → approved → paid → cancelled (§7.8)
- Profitability at order / product / merchant / store / campaign / courier level (§7.9)
- Operating expense management with categories (§7.10)
- Business rules: no cost edit after close without permission; no settlement approval before matching; no invoice delete after approval; auto-recalc profitability on cost change; no period close with open settlements (§7.12)
- *Future (§7.15):* Financial Health Score, AI Profit Analyzer

---

## Phase 7 — Reports & BI *(spec §9)* ✅

**Delivered:** 4 tables + 10 reporting views (`0020_reports.sql`, `0021_reports_rls.sql`), 7 permissions,
15 seeded report templates, and `/reports` with the §9.22 executive board.

§9.20 ("a new report must not require new development") is what shapes it: a report is a **row** in
`report_definitions` naming a source view, columns, filters and grouping — not code. §9.19 ("hide costs
and profits by role") needs no second permission system, because every `rpt_*` view is
`security_invoker`: a report returns exactly the rows the caller could have queried directly, and a
definition can declare a `requires_permission` so it is not even listed to someone who lacks it.

**Not built:** the report *runner* (turning a definition into a query and an Excel/PDF file) and the
scheduler worker. `report_runs` already logs every export into the §2.9 audit trail by trigger.

- Report engine over **live data** with 15 categories (§9.3) and a custom report builder requiring no new development (§9.20)
- 14 dashboards (§9.21) with clickable drill-down on every metric (§9.2)
- Global filter bar — 16 dimensions, per-user saved filters (§9.16)
- Export to Excel/PDF/CSV, print, email, and scheduled daily/weekly/monthly delivery (§9.17)
- Report-level permissions incl. hiding costs/profits by role (§9.19); all exports audited
- Executive KPI board — 19 headline metrics (§9.22)
- *AI Insights dashboard (§9.18)* — sales decline causes, return spikes, stockout forecasts, dead stock, unprofitable campaigns, best courier per governorate, churn-risk customers, demand forecast

---

## Phase 8 — reserved for Section 8

Section 8 is absent from the supplied PDF (it jumps §7 → §9). Based on the §1.5 scope list, the missing modules are:
marketing expense management · affiliate & commission management · marketplace management · customer service management · complaint & ticket management · workflow & automation management · integration & API management · AI features · system settings.

Extension points reserved for it:
- `campaigns` and `affiliates` FKs already anticipated on `orders` (Phase 3) and `marketing_expenses` (Phase 6)
- Ticket entity will attach to the existing polymorphic `notes`/`attachments` tables from Phase 1
- Workflow engine will consume the `approval_requests` primitive from Phase 1

Send Section 8 whenever ready and it folds in without rework.

---

## Cross-cutting, delivered continuously

- **Security:** RLS on 100% of tables; no service-role key in client code; PII masking; encrypted channel credentials; every sensitive export audited
- **i18n:** AR/EN with RTL from Phase 1; all user-facing status/reason values translatable
- **Testing:** RLS isolation tests (tenant A cannot read tenant B) as a permanent regression suite; adapter contract tests run against mock + real
- **Performance:** the spec expects large order volumes — indexed tenant columns, cursor pagination, materialised views for dashboards from Phase 7
