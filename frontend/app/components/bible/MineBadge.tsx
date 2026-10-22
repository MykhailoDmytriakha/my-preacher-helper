'use client';

import { USAGE_KIND_LOOK } from './usageKinds';

import type { ScriptureUsageKind } from '@/utils/scriptureUsage';

/**
 * The links' chip's measure (`CrossRefsChip`: 20 px, raised 0.15em), so the two stand on one line after a
 * verse — 22 px and 0.1em left the badge 2.6 px lower at the bottom (the owner's screenshot, 2026-10-21).
 * One pixel more: the line holds each by the bottom of its first icon, and the circle's icon ends a pixel
 * higher in the box than the chip's — measured 1.0 px lower at every text size until raised.
 */
const CAPSULE = 'relative inline-flex h-5 items-center gap-[5px] whitespace-nowrap rounded-full border pl-[1px] pr-2 align-[calc(0.15em+1px)] font-sans text-xs font-bold leading-none tabular-nums';

/**
 * THE PERSON'S BADGE ON THE BIBLE TEXT — the one look of it everywhere it is drawn: after a verse, by a
 * chapter's heading, in Settings → Bible (the owner's choice 2026-10-21 on the canvas «Перекрёстные ссылки в
 * читалке», row 2.2: «Б · Кружок», the number white with a border, on the badge's top right corner). A solid
 * circle of the section's colour with its white icon says whose it is; the words say the place, "3:16".
 * Pressed, it is a button; without `onClick` only its look. Its ring shows for the keyboard only
 * (`focus-visible`): a finger coming back from the list did not want one.
 */
export function MineBadge({ kind, label, count = 1, ariaLabel, onClick, testId }: {
  kind: ScriptureUsageKind;
  label: string;
  /** How many documents of the kind stand there; from 2 it shows on the corner. */
  count?: number;
  ariaLabel?: string;
  onClick?: () => void;
  testId?: string;
}) {
  const { Icon, badge } = USAGE_KIND_LOOK[kind];
  // The number reaches 7 px past the corner: room for it, so it never touches the next badge.
  const room = count > 1 ? 'mr-[7px]' : '';
  const content = (
    <>
      <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${badge.circle}`}>
        <Icon className="h-2.5 w-2.5 text-white" aria-hidden="true" />
      </span>
      {label}
      {count > 1 ? (
        <span
          aria-hidden="true"
          data-testid={testId ? `${testId}-count` : undefined}
          className={`absolute -right-[7px] -top-[7px] h-[14px] min-w-[14px] rounded-full bg-white px-[3px] text-center text-[9px] leading-[14px] ring-1 ring-inset outline outline-[1.5px] outline-white dark:bg-gray-900 dark:outline-gray-900 ${badge.count}`}
        >
          {count}
        </span>
      ) : null}
    </>
  );
  if (!onClick) return <span className={`${CAPSULE} ${badge.capsule} ${room}`} data-testid={testId}>{content}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`${CAPSULE} ${badge.capsule} ${room} transition-[filter] hover:brightness-95 active:brightness-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400`}
    >
      {content}
    </button>
  );
}

/** The badge standing for the rest, "+2": the same capsule, grey, opening the same list. */
export function MineMoreBadge({ count, ariaLabel, onClick, testId }: { count: number; ariaLabel: string; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`${CAPSULE} border-gray-200 bg-gray-50 px-2 text-gray-700 hover:brightness-95 active:brightness-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-gray-700 dark:bg-transparent dark:text-gray-300`}
    >
      {`+${count}`}
    </button>
  );
}
