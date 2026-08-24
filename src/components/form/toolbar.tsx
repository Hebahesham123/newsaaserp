'use client';

import { useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { Button, Input, Select } from '@/components/ui';

export type FilterSpec = {
  name: string;
  label: string;
  options: { value: string; label: string }[];
};

/**
 * List filters, driven by the URL.
 *
 * Search and filter state lives in the query string rather than component
 * state, so filtering is done by the same server query that renders the page,
 * the result is shareable and bookmarkable, and the back button works. Selects
 * submit on change; the text field submits on Enter.
 */
export function Toolbar({
  filters = [],
  placeholder,
  children,
}: {
  filters?: FilterSpec[];
  placeholder?: string;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);

  const currentQuery = searchParams.get('q') ?? '';
  const hasFilters = [...searchParams.keys()].some((key) => key !== 'page');

  function submit(formData: FormData) {
    const next = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      const text = String(value).trim();
      if (text) next.set(key, text);
    }
    router.push(`${pathname}${next.size > 0 ? `?${next}` : ''}`);
  }

  return (
    <form
      ref={formRef}
      action={submit}
      className="mb-4 flex flex-wrap items-center gap-2"
      role="search"
    >
      <div className="relative min-w-48 flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
          aria-hidden
        />
        <Input
          type="search"
          name="q"
          defaultValue={currentQuery}
          placeholder={placeholder ?? t.common.search}
          className="ps-9"
          aria-label={t.common.search}
        />
      </div>

      {filters.map((filter) => (
        <Select
          key={filter.name}
          name={filter.name}
          defaultValue={searchParams.get(filter.name) ?? ''}
          aria-label={filter.label}
          className="w-auto min-w-36"
          onChange={() => formRef.current?.requestSubmit()}
        >
          <option value="">{`${filter.label}: ${t.common.all}`}</option>
          {filter.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ))}

      <Button type="submit" variant="secondary">
        {t.common.filter}
      </Button>

      {hasFilters ? (
        <Button type="button" variant="ghost" onClick={() => router.push(pathname)}>
          <X className="size-4" aria-hidden />
          {t.common.clear}
        </Button>
      ) : null}

      {children ? <div className="ms-auto flex items-center gap-2">{children}</div> : null}
    </form>
  );
}
