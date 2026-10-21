import { textLanguage, type AppLocale } from '@/utils/appLocale';
import { getBookById } from '@/utils/bibleBooks';
import { BIBLES } from '@/utils/bibles';
import { bookSlug } from '@/utils/bibleText';
import { referenceBibleFor, sameScriptureReference, withStoredBible } from '@/utils/scriptureReferenceNumbering';
import { bookNameLanguages, exactBook, parseReferenceText } from '@/utils/scriptureReferenceParser';
import { chapterCount, verseCount } from '@/utils/versification';

import type { BibleId } from '@/utils/bibles';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

/**
 * A SCRIPTURE REFERENCE AS A PLACE TO OPEN — the one door from any screen into the Bible.
 *
 * `/bible?book=romans&at=16:21&to=21&tr=rst&from=/studies/abc`
 * - `at`   — the verse the book opens at; a whole chapter opens at its heading and marks nothing;
 * - `to`   — the last verse of the passage in that chapter: `at`…`to` are lit on arrival;
 * - `tr`   — the Bible the numbers are in; the reader finds the place in the Bible it reads
 *            (`utils/versification`), so a screen never renumbers a reference itself;
 * - `from` — the screen the reference was tapped on: the reader's way back.
 *
 * Screens build the address here and the Bible page reads it here; neither spells the query.
 */

/**
 * A path inside the app, or nothing: a way back never leads off the app. Judged the way the router
 * will read it — as a URL against this origin: a browser drops tabs and newlines and takes a
 * backslash for a slash, so "/\t/evil.example" and "/\\evil.example" lead to another host while
 * starting with one slash. What is given back is the normalized path, and it must still start with
 * one slash: "/a/..//evil.example" normalizes to "//evil.example", another host again.
 */
export function wayBackPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/')) return null;
  const origin = 'https://app.invalid';
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.pathname.startsWith('//')) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** What the way back leads to, by the screen's address — the reader names it. */
export type WayBackKind = 'note' | 'notes' | 'plan' | 'sermon' | 'group' | 'order' | 'page';

