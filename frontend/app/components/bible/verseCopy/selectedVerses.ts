import type { VerseForCopy } from '@/utils/verseCopy';

export type VerseAt = { chapter: number; verse: number };

export const verseKey = (at: VerseAt): string => `${at.chapter}:${at.verse}`;

/** The verse a row of the ribbon is (`data-verse="8:28"`), or nothing. */
export function verseOfRow(row: Element): VerseAt | null {
  const match = /^(\d+):(\d+)$/.exec(row.getAttribute('data-verse') ?? '');
  return match ? { chapter: Number(match[1]), verse: Number(match[2]) } : null;
}

/** The row of the ribbon under a press, inside `root`, or nothing. */
export function verseRowAt(target: EventTarget | null, root: Element | null): HTMLElement | null {
  if (!root || !(target instanceof Element)) return null;
  const row = target.closest<HTMLElement>('[data-verse]');
  return row && root.contains(row) ? row : null;
}

/**
 * THE VERSES A SELECTION HOLDS — only their words (`data-verse-text`), never the numbers, link chips or badges
 * drawn beside them; a verse the selection starts or ends inside is a piece, and says on which side it was cut.
 */
export function selectedVerses(root: Element, range: Range): VerseForCopy[] {
  const verses: VerseForCopy[] = [];
  for (const row of root.querySelectorAll('[data-verse]')) {
    const at = verseOfRow(row);
    const words = row.querySelector('[data-verse-text]');
    if (!at || !words || !range.intersectsNode(words)) continue;
    const part = document.createRange();
    part.selectNodeContents(words);
    const cutStart = range.compareBoundaryPoints(Range.START_TO_START, part) > 0;
    const cutEnd = range.compareBoundaryPoints(Range.END_TO_END, part) < 0;
    if (cutStart) part.setStart(range.startContainer, range.startOffset);
    if (cutEnd) part.setEnd(range.endContainer, range.endOffset);
    const text = part.toString().replace(/\s+/g, ' ').trim();
    if (text) verses.push({ ...at, words: text, cutStart, cutEnd });
  }
  return verses;
}
