/**
 * Comprehensive Bible data with localized book names, chapter counts,
 * and Psalm numbering offset handling for different translations.
 *
 * Supported translations:
 * - EN: King James Version (KJV) - Hebrew/Masoretic numbering
 * - RU: Russian Synodal (RST) - Septuagint/Orthodox numbering
 * - UK: Ukrainian Ohienko (UKR) - Septuagint/Orthodox numbering
 */

export type BibleLocale = 'en' | 'ru' | 'uk';

export interface BookInfo {
  /** Canonical ID (English name used as key) */
  id: string;
  /** Number of chapters in the book */
  chapters: number;
  /** Localized names */
  names: {
    en: string;
    ru: string;
    uk: string;
  };
  /** Localized abbreviations for compact display */
  abbrev: {
    en: string;
    ru: string;
    uk: string;
  };
}

/**
 * Complete Bible book data with chapter counts and localized names.
 * Book order follows Protestant canon (66 books).
 *
 * Note on Russian/Ukrainian vs English naming:
 * - 1-2 Samuel (EN) = 1-2 Царств (RU) = 1-2 Самуїлова (UK)
 * - 1-2 Kings (EN) = 3-4 Царств (RU) = 1-2 Царів (UK)
 */
export const BIBLE_BOOKS_DATA: BookInfo[] = [
  // Old Testament - Pentateuch
  { id: 'Genesis', chapters: 50, names: { en: 'Genesis', ru: 'Бытие', uk: 'Буття' }, abbrev: { en: 'Gen', ru: 'Быт', uk: 'Бут' } },
  { id: 'Exodus', chapters: 40, names: { en: 'Exodus', ru: 'Исход', uk: 'Вихід' }, abbrev: { en: 'Exod', ru: 'Исх', uk: 'Вих' } },
  { id: 'Leviticus', chapters: 27, names: { en: 'Leviticus', ru: 'Левит', uk: 'Левит' }, abbrev: { en: 'Lev', ru: 'Лев', uk: 'Лев' } },
  { id: 'Numbers', chapters: 36, names: { en: 'Numbers', ru: 'Числа', uk: 'Числа' }, abbrev: { en: 'Num', ru: 'Чис', uk: 'Чис' } },
  { id: 'Deuteronomy', chapters: 34, names: { en: 'Deuteronomy', ru: 'Второзаконие', uk: 'Повторення Закону' }, abbrev: { en: 'Deut', ru: 'Втор', uk: 'Повт' } },

  // Old Testament - Historical Books
  { id: 'Joshua', chapters: 24, names: { en: 'Joshua', ru: 'Иисус Навин', uk: 'Ісус Навин' }, abbrev: { en: 'Josh', ru: 'И.Нав', uk: 'І.Нав' } },
  { id: 'Judges', chapters: 21, names: { en: 'Judges', ru: 'Судей', uk: 'Суддів' }, abbrev: { en: 'Judg', ru: 'Суд', uk: 'Суд' } },
  { id: 'Ruth', chapters: 4, names: { en: 'Ruth', ru: 'Руфь', uk: 'Рут' }, abbrev: { en: 'Ruth', ru: 'Руф', uk: 'Рут' } },
  // Note: 1-2 Samuel (EN) = 1-2 Царств (RU), 1-2 Kings (EN) = 3-4 Царств (RU)
  { id: '1 Samuel', chapters: 31, names: { en: '1 Samuel', ru: '1 Царств', uk: '1 Самуїлова' }, abbrev: { en: '1Sam', ru: '1Цар', uk: '1Сам' } },
  { id: '2 Samuel', chapters: 24, names: { en: '2 Samuel', ru: '2 Царств', uk: '2 Самуїлова' }, abbrev: { en: '2Sam', ru: '2Цар', uk: '2Сам' } },
  { id: '1 Kings', chapters: 22, names: { en: '1 Kings', ru: '3 Царств', uk: '1 Царів' }, abbrev: { en: '1Kgs', ru: '3Цар', uk: '1Цар' } },
  { id: '2 Kings', chapters: 25, names: { en: '2 Kings', ru: '4 Царств', uk: '2 Царів' }, abbrev: { en: '2Kgs', ru: '4Цар', uk: '2Цар' } },
  { id: '1 Chronicles', chapters: 29, names: { en: '1 Chronicles', ru: '1 Паралипоменон', uk: '1 Хроніки' }, abbrev: { en: '1Chr', ru: '1Пар', uk: '1Хр' } },
  { id: '2 Chronicles', chapters: 36, names: { en: '2 Chronicles', ru: '2 Паралипоменон', uk: '2 Хроніки' }, abbrev: { en: '2Chr', ru: '2Пар', uk: '2Хр' } },
  { id: 'Ezra', chapters: 10, names: { en: 'Ezra', ru: 'Ездра', uk: 'Ездра' }, abbrev: { en: 'Ezra', ru: 'Езд', uk: 'Езд' } },
  { id: 'Nehemiah', chapters: 13, names: { en: 'Nehemiah', ru: 'Неемия', uk: 'Неемія' }, abbrev: { en: 'Neh', ru: 'Неем', uk: 'Неем' } },
  { id: 'Esther', chapters: 10, names: { en: 'Esther', ru: 'Есфирь', uk: 'Естер' }, abbrev: { en: 'Esth', ru: 'Есф', uk: 'Ест' } },

  // Old Testament - Wisdom/Poetry
  { id: 'Job', chapters: 42, names: { en: 'Job', ru: 'Иов', uk: 'Йов' }, abbrev: { en: 'Job', ru: 'Иов', uk: 'Йов' } },
  { id: 'Psalms', chapters: 150, names: { en: 'Psalms', ru: 'Псалтирь', uk: 'Псалми' }, abbrev: { en: 'Ps', ru: 'Пс', uk: 'Пс' } },
  { id: 'Proverbs', chapters: 31, names: { en: 'Proverbs', ru: 'Притчи', uk: 'Приповістки' }, abbrev: { en: 'Prov', ru: 'Притч', uk: 'Прип' } },
  { id: 'Ecclesiastes', chapters: 12, names: { en: 'Ecclesiastes', ru: 'Екклесиаст', uk: 'Екклезіяст' }, abbrev: { en: 'Eccl', ru: 'Еккл', uk: 'Еккл' } },
  { id: 'Song of Solomon', chapters: 8, names: { en: 'Song of Solomon', ru: 'Песнь Песней', uk: 'Пісня Пісень' }, abbrev: { en: 'Song', ru: 'Песн', uk: 'Пісн' } },

  // Old Testament - Major Prophets
  { id: 'Isaiah', chapters: 66, names: { en: 'Isaiah', ru: 'Исаия', uk: 'Ісая' }, abbrev: { en: 'Isa', ru: 'Ис', uk: 'Іс' } },
  { id: 'Jeremiah', chapters: 52, names: { en: 'Jeremiah', ru: 'Иеремия', uk: 'Єремія' }, abbrev: { en: 'Jer', ru: 'Иер', uk: 'Єр' } },
  { id: 'Lamentations', chapters: 5, names: { en: 'Lamentations', ru: 'Плач Иеремии', uk: 'Плач Єремії' }, abbrev: { en: 'Lam', ru: 'Плач', uk: 'Плач' } },
  { id: 'Ezekiel', chapters: 48, names: { en: 'Ezekiel', ru: 'Иезекииль', uk: 'Єзекіїль' }, abbrev: { en: 'Ezek', ru: 'Иез', uk: 'Єз' } },
  { id: 'Daniel', chapters: 12, names: { en: 'Daniel', ru: 'Даниил', uk: 'Даниїл' }, abbrev: { en: 'Dan', ru: 'Дан', uk: 'Дан' } },

  // Old Testament - Minor Prophets
  { id: 'Hosea', chapters: 14, names: { en: 'Hosea', ru: 'Осия', uk: 'Осія' }, abbrev: { en: 'Hos', ru: 'Ос', uk: 'Ос' } },
  { id: 'Joel', chapters: 3, names: { en: 'Joel', ru: 'Иоиль', uk: 'Йоїл' }, abbrev: { en: 'Joel', ru: 'Иоил', uk: 'Йоїл' } },
  { id: 'Amos', chapters: 9, names: { en: 'Amos', ru: 'Амос', uk: 'Амос' }, abbrev: { en: 'Amos', ru: 'Ам', uk: 'Ам' } },
  { id: 'Obadiah', chapters: 1, names: { en: 'Obadiah', ru: 'Авдий', uk: 'Овдій' }, abbrev: { en: 'Obad', ru: 'Авд', uk: 'Овд' } },
  { id: 'Jonah', chapters: 4, names: { en: 'Jonah', ru: 'Иона', uk: 'Йона' }, abbrev: { en: 'Jonah', ru: 'Ион', uk: 'Йон' } },
  { id: 'Micah', chapters: 7, names: { en: 'Micah', ru: 'Михей', uk: 'Михей' }, abbrev: { en: 'Mic', ru: 'Мих', uk: 'Мих' } },
  { id: 'Nahum', chapters: 3, names: { en: 'Nahum', ru: 'Наум', uk: 'Наум' }, abbrev: { en: 'Nah', ru: 'Наум', uk: 'Наум' } },
  { id: 'Habakkuk', chapters: 3, names: { en: 'Habakkuk', ru: 'Аввакум', uk: 'Авакум' }, abbrev: { en: 'Hab', ru: 'Авв', uk: 'Авк' } },
  { id: 'Zephaniah', chapters: 3, names: { en: 'Zephaniah', ru: 'Софония', uk: 'Софонія' }, abbrev: { en: 'Zeph', ru: 'Соф', uk: 'Соф' } },
  { id: 'Haggai', chapters: 2, names: { en: 'Haggai', ru: 'Аггей', uk: 'Огій' }, abbrev: { en: 'Hag', ru: 'Агг', uk: 'Ог' } },
  { id: 'Zechariah', chapters: 14, names: { en: 'Zechariah', ru: 'Захария', uk: 'Захарія' }, abbrev: { en: 'Zech', ru: 'Зах', uk: 'Зах' } },
  { id: 'Malachi', chapters: 4, names: { en: 'Malachi', ru: 'Малахия', uk: 'Малахія' }, abbrev: { en: 'Mal', ru: 'Мал', uk: 'Мал' } },

  // New Testament - Gospels
  { id: 'Matthew', chapters: 28, names: { en: 'Matthew', ru: 'От Матфея', uk: 'Від Матвія' }, abbrev: { en: 'Matt', ru: 'Мф', uk: 'Мт' } },
  { id: 'Mark', chapters: 16, names: { en: 'Mark', ru: 'От Марка', uk: 'Від Марка' }, abbrev: { en: 'Mark', ru: 'Мк', uk: 'Мр' } },
  { id: 'Luke', chapters: 24, names: { en: 'Luke', ru: 'От Луки', uk: 'Від Луки' }, abbrev: { en: 'Luke', ru: 'Лк', uk: 'Лк' } },
  { id: 'John', chapters: 21, names: { en: 'John', ru: 'От Иоанна', uk: 'Від Івана' }, abbrev: { en: 'John', ru: 'Ин', uk: 'Ів' } },

  // New Testament - History
  { id: 'Acts', chapters: 28, names: { en: 'Acts', ru: 'Деяния', uk: 'Дії' }, abbrev: { en: 'Acts', ru: 'Деян', uk: 'Дії' } },

  // New Testament - Pauline Epistles
  { id: 'Romans', chapters: 16, names: { en: 'Romans', ru: 'К Римлянам', uk: 'До Римлян' }, abbrev: { en: 'Rom', ru: 'Рим', uk: 'Рим' } },
  { id: '1 Corinthians', chapters: 16, names: { en: '1 Corinthians', ru: '1 Коринфянам', uk: '1 Коринтян' }, abbrev: { en: '1Cor', ru: '1Кор', uk: '1Кор' } },
  { id: '2 Corinthians', chapters: 13, names: { en: '2 Corinthians', ru: '2 Коринфянам', uk: '2 Коринтян' }, abbrev: { en: '2Cor', ru: '2Кор', uk: '2Кор' } },
  { id: 'Galatians', chapters: 6, names: { en: 'Galatians', ru: 'К Галатам', uk: 'До Галатів' }, abbrev: { en: 'Gal', ru: 'Гал', uk: 'Гал' } },
  { id: 'Ephesians', chapters: 6, names: { en: 'Ephesians', ru: 'К Ефесянам', uk: 'До Ефесян' }, abbrev: { en: 'Eph', ru: 'Еф', uk: 'Еф' } },
  { id: 'Philippians', chapters: 4, names: { en: 'Philippians', ru: 'К Филиппийцам', uk: 'До Филип\'ян' }, abbrev: { en: 'Phil', ru: 'Флп', uk: 'Флп' } },
  { id: 'Colossians', chapters: 4, names: { en: 'Colossians', ru: 'К Колоссянам', uk: 'До Колосян' }, abbrev: { en: 'Col', ru: 'Кол', uk: 'Кол' } },
  { id: '1 Thessalonians', chapters: 5, names: { en: '1 Thessalonians', ru: '1 Фессалоникийцам', uk: '1 Солунян' }, abbrev: { en: '1Thess', ru: '1Фес', uk: '1Сол' } },
  { id: '2 Thessalonians', chapters: 3, names: { en: '2 Thessalonians', ru: '2 Фессалоникийцам', uk: '2 Солунян' }, abbrev: { en: '2Thess', ru: '2Фес', uk: '2Сол' } },
  { id: '1 Timothy', chapters: 6, names: { en: '1 Timothy', ru: '1 Тимофею', uk: '1 Тимофія' }, abbrev: { en: '1Tim', ru: '1Тим', uk: '1Тим' } },
  { id: '2 Timothy', chapters: 4, names: { en: '2 Timothy', ru: '2 Тимофею', uk: '2 Тимофія' }, abbrev: { en: '2Tim', ru: '2Тим', uk: '2Тим' } },
  { id: 'Titus', chapters: 3, names: { en: 'Titus', ru: 'К Титу', uk: 'До Тита' }, abbrev: { en: 'Titus', ru: 'Тит', uk: 'Тит' } },
  { id: 'Philemon', chapters: 1, names: { en: 'Philemon', ru: 'К Филимону', uk: 'До Филимона' }, abbrev: { en: 'Phlm', ru: 'Флм', uk: 'Флм' } },

  // New Testament - General Epistles
  { id: 'Hebrews', chapters: 13, names: { en: 'Hebrews', ru: 'К Евреям', uk: 'До Євреїв' }, abbrev: { en: 'Heb', ru: 'Евр', uk: 'Євр' } },
  { id: 'James', chapters: 5, names: { en: 'James', ru: 'Иакова', uk: 'Якова' }, abbrev: { en: 'Jas', ru: 'Иак', uk: 'Як' } },
  { id: '1 Peter', chapters: 5, names: { en: '1 Peter', ru: '1 Петра', uk: '1 Петра' }, abbrev: { en: '1Pet', ru: '1Пет', uk: '1Пт' } },
  { id: '2 Peter', chapters: 3, names: { en: '2 Peter', ru: '2 Петра', uk: '2 Петра' }, abbrev: { en: '2Pet', ru: '2Пет', uk: '2Пт' } },
  { id: '1 John', chapters: 5, names: { en: '1 John', ru: '1 Иоанна', uk: '1 Івана' }, abbrev: { en: '1John', ru: '1Ин', uk: '1Ів' } },
  { id: '2 John', chapters: 1, names: { en: '2 John', ru: '2 Иоанна', uk: '2 Івана' }, abbrev: { en: '2John', ru: '2Ин', uk: '2Ів' } },
  { id: '3 John', chapters: 1, names: { en: '3 John', ru: '3 Иоанна', uk: '3 Івана' }, abbrev: { en: '3John', ru: '3Ин', uk: '3Ів' } },
  { id: 'Jude', chapters: 1, names: { en: 'Jude', ru: 'Иуды', uk: 'Юди' }, abbrev: { en: 'Jude', ru: 'Иуд', uk: 'Юд' } },

  // New Testament - Apocalypse
  { id: 'Revelation', chapters: 22, names: { en: 'Revelation', ru: 'Откровение', uk: 'Об\'явлення' }, abbrev: { en: 'Rev', ru: 'Откр', uk: 'Об' } },
];

