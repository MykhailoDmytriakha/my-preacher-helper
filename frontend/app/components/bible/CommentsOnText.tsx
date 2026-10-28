'use client';

import { CommentIcon } from '@/components/Icons';
import MarkdownDisplay from '@/components/MarkdownDisplay';

/** A comment drawn on the text: its id for the window that edits it, its words, what a screen reader hears. */
export type TextComment = { id: string; body: string; editLabel: string };

/** Smaller than Scripture and following the reader's text size ("T"), as the verse does (`VERSE_TEXT_STYLE`). */
const COMMENT_TEXT_STYLE = { fontSize: 'calc(0.875rem * var(--text-scale, 1))' };

/**
 * THE PERSON'S COMMENTS ON THE TEXT (case 2026-10-12-block-diagram, 3.2; the owner's board 2026-10-28): under a
 * verse, or under a chapter's heading for one written to the whole chapter, the comment's own words in grey and
 * smaller than Scripture — pencil in a Bible's margin. Pressed, it opens in its window: the grey circle is the
 * button a keyboard and a screen reader reach, a press on the words is the same for a mouse and a finger, and a
 * link in the words (a verse the comment names) keeps its own job.
 */
export function CommentsOnText({ comments, onEdit, testId, className = '' }: {
  comments: readonly TextComment[];
  onEdit: (id: string) => void;
  testId: string;
  className?: string;
}) {
  return (
    <div className={`space-y-1 font-sans ${className}`} style={COMMENT_TEXT_STYLE} data-testid={testId}>
      {comments.map((comment) => (
        <div
          key={comment.id}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a, button')) return;
            onEdit(comment.id);
          }}
          className="-mx-1 flex cursor-pointer items-start gap-2 rounded-md px-1 py-0.5 leading-[1.55] text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-300"
        >
          <button
            type="button"
            onClick={() => onEdit(comment.id)}
            aria-label={comment.editLabel}
            data-testid={`${testId}-edit-${comment.id}`}
            className="mt-[0.2em] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <CommentIcon className="h-2.5 w-2.5 text-white" />
          </button>
          <MarkdownDisplay pencil content={comment.body} className="min-w-0 flex-1" />
        </div>
      ))}
    </div>
  );
}
