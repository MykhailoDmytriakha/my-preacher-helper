'use client';

import { ArrowRightIcon } from '@heroicons/react/24/outline';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { ScratchNote } from '@/models/models';

/**
 * WHAT THE THOUGHTS BLOCK SAYS WHEN THE SERMON HAS NO THOUGHTS YET.
 *
 * The old answer was one line — "Нет мыслей для этой проповеди" — and on a sermon born from a
 * study note that line is FALSE. Measured on a real one: zero thoughts, twenty-two scratch atoms
 * cut from the note, and a 37 000-character study behind a chip. The block was reporting an empty
 * ARRAY and the reader was hearing "this sermon is empty". Every container on this screen has the
 * same habit — `SourceNoteChips` returns null, the plan screen prints the same string — so the
 * rule here is narrow and worth stating: an empty state describes the WORK, not the field.
 *
 * Three variants exist because the strongest one crosses a line the app draws on purpose. The
 * sermon screen has three rooms (classic · scratch · prep) and "classic" has always meant
 * thoughts only; `atoms` puts scratch material into it. That is the owner's call, not ours, so
 * `now` (the old line, kept to compare against) and `invite` (a calm pointer that keeps the rooms
 * apart) stay selectable. Remove the rejected ones once he has chosen — keeping a variant nobody
 * picked is how a component grows a second personality.
 */
export type ThoughtsEmptyVariant = 'now' | 'invite' | 'atoms';

/** Above this many atoms the block stops being a preview and becomes the scratch room. */
const ATOM_PREVIEW_LIMIT = 6;

interface ThoughtsEmptyStateProps {
  /** Only the atoms this block still owns — the ones the note above does not show. */
  scratchNotes: ScratchNote[];
  /** Switches the screen to the scratch room. Absent when there is nothing to sort. */
  onOpenScratch?: () => void;
}

const QUIET_LINK =
  'inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline dark:text-blue-400';

const ThoughtsEmptyState: React.FC<ThoughtsEmptyStateProps> = ({
  scratchNotes,
  onOpenScratch,
}) => {
  const { t } = useTranslation();
  const atomCount = scratchNotes.length;

  /**
   * Atoms that belong to a linked note are NOT listed here — the note above shows each of them
   * under the section it was cut from. What can still land here is an atom with no note behind
   * it, written straight into the scratch room; it has nowhere else to live.
   */
  if (atomCount > 0) {
    return (
      <div data-testid="thoughts-empty-atoms">
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <span>{t('sermon.materialEmpty.atomsBandNoNote')}</span>
          {/* The number lives in a badge, never inside the sentence: Russian would need a
              different case for 1, 2 and 22, and a phrase built by interpolation gets one
              of them wrong every time. */}
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
            {atomCount}
          </span>
        </p>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3" style={{ alignItems: 'start' }}>
          {scratchNotes.slice(0, ATOM_PREVIEW_LIMIT).map((note) => (
            <div
              key={note.id}
              className="rounded-lg border border-l-[3px] border-gray-200 border-l-violet-300 bg-white p-3 dark:border-gray-700 dark:border-l-violet-800 dark:bg-gray-800"
            >
              <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{note.text}</p>
            </div>
          ))}
        </div>
        {onOpenScratch && (
          <div className="mt-3.5">
            <button type="button" onClick={onOpenScratch} className={QUIET_LINK} data-testid="thoughts-empty-sort">
              {t('sermon.materialEmpty.sortAtoms')}
              <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    );
  }

  /** An ordinary new sermon: nothing anywhere yet. */
  return (
    <div
      data-testid="thoughts-empty-plain"
      className="rounded-lg border border-gray-200 bg-gray-50 p-5 dark:border-gray-700 dark:bg-gray-800/60"
    >
      <p className="font-semibold text-gray-900 dark:text-gray-100">{t('sermon.materialEmpty.plain')}</p>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('sermon.materialEmpty.plainHint')}</p>
    </div>
  );
};

export default ThoughtsEmptyState;
