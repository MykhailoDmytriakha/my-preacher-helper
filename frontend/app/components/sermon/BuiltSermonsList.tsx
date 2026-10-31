'use client';

import { BookOpenIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { type ReactNode } from 'react';

import { formatDateOnly } from '@/utils/dateFormatter';
import { NOTE_TO_SERMON_COLORS, SOURCE_NOTE_COLORS } from '@/utils/themeColors';

import type { Sermon } from '@/models/models';

/**
 * WHAT TELLS TWO SERMONS FROM THE SAME NOTE APART.
 *
 * A note is usually preached under one theme, so the titles of the sermons grown out of it
 * open with the same words and, cut to the width of a 232px column, read as duplicates of
 * one another. The passage is what actually differs — it is chosen per sermon at the moment
 * the sermon is born — so it leads the line and the date follows. A sermon with no verse yet
 * simply shows the date: the separator never appears on its own.
 */
const sermonMetaLine = (sermon: Sermon): string =>
  [sermon.verse?.replace(/\s+/g, ' ').trim(), formatDateOnly(sermon.date)].filter(Boolean).join(' · ');

/**
 * THE SERMONS BUILT ON A NOTE, IN A SIDE PANEL — one look wherever a note's sermons are listed: a study note's page
 * and an analysis's page in the Bible (the owner, 2026-10-31: «что-то похожее у нас есть в заметках»).
 *
 * A heading with an icon and the count, then the sermons, then the caller's door to make a new one. The heading stays
 * even when the list is empty, so the section reads the same everywhere and the door is never an orphaned button.
 * Rows carry the SERMONS accent (blue): the colour says where the click goes. The name owns the row — full width, up
 * to two lines; verse and date step down to a quieter second line. A screen that leaves its own way (the Bible reader
 * keeps the way back) passes `onOpen`; otherwise a row is a link.
 */
export function BuiltSermonsList({ title, sermons, empty, openLabel, onOpen, testId, children }: {
  title: string;
  sermons: Sermon[];
  empty: string;
  openLabel: (title: string) => string;
  onOpen?: (href: string) => void;
  testId: string;
  /** The door to a new sermon, under the list. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <div className={`flex items-center gap-2 ${SOURCE_NOTE_COLORS.reverseHeading}`}>
        <BookOpenIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium">{title}</span>
        {sermons.length > 0 && (
          <span
            data-testid="built-sermons-count"
            aria-hidden="true"
            className={`shrink-0 rounded-full px-1.5 text-[11px] font-semibold leading-4 ${NOTE_TO_SERMON_COLORS.builtCount}`}
          >
            {sermons.length}
          </span>
        )}
      </div>

      {sermons.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {sermons.map((sermon) => {
            const href = `/sermons/${sermon.id}`;
            const className = `flex w-full min-w-0 flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${NOTE_TO_SERMON_COLORS.builtRow}`;
            const body = (
              <>
                <span data-testid="built-sermon-title" className={`line-clamp-2 text-sm font-medium leading-[18px] ${NOTE_TO_SERMON_COLORS.builtRowTitle}`}>
                  {sermon.title}
                </span>
                <span data-testid="built-sermon-meta" className={`truncate text-[11px] leading-4 ${NOTE_TO_SERMON_COLORS.builtRowMeta}`}>
                  {sermonMetaLine(sermon)}
                </span>
              </>
            );
            return (
              <li key={sermon.id} className="min-w-0">
                {onOpen ? (
                  <button type="button" onClick={() => onOpen(href)} data-testid="built-sermon-link" aria-label={openLabel(sermon.title)} className={className}>
                    {body}
                  </button>
                ) : (
                  <Link href={href} data-testid="built-sermon-link" aria-label={openLabel(sermon.title)} className={className}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-0.5 text-xs leading-4 text-gray-400 dark:text-gray-500" data-testid="built-sermons-empty">
          {empty}
        </p>
      )}

      {children}
    </div>
  );
}
