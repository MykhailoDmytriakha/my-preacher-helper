'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';

/**
 * Up and down, wherever the pastor rearranges a list by hand: the services and the steps inside
 * one, a council's topics, the themes, groups, bases and questions of the hard questions. It was
 * written twice, identically, in the orders of service, which is how two versions of one control
 * start to drift — so it lives here, once (moved from `care/orders/ReorderArrows.tsx`, 2026-11-25,
 * when the council and the hard questions became its third and fourth users).
 *
 * Arrows rather than dragging alone, everywhere: dragging does not exist for a keyboard and is
 * awkward under a thumb, and both of those are people these sections are for.
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
    'flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-800 dark:hover:text-gray-200';

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
