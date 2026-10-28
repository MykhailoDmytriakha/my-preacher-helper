import { countWords } from './noteCutCorridor';

/**
 * HOW FAR A COMMENT IS FROM BEING A NOTE — the one rule the comment window's bar and anything else that measures
 * a comment ask. A comment holds about five sentences (the owner, 2026-10-28: «ограничены количеством символов,
 * где-то 5 предложений. если больше то это уже изучения»); past that it is a note.
 *
 * Sentences are counted by words, not by full stops — dictated text often has none: about twelve words make one.
 * A list item counts as at least one sentence, so a list of ten one-word items is not "short": under a verse it
 * would still stand ten lines tall.
 */
export const COMMENT_SENTENCES = 5;
export const WORDS_PER_SENTENCE = 12;

const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+/;
/** The mark that opens a list item or a quote, with or without the space after it. */
const LIST_MARK = /^\s*(?:[-*+•>]|\d+[.)])(?:\s+|$)/;

export type CommentLength = {
  /** Sentences written, a fraction for a part of one. */
  sentences: number;
  /** The way from a comment to a note, 0 to 1 — the bar's fill. */
  share: number;
  /** Past five sentences: this is a note now. */
  isNote: boolean;
};

export function measureComment(markdown: string): CommentLength {
  const sentences = (markdown || '').split('\n').reduce((sum, line) => {
    // Words in `code` stand under the verse like any others: the shared counter skips code, a comment's length may not.
    // A list's own mark is no word: «1.» of an emptied numbered item counted as one and let «1.» be saved.
    const words = countWords(line.replace(LIST_MARK, '').replace(/`/g, ' '));
    if (!words) return sum;
    return sum + (LIST_ITEM.test(line) ? Math.max(1, words / WORDS_PER_SENTENCE) : words / WORDS_PER_SENTENCE);
  }, 0);
  return { sentences, share: Math.min(1, sentences / COMMENT_SENTENCES), isNote: sentences > COMMENT_SENTENCES };
}
