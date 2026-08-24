import Link from 'next/link';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, StatTile, Table, Tabs, Td, Th, Tr } from '@/components/ui';
import { DateTime, EnumBadge } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter } from '@/lib/filters';

const TASK_TYPES = [
  'receiving', 'put_away', 'picking', 'packing', 'quality_check',
  'transfer', 'inventory_count', 'courier_handover',
] as const;

const TASK_STATUSES = ['pending', 'assigned', 'in_progress', 'on_hold', 'completed', 'cancelled'] as const;

/** §5.11 the task board, and §5.21 the SLA breaches it makes visible. */
export default async function WarehouseTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; type?: string; status?: string; warehouse?: string }>;
}) {
  const session = await requirePermission('warehouse.tasks.view');
  const { tab, type, status, warehouse } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const active = tab === 'all' || tab === 'overdue' ? tab : 'mine';
  const now = new Date().toISOString();

  let query = supabase
    .from('warehouse_tasks')
    .select('*, warehouses(name), app_users(full_name), orders(order_number)')
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(250);

  if (active === 'mine') {
    query = query.eq('assigned_to', session.profile.id);
  } else if (active === 'overdue') {
    query = query.lt('due_at', now).not('status', 'in', '("completed","cancelled")');
  }

  const typeFilter = pickFilter(type, TASK_TYPES);
  if (typeFilter) query = query.eq('task_type', typeFilter);

  const statusFilter = pickFilter(status, TASK_STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);
  if (warehouse) query = query.eq('warehouse_id', warehouse);

  const [{ data: tasks }, { data: warehouses }, mineCount, openCount, overdueCount] = await Promise.all([
    query,
    supabase.from('warehouses').select('id, name').is('archived_at', null).order('name'),
    supabase
      .from('warehouse_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', session.profile.id)
      .not('status', 'in', '("completed","cancelled")'),
    supabase
      .from('warehouse_tasks')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '("completed","cancelled")'),
    supabase
      .from('warehouse_tasks')
      .select('id', { count: 'exact', head: true })
      .lt('due_at', now)
      .not('status', 'in', '("completed","cancelled")'),
  ]);

  const canAssign = can(session, 'warehouse.tasks.assign');

  return (
    <>
      <PageHeader title={t.warehouseTasks.title} subtitle={t.warehouseTasks.subtitle} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatTile label={t.warehouseTasks.myTasks} value={mineCount.count ?? 0} tone="brand" />
        <StatTile label={t.warehouseTasks.allTasks} value={openCount.count ?? 0} tone="info" />
        <StatTile label={t.warehouseTasks.overdue} value={overdueCount.count ?? 0} tone="danger" />
      </div>

      <Tabs
        active={`/warehouse-tasks?tab=${active}`}
        items={[
          { href: '/warehouse-tasks?tab=mine', label: t.warehouseTasks.myTasks, count: mineCount.count ?? 0 },
          { href: '/warehouse-tasks?tab=all', label: t.warehouseTasks.allTasks, count: openCount.count ?? 0 },
          { href: '/warehouse-tasks?tab=overdue', label: t.warehouseTasks.overdue, count: overdueCount.count ?? 0 },
        ]}
      />

      <Toolbar
        filters={[
          {
            name: 'type',
            label: t.warehouseTasks.taskType,
            options: TASK_TYPES.map((value) => ({ value, label: t.warehouseTaskType[value] })),
          },
          {
            name: 'status',
            label: t.common.status,
            options: TASK_STATUSES.map((value) => ({ value, label: t.taskStatus[value] })),
          },
          {
            name: 'warehouse',
            label: t.inventory.warehouse,
            options: (warehouses ?? []).map((w) => ({ value: w.id, label: w.name })),
          },
        ]}
      />

      <Card>
        {!tasks || tasks.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.warehouseTasks.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.warehouseTasks.taskNumber}</Th>
                <Th>{t.warehouseTasks.taskType}</Th>
                <Th>{t.orders.orderNumber}</Th>
                <Th>{t.common.status}</Th>
                <Th>{t.warehouseTasks.priority}</Th>
                {canAssign ? <Th>{t.warehouseTasks.assignedTo}</Th> : null}
                <Th>{t.warehouseTasks.dueAt}</Th>
                <Th>{t.inventory.warehouse}</Th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const wh = task.warehouses as unknown as { name: string } | null;
                const agent = task.app_users as unknown as { full_name: string } | null;
                const order = task.orders as unknown as { order_number: string } | null;

                // §5.11 an SLA is only breached while the task is still open, or
                // if it finished after its deadline.
                const overdue =
                  task.due_at != null &&
                  (task.completed_at
                    ? task.completed_at > task.due_at
                    : task.due_at < now && !['completed', 'cancelled'].includes(task.status));

                return (
                  <Tr key={task.id}>
                    <Td className="tnum font-medium" dir="ltr">{task.task_number}</Td>
                    <Td>
                      <EnumBadge section="warehouseTaskType" value={task.task_type} tone="neutral" />
                    </Td>
                    <Td className="tnum" dir="ltr">
                      {order && task.order_id ? (
                        <Link href={`/orders/${task.order_id}`} className="text-brand hover:underline">
                          {order.order_number}
                        </Link>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </Td>
                    <Td>
                      <EnumBadge section="taskStatus" value={task.status} />
                    </Td>
                    <Td>
                      <EnumBadge
                        section="taskPriority"
                        value={task.priority}
                        tone={task.priority === 'urgent' ? 'danger' : task.priority === 'high' ? 'warning' : 'neutral'}
                      />
                    </Td>
                    {canAssign ? (
                      <Td className="text-ink-muted">
                        {agent?.full_name ?? (
                          <span className="text-ink-subtle">{t.warehouseTasks.unassigned}</span>
                        )}
                      </Td>
                    ) : null}
                    <Td>
                      <DateTime value={task.due_at} />
                      {overdue ? (
                        <Badge tone="danger" className="ms-2 text-[10px]">
                          {t.warehouseTasks.slaBreached}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="text-ink-muted">{wh?.name ?? '—'}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
