import { requirePermission } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, EmptyState, Notice, PageHeader } from '@/components/ui';
import { PermissionMatrix } from './matrix';

/**
 * §2.14 "Permission matrix" — the screen where role × permission is inspected
 * as a grid rather than one role at a time.
 */
export default async function PermissionMatrixPage() {
  await requirePermission('roles.manage');
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  const [{ data: permissions }, { data: roles }, { data: grants }] = await Promise.all([
    supabase.from('permissions').select('*').order('sort_order'),
    supabase.from('roles').select('id, code, name_en, name_ar, company_id, is_active').order('code'),
    supabase.from('role_permissions').select('role_id, permission_id'),
  ]);

  const companyRoles = (roles ?? []).filter((role) => role.company_id !== null);
  const visibleRoles = companyRoles.length > 0 ? companyRoles : (roles ?? []);

  return (
    <>
      <PageHeader title={t.roles.matrixTitle} subtitle={t.roles.matrixSubtitle} />

      <div className="mb-4">
        <Notice tone="info">
          Sensitive permissions are marked. Granting one is itself recorded in the audit log, and some
          require a second approver before they take effect (§2.13 rule 13).
        </Notice>
      </div>

      <Card className="overflow-hidden">
        {!permissions || permissions.length === 0 || visibleRoles.length === 0 ? (
          <EmptyState
            title={t.common.noResults}
            hint="Roles are provisioned automatically when a company is created."
          />
        ) : (
          <PermissionMatrix
            locale={locale}
            permissions={permissions}
            roles={visibleRoles.map((role) => ({
              id: role.id,
              code: role.code,
              name: locale === 'ar' ? role.name_ar : role.name_en,
            }))}
            grants={(grants ?? []).map((g) => `${g.role_id}:${g.permission_id}`)}
          />
        )}
      </Card>
    </>
  );
}
