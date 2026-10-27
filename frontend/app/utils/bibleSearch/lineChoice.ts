import { BIBLES } from '@/utils/bibles';

import { fromEnglishLayout } from './keyboardLayout';
import { readBooksBegun, readLine, type BooksBegunLine, type LineContext, type LineReading } from './query';
import { scopeBookIds, type SearchAnswer } from './results';

/** The books a line's first letters may stand for, how many verses that reading finds, and whether it is the one shown. */
export type BooksBegun = BooksBegunLine & { found: number; chosen: boolean };

export type LineChoice = {
  reading: LineReading;
  answer: SearchAnswer | null;
  /** The line as read after turning the English layout, when it was typed so. */
  layoutFixed: string | null;
  booksBegun: BooksBegun | null;
};

/** How a line is answered, and whether the Bible has a word as written (`isBibleWord`). */
export type Answering = { answerFor: (reading: LineReading) => SearchAnswer | null; isWord: (word: string) => boolean };

const hitsOf = (answer: SearchAnswer | null): number => answer?.hits.length ?? 0;

/** The books a reading stands in: its scope's, or its place's. */
function booksOf(reading: LineReading): readonly string[] {
  if (reading.kind === 'search' || reading.kind === 'booksChapter') return reading.query.scope ? scopeBookIds(reading.query.scope) : [];
  if (reading.kind === 'books' || reading.kind === 'part') return reading.scope.bookIds;
  return 'bookId' in reading ? [reading.bookId] : [];
}

/**
 * Which reading of a line is shown: the line as written, unless another reading of it is what the person meant.
 * - With the books its first letters begin, when the letters are no word of the Bible and the books hold something
 *   for the rest: «корин душ» is 1 and 2 Corinthians, «корин 13:4» their place (the owner, 2026-10-27). A word the
 *   Bible has is never taken for a book's first letters — «Иисус сказал», «Петр сказал», «Мф иисус сказал» search the
 *   name: counting verses would choose the books, since a word made a book is one word fewer to find (Codex review,
 *   2026-10-27). The other reading stays a tap away; one read as words by the person's choice keeps the books only
 *   as that way back.
 * - With the English layout turned, when as typed it means nothing: «ghbn» is «прит».
 * One rule for the line shown and for the count its history keeps.
 */
export function chooseReading(text: string, context: LineContext, { answerFor, isWord }: Answering): LineChoice {
  let reading = readLine(text, context);
  let answer = answerFor(reading);
  let booksBegun: BooksBegun | null = null;
  const begun = reading.kind === 'search' ? readBooksBegun(text, context.bible) : null;
  if (begun && !begun.said.split(' ').some(isWord)) {
    const second = readLine(begun.line, { ...context, asWords: false });
    // The line written with the books reads them and no other: «corin judg» must not make «Judg» a third book.
    const holds = booksOf(second).join() === begun.bookIds.join();
    const secondAnswer = holds ? answerFor(second) : null;
    const meant = holds && (hitsOf(secondAnswer) > 0 || (second.kind !== 'search' && (begun.place || hitsOf(answer) === 0)));
    const chosen = !context.asWords && meant;
    booksBegun = { ...begun, found: hitsOf(secondAnswer), chosen };
    if (chosen) {
      reading = second;
      answer = secondAnswer;
    }
  }
  const language = BIBLES[context.bible].language;
  const turned = language === 'en' ? null : fromEnglishLayout(text, language);
  if (turned && reading.kind === 'search' && !reading.prefixBooks.length && hitsOf(answer) === 0) {
    const second = readLine(turned, context);
    const secondAnswer = answerFor(second);
    if (second.kind !== 'search' || second.prefixBooks.length || hitsOf(secondAnswer) > 0) {
      return { reading: second, answer: secondAnswer, layoutFixed: turned, booksBegun: null };
    }
  }
  return { reading, answer, layoutFixed: null, booksBegun };
}
