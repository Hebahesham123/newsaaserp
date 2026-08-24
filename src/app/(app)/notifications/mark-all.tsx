'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { CheckCheck } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { Button } from '@/components/ui';
import { markAllNotificationsRead } from './actions';

export function MarkAllReadButton({ disabled }: { disabled?: boolean }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markAllNotificationsRead();
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? t.notifications.allRead);
        })
      }
    >
      <CheckCheck className="size-4" aria-hidden />
      {t.notifications.markAllRead}
    </Button>
  );
}
