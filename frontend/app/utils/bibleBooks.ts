/**
 * THE BOOKS OF THE BIBLE: the canonical id of each book (its English name, the key every reference
 * stores), its names and abbreviations in the interface's three languages, and the book order the
 * ids are listed in. How many chapters and verses a book has, and how a place moves between
 * Bibles, is `utils/versification`: it differs between Bibles, the books' names do not.
 */

import type { AppLocale } from '@/utils/appLocale';

export interface BookInfo {
  /** Canonical ID (English name used as key) */
  id: string;
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
  { id: 'Genesis', names: { en: 'Genesis', ru: 'Бытие', uk: 'Буття' }, abbrev: { en: 'Gen', ru: 'Быт', uk: 'Бут' } },
  { id: 'Exodus', names: { en: 'Exodus', ru: 'Исход', uk: 'Вихід' }, abbrev: { en: 'Exod', ru: 'Исх', uk: 'Вих' } },
  { id: 'Leviticus', names: { en: 'Leviticus', ru: 'Левит', uk: 'Левит' }, abbrev: { en: 'Lev', ru: 'Лев', uk: 'Лев' } },
  { id: 'Numbers', names: { en: 'Numbers', ru: 'Числа', uk: 'Числа' }, abbrev: { en: 'Num', ru: 'Чис', uk: 'Чис' } },
  { id: 'Deuteronomy', names: { en: 'Deuteronomy', ru: 'Второзаконие', uk: 'Повторення Закону' }, abbrev: { en: 'Deut', ru: 'Втор', uk: 'Повт' } },

  // Old Testament - Historical Books
  { id: 'Joshua', names: { en: 'Joshua', ru: 'Иисус Навин', uk: 'Ісус Навин' }, abbrev: { en: 'Josh', ru: 'И.Нав', uk: 'І.Нав' } },
  { id: 'Judges', names: { en: 'Judges', ru: 'Судей', uk: 'Суддів' }, abbrev: { en: 'Judg', ru: 'Суд', uk: 'Суд' } },
  { id: 'Ruth', names: { en: 'Ruth', ru: 'Руфь', uk: 'Рут' }, abbrev: { en: 'Ruth', ru: 'Руф', uk: 'Рут' } },
  // Note: 1-2 Samuel (EN) = 1-2 Царств (RU), 1-2 Kings (EN) = 3-4 Царств (RU)
  { id: '1 Samuel', names: { en: '1 Samuel', ru: '1 Царств', uk: '1 Самуїлова' }, abbrev: { en: '1Sam', ru: '1Цар', uk: '1Сам' } },
  { id: '2 Samuel', names: { en: '2 Samuel', ru: '2 Царств', uk: '2 Самуїлова' }, abbrev: { en: '2Sam', ru: '2Цар', uk: '2Сам' } },
  { id: '1 Kings', names: { en: '1 Kings', ru: '3 Царств', uk: '1 Царів' }, abbrev: { en: '1Kgs', ru: '3Цар', uk: '1Цар' } },
  { id: '2 Kings', names: { en: '2 Kings', ru: '4 Царств', uk: '2 Царів' }, abbrev: { en: '2Kgs', ru: '4Цар', uk: '2Цар' } },
  { id: '1 Chronicles', names: { en: '1 Chronicles', ru: '1 Паралипоменон', uk: '1 Хроніки' }, abbrev: { en: '1Chr', ru: '1Пар', uk: '1Хр' } },
  { id: '2 Chronicles', names: { en: '2 Chronicles', ru: '2 Паралипоменон', uk: '2 Хроніки' }, abbrev: { en: '2Chr', ru: '2Пар', uk: '2Хр' } },
  { id: 'Ezra', names: { en: 'Ezra', ru: 'Ездра', uk: 'Ездра' }, abbrev: { en: 'Ezra', ru: 'Езд', uk: 'Езд' } },
  { id: 'Nehemiah', names: { en: 'Nehemiah', ru: 'Неемия', uk: 'Неемія' }, abbrev: { en: 'Neh', ru: 'Неем', uk: 'Неем' } },
  { id: 'Esther', names: { en: 'Esther', ru: 'Есфирь', uk: 'Естер' }, abbrev: { en: 'Esth', ru: 'Есф', uk: 'Ест' } },

  // Old Testament - Wisdom/Poetry
  { id: 'Job', names: { en: 'Job', ru: 'Иов', uk: 'Йов' }, abbrev: { en: 'Job', ru: 'Иов', uk: 'Йов' } },
  { id: 'Psalms', names: { en: 'Psalms', ru: 'Псалтирь', uk: 'Псалми' }, abbrev: { en: 'Ps', ru: 'Пс', uk: 'Пс' } },
  { id: 'Proverbs', names: { en: 'Proverbs', ru: 'Притчи', uk: 'Приповістки' }, abbrev: { en: 'Prov', ru: 'Притч', uk: 'Прип' } },
  { id: 'Ecclesiastes', names: { en: 'Ecclesiastes', ru: 'Екклесиаст', uk: 'Екклезіяст' }, abbrev: { en: 'Eccl', ru: 'Еккл', uk: 'Еккл' } },
  { id: 'Song of Solomon', names: { en: 'Song of Solomon', ru: 'Песнь Песней', uk: 'Пісня Пісень' }, abbrev: { en: 'Song', ru: 'Песн', uk: 'Пісн' } },

