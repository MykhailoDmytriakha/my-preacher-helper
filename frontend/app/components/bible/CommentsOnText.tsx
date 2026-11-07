'use client';

import { CommentIcon } from '@/components/Icons';
import MarkdownDisplay from '@/components/MarkdownDisplay';

import type { Passage } from '@/utils/scriptureReferenceNumbering';

/**
 * A comment drawn on the text: its id for the window that edits it, its words, what a screen reader hears; and, for one on
 * several verses drawn under the last of them, their place — «3:20–21» (the owner, 2026-11-06).
 */
export type TextComment = { id: string; body: string; editLabel: string; passage: Passage; label?: string };

/** Smaller than Scripture and following the reader's text size ("T"), as the verse does (`VERSE_TEXT_STYLE`). */
const COMMENT_TEXT_STYLE = { fontSize: 'calc(0.875rem * var(--text-scale, 1))' };

/**
 * THE PERSON'S COMMENTS ON THE TEXT (case 2026-10-12-block-diagram, 3.2; the owner's board 2026-10-28): under a
 * verse, or under a chapter's heading for one written to the whole chapter, the comment's own words in grey and
 * smaller than Scripture — pencil in a Bible's margin. Pressed, it opens in its window: the grey circle is the
 * button a keyboard and a screen reader reach, a press on the words is the same for a mouse and a finger, and a
 * link in the words (a verse the comment names) keeps its own job.
 */
export function CommentsOnText({ comments, onEdit, testId, className = '', align = 'start' }: {
  comments: readonly TextComment[];
  onEdit: (id: string, passage: Passage) => void;
  testId: string;
  className?: string;
  /** `end` — against the column's right edge, the words right-aligned: a comment on one verse in the reader. */
  align?: 'start' | 'end';
}) {
  // The grey circle: the button a keyboard and a screen reader reach.
  const mark = (comment: TextComment) => (
    <button
      type="button"
      onClick={() => onEdit(comment.id, comment.passage)}
      aria-label={comment.editLabel}
      data-testid={`${testId}-edit-${comment.id}`}
      className={`${comment.label ? '' : 'mt-[0.2em] '}inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400`}
    >
      <CommentIcon className="h-2.5 w-2.5 text-white" />
    </button>
  );
  return (
    <div className={`space-y-1 font-sans ${className}`} style={COMMENT_TEXT_STYLE} data-testid={testId}>
      {comments.map((comment) => (
        <div
          key={comment.id}
          // The whole comment — its mark, place and words — is what is brought into sight after a save (`readerSight.ts`).
          data-comment={comment.id}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a, button')) return;
            onEdit(comment.id, comment.passage);
          }}
          className={`-mx-1 flex cursor-pointer items-start gap-2 rounded-md px-1 py-0.5 leading-[1.55] text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-300 ${align === 'end' ? 'justify-end' : ''}`}
        >
          {comment.label ? (
            // The mark and the place, one short line over the words, both at the words' edge: one comment reads as one piece.
            // Before, the mark stood at the start of the place's line and the place at its far end — read as a third thing —
            // and with the place beside the words, words that wrapped left the place stranded (visual pass, 2026-11-07).
            <div className={`min-w-0 flex-1 ${align === 'end' ? 'text-right' : ''}`}>
              <div className={`flex items-center gap-2 ${align === 'end' ? 'justify-end' : ''}`}>
                {mark(comment)}
                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500" data-comment-place="">{comment.label}</span>
              </div>
              <MarkdownDisplay pencil content={comment.body} className="min-w-0" />
            </div>
          ) : (
            <>
              {mark(comment)}
              <MarkdownDisplay pencil content={comment.body} className={align === 'end' ? 'min-w-0 text-right' : 'min-w-0 flex-1'} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
