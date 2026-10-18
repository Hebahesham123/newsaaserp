'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Filter, X, Search, Calendar } from 'lucide-react';
import { Button, Card, CardBody, Input, Select, Badge } from '@/components/ui';

/**
 * §7 Dynamic Advanced Filters, §11 Date Range.
 *
 * The catalogue arrives already flattened by the server: labels resolved,
 * forbidden fields removed, options filled in. That is deliberate — the server
 * decides what may be filtered, and shipping the raw definitions would mean
 * shipping fields this viewer is not allowed to use and then hiding them in the
 * browser, which is not the same thing.
 *
 * Every change is a navigation. Filters live in the URL so a filtered list can
 * be bookmarked, shared and saved as a view, and so the back button does what
 * it looks like it does.
 */

export type ClientFilterField = {
  key: string;
  label: string;
  type: 'select' | 'text' | 'number' | 'date' | 'boolean';
  operators: { value: string; label: string }[];
  options?: { value: string; label: string }[];
  isDateField?: boolean;
};

export type ClientChip = {
  /** The exact `f` value, so removing it is an array filter rather than a re-encode. */
  raw: string;
  label: string;
};

const VALUELESS = new Set(['is_empty']);

export function OrderFilterBar({
  fields,
  chips,
  presets,
  labels,
  searchValue,
}: {
  fields: ClientFilterField[];
  chips: ClientChip[];
  presets: { value: string; label: string }[];
  labels: {
    addFilter: string;
    searchFilters: string;
    apply: string;
    clearAll: string;
    dateRange: string;
    dateField: string;
    customRange: string;
    search: string;
  };
  searchValue: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [open, setOpen] = useState(false);
  const [fieldKey, setFieldKey] = useState('');
  const [operator, setOperator] = useState('');
  const [value, setValue] = useState('');
  const [secondValue, setSecondValue] = useState('');
  const [query, setQuery] = useState('');

  const field = useMemo(
    () => fields.find((candidate) => candidate.key === fieldKey),
    [fields, fieldKey],
  );

  const matching = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? fields.filter((f) => f.label.toLowerCase().includes(term)) : fields;
  }, [fields, query]);

  const navigate = (next: URLSearchParams) => {
    const search = next.toString();
    router.push(search ? `${pathname}?${search}` : pathname);
  };

  const addFilter = () => {
    if (!field || !operator) return;

    const encoded = VALUELESS.has(operator)
      ? `${field.key}:${operator}`
      : operator === 'between'
        ? `${field.key}:${operator}:${value}..${secondValue}`
        : `${field.key}:${operator}:${value}`;

    if (!VALUELESS.has(operator) && !value) return;
    if (operator === 'between' && !secondValue) return;

    const next = new URLSearchParams(params.toString());
    next.append('f', encoded);
    navigate(next);

    setOpen(false);
    setFieldKey('');
    setOperator('');
    setValue('');
    setSecondValue('');
  };

  const removeChip = (raw: string) => {
    const next = new URLSearchParams(params.toString());
    const kept = next.getAll('f').filter((entry) => entry !== raw);
    next.delete('f');
    for (const entry of kept) next.append('f', entry);
    navigate(next);
  };

  const clearAll = () => {
    const next = new URLSearchParams(params.toString());
    next.delete('f');
    next.delete('preset');
    next.delete('from');
    next.delete('to');
    next.delete('q');
    navigate(next);
  };

  const setPreset = (preset: string) => {
    const next = new URLSearchParams(params.toString());
    if (preset) next.set('preset', preset);
    else next.delete('preset');
    // A preset and an explicit range are two answers to the same question.
    next.delete('from');
    next.delete('to');
    navigate(next);
  };

  const setDateField = (key: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('dateField', key);
    navigate(next);
  };

  const submitSearch = (term: string) => {
    const next = new URLSearchParams(params.toString());
    if (term) next.set('q', term);
    else next.delete('q');
    navigate(next);
  };

  const dateFields = fields.filter((f) => f.isDateField);

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-[16rem] flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem('q') as HTMLInputElement | null;
            submitSearch(input?.value.trim() ?? '');
          }}
        >
          <Search
            className="pointer-events-none absolute inset-inline-start-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
            style={{ insetInlineStart: '0.75rem' }}
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={searchValue}
            placeholder={labels.search}
            className="ps-9"
          />
        </form>

        <Select
          value={params.get('dateField') ?? 'order_date'}
          onChange={(event) => setDateField(event.currentTarget.value)}
          aria-label={labels.dateField}
          className="w-auto"
        >
          {dateFields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>

        <Select
          value={params.get('preset') ?? ''}
          onChange={(event) => setPreset(event.currentTarget.value)}
          aria-label={labels.dateRange}
          className="w-auto"
        >
          <option value="">{labels.dateRange}</option>
          {presets.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </Select>

        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
          <Filter className="me-1.5 size-4" aria-hidden />
          {labels.addFilter}
        </Button>
      </div>

      {open ? (
        <Card>
          <CardBody>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <div>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder={labels.searchFilters}
                  className="mb-2"
                />
                <Select
                  value={fieldKey}
                  onChange={(event) => {
                    setFieldKey(event.currentTarget.value);
                    const next = fields.find((f) => f.key === event.currentTarget.value);
                    // Default to the first condition its type allows, so the
                    // commonest case is one choice rather than three.
                    setOperator(next?.operators[0]?.value ?? '');
                    setValue('');
                    setSecondValue('');
                  }}
                  size={Math.min(Math.max(matching.length, 2), 8)}
                >
                  {matching.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </div>

              <Select
                value={operator}
                onChange={(event) => setOperator(event.currentTarget.value)}
                disabled={!field}
              >
                {(field?.operators ?? []).map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </Select>

              <div className="space-y-2">
                {field && !VALUELESS.has(operator) ? (
                  field.options ? (
                    <Select value={value} onChange={(event) => setValue(event.currentTarget.value)}>
                      <option value="">—</option>
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
                      value={value}
                      onChange={(event) => setValue(event.currentTarget.value)}
                    />
                  )
                ) : null}

                {operator === 'between' ? (
                  <Input
                    type={field?.type === 'date' ? 'date' : 'number'}
                    value={secondValue}
                    onChange={(event) => setSecondValue(event.currentTarget.value)}
                  />
                ) : null}
              </div>

              <Button type="button" size="sm" onClick={addFilter} disabled={!field || !operator}>
                {labels.apply}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <span
              key={chip.raw}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-ink"
            >
              <Calendar className="size-3 text-ink-subtle" aria-hidden />
              {chip.label}
              <button
                type="button"
                onClick={() => removeChip(chip.raw)}
                className="text-ink-subtle transition-colors hover:text-danger"
                aria-label={labels.clearAll}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}

          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-brand hover:underline"
          >
            {labels.clearAll}
          </button>

          <Badge tone="neutral" className="text-[10px]">
            {chips.length}
          </Badge>
        </div>
      ) : null}
    </div>
  );
}
