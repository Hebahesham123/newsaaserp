import { ChevronRight, Building2, Users } from 'lucide-react';
import { Badge } from '@/components/ui';

/**
 * One row of the department tree.
 *
 * Indentation uses a logical margin (`ms-`) rather than a left margin, so the
 * hierarchy mirrors correctly in Arabic — the tree grows from the start edge in
 * both directions, which is the whole reason the UI is built on logical
 * properties.
 *
 * The chevron is a static affordance, not a toggle: the rows arrive pre-ordered
 * by path from `department_tree`, so the tree is already flattened in reading
 * order and there is nothing to collapse without shipping client state for it.
 */
export function TreeRow({
  depth,
  name,
  childCount,
  isRoot,
}: {
  depth: number;
  name: string;
  childCount: number;
  isRoot: boolean;
}) {
  return (
    <div className="flex items-center gap-2" style={{ marginInlineStart: `${depth * 1.25}rem` }}>
      {depth > 0 ? (
        <ChevronRight className="size-3.5 shrink-0 text-ink-subtle flip-icon" aria-hidden />
      ) : null}

      {isRoot ? (
        <Building2 className="size-4 shrink-0 text-brand" aria-hidden />
      ) : (
        <Users className="size-4 shrink-0 text-ink-subtle" aria-hidden />
      )}

      <span className={isRoot ? 'font-medium text-ink' : 'text-ink'}>{name}</span>

      {childCount > 0 ? (
        <Badge tone="neutral" className="text-[10px]">
          {childCount}
        </Badge>
      ) : null}
    </div>
  );
}
