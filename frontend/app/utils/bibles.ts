import { bibleTextBase } from '@/utils/bibleTextCache';

import type { AppLocale } from '@/utils/appLocale';

/**
 * THE BIBLES THE APP READS, one entry each, keyed by the Bible and never by its language: two
 * translations in one language are two entries, and a Greek text would be one more. Everything
 * that differs between Bibles hangs on the id — the numbering of chapters and verses
 * (`utils/versification`), the order of the books (`components/bible/bookOrder.ts`), the folder
 * of the text.
 */
export const BIBLE_IDS = ['rst', 'ubio', 'kjv'] as const;
export type BibleId = (typeof BIBLE_IDS)[number];

export type BibleInfo = {
  id: BibleId;
  /** The language the text is written in (a screen reader reads it so). */
  language: 'ru' | 'uk' | 'en';
  /** The order its printed edition gives the books: the Synodal puts James–Jude right after Acts. */
  bookOrder: 'synodal' | 'protestant';
  /** Where its books are served from. */
  textBase: string;
};

export const BIBLES: Readonly<Record<BibleId, BibleInfo>> = {
  // Russian Synodal translation (MyBible RST+).
  rst: { id: 'rst', language: 'ru', bookOrder: 'synodal', textBase: bibleTextBase('rst') },
  // Ukrainian, Ivan Ohienko's translation, 1988 edition (MyBible UBIO'88).
  ubio: { id: 'ubio', language: 'uk', bookOrder: 'protestant', textBase: bibleTextBase('ubio') },
  // King James Version (MyBible KJV+).
  kjv: { id: 'kjv', language: 'en', bookOrder: 'protestant', textBase: bibleTextBase('kjv') },
};

export const isBibleId = (value: unknown): value is BibleId =>
  typeof value === 'string' && (BIBLE_IDS as readonly string[]).includes(value);

/** The Bible a person reads before choosing one: the one in the interface's language. */
export const bibleForLocale = (locale: AppLocale): BibleId => ({ ru: 'rst', uk: 'ubio', en: 'kjv' } as const)[locale];
