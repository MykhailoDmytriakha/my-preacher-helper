import { verseWords, type BookText } from '@/utils/bibleText';

import { wordsOfText } from './words';

import type { WordMatcher } from './wordForms';

/**
 * THE WORDS OF A BIBLE, KEPT FOR SEARCH. Every distinct word of the text gets a number once; a verse is
 * kept as the numbers of its words in order. A search then asks the matchers about the distinct words
 * only — some tens of thousands, not the million words of the text — and walks the verses comparing
 * numbers. Typing a letter costs a few milliseconds on a phone, and the work for a word is kept until a
 * new book joins the index. Books join one at a time, in any order, as they arrive (`searchIndexStore.ts`).
 */
/** Word sets kept for the last searches: enough for typing back and forth, a few megabytes at most. */
const KEPT_FLAGS = 48;

export type IndexedVerse = { book: string; chapter: number; verse: number; text: string; words: Uint32Array };
export type VerseHit = { book: string; chapter: number; verse: number; text: string };

export class BibleSearchIndex {
  private readonly vocabulary: string[] = [];
  private readonly ids = new Map<string, number>();
  private readonly books = new Map<string, IndexedVerse[]>();
  private readonly flagsByKey = new Map<string, Uint8Array>();
  private flagsSize = 0;

  /** `order`: the books in the order of the Bible being read — the order results come in. */
  constructor(private readonly order: readonly string[]) {}

  get bookCount(): number {
    return this.books.size;
  }

  has(bookId: string): boolean {
    return this.books.has(bookId);
  }

  addBook(text: BookText): void {
    if (this.books.has(text.id)) return;
    const verses: IndexedVerse[] = [];
    text.chapters.forEach((chapter, c) => chapter.forEach((raw, v) => {
      const plain = verseWords(raw);
      const words = wordsOfText(plain);
      const numbers = new Uint32Array(words.length);
      words.forEach((word, k) => {
        let id = this.ids.get(word);
        if (id === undefined) {
          id = this.vocabulary.length;
          this.vocabulary.push(word);
          this.ids.set(word, id);
        }
        numbers[k] = id;
      });
      verses.push({ book: text.id, chapter: c + 1, verse: v + 1, text: plain, words: numbers });
    }));
    this.books.set(text.id, verses);
  }

  /** A verse's plain text, when its book is in the index. */
  verseText(bookId: string, chapter: number, verse: number): string | null {
    return this.books.get(bookId)?.find((each) => each.chapter === chapter && each.verse === verse)?.text ?? null;
  }

  /** Which distinct words a matcher accepts, as flags by word number; kept until the vocabulary grows. */
  private flagsFor(matcher: WordMatcher): Uint8Array {
    if (this.flagsSize !== this.vocabulary.length) {
      this.flagsByKey.clear();
      this.flagsSize = this.vocabulary.length;
    }
    let flags = this.flagsByKey.get(matcher.key);
    if (flags) {
      // Used again: it moves to the end, away from the next eviction.
      this.flagsByKey.delete(matcher.key);
    } else {
      flags = new Uint8Array(this.vocabulary.length);
      for (let id = 0; id < this.vocabulary.length; id += 1) if (matcher.test(this.vocabulary[id])) flags[id] = 1;
    }
    this.flagsByKey.set(matcher.key, flags);
    // Every prefix typed would keep an array the size of the vocabulary: the oldest go.
    while (this.flagsByKey.size > KEPT_FLAGS) this.flagsByKey.delete(this.flagsByKey.keys().next().value as string);
    return flags;
  }

  /** Whether some word of the text fits the matcher. */
  knows(matcher: WordMatcher): boolean {
    return this.flagsFor(matcher).includes(1);
  }

  /**
   * Every verse with all the words (each in any of its forms) and every phrase (its words in a row), in
   * the Bible's order; `inBooks` narrows to those books.
   */
  search(matchers: readonly WordMatcher[], phrases: readonly (readonly string[])[], inBooks?: ReadonlySet<string> | null): VerseHit[] {
    if (!matchers.length && !phrases.length) return [];
    const flags = matchers.map((matcher) => this.flagsFor(matcher));
    const phraseIds: number[][] = [];
    for (const phrase of phrases) {
      const ids = phrase.map((word) => this.ids.get(word));
      if (ids.some((id) => id === undefined)) return [];
      phraseIds.push(ids as number[]);
    }
    const hits: VerseHit[] = [];
    for (const bookId of this.order) {
      if (inBooks && !inBooks.has(bookId)) continue;
      const verses = this.books.get(bookId);
      if (!verses) continue;
      for (const verse of verses) {
        const { words } = verse;
        if (!flags.every((each) => words.some((id) => each[id] === 1))) continue;
        if (!phraseIds.every((ids) => containsRun(words, ids))) continue;
        hits.push({ book: verse.book, chapter: verse.chapter, verse: verse.verse, text: verse.text });
      }
    }
    return hits;
  }
}

function containsRun(words: Uint32Array, run: readonly number[]): boolean {
  for (let start = 0; start + run.length <= words.length; start += 1) {
    let k = 0;
    while (k < run.length && words[start + k] === run[k]) k += 1;
    if (k === run.length) return true;
  }
  return false;
}
