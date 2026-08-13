import Link from 'next/link';
import type { Route } from 'next';
import { requireSession, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardBody, CardHeader, CardTitle, Notice, PageHeader, StatTile } from '@/components/ui';

export default async function DashboardPage() {
  const session = await requireSession();
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  // Counts respect RLS, so each user sees totals for what they may actually
  // access — not a global number they have no right to know.
  const [merchants, stores, users, syncFailures] = await Promise.all([
    supabase.from('merchants').select('*', { count: 'exact', head: true }).is('archived_at', null),
    supabase.from('stores').select('*', { count: 'exact', head: true }).is('archived_at', null),
    supabase.from('app_users').select('*', { count: 'exact', head: true }).is('archived_at', null),
    supabase.from('sync_log').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
  ]);

  const isFresh = (merchants.count ?? 0) === 0 && (stores.count ?? 0) === 0;

  return (
    <>
      <PageHeader
        title={t.nav.dashboard}
        subtitle={`${t.app.tagline} · Phase 1`}
      />

      {isFresh ? (
        <div className="mb-6">
          <Notice tone="info" title="Phase 1 is live">
            The tenancy, identity and access layer is in place. Create a merchant, connect a store on the
            mock provider, and the order pipeline in Phase 3 will have something to run against.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t.companies.merchantCount} value={merchants.count ?? 0} />
        <StatTile label={t.companies.storeCount} value={stores.count ?? 0} />
        <StatTile label={t.companies.userCount} value={users.count ?? 0} />
        <StatTile
          label={t.sync.failed}
          value={syncFailures.count ?? 0}
          hint={t.sync.title}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Phase 1 — {t.nav.administration}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-1">
            {([
              { href: '/merchants', label: t.nav.merchants, perm: 'merchants.view' },
              { href: '/stores', label: t.nav.stores, perm: 'stores.view' },
              { href: '/users', label: t.nav.users, perm: 'users.view' },
              { href: '/roles/matrix', label: t.nav.permissionMatrix, perm: 'roles.manage' },
              { href: '/activity-log', label: t.nav.activityLog, perm: 'audit.view' },
            ] satisfies { href: Route; label: string; perm: string }[])
              .filter((link) => can(session, link.perm))
              .map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                >
                  {link.label}
                </Link>
              ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next phases</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="space-y-2 text-sm text-ink-muted">
              <li>
                <span className="tnum text-ink-subtle">2 · </span>Catalog &amp; pricing — products, variants,
                bundles, channel mapping
              </li>
              <li>
                <span className="tnum text-ink-subtle">3 · </span>Orders &amp; Confirmation Center — including
                Shopify sync
              </li>
              <li>
                <span className="tnum text-ink-subtle">4 · </span>Warehouse, inventory &amp; fulfillment
              </li>
              <li>
                <span className="tnum text-ink-subtle">5 · </span>Shipping, returns &amp; COD collections
              </li>
              <li>
                <span className="tnum text-ink-subtle">6 · </span>Finance, settlements &amp; profitability
              </li>
              <li>
                <span className="tnum text-ink-subtle">7 · </span>Reports &amp; BI
              </li>
            </ol>
            <p className="mt-4 text-xs text-ink-subtle">See docs/ROADMAP.md for the full breakdown.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
