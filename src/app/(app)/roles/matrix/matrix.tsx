'use client';

import { Fragment, useMemo, useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Minus, ShieldAlert } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { Badge, Input } from '@/components/ui';
import type { PermissionRow } from '@/lib/supabase/database.types';
import type { Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';
import { toggleRolePermission } from '../actions';

type Role = { id: string; code: string; name: string; isTemplate: boolean };

/**
 * Role × permission grid.
 *
 * The first column is sticky because the grid is far wider than any screen —
 * without it you lose track of which permission a row represents after two
 * roles of horizontal scroll.
 *
 * Cells are buttons when the viewer may manage roles. Each click is one row
 * written to role_permissions, applied optimistically so a grid of 60
 * permissions stays usable, and rolled back by the server's revalidation if the
 * write is refused.
 */
export function PermissionMatrix({
  locale,
  permissions,
  roles,
  grants,
  editable,
}: {
  locale: Locale;
  permissions: PermissionRow[];
  roles: Role[];
  grants: string[];
  editable: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [, startTransition] = useTransition();

  const [optimisticGrants, applyOptimistic] = useOptimistic(
    grants,
    (current: string[], change: { key: string; grant: boolean }) =>
      change.grant ? [...current, change.key] : current.filter((key) => key !== change.key),
  );

  const grantSet = useMemo(() => new Set(optimisticGrants), [optimisticGrants]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return permissions;
    return permissions.filter(
      (p) =>
        p.code.toLowerCase().includes(q) ||
        p.label_en.toLowerCase().includes(q) ||
        p.label_ar.includes(query.trim()) ||
        p.module.toLowerCase().includes(q),
    );
  }, [permissions, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, PermissionRow[]>();
    for (const permission of filtered) {
      const list = map.get(permission.module) ?? [];
      list.push(permission);
      map.set(permission.module, list);
    }
    return [...map.entries()];
  }, [filtered]);

  function toggle(role: Role, permission: PermissionRow, granted: boolean) {
    if (!editable) return;

    if (role.isTemplate) {
      toast.error(t.roles.templateReadOnly);
      return;
    }

    const key = `${role.id}:${permission.id}`;

    startTransition(async () => {
      applyOptimistic({ key, grant: !granted });

      const formData = new FormData();
      formData.set('role_id', role.id);
      formData.set('permission_id', permission.id);
      formData.set('grant', String(!granted));

      const result = await toggleRolePermission({}, formData);

      if (result.error) toast.error(result.error);
      else if (permission.is_sensitive) {
        // Sensitive grants are audited; say so rather than a silent success.
        toast.success(`${result.message} · ${t.roles.sensitive}`);
      } else {
        toast.success(result.message ?? t.roles.permissionUpdated);
      }
    });
  }

  const grantedCount = grantSet.size;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.common.search}
          className="max-w-xs"
        />
        {editable ? <p className="text-xs text-ink-subtle">{t.roles.toggleHint}</p> : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky start-0 z-20 min-w-72 border-b border-border bg-surface-muted px-4 py-2.5 text-start text-xs font-medium tracking-wide text-ink-muted uppercase">
                {t.roles.permission}
              </th>
              {roles.map((role) => (
                <th
                  key={role.id}
                  className="border-b border-border bg-surface-muted px-3 py-2.5 text-center text-xs font-medium text-ink-muted"
                >
                  <span className="block max-w-28 truncate" title={role.name}>
                    {role.name}
                  </span>
                  {role.isTemplate ? (
                    <span className="mt-0.5 block text-[10px] text-ink-subtle">
                      {t.roles.scopeTemplate}
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {grouped.map(([module, modulePermissions]) => (
              <Fragment key={module}>
                <tr>
                  <td
                    colSpan={roles.length + 1}
                    className="sticky start-0 border-b border-border bg-brand-soft px-4 py-1.5 text-xs font-semibold tracking-wide text-brand-ink uppercase"
                  >
                    {module}
                  </td>
                </tr>

                {modulePermissions.map((permission) => (
                  <tr key={permission.id} className="group hover:bg-surface-muted">
                    <td className="sticky start-0 z-10 border-b border-border bg-surface px-4 py-2 group-hover:bg-surface-muted">
                      <div className="flex items-center gap-2">
                        <span className="text-ink">
                          {locale === 'ar' ? permission.label_ar : permission.label_en}
                        </span>
                        {permission.is_sensitive ? (
                          <ShieldAlert className="size-3.5 shrink-0 text-warning" aria-label={t.roles.sensitive} />
                        ) : null}
                        {permission.requires_approval ? (
                          <Badge tone="warning" className="text-[10px]">
                            {t.roles.requiresApproval}
                          </Badge>
                        ) : null}
                      </div>
                      <code dir="ltr" className="mt-0.5 block font-mono text-[11px] text-ink-subtle">
                        {permission.code}
                      </code>
                    </td>

                    {roles.map((role) => {
                      const granted = grantSet.has(`${role.id}:${permission.id}`);
                      const label = `${role.name} · ${permission.code}`;

                      const mark = granted ? (
                        <Check
                          className={cn(
                            'mx-auto size-4',
                            permission.is_sensitive ? 'text-warning' : 'text-success',
                          )}
                          aria-hidden
                        />
                      ) : (
                        <Minus className="mx-auto size-4 text-ink-subtle/40" aria-hidden />
                      );

                      return (
                        <td key={role.id} className="border-b border-border p-0 text-center">
                          {editable && !role.isTemplate ? (
                            <button
                              type="button"
                              onClick={() => toggle(role, permission, granted)}
                              title={`${label} — ${granted ? t.common.remove : t.common.add}`}
                              aria-label={`${label} — ${granted ? t.common.remove : t.common.add}`}
                              aria-pressed={granted}
                              className="flex h-full w-full items-center justify-center px-3 py-2 transition-colors hover:bg-brand-soft"
                            >
                              {mark}
                            </button>
                          ) : (
                            <span className="flex items-center justify-center px-3 py-2" title={label}>
                              {mark}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-border px-5 py-3 text-xs text-ink-subtle">
        <span className="flex items-center gap-1.5">
          <Check className="size-3.5 text-success" /> {t.roles.granted}
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldAlert className="size-3.5 text-warning" /> {t.roles.sensitive}
        </span>
        <span className="tnum">
          {grantedCount} {t.roles.granted}
        </span>
        <span className="tnum ms-auto">
          {filtered.length} {t.common.of} {permissions.length}
        </span>
      </div>
    </>
  );
}
