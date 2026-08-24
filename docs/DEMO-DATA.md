# Demo data

`npm run db:seed` populates a plausible mid-size fulfillment operation across all seven phases, so you
can walk every screen with realistic figures before entering anything real.

```bash
npm run db:seed                    # everything
npm run db:seed -- --with-logins   # plus sign-in accounts (password: GreenErp!2026)
npm run db:seed -- --phase1-only   # tenant scaffold only
```

**Re-running is safe.** Every record carries an explicit code or number, so a second run updates in
place rather than duplicating. Stock is the one thing that could silently double, so ledger rows are
inserted with `ignoreDuplicates` — the second run is a no-op for them.

---

## What you get

| Phase | Records |
|---|---|
| 1 | 2 companies, 5 merchants, 8 stores, 4 warehouses, 19 staff across 24 roles, teams, shifts, sync log |
| 2 | 12 products (36 variants), 5 brands, 8 categories, 3 suppliers, 2 collections, price matrix, costs, channel mappings |
| 3 | 10 customers, 20 orders across every lifecycle state, calls, WhatsApp messages, a duplicate pair |
| 4 | 31 warehouse locations, 2 goods receipts, opening stock, 9 tasks, a wave pick list |
| 5 | 4 couriers with zone rates, 4 shipments, 2 returns, COD collections, a courier statement |
| 6 | Order cost lines, 42 days of ad spend, 7 expenses, 2 settlements, 3 invoices, a closed period |
| 7 | Saved filters, export history |

---

## What each record is there to demonstrate

The dataset is not random — most records exist to make one specific rule or screen state visible.

### Orders (`/orders`)

Twenty orders, `DEMO-0001` … `DEMO-0020`, deliberately spread so no list is empty:

| Orders | State | Shows |
|---|---|---|
| 0001–0004 | `ready_for_warehouse` | Confirmed then released — the §4.15 rule 1 path walked properly |
| 0005–0007 | `confirmed` | Awaiting warehouse handover |
| 0008–0010 | `cancelled` | Three different cancellation reasons; §4.15 rule 8 requires one |
| 0011 | `callback` | A callback due in 6 hours — appears in the Confirmation Center's callbacks tab |
| 0012 | `second_call` | Two failed attempts, still open |
| 0013–0014 | `assigned` | In an agent's queue |
| 0015–0016 | `pending_assignment` | Unclaimed — the "assign to me" button appears |
| 0017, 0020 | `pending_review`, `duplicate_check` | **Same customer, same day, same product.** The intake trigger should flag these as a duplicate pair |
| 0019 | `new` | Just arrived, manual source |

Order 0008 has three `no_answer` calls before cancellation — that is the §4.16 "unreachable" pattern.

### Catalog (`/products`, `/catalog`)

- **`NRA-SET-04`** is a bundle with three components, so §3.9 composition has a subject.
- **`NRA-FND-03`** has three shade variants; **`ATL-TEE-01`** has four colour/size variants.
- **`HLM-TWL-02`** is deliberately left **unmapped**, so `/products/unmapped` (§3.14) is not empty and
  rule 13 has something to block.
- **`NRA-MSK-05`** sits in `draft` and **`ATL-BTL-03`** in `out_of_stock`.
- Every product carries a wholesale tier at 78% and about half carry a promotional price, so the §3.7
  matrix is more than just a base price.

### Inventory (`/inventory`, `/inventory/ledger`)

- Opening stock arrives as **ledger rows**, never as levels — §5.10 makes the ledger authoritative and
  the trigger derives the buckets. Compare the two screens: they must agree.
- **`ATL-BTL-03` is seeded at zero**, so the out-of-stock KPI on the executive board has a subject.
- Two SKUs carry **damaged** stock from a QC rejection, so that bucket is not uniformly zero.
- Six SKUs get a reorder point of 50, so the low-stock filter finds something.

### Warehouse tasks (`/warehouse-tasks`)

Picking and packing tasks for the four released orders, plus **one receiving task that is 20 hours past
a 2-hour SLA** — that is the row that renders the SLA-breached badge.

### Shipping (`/shipments`, `/returns`, `/collections`)

- Shipments are inserted as `handed_to_courier` **first**, then advanced. That is the transition the
  §6.10 trigger watches to open the COD collection; inserting straight to `delivered` would silently
  skip the money.
- **`DEMO-SHP-0004`** is an RTO after three failed attempts, with a return attached.
- **`DEMO-0002`'s collection comes back 50 EGP short**, so the generated `variance` column has a
  non-zero value to display.
- **`DEMO-0004`'s collection is `missing`** — collected nothing.
- The courier statement `DEMO-CST-0001` is left in `draft` with one line quoting **an AWB that does not
  exist in the system**. Run Reconcile on it and that line should come back `not_found` while the rest
  match — that is §6.11 working.
- Return items are given a disposition but **not posted to stock**. `apply_return_disposition` is the
  supported way to move it, and running it in the seed would hide that step from you.

### Finance (`/expenses`, `/settlements`, `/invoices`, `/profitability`)

- Expenses span all five statuses. Submitter is EMP-007 and approver EMP-002 — **deliberately different
  people**, because §2.7.4 makes the database refuse self-approval. Try changing one to match and watch
  it fail.
- Settlements are left in `draft`. Press **Calculate** to build one from the period's real orders, then
  **Approve** — approving a `draft` is refused by §7.12 rule 2, which is the point.
- Invoices are inserted as draft, given lines, then advanced. `DEMO-INV-0001` is `paid` and cannot be
  re-priced or deleted (§7.12 rule 5).
- A **closed period** covers 120–91 days ago, well before any demo order — so the guard is demonstrable
  without making the seeded data uneditable.

---

## Things worth trying once it is loaded

These are the rules that only prove themselves when you try to break them:

1. Open a `ready_for_warehouse` order and try to edit its products → refused unless you hold
   `orders.edit.after_warehouse` (§4.15 rule 5).
2. Try to cancel an order without picking a reason → refused (§4.15 rule 8).
3. Open `/inventory/ledger` and try to change a row from the API → refused; the ledger is append-only
   (§5.10).
4. Approve an expense as the same user who submitted it → refused (§2.7.4).
5. Approve a `draft` settlement without calculating it first → refused (§7.12 rule 2).
6. Sign in as a confirmation agent (`EMP-004`) and confirm you see **only your own queue**, not the
   whole order book — that is `orders.view.all` doing its job.
7. Sign in as a merchant admin (`MER-001`) and confirm you see only that merchant's data.

Number 7 is the one to spend time on. Tenant isolation is the single most expensive thing to get wrong,
and the demo has two companies precisely so you can check that the wall holds.
