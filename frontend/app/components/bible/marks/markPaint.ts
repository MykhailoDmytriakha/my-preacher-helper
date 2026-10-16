import type { MarkColor, PencilColor } from '@/utils/bibleMarks';

/*
 * THE MARKS' COLOURS ON AN ELEMENT — for words drawn as elements of their own (the window of a verse
 * marked in another Bible) and for the legend. Over the reader's text the browser paints the same
 * colours itself (`globals.css`, `::highlight(bible-mark-…)`): a colour changed here changes there too.
 */
export const MARK_FILL_CLASS: Record<MarkColor, string> = {
  red: 'bg-[#fdd8d8] dark:bg-[rgba(255,107,107,0.30)]',
  green: 'bg-[#d3f2df] dark:bg-[rgba(61,214,140,0.26)]',
  yellow: 'bg-[#fff0a0] dark:bg-[rgba(255,214,10,0.30)]',
  orange: 'bg-[#ffdcc2] dark:bg-[rgba(255,139,62,0.30)]',
  blue: 'bg-[#d9e2fc] dark:bg-[rgba(123,155,255,0.32)]',
};

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
