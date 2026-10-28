'use client';

import { useTranslation } from 'react-i18next';

import { useOpenStoredReference } from '@/components/bible/useOpenStoredReference';
import { CommentIcon } from '@/components/Icons';
import { relativeDay } from '@/utils/relativeDay';
import MarkdownDisplay from '@components/MarkdownDisplay';

import ScriptureRefBadge from './ScriptureRefBadge';

import type { StudyNote } from '@/models/models';

/**
 * A COMMENT IN STUDIES (case 2026-10-12-block-diagram, 3.2): no title — a comment is a few sentences, so the card is
 * its own words, the place it is written to and when it was touched. Grey like the pencil it is; pressed, it opens in
 * the comment's window, where alone it is edited (the owner, 2026-10-28). A link in its words and its place keep their
 * own job: the place opens its verse over the page, as a note's does (the owner, 2026-10-28).
 */
export function CommentCard({ note, searchQuery, onOpen }: { note: StudyNote; searchQuery?: string; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const openReference = useOpenStoredReference();
  return (
    <article
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a, button')) return;
        onOpen(note.id);
      }}
      className="flex cursor-pointer gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
      data-testid={`comment-card-${note.id}`}
    >
      <button
        type="button"
        onClick={() => onOpen(note.id)}
        aria-label={t('comment.open')}
        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <CommentIcon className="h-3.5 w-3.5 text-white" />
      </button>
      <div className="min-w-0 flex-1">
        <MarkdownDisplay pencil content={note.content} searchQuery={searchQuery} className="text-[15px] leading-relaxed text-gray-700 dark:text-gray-200" />
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {note.scriptureRefs.map((reference) => (
            <ScriptureRefBadge
              key={reference.id}
              reference={reference}
              tone="neutral"
              onClick={(event) => {
                // A pressable chip is not a <button>: the card would take the press as «open the comment» too.
                event.stopPropagation();
                openReference(reference);
              }}
            />
          ))}
          <span>{relativeDay(note.updatedAt, t)}</span>
        </div>
      </div>
    </article>
  );
}
