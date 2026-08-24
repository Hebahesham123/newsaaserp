# Architecture

Decisions that shape everything built on top of them, and why they were made this way.

---

## 1. Tenant isolation lives in the database, not the application

The spec is unambiguous: *"Maintain complete data separation between companies"* (§1.9), *"A merchant
must never access another merchant's data"* (§2.13 rule 23).

Enforcing that in application code means every query, every report, every export and every future
background job has to remember to filter. One forgotten `.eq('company_id', …)` is a cross-tenant leak,
and the code that leaks looks exactly like the code that does not.

So isolation is a **row-level security policy on every table**. The browser talks to Postgres with the
user's own JWT; the database decides what rows exist. An application bug can produce a wrong screen,
but it cannot produce another tenant's data.

Consequences worth knowing:

- **`app` schema, `SECURITY DEFINER` helpers.** Policies that query the tables they protect recurse
  infinitely. The helpers (`app.uid()`, `app.has_perm()`, `app.in_scope()`) run as the owner and bypass
  RLS deliberately. They live in a private schema that PostgREST does not expose.
- **The service role is rationed.** It appears in exactly three places: reading `store_credentials`,
  handling webhooks that arrive without a session, and background sync. Each call site re-checks the
  caller's access with the *user's* client first — see `triggerSync` in `src/app/(app)/stores/actions.ts`.
- **No `DELETE` grants anywhere.** §2.13 rules 19 and 21 require archiving. The verb simply does not
  exist for client roles.

## 2. Permissions have four levels, and they are separate concerns

§2.7.1 defines screen, action, data and field permissions. They are genuinely different questions and
are modelled separately:

| Level | Mechanism | Example |
|---|---|---|
| Screen | `permissions.screen` + `requirePermission()` | Can this user open Merchants? |
| Action | `permissions.code` + `app.has_perm()` in policies | Can they create one? |
| Data | `user_data_scopes` + `app.in_scope()` | Which merchants specifically? |
| Field | `role_field_policies` + `applyFieldPolicy()` | Can they see the phone number, or a mask? |

**Data scopes use absence-means-unrestricted semantics.** No row of a given scope type = full access
within the company; one or more rows = restricted to exactly those ids. The alternative — requiring an
explicit grant per merchant — makes "Company Admin sees everything" a maintenance burden that silently
breaks each time a merchant is added.

**Field policies resolve to the most restrictive across a user's roles.** Someone holding both
Accountant and Reports Viewer gets the tighter of the two, never the looser.

## 3. The audit trail is written by triggers

§2.9 requires every change, permission grant, export and sensitive read to be recorded. If application
code writes the audit rows, then any code path that forgets — a migration script, an admin fix, a future
integration — silently produces an incomplete history. An audit log with gaps is worse than none, because
it is trusted.

`app.audit_trigger()` is attached to every business table. It captures actor, tenant, action, the exact
changed field list, before/after values, and request metadata pulled from PostgREST headers. Permission
tables get a dedicated writer so `permission_change` is distinguishable from an ordinary update.

Updates that change nothing but `updated_at` are skipped — otherwise the trail fills with noise and the
real events become unfindable.

## 4. Statuses: enum where fixed, table where configurable

§1.10 requires order statuses, cancellation reasons, workflows and notifications to be **configurable**.
It also fixes company, merchant, store and user statuses to specific lists (§2.2.3, §2.3.4, §2.4.3, §2.5.3).

So: the fixed sets are Postgres enums — cheap, indexable, and impossible to typo. Everything the spec
calls configurable becomes a per-company reference table instead. Encoding a configurable set as an enum
would force a migration every time a client wants a new cancellation reason.

## 5. Suspension cascades are database-level

§2.13 rules 15 and 17: a suspended company accepts no new operations; a suspended merchant halts store
synchronization.

Rule 17 is a `BEFORE INSERT` trigger. Rule 15 is the `syncable_stores` view — sync workers read the view,
never the `stores` table, so the rule cannot be bypassed by a new code path that forgets it.

## 6. Channel adapters: one interface, mock and real are peers

Orders arrive from Shopify, WooCommerce, Amazon, Noon, POS, branches and manual entry (§1.6). They all
implement one `ChannelAdapter` interface. Application code never imports a concrete adapter; it resolves
one from the store row.

The immediate payoff is that **the mock adapter is not a stub** — it implements the full contract with
deterministic fixtures, so the entire Phase 3 order pipeline can be built, demonstrated and
regression-tested before any Shopify account exists. Because mock and Shopify satisfy the same interface,
the same contract tests run against both.

Switching a store to live Shopify is a data change: fill two env vars, run OAuth, set `provider = 'shopify'`.

