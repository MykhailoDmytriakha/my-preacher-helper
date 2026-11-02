import type { MarkColor, PencilColor } from '@/utils/bibleMarks';

/*
 * THE MARKS' COLOURS ON AN ELEMENT — for words drawn as elements of their own (the window of a verse marked in another
 * Bible, the analysis) and for the legend. The marker's fills are the page's variables (`globals.css`,
 * `--mark-fill-<colour>`, light and dark), the same the reader's bands are drawn in (`markBands.ts`): one place to change
 * a colour. The pencil's lines repeat the colours of `::highlight(bible-mark-pencil-…)` there — kept in step by hand.
 */
export const MARK_FILL_CLASS: Record<MarkColor, string> = {
  red: 'bg-[var(--mark-fill-red)]',
  green: 'bg-[var(--mark-fill-green)]',
  yellow: 'bg-[var(--mark-fill-yellow)]',
  orange: 'bg-[var(--mark-fill-orange)]',
  blue: 'bg-[var(--mark-fill-blue)]',
};

/** A run of marked words as one band, each line of it rounded on its own (the reader's bands look). */
export const MARK_RUN_CLASS = 'rounded-[0.3em] px-[2px] -mx-[2px] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]';

const PENCIL_LINE = 'underline decoration-[1.5px] underline-offset-[0.14em]';

export const PENCIL_LINE_CLASS: Record<PencilColor, string> = {
  gray: `${PENCIL_LINE} decoration-[#8b8f98] dark:decoration-[#9ca3af]`,
  red: `${PENCIL_LINE} decoration-[#e5484d] dark:decoration-[#ff6b6b]`,
  green: `${PENCIL_LINE} decoration-[#30a46c] dark:decoration-[#3dd68c]`,
  yellow: `${PENCIL_LINE} decoration-[#e0b100] dark:decoration-[#ffd60a]`,
  orange: `${PENCIL_LINE} decoration-[#f76b15] dark:decoration-[#ff8b3e]`,
  blue: `${PENCIL_LINE} decoration-[#3e63dd] dark:decoration-[#7b9bff]`,
};

/** The classes of a word under a marker colour and a pencil line, either or both. */
export function wordPaintClass({ color, pencil }: { color: MarkColor | null; pencil: PencilColor | null }): string {
  return [color ? MARK_FILL_CLASS[color] : '', pencil ? PENCIL_LINE_CLASS[pencil] : ''].filter(Boolean).join(' ');
}
