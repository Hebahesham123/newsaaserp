'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm } from '@/components/form/entity-form';
import { Notice } from '@/components/ui';
import { decideApproval } from './actions';

/**
 * §2.7.4 — the checker's decision.
 *
 * Approve and reject are two dialogs rather than one form with a radio, so the
 * intent is explicit in the button the user pressed and cannot be mis-set.
 */
export function DecideForm({
  requestId,
  summary,
  decision,
  ownRequest,
}: {
  requestId: string;
  summary: string;
  decision: 'approved' | 'rejected';
  ownRequest: boolean;
}) {
  const { t } = useI18n();
  const approving = decision === 'approved';

  return (
    <EntityForm
      action={decideApproval}
      title={approving ? t.approvals.approve : t.approvals.reject}
      description={summary}
      fields={[
        { kind: 'hidden', name: 'id', value: requestId },
        { kind: 'hidden', name: 'decision', value: decision },
        {
          kind: 'textarea',
          name: 'decision_note',
          label: t.approvals.decisionNote,
          required: !approving,
          hint: approving ? undefined : 'Say why, so the requester can correct and resubmit.',
          full: true,
        },
      ]}
      trigger={approving ? t.approvals.approve : t.approvals.reject}
      triggerIcon="none"
      triggerVariant={approving ? 'primary' : 'secondary'}
      triggerSize="sm"
      submitLabel={approving ? t.approvals.approve : t.approvals.reject}
      size="sm"
      banner={ownRequest ? <Notice tone="danger">{t.approvals.ownRequest}</Notice> : undefined}
    />
  );
}