  // Old Testament - Major Prophets
  { id: 'Isaiah', names: { en: 'Isaiah', ru: 'Исаия', uk: 'Ісая' }, abbrev: { en: 'Isa', ru: 'Ис', uk: 'Іс' } },
  { id: 'Jeremiah', names: { en: 'Jeremiah', ru: 'Иеремия', uk: 'Єремія' }, abbrev: { en: 'Jer', ru: 'Иер', uk: 'Єр' } },
  { id: 'Lamentations', names: { en: 'Lamentations', ru: 'Плач Иеремии', uk: 'Плач Єремії' }, abbrev: { en: 'Lam', ru: 'Плач', uk: 'Плач' } },
  { id: 'Ezekiel', names: { en: 'Ezekiel', ru: 'Иезекииль', uk: 'Єзекіїль' }, abbrev: { en: 'Ezek', ru: 'Иез', uk: 'Єз' } },
  { id: 'Daniel', names: { en: 'Daniel', ru: 'Даниил', uk: 'Даниїл' }, abbrev: { en: 'Dan', ru: 'Дан', uk: 'Дан' } },

  // Old Testament - Minor Prophets
  { id: 'Hosea', names: { en: 'Hosea', ru: 'Осия', uk: 'Осія' }, abbrev: { en: 'Hos', ru: 'Ос', uk: 'Ос' } },
  { id: 'Joel', names: { en: 'Joel', ru: 'Иоиль', uk: 'Йоїл' }, abbrev: { en: 'Joel', ru: 'Иоил', uk: 'Йоїл' } },
  { id: 'Amos', names: { en: 'Amos', ru: 'Амос', uk: 'Амос' }, abbrev: { en: 'Amos', ru: 'Ам', uk: 'Ам' } },
  { id: 'Obadiah', names: { en: 'Obadiah', ru: 'Авдий', uk: 'Овдій' }, abbrev: { en: 'Obad', ru: 'Авд', uk: 'Овд' } },
  { id: 'Jonah', names: { en: 'Jonah', ru: 'Иона', uk: 'Йона' }, abbrev: { en: 'Jonah', ru: 'Ион', uk: 'Йон' } },
  { id: 'Micah', names: { en: 'Micah', ru: 'Михей', uk: 'Михей' }, abbrev: { en: 'Mic', ru: 'Мих', uk: 'Мих' } },
  { id: 'Nahum', names: { en: 'Nahum', ru: 'Наум', uk: 'Наум' }, abbrev: { en: 'Nah', ru: 'Наум', uk: 'Наум' } },
  { id: 'Habakkuk', names: { en: 'Habakkuk', ru: 'Аввакум', uk: 'Авакум' }, abbrev: { en: 'Hab', ru: 'Авв', uk: 'Авк' } },
  { id: 'Zephaniah', names: { en: 'Zephaniah', ru: 'Софония', uk: 'Софонія' }, abbrev: { en: 'Zeph', ru: 'Соф', uk: 'Соф' } },
  { id: 'Haggai', names: { en: 'Haggai', ru: 'Аггей', uk: 'Огій' }, abbrev: { en: 'Hag', ru: 'Агг', uk: 'Ог' } },
  { id: 'Zechariah', names: { en: 'Zechariah', ru: 'Захария', uk: 'Захарія' }, abbrev: { en: 'Zech', ru: 'Зах', uk: 'Зах' } },
  { id: 'Malachi', names: { en: 'Malachi', ru: 'Малахия', uk: 'Малахія' }, abbrev: { en: 'Mal', ru: 'Мал', uk: 'Мал' } },

  // New Testament - Gospels
  { id: 'Matthew', names: { en: 'Matthew', ru: 'От Матфея', uk: 'Від Матвія' }, abbrev: { en: 'Matt', ru: 'Мф', uk: 'Мт' } },
  { id: 'Mark', names: { en: 'Mark', ru: 'От Марка', uk: 'Від Марка' }, abbrev: { en: 'Mark', ru: 'Мк', uk: 'Мр' } },
  { id: 'Luke', names: { en: 'Luke', ru: 'От Луки', uk: 'Від Луки' }, abbrev: { en: 'Luke', ru: 'Лк', uk: 'Лк' } },
  { id: 'John', names: { en: 'John', ru: 'От Иоанна', uk: 'Від Івана' }, abbrev: { en: 'John', ru: 'Ин', uk: 'Ів' } },

  // New Testament - History
  { id: 'Acts', names: { en: 'Acts', ru: 'Деяния', uk: 'Дії' }, abbrev: { en: 'Acts', ru: 'Деян', uk: 'Дії' } },

