import { Card, CardBody, Notice } from '@/components/ui';

/**
 * Shown when a screen's tables have not been created yet, instead of letting the
 * page fail. The command is the whole point of the message.
 */
export function MigrationRequired({ migrations }: { migrations: string }) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <Notice tone="warning" title="Database migration required">
          This screen needs migrations <strong>{migrations}</strong>, which have not been applied to
          the connected Supabase project yet.
        </Notice>

        <p className="text-sm text-ink-muted">Apply them with the Supabase CLI:</p>
        <pre
          dir="ltr"
          className="overflow-x-auto rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-muted"
        >
          {`npx supabase login\nnpm run db:link\nnpm run db:push`}
        </pre>
        <p className="text-xs text-ink-subtle">
          Or paste the SQL from <code dir="ltr">supabase/migrations/</code> into the project&apos;s SQL
          editor, in filename order. Afterwards run <code dir="ltr">npm run db:seed</code> to load the
          demo catalog.
        </p>
      </CardBody>
    </Card>
  );
}
