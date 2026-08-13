# Green ERP

Integrated E-Commerce Operations & Fulfillment Management Platform.

Built from `docs/spec/green-erp-spec-sections-1-9.pdf` — a 439-page bilingual (AR/EN) specification covering
orders, confirmation, inventory, fulfillment, shipping, collections, finance and BI.

**Stack:** Next.js 16 (App Router, TypeScript) · Supabase (Postgres + Auth + RLS + Storage) · Tailwind CSS v4

---

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Foundations & scaffold | **Shipped** |
| 1 | Tenancy, identity & access (§1, §2) | **Shipped** |
| 2 | Catalog & pricing (§3) | Next |
| 3 | Orders & Confirmation Center, incl. Shopify (§4) | Channel adapter ready |
| 4 | Warehouse, inventory & fulfillment (§5) | Planned |
| 5 | Shipping, returns & COD collections (§6) | Planned |
| 6 | Finance, settlements & profitability (§7) | Planned |
| 7 | Reports & BI (§9) | Planned |
| 8 | Marketing, affiliate & customer service (§8) | Awaiting spec section |

Full breakdown: [`docs/ROADMAP.md`](docs/ROADMAP.md).
A static preview of the shipped UI: [`docs/ui-preview.html`](docs/ui-preview.html).

---

## Getting started

### 1. Install

```bash
npm install
```

### 2. Create a Supabase project

Sign up at [supabase.com](https://supabase.com), create a project, then copy the credentials:

```bash
cp .env.example .env.local
```

Fill in from **Project Settings → API**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Generate the credential-encryption key:

```bash
npm run gen:key    # paste the output into CREDENTIAL_ENCRYPTION_KEY
```

### 3. Apply the database

```bash
npx supabase login
npm run db:link       # select your project
npm run db:push       # applies supabase/migrations in order
```

> A local stack (`npm run db:reset`) additionally needs Docker Desktop running.

### 4. Run

```bash
npm run dev
```

The **first account to sign up becomes the platform owner** (§1.7). Every subsequent account must be
invited by an administrator — the database rejects uninvited signups.

---

## Shopify

The Shopify adapter is written and complete. It is waiting on credentials, not on code.

Until a Shopify Partner app exists, every store runs on the **mock provider**: a full `ChannelAdapter`
implementation with deterministic fixtures and a webhook simulator. The whole order pipeline is
therefore buildable and testable now.

When credentials arrive:

1. Fill `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` in `.env.local`.
2. Install the app on the store (OAuth), which writes an encrypted token to `store_credentials`.
3. Set the store's `provider` column to `shopify`.

No application code changes. The webhook endpoint is already live at
`/api/webhooks/shopify/<storeId>` and rejects any request whose HMAC signature does not verify.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run db:push` | Apply migrations to the linked project |
| `npm run db:types` | Regenerate database types from the live schema |
| `npm run gen:key` | Generate a credential-encryption key |

---

## Architecture notes

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the decisions that matter — tenant isolation,
the four-level permission model, the audit trail, and the channel adapter design.