  // New Testament - Pauline Epistles
  { id: 'Romans', names: { en: 'Romans', ru: 'К Римлянам', uk: 'До Римлян' }, abbrev: { en: 'Rom', ru: 'Рим', uk: 'Рим' } },
  { id: '1 Corinthians', names: { en: '1 Corinthians', ru: '1 Коринфянам', uk: '1 Коринтян' }, abbrev: { en: '1Cor', ru: '1Кор', uk: '1Кор' } },
  { id: '2 Corinthians', names: { en: '2 Corinthians', ru: '2 Коринфянам', uk: '2 Коринтян' }, abbrev: { en: '2Cor', ru: '2Кор', uk: '2Кор' } },
  { id: 'Galatians', names: { en: 'Galatians', ru: 'К Галатам', uk: 'До Галатів' }, abbrev: { en: 'Gal', ru: 'Гал', uk: 'Гал' } },
  { id: 'Ephesians', names: { en: 'Ephesians', ru: 'К Ефесянам', uk: 'До Ефесян' }, abbrev: { en: 'Eph', ru: 'Еф', uk: 'Еф' } },
  { id: 'Philippians', names: { en: 'Philippians', ru: 'К Филиппийцам', uk: 'До Филип\'ян' }, abbrev: { en: 'Phil', ru: 'Флп', uk: 'Флп' } },
  { id: 'Colossians', names: { en: 'Colossians', ru: 'К Колоссянам', uk: 'До Колосян' }, abbrev: { en: 'Col', ru: 'Кол', uk: 'Кол' } },
  { id: '1 Thessalonians', names: { en: '1 Thessalonians', ru: '1 Фессалоникийцам', uk: '1 Солунян' }, abbrev: { en: '1Thess', ru: '1Фес', uk: '1Сол' } },
  { id: '2 Thessalonians', names: { en: '2 Thessalonians', ru: '2 Фессалоникийцам', uk: '2 Солунян' }, abbrev: { en: '2Thess', ru: '2Фес', uk: '2Сол' } },
  { id: '1 Timothy', names: { en: '1 Timothy', ru: '1 Тимофею', uk: '1 Тимофія' }, abbrev: { en: '1Tim', ru: '1Тим', uk: '1Тим' } },
  { id: '2 Timothy', names: { en: '2 Timothy', ru: '2 Тимофею', uk: '2 Тимофія' }, abbrev: { en: '2Tim', ru: '2Тим', uk: '2Тим' } },
  { id: 'Titus', names: { en: 'Titus', ru: 'К Титу', uk: 'До Тита' }, abbrev: { en: 'Titus', ru: 'Тит', uk: 'Тит' } },
  { id: 'Philemon', names: { en: 'Philemon', ru: 'К Филимону', uk: 'До Филимона' }, abbrev: { en: 'Phlm', ru: 'Флм', uk: 'Флм' } },

  // New Testament - General Epistles
  { id: 'Hebrews', names: { en: 'Hebrews', ru: 'К Евреям', uk: 'До Євреїв' }, abbrev: { en: 'Heb', ru: 'Евр', uk: 'Євр' } },
  { id: 'James', names: { en: 'James', ru: 'Иакова', uk: 'Якова' }, abbrev: { en: 'Jas', ru: 'Иак', uk: 'Як' } },
  { id: '1 Peter', names: { en: '1 Peter', ru: '1 Петра', uk: '1 Петра' }, abbrev: { en: '1Pet', ru: '1Пет', uk: '1Пт' } },
  { id: '2 Peter', names: { en: '2 Peter', ru: '2 Петра', uk: '2 Петра' }, abbrev: { en: '2Pet', ru: '2Пет', uk: '2Пт' } },
  { id: '1 John', names: { en: '1 John', ru: '1 Иоанна', uk: '1 Івана' }, abbrev: { en: '1John', ru: '1Ин', uk: '1Ів' } },
  { id: '2 John', names: { en: '2 John', ru: '2 Иоанна', uk: '2 Івана' }, abbrev: { en: '2John', ru: '2Ин', uk: '2Ів' } },
  { id: '3 John', names: { en: '3 John', ru: '3 Иоанна', uk: '3 Івана' }, abbrev: { en: '3John', ru: '3Ин', uk: '3Ів' } },
  { id: 'Jude', names: { en: 'Jude', ru: 'Иуды', uk: 'Юди' }, abbrev: { en: 'Jude', ru: 'Иуд', uk: 'Юд' } },

  // New Testament - Apocalypse
  { id: 'Revelation', names: { en: 'Revelation', ru: 'Откровение', uk: 'Об\'явлення' }, abbrev: { en: 'Rev', ru: 'Откр', uk: 'Об' } },
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
export function getBookByName(name: string, locale?: AppLocale): BookInfo | undefined {
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
export function getLocalizedBookName(bookId: string, locale: AppLocale): string {
  const book = getBookById(bookId);
  return book?.names[locale] || bookId;
}

/**
 * Get localized book abbreviation.
 */
export function getLocalizedAbbrev(bookId: string, locale: AppLocale): string {
  const book = getBookById(bookId);
  return book?.abbrev[locale] || bookId;
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
export function getBooksForDropdown(locale: AppLocale): Array<{ id: string; name: string }> {
  return BIBLE_BOOKS_DATA.map((b) => ({
    id: b.id,
    name: b.names[locale],
  }));
}
