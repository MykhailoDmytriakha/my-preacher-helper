'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';

/**
 * Up and down, in both places that rearrange something in this section: the list of services
 * and the steps inside one. It was written twice, identically, which is how two versions of one
 * control start to drift — one gets a disabled state, the other a different hit area, and
 * nobody notices until a person meets both.
 *
 * Deliberately scoped to this section rather than made global: groups and series rearrange under
 * materially different rules, and a shared "reorder control" would have to grow options for all
 * of them before it had a second real user.
 *
 * Arrows rather than dragging alone, everywhere: dragging does not exist for a keyboard and is
 * awkward under a thumb, and both of those are people this section is for.
 */
export function ReorderArrows({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  upLabel,
  downLabel,
}: {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  upLabel: string;
  downLabel: string;
}) {
  const button =
    'flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-800 dark:hover:text-gray-200';

  return (
    <span className="flex shrink-0 items-center">
      <button type="button" onClick={onMoveUp} disabled={!canMoveUp} aria-label={upLabel} className={button}>
        <ArrowUp className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
      <button type="button" onClick={onMoveDown} disabled={!canMoveDown} aria-label={downLabel} className={button}>
        <ArrowDown className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * The same refusal, said the same way, on both pages of the section. Kept beside them rather
 * than turned into a global error banner: what a person should do about it is specific to this
 * section, and a generic one would lose that.
 */
export function ServiceOrderFailure({ message, testId }: { message: string; testId: string }) {
  return (
    <p
      role="alert"
      data-testid={testId}
      className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200"
    >
      {message}
    </p>
  );
}