// Quick lookup maps
const bookById = new Map(BIBLE_BOOKS_DATA.map((b) => [b.id, b]));
const bookByNameEN = new Map(BIBLE_BOOKS_DATA.map((b) => [b.names.en.toLowerCase(), b]));
const bookByNameRU = new Map(BIBLE_BOOKS_DATA.map((b) => [b.names.ru.toLowerCase(), b]));
const bookByNameUK = new Map(BIBLE_BOOKS_DATA.map((b) => [b.names.uk.toLowerCase(), b]));
const bookByAbbrevEN = new Map(BIBLE_BOOKS_DATA.map((b) => [b.abbrev.en.toLowerCase(), b]));
const bookByAbbrevRU = new Map(BIBLE_BOOKS_DATA.map((b) => [b.abbrev.ru.toLowerCase(), b]));
const bookByAbbrevUK = new Map(BIBLE_BOOKS_DATA.map((b) => [b.abbrev.uk.toLowerCase(), b]));

/**
 * Get book info by canonical ID (English name).
 */
export function getBookById(id: string): BookInfo | undefined {
  return bookById.get(id);
}

/**
 * Get book info by localized name or abbreviation.
 */
export function getBookByName(name: string, locale?: BibleLocale): BookInfo | undefined {
  const lower = name.toLowerCase();

  // Try exact matches first
  if (bookById.has(name)) return bookById.get(name);

  // Try by locale if specified
  if (locale === 'en') {
    return bookByNameEN.get(lower) || bookByAbbrevEN.get(lower);
  }
  if (locale === 'ru') {
    return bookByNameRU.get(lower) || bookByAbbrevRU.get(lower);
  }
  if (locale === 'uk') {
    return bookByNameUK.get(lower) || bookByAbbrevUK.get(lower);
  }

  // Try all locales
  return (
    bookByNameEN.get(lower) ||
    bookByNameRU.get(lower) ||
    bookByNameUK.get(lower) ||
    bookByAbbrevEN.get(lower) ||
    bookByAbbrevRU.get(lower) ||
    bookByAbbrevUK.get(lower)
  );
}

