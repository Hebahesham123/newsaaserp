'use client';

import { Fragment, useMemo, useState } from 'react';
import { Check, Minus, ShieldAlert } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { Badge, Input } from '@/components/ui';
import type { PermissionRow } from '@/lib/supabase/database.types';
import type { Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';

type Role = { id: string; code: string; name: string };

/**
 * Role × permission grid.
 *
 * The first column is sticky because the grid is far wider than any screen —
 * without it you lose track of which permission a row represents after two
 * roles of horizontal scroll.
 */
export function PermissionMatrix({
  locale,
  permissions,
  roles,
  grants,
}: {
  locale: Locale;
  permissions: PermissionRow[];
  roles: Role[];
  grants: string[];
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const grantSet = useMemo(() => new Set(grants), [grants]);

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

  return (
    <>
      <div className="border-b border-border px-5 py-3">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.common.search}
          className="max-w-xs"
        />
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
                      return (
                        <td
                          key={role.id}
                          className="border-b border-border px-3 py-2 text-center"
                          title={`${role.name} · ${permission.code}`}
                        >
                          {granted ? (
                            <Check
                              className={cn(
                                'mx-auto size-4',
                                permission.is_sensitive ? 'text-warning' : 'text-success',
                              )}
                              aria-label={t.common.yes}
                            />
                          ) : (
                            <Minus className="mx-auto size-4 text-ink-subtle/40" aria-label={t.common.no} />
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
          <Check className="size-3.5 text-success" /> granted
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldAlert className="size-3.5 text-warning" /> {t.roles.sensitive}
        </span>
        <span className="tnum ms-auto">
          {filtered.length} {t.common.of} {permissions.length}
        </span>
      </div>
    </>
  );
}
