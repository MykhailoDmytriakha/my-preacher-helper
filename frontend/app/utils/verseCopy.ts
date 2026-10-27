/*
 * A VERSE TAKEN OUT OF THE BIBLE — the text a copy or a send carries, made from the verses themselves and never
 * from what the page shows around them (numbers, link chips, badges). The owner, 2026-10-27: a verse is copied
 * to make a sermon of it, to send it to someone as a wish, or to take a few verses while preparing. So one verse
 * goes as a quote with its place and its Bible, several as the place and the verses numbered.
 *
 *   «Притом знаем, что любящим Бога… ко благу.»
 *   — Рим 8:28 (Синодальный перевод)
 *
 *   Рим 8:28–30 (Синодальный перевод)
 *   28 Притом знаем…
 *   29 Ибо кого Он предузнал…
 *
 * A quote looks whole: where the words start in the middle of a sentence (a small letter, or a piece cut from a
 * verse) it opens with «…», and where they stop at a comma or are cut it ends with «…». The words of Scripture
 * are never changed otherwise.
 */

export type CopyFormat = 'quote' | 'numbered';

/** One verse as it goes into a copy; a piece of a verse says on which side it was cut. */
export type VerseForCopy = { chapter: number; verse: number; words: string; cutStart?: boolean; cutEnd?: boolean };

/** The book as the Bible's own language shortens it, the Bible's own name, and the quotation marks of its language. */
export type CopyNames = { book: string; bible: string; quotes: readonly [string, string] };

const QUOTES: Record<'ru' | 'uk' | 'en', readonly [string, string]> = { ru: ['«', '»'], uk: ['«', '»'], en: ['“', '”'] };

export const quotesFor = (language: 'ru' | 'uk' | 'en'): readonly [string, string] => QUOTES[language];

/** One verse goes as a quote, several as numbered verses: the person changes it in the bar. */
export const defaultCopyFormat = (count: number): CopyFormat => (count === 1 ? 'quote' : 'numbered');

const ELLIPSIS = '…';

const inOrder = <T extends { chapter: number; verse: number }>(verses: readonly T[]): T[] => {
  const seen = new Map<string, T>();
  for (const verse of verses) seen.set(`${verse.chapter}:${verse.verse}`, verse);
  return [...seen.values()].sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);
};

/** How many verses a chapter has, where the caller knows: a chapter's last verse is then followed by the next chapter's first. */
export type ChapterLength = (chapter: number) => number | undefined;

/** Verses that follow each other make one run; without `chapterLength` a run stays within its chapter. */
function runsOf<T extends { chapter: number; verse: number }>(verses: readonly T[], chapterLength?: ChapterLength): T[][] {
  const runs: T[][] = [];
  for (const verse of inOrder(verses)) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    const follows = last && (last.chapter === verse.chapter
      ? last.verse + 1 === verse.verse
      : last.chapter + 1 === verse.chapter && verse.verse === 1 && chapterLength?.(last.chapter) === last.verse);
    if (follows) run.push(verse);
    else runs.push([verse]);
  }
  return runs;
}

/** «Рим 8:28», «Рим 8:28–30, 32», «Рим 8:38–39; 9:1–2». */
export function copiedPlace(book: string, verses: readonly { chapter: number; verse: number }[]): string {
  const chapters: string[] = [];
  let chapter: number | null = null;
  let parts: string[] = [];
  const close = () => { if (chapter !== null) chapters.push(`${chapter}:${parts.join(', ')}`); };
  for (const run of runsOf(verses)) {
    const first = run[0];
    if (first.chapter !== chapter) {
      close();
      chapter = first.chapter;
      parts = [];
    }
    const last = run[run.length - 1];
    parts.push(last.verse === first.verse ? String(first.verse) : `${first.verse}–${last.verse}`);
  }
  close();
  return `${book} ${chapters.join('; ')}`;
}

/** The words of a run made to look whole where they start or stop in the middle of a sentence. */
function whole(words: string, cutStart: boolean, cutEnd: boolean): string {
  let text = words.replace(/\s+/g, ' ').trim();
  const opensMidSentence = cutStart || /^\p{Ll}/u.test(text);
  const stopsMidSentence = cutEnd || /[\p{L}\p{N},;:—–-]$/u.test(text);
  if (stopsMidSentence) text = `${text.replace(/[\s,;:—–-]+$/u, '')}${ELLIPSIS}`;
  return `${opensMidSentence ? ELLIPSIS : ''}${text}`;
}

const placeLine = (verses: readonly VerseForCopy[], names: CopyNames) => `${copiedPlace(names.book, verses)} (${names.bible})`;

export function verseCopyText(verses: readonly VerseForCopy[], format: CopyFormat, names: CopyNames, chapterLength?: ChapterLength): string {
  const runs = runsOf(verses, chapterLength);
  if (runs.length === 0) return '';
  const [open, shut] = names.quotes;
  if (format === 'quote') {
    const body = runs
      .map((run) => whole(run.map((verse) => verse.words).join(' '), Boolean(run[0].cutStart), Boolean(run[run.length - 1].cutEnd)))
      // A gap between runs is said, unless the next run already opens with «…».
      .map((text, index) => (index > 0 && !text.startsWith(ELLIPSIS) ? `${ELLIPSIS} ${text}` : text))
      .join(' ');
    return `${open}${body}${shut}\n— ${placeLine(verses, names)}`;
  }
  const severalChapters = new Set(verses.map((verse) => verse.chapter)).size > 1;
  const lines = [placeLine(verses, names)];
  runs.forEach((run, index) => {
    if (index > 0) lines.push(ELLIPSIS);
    for (const verse of run) {
      const number = severalChapters ? `${verse.chapter}:${verse.verse}` : String(verse.verse);
      const words = verse.words.replace(/\s+/g, ' ').trim();
      lines.push(`${number} ${verse.cutStart ? ELLIPSIS : ''}${words}${verse.cutEnd ? ELLIPSIS : ''}`);
    }
  });
  return lines.join('\n');
}
