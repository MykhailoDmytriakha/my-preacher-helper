'use client';

import { RectangleStackIcon } from '@heroicons/react/20/solid';

import { CommentIcon, ParagraphIcon } from '@/components/Icons';
import { COMMENT_SENTENCES, measureComment } from '@/utils/commentLength';
import { useTranslation } from '@locales/useTranslation';

/**
 * THE WAY FROM A COMMENT TO A NOTE (the owner, 2026-10-28: «эта полоска должна показывать от чего-то до заметки…
 * от серого постепенно зеленеть»): the comment's grey mark at one end, the note's green one at the other, the
 * line filling from grey to green as the person writes. Its unit is the way itself, so it needs no number; a
 * screen reader hears the count (`utils/commentLength.ts`). Written as a paragraph, its start is the paragraph's:
 * the window's title says «Абзац», and one thing has one name in the window (case 2026-11-06-comment-paragraph).
 */
export function CommentWayBar({ text, paragraph = false }: { text: string; paragraph?: boolean }) {
  const { t } = useTranslation();
  const { sentences, share, isNote } = measureComment(text);
  const label = isNote ? t('comment.wayNote') : t('comment.wayLabel', { count: Math.min(COMMENT_SENTENCES, Math.round(sentences)), total: COMMENT_SENTENCES });
  const StartIcon = paragraph ? ParagraphIcon : CommentIcon;
  return (
    <div className="flex items-center gap-2" data-testid="comment-way">
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-500"><StartIcon className="h-2.5 w-2.5 text-white" /></span>
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{paragraph ? t('comment.kind.paragraph') : t('studiesWorkspace.type.comment')}</span>
      <div role="img" aria-label={label} className="relative h-1 flex-1 overflow-hidden rounded-full bg-gradient-to-r from-[#8b8f98] to-emerald-600 dark:from-gray-400 dark:to-emerald-400">
        <div className="absolute inset-y-0 right-0 bg-gray-200 transition-[width] duration-200 dark:bg-gray-700" style={{ width: `${Math.round((1 - share) * 100)}%` }} data-testid="comment-way-rest" />
      </div>
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600"><RectangleStackIcon className="h-2.5 w-2.5 text-white" aria-hidden="true" /></span>
      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{t('studiesWorkspace.type.note')}</span>
    </div>
  );
}

/** «Комментарий | Абзац» at the top of the window: what the comment is in the reader. */
export function CommentKindSwitch({ paragraph, onChange, disabled }: { paragraph: boolean; onChange: (paragraph: boolean) => void; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t('comment.kind.label')} className="flex gap-0.5 rounded-xl bg-gray-100 p-[3px] dark:bg-gray-950" data-testid="comment-kind">
      {([false, true] as const).map((one) => (
        <button
          key={String(one)}
          type="button"
          aria-pressed={paragraph === one}
          disabled={disabled}
          onClick={() => onChange(one)}
          className={`h-8 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-semibold disabled:opacity-50 ${paragraph === one
            ? 'bg-white text-gray-900 shadow-sm dark:bg-indigo-600 dark:text-white'
            : 'text-gray-600 dark:text-gray-300'}`}
        >
          {t(one ? 'comment.kind.paragraph' : 'comment.kind.comment')}
        </button>
      ))}
    </div>
  );
}
