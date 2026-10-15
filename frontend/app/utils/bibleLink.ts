import { getBookById } from '@/utils/bibleBooks';
import { bookSlug } from '@/utils/bibleText';
import { referenceBibleFor, withStoredBible } from '@/utils/scriptureReferenceNumbering';
import { parseReferenceText } from '@/utils/scriptureReferenceParser';
import { chapterCount } from '@/utils/versification';

import type { AppLocale } from '@/utils/appLocale';
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
  const parsed = parseReferenceText(raw.trim());
  const book = parsed ? getBookById(parsed.book) : undefined;
  if (!parsed || !book) return null;
  if (parsed.chapter && !parsed.fromVerse && chapterCount(bible, book.id) === 1) {
    return { bible, book: book.id, chapter: 1, fromVerse: parsed.chapter, toVerse: parsed.toChapter };
  }
  return { bible, book: book.id, chapter: parsed.chapter, toChapter: parsed.toChapter, fromVerse: parsed.fromVerse, toVerse: parsed.toVerse };
}

export type BibleLinkOptions = {
  /** The interface language: the Bible a reference that names none was typed in. */
  locale: AppLocale;
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

/** Typed text read in the interface's Bible; a dash between verses may be typed long ("9–10"). */
const typedReference = (raw: string, locale: AppLocale) => referenceFromText(raw.replace(/[–—]/g, '-'), referenceBibleFor(locale));

/** The address for a reference kept as typed text, in the interface's Bible; null when it is not one. */
export function bibleHrefForText(raw: string, options: BibleLinkOptions): string | null {
  const ref = typedReference(raw, options.locale);
  return ref ? bibleHref(ref, options) : null;
}

/** Where a text's opening reference ends, and the address it opens. */
export type LeadingReference = { end: number; href: string };

/**
 * THE REFERENCE A TEXT OPENS WITH — "Еф 1:15 — «Посему и я…»", "1 Пар. 4:9–10",
 * "Агг 1:5-14: "Посему ныне…"" — and only that: a sermon's verse names its passage first and quotes
 * it after. The longest run of its first words that reads as a reference with a chapter wins; a
 * text that does not begin with one gets nothing, and a reference inside prose is never guessed.
 */
export function leadingReference(text: string, options: BibleLinkOptions): LeadingReference | null {
  let found: LeadingReference | null = null;
  for (const word of Array.from(text.matchAll(/\S+/g)).slice(0, 5)) {
    if (!/\d/.test(word[0])) continue;
    // The punctuation that ends the reference ("Агг 1:5-14:", "Еф 1:15,") is not part of it.
    const end = (word.index ?? 0) + word[0].replace(/[.,:;]+$/, '').length;
    const candidate = text.slice(0, end);
    if (!isReferenceShaped(candidate)) continue;
    // A chapter at least: a book named alone in prose is an ordinary word as often as a reference.
    const ref = typedReference(candidate, options.locale);
    const href = ref?.chapter ? bibleHref(ref, options) : null;
    if (href) found = { end, href };
  }
  return found;
}

/** Chapter and verse as written after a book: "3", "3:16", "4:9-10", "3:16-4:2", "22:1, 3-5". */
const NUMBERS_AFTER_BOOK = /(\d+(?:[:.]\d+)?(?:\s*-\s*\d+(?:[:.]\d+)?)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*)$/u;

/**
 * Text that is a book's name and then only its numbers. The reference parser is generous on
 * purpose — a person typing into a reference field drops words and it reads past them — but in
 * prose that generosity makes "Иоанн пришёл 3-4 раза" John 3–4 and "Ин 3:16 2 ученика" a longer
 * reference. Here the name must read as a book all by itself, with nothing after it but numbers.
 */
function isReferenceShaped(candidate: string): boolean {
  const normalized = candidate.replace(/[–—]/g, '-');
  const numbers = NUMBERS_AFTER_BOOK.exec(normalized);
  if (!numbers) return false;
  const name = normalized.slice(0, numbers.index).trim();
  if (!/\p{L}/u.test(name)) return false;
  const named = parseReferenceText(name);
  return Boolean(named && !named.chapter);
}