/**
 * Get localized book name.
 */
export function getLocalizedBookName(bookId: string, locale: BibleLocale): string {
  const book = getBookById(bookId);
  return book?.names[locale] || bookId;
}

/**
 * Get localized book abbreviation.
 */
export function getLocalizedAbbrev(bookId: string, locale: BibleLocale): string {
  const book = getBookById(bookId);
  return book?.abbrev[locale] || bookId;
}

/**
 * Get number of chapters for a book.
 */
export function getChapterCount(bookId: string): number {
  const book = getBookById(bookId);
  return book?.chapters || 1;
}

/**
 * Get list of book IDs in canonical order.
 */
export function getBookIds(): string[] {
  return BIBLE_BOOKS_DATA.map((b) => b.id);
}

/**
 * Get list of books for dropdown with localized names.
 */
export function getBooksForDropdown(locale: BibleLocale): Array<{ id: string; name: string }> {
  return BIBLE_BOOKS_DATA.map((b) => ({
    id: b.id,
    name: b.names[locale],
  }));
}

// ============================================================================
// PSALM NUMBERING CONVERSION
// ============================================================================

/**
 * Psalm numbering differs between Hebrew/Protestant (KJV) and Septuagint/Orthodox (RST, UKR).
 *
 * The main differences (simplified):
 * - Psalms 1-8: Same in both
 * - Psalms 9-10 (Hebrew) = Psalm 9 (LXX) - combined
 * - Psalms 11-113 (Hebrew) = Psalms 10-112 (LXX) - offset by 1
 * - Psalms 114-115 (Hebrew) = Psalm 113 (LXX) - combined
 * - Psalm 116 (Hebrew) = Psalms 114-115 (LXX) - split
 * - Psalms 117-146 (Hebrew) = Psalms 116-145 (LXX) - offset by 1
 * - Psalm 147 (Hebrew) = Psalms 146-147 (LXX) - split
 * - Psalms 148-150: Same in both
 *
 * For simplicity, we use a common approximation:
 * - Hebrew Ps 10-147 ≈ LXX Ps 9-146 (offset of -1)
 * - Psalms 1-9 and 148-150 are the same
 */