export function wayBackKind(path: string): WayBackKind {
  if (/^\/studies\/[^/?#]+/.test(path)) return 'note';
  if (/^\/studies(?:[/?#]|$)/.test(path)) return 'notes';
  if (/^\/sermons\/[^/?#]+\/plan(?:[/?#]|$)/.test(path)) return 'plan';
  if (/^\/sermons\//.test(path)) return 'sermon';
  if (/^\/groups\//.test(path)) return 'group';
  if (/^\/care\/orders\//.test(path)) return 'order';
  return 'page';
}

/** `to` of the address: the last verse of the passage, or null. */
export function parsePassageEnd(value: string | null | undefined): number | null {
  const match = /^(\d{1,3})$/.exec(value ?? '');
  const verse = match ? Number(match[1]) : 0;
  return verse > 0 ? verse : null;
}

/**
 * A reference typed as one line — "Ин 3:16", "Пс 22", "Иуд 3" — numbered in `bible`, or null when
 * it names no book. The number after a book of one chapter is its verse: "Иуд 3" is Jude 1:3.
 * Whether the chapter and verse exist is the reader's check.
 */
export function referenceFromText(raw: string, bible: BibleId): (ScriptureRefShape & { bible: BibleId }) | null {
  // Digits alone are no reference: the parser would take "3" for the start of "3 John".
  if (!/\p{L}/u.test(raw)) return null;
  // Read in the language of its Bible: "1Цар" is 1 Samuel in the Synodal, 1 Kings in Ohienko.
  const parsed = parseReferenceText(raw.trim(), { locale: BIBLES[bible].language });
  const book = parsed ? getBookById(parsed.book) : undefined;
  if (!parsed || !book) return null;
  const place = parsed.chapter && !parsed.fromVerse && chapterCount(bible, book.id) === 1
    ? { chapter: 1, fromVerse: parsed.chapter, toVerse: parsed.toChapter }
    : { chapter: parsed.chapter, toChapter: parsed.toChapter, fromVerse: parsed.fromVerse, toVerse: parsed.toVerse };
  // Only the numbers it has: a reference may be kept as it is read, and a store refuses an empty field.
  const numbers = Object.fromEntries(Object.entries(place).filter(([, value]) => value !== undefined)) as Partial<typeof place>;
  return { bible, book: book.id, ...numbers };
}

export type BibleLinkOptions = {
  /** The interface language: the Bible a reference that names none was typed in. */
  locale: AppLocale;
  /**
   * The language of the text a typed reference stands in (`textLanguage`), when its letters say it:
   * it decides a book Russian and Ukrainian write alike ("1Цар"), before the interface does.
   */
  written?: AppLocale | null;
  /** The screen the reference is on, for the way back. */
  from?: string;
};

/** The address that opens a stored reference in the Bible, or null when its book is unknown. */
export function bibleHref(ref: ScriptureRefShape, { locale, from }: BibleLinkOptions): string | null {
  if (!getBookById(ref.book)) return null;
  // A reference written before Bibles were kept is read as the interface typed it then.
  const stored = ref.bible ? ref : withStoredBible(ref, locale);
  const query = new URLSearchParams({ book: bookSlug(stored.book) });
  if (stored.chapter) {
    query.set('at', `${stored.chapter}:${stored.fromVerse ?? 1}`);
    // A verse wins over a leftover chapter range, as when the reference is printed.
    if (stored.fromVerse) {
      const last = stored.toVerse !== undefined && stored.toVerse >= stored.fromVerse ? stored.toVerse : stored.fromVerse;
      query.set('to', String(last));
    }
    query.set('tr', stored.bible ?? referenceBibleFor(locale));
  }
  const back = wayBackPath(from);
  if (back) query.set('from', back);
  return `/bible?${query.toString()}`;
}

/**
 * THE LANGUAGE A TYPED REFERENCE IS WRITTEN IN, and so its Bible (the owner, 2026-10-20): its book's
 * name says it when one language alone writes the book so — "Ps" English, "Иоил" Russian, "Йоїл"
 * Ukrainian. Where Russian and Ukrainian write it alike ("Пс", "1Цар" — 1 Samuel in Russian, 1 Kings in
 * Ukrainian) the words of the document it stands in decide (`written`; "the document's words decide",
 * the owner on the case canvas), and then the interface. A Russian sermon read under
 * an English interface keeps its "Пс 22:1" the Shepherd's psalm, Ps 23:1 of the King James.
 */
function writtenLanguage(name: string, locale: AppLocale, written?: AppLocale | null): AppLocale {
  const known = bookNameLanguages(name);
  if (known.length === 1) return known[0];
  // A spelling the book table does not hold ("Псал", "Иоанн") still has its alphabet.
  const languages: AppLocale[] = known.length ? known : /\p{Script=Cyrillic}/u.test(name) ? ['ru', 'uk'] : ['en'];
  const fits = (each: AppLocale | null | undefined): each is AppLocale => !!each && languages.includes(each);
  return [written, locale].find(fits) ?? languages[0];
}

/** A reference's book name: the words before its numbers. */
const bookNameIn = (raw: string): string => {
  const numbers = NUMBERS_AFTER_BOOK.exec(raw);
  return (numbers ? raw.slice(0, numbers.index) : raw).trim();
};

/** Typed text read in the Bible it was written in; a dash between verses may be typed long ("9–10"). */
const typedReference = (raw: string, locale: AppLocale, written?: AppLocale | null) => {
  const text = raw.replace(/[–—]/g, '-');
  return referenceFromText(text, referenceBibleFor(writtenLanguage(bookNameIn(text), locale, written)));
};

/** Typed text as a reader of the interface takes its letters: in their own language and Bible. */
const readersReading = (raw: string, locale: AppLocale) => referenceFromText(raw.replace(/[–—]/g, '-'), referenceBibleFor(locale));

/**
 * The Bible a typed reference was written in, where a reader of the interface, taking its letters in
 * their own language and Bible, would land elsewhere — a Synodal "Пс 22:1" for an English reader
 * (Ps 23:1 there), a Ukrainian "1Цар 3:5" for a Russian one (3 Kings there); else nothing. The screen
 * marks the reference with it (`WrittenInMark`).
 */
export function writtenInFor(raw: string, reference: ScriptureRefShape & { bible: BibleId }, locale: AppLocale): BibleId | undefined {
  const asRead = readersReading(raw, locale);
  return !asRead || !namesAPlace(asRead) || !sameScriptureReference(asRead, reference) ? reference.bible : undefined;
}

/**
 * A reference kept as typed text — a block's passage, one typed into a note's field — read in the Bible
 * it was written in: its book's name, then the document's words (`written`), then the interface. Null
 * when it is not one.
 */
export function referenceFromTyped(raw: string, options: Pick<BibleLinkOptions, 'locale' | 'written'>) {
  return typedReference(raw, options.locale, options.written ?? textLanguage(raw));
}

/** The address for a reference kept as typed text, in the Bible it was written in; null when it is not one. */
export function bibleHrefForText(raw: string, options: BibleLinkOptions): string | null {
  const ref = referenceFromTyped(raw, options);
  return ref ? bibleHref(ref, options) : null;
}

/**
 * Where a text's opening reference ends, the address it opens, the reference itself (for the verse
 * window), and its Bible where the reader needs the mark (`writtenInFor`).
 */
export type LeadingReference = { end: number; href: string; reference: ScriptureRefShape & { bible: BibleId }; writtenIn?: BibleId };

/**
 * THE REFERENCE A TEXT OPENS WITH — "Еф 1:15 — «Посему и я…»", "1 Пар. 4:9–10",
 * "Агг 1:5-14: "Посему ныне…"" — and only that: a sermon's verse names its passage first and quotes
 * it after. The longest run of its first words that reads as a reference with a chapter wins; a
 * text that does not begin with one gets nothing, and a reference inside prose is never guessed.
 */
export function leadingReference(text: string, options: BibleLinkOptions): LeadingReference | null {
  let found: LeadingReference | null = null;
  // The sermon's words decide; the verse's own only where the screen gives none.
  const written = options.written ?? textLanguage(text);
  for (const word of Array.from(text.matchAll(/\S+/g)).slice(0, 5)) {
    if (!/\d/.test(word[0])) continue;
    // The punctuation that ends the reference ("Агг 1:5-14:", "Еф 1:15,") is not part of it.
    const end = (word.index ?? 0) + word[0].replace(/[.,:;]+$/, '').length;
    const candidate = text.slice(0, end);
    if (!isReferenceShaped(candidate, options.locale)) continue;
    // A chapter at least: a book named alone in prose is an ordinary word as often as a reference.
    const ref = typedReference(candidate, options.locale, written);
    const href = ref?.chapter ? bibleHref(ref, options) : null;
    const writtenIn = ref ? writtenInFor(candidate, ref, options.locale) : undefined;
    if (ref && href) found = { end, href, reference: ref, ...(writtenIn ? { writtenIn } : {}) };
  }
  return found;
}

/**
 * A reference found in prose: where it stands in the text, as it was written, and what it names.
 * `writtenIn` — its Bible, where a reader of the interface, taking its letters in their own language
 * and Bible, would land elsewhere: a Synodal "Пс 22:1" for an English reader (Ps 23:1 there), a
 * Ukrainian "1Цар 3:5" for a Russian one (3 Kings there). The screen marks the reference with it.
 */
export type ReferenceInText = { start: number; end: number; raw: string; reference: ScriptureRefShape & { bible: BibleId }; writtenIn?: BibleId };

/**
 * Whether a reference names a place its Bible has — the chapter, and the verse it starts at — so a
 * screen can offer to open it. "Рим 25" and "Рим 8:999" name nothing to open.
 */
export function namesAPlace(ref: ScriptureRefShape & { bible: BibleId }): boolean {
  const chapters = chapterCount(ref.bible, ref.book);
  if (!ref.chapter || ref.chapter > chapters) return false;
  // A verse wins over a chapter range left beside it; a range of whole chapters ends in the book.
  if (ref.fromVerse) return ref.fromVerse <= verseCount(ref.bible, ref.book, ref.chapter);
  return ref.toChapter === undefined || ref.toChapter <= chapters;
}

/**
 * The numbers right after a book's name in prose — "13", "12:1", "12:1–2", "5-7" — and not a digit,
 * a letter or a verse more. A passage across a chapter end ("Ис 52:13–53:12") gives its first verse:
 * the reference model has no such passage yet (BUG-20261015-cross-chapter-passage-misread).
 */
const NUMBERS_IN_PROSE = /^\s*(\d+(?:[:.]\d+)?(?:\s*[-–—]\s*\d+)?)(?![\d\p{L}_@/\\]|[:.]\d|\.\p{L})/u;
/**
 * The words a whole chapter may be followed by and stay a chapter: the word "chapter" itself, or the
 * word that joins the next reference of a list. Any other word makes it prose — "Даниил 3 года",
 * "Job 2 children", "A 2 point plan" — and prose is never guessed.
 */
const STILL_A_CHAPTER = /^\s+(?:и|или|а|та|і|й|чи|and|or|глав[аеуы]?|chapters?|розділ[иу]?)(?=[\s,.;:!?)]|$)/iu;
/** The marks a reference may open with in prose: brackets, quotes, Markdown emphasis. */
const OPENING_MARKS = /^[([«"'“„*_]*/u;

/**
 * EVERY REFERENCE A TEXT NAMES — "Прочитайте Рим 12:1–2 и обсудите", "(1 Кор 13:4–7)", "Рим 13, Еф 6",
 * "Рим.12:1-2" as the app prints it — each read in the Bible it was written in (`writtenLanguage`;
 * `written` — the language of the document the text belongs to, else the text's own). A book's
 * name must read as a book all by itself and be followed only by its numbers, so prose stays prose:
 * "Иоанн пришёл 3-4 раза" names nothing; a chapter alone followed by what it counts is a count —
 * "Даниил 3 года"; and a place the book does not have is no reference.
 */
export function referencesInText(text: string, locale: AppLocale, written?: AppLocale | null): ReferenceInText[] {
  // The document's words decide (`written`); the text's own only where the screen gives none.
  const language = written ?? textLanguage(text);
  // Words end at spaces and at list marks: "Рим 8:28;Еф 4:1" holds two.
  const words = Array.from(text.matchAll(/[^\s,;]+/g));
  const found: ReferenceInText[] = [];
  let after = 0;
  words.forEach((word, first) => {
    // Opening marks are not the name: "(Рим", "«Рим", "**Рим". A word opening with anything else —
    // "//John3", "@Ин3" — is an address or a handle, not a reference.
    const start = (word.index ?? 0) + (OPENING_MARKS.exec(word[0])?.[0].length ?? 0);
    if (start < after || !/[\p{L}\d]/u.test(text[start] ?? '')) return;
    // The longest name first: "1 Кор" before "1", "Песнь Песней" before "Песнь".
    for (let last = Math.min(first + 3, words.length - 1); last >= first; last -= 1) {
      const wordStart = Math.max(start, words[last].index ?? 0);
      const wordEnd = (words[last].index ?? 0) + words[last][0].length;
      // The name ends where its word ends, or where its numbers start inside it: "Рим.12:1", "Ин3:16".
      const glued = /^\d*[^\d]+?(?=\d)/u.exec(text.slice(wordStart, wordEnd));
      for (const nameEnd of [wordEnd, ...(glued ? [wordStart + glued[0].length] : [])]) {
        const reference = referenceAt(text, start, nameEnd, locale, language);
        if (!reference) continue;
        found.push(reference);
        after = reference.end;
        return;
      }
    }
  });
  return found;
}

/** The reference whose book's name runs from `start` to `nameEnd` in the text, when it is one. */
function referenceAt(text: string, start: number, nameEnd: number, locale: AppLocale, written?: AppLocale | null): ReferenceInText | null {
  const name = text.slice(start, nameEnd);
  // A name may open with its number ("1 Кор") and holds no other; a comma ends a word, not a book.
  if (!/\p{L}/u.test(name) || /\d/.test(name.replace(/^\d+/, '')) || /[,;:]$/.test(name)) return null;
  const numbers = NUMBERS_IN_PROSE.exec(text.slice(nameEnd));
  if (!numbers) return null;
  const end = nameEnd + numbers[0].length;
  // Read with a space where the numbers were glued on: the parser reads "Ин 3:16", not "Ин3:16".
  const spaced = `${name} ${numbers[1]}`;
  if (!isReferenceShaped(spaced, locale)) return null;
  const reference = typedReference(spaced, locale, written);
  if (!reference || !namesAPlace(reference)) return null;
  const rest = text.slice(end);
  if (!/[:.]/.test(numbers[1]) && /^\s+\p{L}/u.test(rest) && !STILL_A_CHAPTER.test(rest)) return null;
  const writtenIn = writtenInFor(spaced, reference, locale);
  return { start, end, raw: text.slice(start, end), reference, ...(writtenIn ? { writtenIn } : {}) };
}

/** Chapter and verse as written after a book: "3", "3:16", "4:9-10", "3:16-4:2", "22:1, 3-5". */
const NUMBERS_AFTER_BOOK = /(\d+(?:[:.]\d+)?(?:\s*-\s*\d+(?:[:.]\d+)?)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*)$/u;

/**
 * Text that is a book's name and then only its numbers. The reference parser is generous on
 * purpose — a person typing into a reference field drops words and it reads past them — but in
 * prose that generosity makes "Иоанн пришёл 3-4 раза" John 3–4 and "Ин 3:16 2 ученика" a longer
 * reference. Here the name must read as a book all by itself, with nothing after it but numbers.
 */
function isReferenceShaped(candidate: string, locale: AppLocale): boolean {
  const normalized = candidate.replace(/[–—]/g, '-');
  const numbers = NUMBERS_AFTER_BOOK.exec(normalized);
  if (!numbers) return false;
  const name = normalized.slice(0, numbers.index).trim();
  return /\p{L}/u.test(name) && exactBook(name, locale) !== null;
}
