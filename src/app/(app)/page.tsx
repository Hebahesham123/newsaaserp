import Link from 'next/link';
import type { Route } from 'next';
import {
  Activity,
  Bell,
  ClipboardCheck,
  Factory,
  RefreshCcw,
  Store,
  Users,
} from 'lucide-react';
import { requireSession, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  Badge,
  Card,
  CardBody,
  CardHeaderRow,
  Dot,
  EmptyState,
  Notice,
  PageHeader,
  StatTile,
} from '@/components/ui';
import { Donut, RankedBars, Sparkline, StatusBars, type DonutSlice } from '@/components/ui/charts';
import { DateTime } from '@/components/status-badge';
import { buildSyncMetrics, syncWindowStart } from '@/lib/metrics';
import { loadCompanyDashboard } from '@/lib/dashboard';
import { CompanyDashboardView } from './company-dashboard';

const WINDOW_DAYS = 14;

/**
 * §Dashboard — dynamic by audience.
 *
 * A platform admin has no company of their own, so the system-level view below
 * is what they need: merchants, stores, users, warehouses and sync health. A
 * client user instead gets the operational dashboard for the modules their plan
 * activates, which is composed in `lib/dashboard.ts`.
 *
 * The split is on `company_id` rather than on a permission, because it is a
 * question of *whose* data there is to show, not of what the viewer may see.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const session = await requireSession();
  const { company: companyParam } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  if (session.profile.company_id) {
    const data = await loadCompanyDashboard(session);

    return (
      <>
        <PageHeader
          title={t.dashboard.overview}
          subtitle={`${session.company?.name_en ?? t.app.tagline} · ${session.profile.full_name}`}
        />
        <CompanyDashboardView
          data={data}
          t={t}
          currency={session.company?.base_currency ?? 'EGP'}
        />
      </>
    );
  }

  /**
   * A platform admin has no company of their own, so there is no single client
   * dashboard to show them by default. They pick one and then see exactly what
   * that client's own staff would see -- same loader, same module and permission
   * gates -- which is the only way to check a client's setup without their
   * password. RLS still decides whether the read is allowed; picking a company
   * narrows the query, it does not widen access.
   */
  const { data: companyRows } = await supabase
    .from('companies')
    .select('id, name_en, name_ar, base_currency')
    .is('archived_at', null)
    .order('name_en');

  const companies = companyRows ?? [];
  const viewing = companyParam ? companies.find((row) => row.id === companyParam) : undefined;
  const companyName = (row: { name_en: string; name_ar: string }) =>
    locale === 'ar' ? row.name_ar : row.name_en;

  const companyPicker =
    companies.length > 0 ? (
      <Card className="mb-6">
        <CardHeaderRow title={t.dashboard.pickCompany} />
        <CardBody>
          <div className="flex flex-wrap gap-2">
            <Link href="/" className={!viewing ? 'rounded-lg border border-brand bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand' : 'rounded-lg border border-border px-3 py-1.5 text-sm text-ink-muted transition-colors hover:border-border-strong hover:bg-surface-muted hover:text-ink'}>
              {t.dashboard.platformView}
            </Link>
            {companies.map((row) => (
              <Link
                key={row.id}
                href={`/?company=${row.id}` as Route}
                className={viewing?.id === row.id ? 'rounded-lg border border-brand bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand' : 'rounded-lg border border-border px-3 py-1.5 text-sm text-ink-muted transition-colors hover:border-border-strong hover:bg-surface-muted hover:text-ink'}
              >
                {companyName(row)}
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>
    ) : null;

  if (viewing) {
    const data = await loadCompanyDashboard(session, viewing.id);

    return (
      <>
        <PageHeader
          title={t.dashboard.overview}
          subtitle={`${t.dashboard.viewingAs} ${companyName(viewing)}`}
        />
        {companyPicker}
        <CompanyDashboardView data={data} t={t} currency={viewing.base_currency ?? 'EGP'} />
      </>
    );
  }

  // Read the clock once, in a helper, and derive everything from that reading.
  const windowStart = syncWindowStart(WINDOW_DAYS);

  // Counts respect RLS, so each user sees totals for what they may actually
  // access — not a global number they have no right to know.
  const [
    merchants,
    stores,
    users,
    warehouses,
    activeStores,
    pendingApprovals,
    unreadAlerts,
    { data: syncRuns },
    { data: storeRows },
    { data: auditRows },
  ] = await Promise.all([
    supabase.from('merchants').select('*', { count: 'exact', head: true }).is('archived_at', null),
    supabase.from('stores').select('*', { count: 'exact', head: true }).is('archived_at', null),
    supabase.from('app_users').select('*', { count: 'exact', head: true }).is('archived_at', null),
    supabase.from('warehouses').select('*', { count: 'exact', head: true }).is('archived_at', null),
    supabase
      .from('stores')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
      .is('archived_at', null),
    supabase.from('approval_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_id', session.profile.id)
      .is('read_at', null),
    supabase
      .from('sync_log')
      .select('status, records_received, records_failed, started_at, store_id')
      .gte('started_at', windowStart)
      .order('started_at', { ascending: true }),
    supabase.from('stores').select('id, name, status').is('archived_at', null),
    can(session, 'audit.view')
      ? supabase
          .from('audit_log')
          .select('id, action, module, occurred_at, changed_fields, app_users!audit_log_actor_id_fkey(full_name)')
          .order('occurred_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: null }),
  ]);

  const runs = syncRuns ?? [];
  const isFresh = (merchants.count ?? 0) === 0 && (stores.count ?? 0) === 0;

  /* --- sync health, bucketed per day ------------------------------------- */

  const dayFormatter = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    day: '2-digit',
    month: 'short',
  });

  const metrics = buildSyncMetrics(runs, WINDOW_DAYS, (date) => dayFormatter.format(date));

  /* --- stores by status -------------------------------------------------- */

  const storeList = storeRows ?? [];
  const countStatus = (...statuses: string[]) =>
    storeList.filter((store) => statuses.includes(store.status)).length;

  const allStoreSlices: DonutSlice[] = [
    { label: t.status.active, value: countStatus('active'), tone: 'success' },
    { label: t.status.connected, value: countStatus('connected'), tone: 'info' },
    { label: t.status.connection_error, value: countStatus('connection_error'), tone: 'danger' },
    {
      label: t.status.temporarily_suspended,
      value: countStatus('temporarily_suspended', 'disconnected'),
      tone: 'warning',
    },
    { label: t.status.draft, value: countStatus('draft', 'not_connected'), tone: 'neutral' },
  ];

  // An empty slice adds a legend row that explains nothing.
  const storeSlices = allStoreSlices.filter((slice) => slice.value > 0);

  /* --- volume by store --------------------------------------------------- */

  const nameById = new Map(storeList.map((store) => [store.id, store.name]));

  const topStores = metrics.byStore
    .slice(0, 6)
    .map((entry) => ({ label: nameById.get(entry.storeId) ?? '—', value: entry.received }));

  const quickLinks = (
    [
      { href: '/merchants', label: t.nav.merchants, perm: 'merchants.view' },
      { href: '/stores', label: t.nav.stores, perm: 'stores.view' },
      { href: '/users', label: t.nav.users, perm: 'users.view' },
      { href: '/warehouses', label: t.nav.warehouses, perm: 'warehouses.view' },
      { href: '/roles/matrix', label: t.nav.permissionMatrix, perm: 'roles.manage' },
      { href: '/approvals', label: t.nav.approvals, perm: 'approvals.view' },
      { href: '/sync-log', label: t.nav.syncLog, perm: 'stores.sync.view' },
      { href: '/activity-log', label: t.nav.activityLog, perm: 'audit.view' },
    ] satisfies { href: Route; label: string; perm: string }[]
  ).filter((link) => can(session, link.perm));

  return (
    <>
      <PageHeader title={t.dashboard.overview} subtitle={`${t.app.tagline} · ${session.profile.full_name}`} />

      {companyPicker}

      {isFresh ? (
        <div className="mb-6">
          <Notice tone="info" title={t.dashboard.setupTitle}>
            {t.dashboard.setupBody} {t.dashboard.seedHint}
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t.companies.merchantCount}
          value={merchants.count ?? 0}
          icon={<Factory className="size-4" aria-hidden />}
        />
        <StatTile
          label={t.dashboard.activeStores}
          value={`${activeStores.count ?? 0} / ${stores.count ?? 0}`}
          tone="info"
          icon={<Store className="size-4" aria-hidden />}
        />
        <StatTile
          label={t.companies.userCount}
          value={users.count ?? 0}
          tone="success"
          hint={`${warehouses.count ?? 0} ${t.warehouses.title}`}
          icon={<Users className="size-4" aria-hidden />}
        />
        <StatTile
          label={t.sync.received}
          value={metrics.totalReceived.toLocaleString('en-GB')}
          tone="brand"
          hint={t.dashboard.ordersBySourceHint}
          icon={<Activity className="size-4" aria-hidden />}
          chart={<Sparkline values={metrics.volumeByDay} label={t.dashboard.ordersBySourceHint} />}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t.dashboard.syncSuccessRate}
          value={`${metrics.successRate}%`}
          tone={metrics.successRate >= 90 ? 'success' : metrics.successRate >= 70 ? 'warning' : 'danger'}
          hint={`${metrics.runCount} ${t.common.results}`}
          icon={<RefreshCcw className="size-4" aria-hidden />}
        />
        <StatTile
          label={t.dashboard.syncFailures}
          value={metrics.failedLast7}
          tone={metrics.failedLast7 > 0 ? 'danger' : 'success'}
          icon={<RefreshCcw className="size-4" aria-hidden />}
        />
        <StatTile
          label={t.dashboard.pendingApprovals}
          value={pendingApprovals.count ?? 0}
          tone={(pendingApprovals.count ?? 0) > 0 ? 'warning' : 'neutral'}
          icon={<ClipboardCheck className="size-4" aria-hidden />}
        />
        <StatTile
          label={t.dashboard.unreadAlerts}
          value={unreadAlerts.count ?? 0}
          tone={(unreadAlerts.count ?? 0) > 0 ? 'info' : 'neutral'}
          icon={<Bell className="size-4" aria-hidden />}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeaderRow title={t.dashboard.syncHealth} hint={t.dashboard.syncHealthHint}>
            {can(session, 'stores.sync.view') ? (
              <Link href="/sync-log" className="text-sm text-brand hover:underline">
                {t.common.viewAll}
              </Link>
            ) : null}
          </CardHeaderRow>
          <CardBody>
            {metrics.runCount === 0 ? (
              <EmptyState title={t.common.noResults} hint={t.sync.subtitle} />
            ) : (
              <StatusBars
                buckets={metrics.buckets}
                legend={{
                  success: t.sync.succeeded,
                  partial: t.status.partial,
                  failed: t.sync.failed,
                }}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeaderRow title={t.dashboard.storeStatus}>
            {can(session, 'stores.view') ? (
              <Link href="/stores" className="text-sm text-brand hover:underline">
                {t.common.viewAll}
              </Link>
            ) : null}
          </CardHeaderRow>
          <CardBody>
            {storeSlices.length === 0 ? (
              <EmptyState title={t.common.noResults} />
            ) : (
              <Donut slices={storeSlices} total={storeList.length} caption={t.nav.stores} size={124} />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeaderRow title={t.dashboard.ordersBySource} hint={t.dashboard.ordersBySourceHint} />
          <CardBody>
            {topStores.length === 0 ? (
              <EmptyState title={t.common.noResults} />
            ) : (
              <RankedBars rows={topStores} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeaderRow title={t.dashboard.recentActivity}>
            {can(session, 'audit.view') ? (
              <Link href="/activity-log" className="text-sm text-brand hover:underline">
                {t.common.viewAll}
              </Link>
            ) : null}
          </CardHeaderRow>
          <CardBody>
            {!auditRows || auditRows.length === 0 ? (
              <EmptyState title={t.dashboard.noActivity} />
            ) : (
              <ul className="space-y-3">
                {auditRows.map((entry) => {
                  const actor = entry.app_users as unknown as { full_name: string } | null;
                  const tone =
                    entry.action === 'create'
                      ? 'success'
                      : entry.action === 'archive' || entry.action === 'permission_change'
                        ? 'warning'
                        : entry.action === 'delete' || entry.action === 'reject'
                          ? 'danger'
                          : 'info';

                  return (
                    <li key={entry.id} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-1.5">
                        <Dot tone={tone} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-ink">
                          <span className="font-medium">{actor?.full_name ?? 'system'}</span>{' '}
                          <span className="text-ink-muted">{entry.action.replace(/_/g, ' ')}</span>{' '}
                          <code className="font-mono text-xs text-ink-subtle" dir="ltr">
                            {entry.module}
                          </code>
                        </p>
                        {entry.changed_fields && entry.changed_fields.length > 0 ? (
                          <p className="truncate text-xs text-ink-subtle" dir="ltr">
                            {entry.changed_fields.slice(0, 4).join(', ')}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-xs text-ink-subtle">
                        <DateTime value={entry.occurred_at} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {quickLinks.length > 0 ? (
        <div className="mt-4">
          <Card>
            <CardHeaderRow title={t.common.quickActions} />
            <CardBody>
              <div className="flex flex-wrap gap-2">
                {quickLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm text-ink-muted transition-colors hover:border-border-strong hover:bg-surface-muted hover:text-ink"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {metrics.failedTotal > 0 && can(session, 'stores.sync.view') ? (
        <p className="mt-4 text-xs text-ink-subtle">
          <Badge tone="danger" className="me-2">
            {metrics.failedTotal}
          </Badge>
          {t.dashboard.syncFailures} · {t.dashboard.syncHealthHint}
        </p>
      ) : null}
    </>
  );
}