/**
 * Convert a Psalm number from Hebrew/Protestant (KJV) to Septuagint/Orthodox (RST/UKR).
 * Note: This is an approximation. Some Psalms are split/merged between traditions.
 */
export function psalmHebrewToSeptuagint(hebrewPsalm: number): number {
  if (hebrewPsalm <= 9) return hebrewPsalm;
  if (hebrewPsalm >= 148) return hebrewPsalm;
  // Psalms 10-147 in Hebrew ≈ 9-146 in LXX (simplified)
  return hebrewPsalm - 1;
}

/**
 * Convert a Psalm number from Septuagint/Orthodox (RST/UKR) to Hebrew/Protestant (KJV).
 * Note: This is an approximation. Some Psalms are split/merged between traditions.
 */
export function psalmSeptuagintToHebrew(lxxPsalm: number): number {
  if (lxxPsalm <= 8) return lxxPsalm;
  if (lxxPsalm >= 148) return lxxPsalm;
  // Psalms 9-146 in LXX ≈ 10-147 in Hebrew (simplified)
  return lxxPsalm + 1;
}

/**
 * Convert a Psalm reference between locales.
 * EN uses Hebrew numbering, RU/UK use Septuagint numbering.
 */
export function convertPsalmNumber(
  psalm: number,
  fromLocale: BibleLocale,
  toLocale: BibleLocale
): number {
  if (fromLocale === toLocale) return psalm;

  // EN → RU/UK: Hebrew to Septuagint
  if (fromLocale === 'en' && (toLocale === 'ru' || toLocale === 'uk')) {
    return psalmHebrewToSeptuagint(psalm);
  }

  // RU/UK → EN: Septuagint to Hebrew
  if ((fromLocale === 'ru' || fromLocale === 'uk') && toLocale === 'en') {
    return psalmSeptuagintToHebrew(psalm);
  }

  // RU ↔ UK: Both use Septuagint, no change
  return psalm;
}