Two security details in the Shopify adapter that are easy to get wrong and expensive to get wrong:

- The webhook HMAC is computed over the **raw, unparsed body**. Parsing and re-serializing JSON changes
  the bytes and every signature check fails.
- The comparison is **constant-time**. A plain `===` leaks the correct digest byte by byte through
  timing, which is enough to forge signatures.

## 7. Channel credentials are encrypted before they reach Postgres

A store access token is a bearer credential for a merchant's live storefront — it reads customer PII and
mutates orders. `store_credentials` has RLS enabled and **no policy**, so no client role can reach it at
all. Values are additionally AES-256-GCM encrypted application-side, so a database compromise alone does
not yield usable tokens.

## 8. The order lifecycle is enforced by the database

§4.15 lists nine rules an order must obey — no warehouse handover before confirmation, no deletion
after creation, archive only when cancelled, a reason on every cancellation, no line edits after
handover without a special permission, totals that always match the lines, and a complete record of
every call, message and edit.

All nine are triggers on `orders` and `order_items`, for the same reason the audit log is
(§3 above): an order arrives from a webhook, a scheduled sync, a manual form and — later — a bulk
import. Enforcing the rules in each of those paths means the newest path is the one that forgets.

Two consequences worth knowing:

- **The application asks, the database refuses.** `releaseOrder` simply sets the status and lets the
  trigger reject it if the order was never confirmed. The error carries its own spec reference, and
  `describeDbError` passes `check_violation` text through unchanged rather than replacing it with
  something vaguer.
- **`order_events` has no UPDATE or DELETE policy.** Agents may insert a note and nothing else; every
  other row is written by a trigger. History that can be edited is not history.

## 9. Channel order ingestion is idempotent and non-destructive

Shopify redelivers webhooks, and a scheduled sync routinely overlaps a webhook that already arrived.
`ingestChannelOrder` is keyed on `(store_id, external_id)` — a partial unique index, since manually
created orders legitimately have neither — so a second delivery updates the existing order.

The subtler rule is what it *refuses* to do. Once an order has left the intake stage, a later sync
refreshes only what the channel still owns (payment state, the raw payload). It does not overwrite an
address the agent corrected on the phone, and it cannot regress the status of an order someone has
already confirmed. A channel that is authoritative about payment is not authoritative about the work
done since.

Lines whose channel variant has no §3.5 mapping are still stored, with a null `variant_id`. Refusing
them would lose a real order because the catalog is incomplete — exactly backwards.

## 10. Bilingual and RTL from day one

§1.9 and §2.15 require Arabic and English. Retrofitting RTL is expensive — it touches every layout
decision — so direction is set on `<html>` from the start and the UI is built entirely on CSS logical
properties (`ms-`, `pe-`, `start-`, `end-`). Mirroring is automatic; the handful of cases that need a
literal flip use the `.flip-icon` utility.

---

## Layout

```
src/
  app/
    (app)/            Authenticated shell — every page here requires a session
    login/            Public
    api/webhooks/     HMAC-authenticated; excluded from the session proxy
  components/
    ui/               Primitives — Card, Table, Badge, Button, Field
    shell/            Sidebar, topbar, nav definition
  i18n/               Dictionaries, provider, direction
  lib/
    auth/             Session, permission checks, field masking
    channels/         Adapter interface, mock, Shopify, registry, sync runner
    supabase/         Browser / server / admin clients, database types
supabase/
  migrations/         Ordered, idempotent-by-convention SQL
docs/
  ROADMAP.md          Phase plan
  ARCHITECTURE.md     This file
  ui-preview.html     Static UI preview
  spec/               Source specification
```

---

## Verification status

| Check | Result |
|---|---|
| `npm run typecheck` | Passes |
| `npm run lint` | Clean |
| `npm run build` | Passes — 47 routes (Phases 1–7) |
| Migration SQL structure | All 21 files: balanced dollar-quoting, and no duplicate table, type, view, index or policy names across the schema |
| Migrations applied to a live database | **Not yet** — no Supabase project or Docker in this environment |

See `docs/MIGRATIONS.md` for the run order and what to test first.

**The last row is the important one.** Phases 4–7 put a great deal of behaviour into triggers and
`SECURITY DEFINER` functions — the inventory ledger's derived buckets, the order lifecycle rules,
segregation of duties on expenses and settlements, the invoice lock. Static checking confirms the SQL is
well-formed and internally consistent; it cannot confirm that a policy does not recurse, that a trigger
fires in the order you expect, or that the ledger and its cache actually agree.

The last row matters: the SQL is syntactically valid and the schema is internally consistent by
construction, but policy behaviour, trigger firing and the RLS isolation tests have not been executed
against a running Postgres. That is the first thing to do once a project is linked.