/**
 * Format a Scripture reference with localized book name and abbreviation.
 */
export function formatScriptureRefLocalized(
  ref: {
    book: string;
    chapter: number;
    fromVerse: number;
    toVerse?: number;
  },
  locale: BibleLocale
): string {
  const abbrev = getLocalizedAbbrev(ref.book, locale);
  const verseRange =
    ref.toVerse && ref.toVerse !== ref.fromVerse
      ? `${ref.fromVerse}-${ref.toVerse}`
      : String(ref.fromVerse);
  return `${abbrev}.${ref.chapter}:${verseRange}`;
}

/**
 * Validate if a chapter number is valid for a book.
 */
export function isValidChapter(bookId: string, chapter: number): boolean {
  const maxChapters = getChapterCount(bookId);
  return chapter >= 1 && chapter <= maxChapters;
}

// ============================================================================
// VERSE COUNTS PER CHAPTER
// ============================================================================

/**
 * Number of verses in each chapter for all 66 books of the Bible.
 * Based on the standard Protestant canon (KJV/Hebrew-Greek critical text).
 * Index 0 = Chapter 1, Index 1 = Chapter 2, etc.
 *
 * Note: Minor variations may exist between translations (±1 verse in some cases),
 * but this data covers 99%+ of cases accurately.
 */
export const VERSE_COUNTS: Record<string, number[]> = {
  // Old Testament - Pentateuch
  'Genesis': [31, 25, 24, 26, 32, 22, 24, 22, 29, 32, 32, 20, 18, 24, 21, 16, 27, 33, 38, 18, 34, 24, 20, 67, 34, 35, 46, 22, 35, 43, 55, 32, 20, 31, 29, 43, 36, 30, 23, 23, 57, 38, 34, 34, 28, 34, 31, 22, 33, 26],
  'Exodus': [22, 25, 22, 31, 23, 30, 25, 32, 35, 29, 10, 51, 22, 31, 27, 36, 16, 27, 25, 26, 36, 31, 33, 18, 40, 37, 21, 43, 46, 38, 18, 35, 23, 35, 35, 38, 29, 31, 43, 38],
  'Leviticus': [17, 16, 17, 35, 19, 30, 38, 36, 24, 20, 47, 8, 59, 57, 33, 34, 16, 30, 37, 27, 24, 33, 44, 23, 55, 46, 34],
  'Numbers': [54, 34, 51, 49, 31, 27, 89, 26, 23, 36, 35, 16, 33, 45, 41, 50, 13, 32, 22, 29, 35, 41, 30, 25, 18, 65, 23, 31, 40, 16, 54, 42, 56, 29, 34, 13],
  'Deuteronomy': [46, 37, 29, 49, 33, 25, 26, 20, 29, 22, 32, 32, 18, 29, 23, 22, 20, 22, 21, 20, 23, 30, 25, 22, 19, 19, 26, 68, 29, 20, 30, 52, 29, 12],

  // Old Testament - Historical Books
  'Joshua': [18, 24, 17, 24, 15, 27, 26, 35, 27, 43, 23, 24, 33, 15, 63, 10, 18, 28, 51, 9, 45, 34, 16, 33],
  'Judges': [36, 23, 31, 24, 31, 40, 25, 35, 57, 18, 40, 15, 25, 20, 20, 31, 13, 31, 30, 48, 25],
  'Ruth': [22, 23, 18, 22],
  '1 Samuel': [28, 36, 21, 22, 12, 21, 17, 22, 27, 27, 15, 25, 23, 52, 35, 23, 58, 30, 24, 42, 15, 23, 29, 22, 44, 25, 12, 25, 11, 31, 13],
  '2 Samuel': [27, 32, 39, 12, 25, 23, 29, 18, 13, 19, 27, 31, 39, 33, 37, 23, 29, 33, 43, 26, 22, 51, 39, 25],
  '1 Kings': [53, 46, 28, 34, 18, 38, 51, 66, 28, 29, 43, 33, 34, 31, 34, 34, 24, 46, 21, 43, 29, 53],
  '2 Kings': [18, 25, 27, 44, 27, 33, 20, 29, 37, 36, 21, 21, 25, 29, 38, 20, 41, 37, 37, 21, 26, 20, 37, 20, 30],
  '1 Chronicles': [54, 55, 24, 43, 26, 81, 40, 40, 44, 14, 47, 40, 14, 17, 29, 43, 27, 17, 19, 8, 30, 19, 32, 31, 31, 32, 34, 21, 30],
  '2 Chronicles': [17, 18, 17, 22, 14, 42, 22, 18, 31, 19, 23, 16, 22, 15, 19, 14, 19, 34, 11, 37, 20, 12, 21, 27, 28, 23, 9, 27, 36, 27, 21, 33, 25, 33, 27, 23],
  'Ezra': [11, 70, 13, 24, 17, 22, 28, 36, 15, 44],
  'Nehemiah': [11, 20, 32, 23, 19, 19, 73, 18, 38, 39, 36, 47, 31],
  'Esther': [22, 23, 15, 17, 14, 14, 10, 17, 32, 3],

  // Old Testament - Wisdom/Poetry
  'Job': [22, 13, 26, 21, 27, 30, 21, 22, 35, 22, 20, 25, 28, 22, 35, 22, 16, 21, 29, 29, 34, 30, 17, 25, 6, 14, 23, 28, 25, 31, 40, 22, 33, 37, 16, 33, 24, 41, 30, 24, 34, 17],
  'Psalms': [6, 12, 8, 8, 12, 10, 17, 9, 20, 18, 7, 8, 6, 7, 5, 11, 15, 50, 14, 9, 13, 31, 6, 10, 22, 12, 14, 9, 11, 12, 24, 11, 22, 22, 28, 12, 40, 22, 13, 17, 13, 11, 5, 26, 17, 11, 9, 14, 20, 23, 19, 9, 6, 7, 23, 13, 11, 11, 17, 12, 8, 12, 11, 10, 13, 20, 7, 35, 36, 5, 24, 20, 28, 23, 10, 12, 20, 72, 13, 19, 16, 8, 18, 12, 13, 17, 7, 18, 52, 17, 16, 15, 5, 23, 11, 13, 12, 9, 9, 5, 8, 28, 22, 35, 45, 48, 43, 13, 31, 7, 10, 10, 9, 8, 18, 19, 2, 29, 176, 7, 8, 9, 4, 8, 5, 6, 5, 6, 8, 8, 3, 18, 3, 3, 21, 26, 9, 8, 24, 13, 10, 7, 12, 15, 21, 10, 20, 14, 9, 6],
  'Proverbs': [33, 22, 35, 27, 23, 35, 27, 36, 18, 32, 31, 28, 25, 35, 33, 33, 28, 24, 29, 30, 31],
  'Ecclesiastes': [18, 26, 22, 16, 20, 12, 29, 17, 18, 20, 10, 14],
  'Song of Solomon': [17, 17, 11, 16, 16, 13, 13, 14],

  // Old Testament - Major Prophets
  'Isaiah': [31, 22, 26, 6, 30, 13, 25, 22, 21, 34, 16, 6, 22, 32, 9, 14, 14, 7, 25, 6, 17, 25, 18, 23, 12, 21, 13, 29, 24, 33, 9, 20, 24, 17, 10, 22, 38, 22, 8, 31, 29, 25, 28, 28, 25, 13, 15, 22, 26, 11, 23, 15, 12, 17, 13, 12, 21, 14, 21, 22, 11, 12, 19, 12, 25, 24],
  'Jeremiah': [19, 37, 25, 31, 31, 30, 34, 22, 26, 25, 23, 17, 27, 22, 21, 21, 27, 23, 15, 18, 14, 30, 40, 10, 38, 24, 22, 17, 32, 24, 40, 44, 26, 22, 19, 32, 21, 28, 18, 16, 18, 22, 13, 30, 5, 28, 7, 47, 39, 46, 64, 34],
  'Lamentations': [22, 22, 66, 22, 22],
  'Ezekiel': [28, 10, 27, 17, 17, 14, 27, 18, 11, 22, 25, 28, 23, 23, 8, 63, 24, 32, 14, 49, 32, 31, 49, 27, 17, 21, 36, 26, 21, 26, 18, 32, 33, 31, 15, 38, 28, 23, 29, 49, 26, 20, 27, 31, 25, 24, 23, 35],
  'Daniel': [21, 49, 30, 37, 31, 28, 28, 27, 27, 21, 45, 13],

  // Old Testament - Minor Prophets
  'Hosea': [11, 23, 5, 19, 15, 11, 16, 14, 17, 15, 12, 14, 16, 9],
  'Joel': [20, 32, 21],
  'Amos': [15, 16, 15, 13, 27, 14, 17, 14, 15],
  'Obadiah': [21],
  'Jonah': [17, 10, 10, 11],
  'Micah': [16, 13, 12, 13, 15, 16, 20],
  'Nahum': [15, 13, 19],
  'Habakkuk': [17, 20, 19],
  'Zephaniah': [18, 15, 20],
  'Haggai': [15, 23],
  'Zechariah': [21, 13, 10, 14, 11, 15, 14, 23, 17, 12, 17, 14, 9, 21],
  'Malachi': [14, 17, 18, 6],

  // New Testament - Gospels
  'Matthew': [25, 23, 17, 25, 48, 34, 29, 34, 38, 42, 30, 50, 58, 36, 39, 28, 27, 35, 30, 34, 46, 46, 39, 51, 46, 75, 66, 20],
  'Mark': [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20],
  'Luke': [80, 52, 38, 44, 39, 49, 50, 56, 62, 42, 54, 59, 35, 35, 32, 31, 37, 43, 48, 47, 38, 71, 56, 53],
  'John': [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25],

  // New Testament - History
  'Acts': [26, 47, 26, 37, 42, 15, 60, 40, 43, 48, 30, 25, 52, 28, 41, 40, 34, 28, 41, 38, 40, 30, 35, 27, 27, 32, 44, 31],

  // New Testament - Pauline Epistles
  'Romans': [32, 29, 31, 25, 21, 23, 25, 39, 33, 21, 36, 21, 14, 23, 33, 27],
  '1 Corinthians': [31, 16, 23, 21, 13, 20, 40, 13, 27, 33, 34, 31, 13, 40, 58, 24],
  '2 Corinthians': [24, 17, 18, 18, 21, 18, 16, 24, 15, 18, 33, 21, 14],
  'Galatians': [24, 21, 29, 31, 26, 18],
  'Ephesians': [23, 22, 21, 32, 33, 24],
  'Philippians': [30, 30, 21, 23],
  'Colossians': [29, 23, 25, 18],
  '1 Thessalonians': [10, 20, 13, 18, 28],
  '2 Thessalonians': [12, 17, 18],
  '1 Timothy': [20, 15, 16, 16, 25, 21],
  '2 Timothy': [18, 26, 17, 22],
  'Titus': [16, 15, 15],
  'Philemon': [25],

  // New Testament - General Epistles
  'Hebrews': [14, 18, 19, 16, 14, 20, 28, 13, 28, 39, 40, 29, 25],
  'James': [27, 26, 18, 17, 20],
  '1 Peter': [25, 25, 22, 19, 14],
  '2 Peter': [21, 22, 18],
  '1 John': [10, 29, 24, 21, 21],
  '2 John': [13],
  '3 John': [14],
  'Jude': [25],

  // New Testament - Apocalypse
  'Revelation': [20, 29, 22, 11, 14, 17, 17, 13, 21, 11, 19, 17, 18, 20, 8, 21, 18, 24, 21, 15, 27, 21],
};

/**
 * Get the number of verses in a specific chapter of a book.
 * @param bookId - The canonical book ID (e.g., 'Genesis', 'Matthew')
 * @param chapter - The chapter number (1-based)
 * @returns The number of verses in that chapter, or a safe default (30) if not found
 */
export function getVerseCount(bookId: string, chapter: number): number {
  const chapters = VERSE_COUNTS[bookId];
  if (!chapters || chapter < 1 || chapter > chapters.length) {
    // Safe fallback for unknown books/chapters
    return 30;
  }
  return chapters[chapter - 1]; // Convert 1-based chapter to 0-based index
}

/**
 * Validate if a verse number is valid for a specific book and chapter.
 * @param bookId - The canonical book ID
 * @param chapter - The chapter number (1-based)
 * @param verse - The verse number to validate
 * @returns true if the verse exists in that chapter
 */
export function isValidVerse(bookId: string, chapter: number, verse: number): boolean {
  const maxVerses = getVerseCount(bookId, chapter);
  return verse >= 1 && verse <= maxVerses;
}

