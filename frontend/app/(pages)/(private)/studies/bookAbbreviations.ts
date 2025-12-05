/**
 * Book abbreviations and formatting utilities for Scripture reference badges.
 * Uses localized data from bibleData.ts
 */

import { getLocalizedAbbrev, BibleLocale, psalmHebrewToSeptuagint } from './bibleData';

/**
 * Legacy abbreviations map for backward compatibility.
 * @deprecated Use getLocalizedAbbrev() from bibleData.ts instead
 */
export const BOOK_ABBREVIATIONS: Record<string, string> = {
  // Old Testament
  Genesis: 'Быт',
  Exodus: 'Исх',
  Leviticus: 'Лев',
  Numbers: 'Чис',
  Deuteronomy: 'Втор',
  Joshua: 'И.Нав',
  Judges: 'Суд',
  Ruth: 'Руф',
  '1 Samuel': '1Цар',
  '2 Samuel': '2Цар',
  '1 Kings': '3Цар',
  '2 Kings': '4Цар',
  '1 Chronicles': '1Пар',
  '2 Chronicles': '2Пар',
  Ezra: 'Езд',
  Nehemiah: 'Неем',
  Esther: 'Есф',
  Job: 'Иов',
  Psalms: 'Пс',
  Proverbs: 'Притч',
  Ecclesiastes: 'Еккл',
  'Song of Solomon': 'Песн',
  Isaiah: 'Ис',
  Jeremiah: 'Иер',
  Lamentations: 'Плач',
  Ezekiel: 'Иез',
  Daniel: 'Дан',
  Hosea: 'Ос',
  Joel: 'Иоил',
  Amos: 'Ам',
  Obadiah: 'Авд',
  Jonah: 'Ион',
  Micah: 'Мих',
  Nahum: 'Наум',
  Habakkuk: 'Авв',
  Zephaniah: 'Соф',
  Haggai: 'Агг',
  Zechariah: 'Зах',
  Malachi: 'Мал',
  // New Testament
  Matthew: 'Мф',
  Mark: 'Мк',
  Luke: 'Лк',
  John: 'Ин',
  Acts: 'Деян',
  Romans: 'Рим',
  '1 Corinthians': '1Кор',
  '2 Corinthians': '2Кор',
  Galatians: 'Гал',
  Ephesians: 'Еф',
  Philippians: 'Флп',
  Colossians: 'Кол',
  '1 Thessalonians': '1Фес',
  '2 Thessalonians': '2Фес',
  '1 Timothy': '1Тим',
  '2 Timothy': '2Тим',
  Titus: 'Тит',
  Philemon: 'Флм',
  Hebrews: 'Евр',
  James: 'Иак',
  '1 Peter': '1Пет',
  '2 Peter': '2Пет',
  '1 John': '1Ин',
  '2 John': '2Ин',
  '3 John': '3Ин',
  Jude: 'Иуд',
  Revelation: 'Откр',
};

/**
 * Formats a Scripture reference into a compact display string.
 * Uses localized abbreviation based on provided locale.
 *
 * IMPORTANT: For Psalms, the chapter number is converted from the standard Hebrew/Protestant
 * numbering (used for storage) to the user's locale numbering for display.
 * - EN uses Hebrew numbering (displayed as-is)
 * - RU/UK use Septuagint numbering (converted from Hebrew for display)
 *
 * Supports flexible reference types:
 * - Book only: { book: 'Ezekiel' } -> "Иез." (ru)
 * - Chapter only: { book: 'Psalms', chapter: 23 } -> "Пс.22" (ru, Septuagint)
 * - Chapter range: { book: 'Matthew', chapter: 5, toChapter: 7 } -> "Мф.5-7"
 * - Verse: { book: 'John', chapter: 3, fromVerse: 16 } -> "Ин.3:16"
 * - Verse range: { book: 'Isaiah', chapter: 4, fromVerse: 5, toVerse: 8 } -> "Ис.4:5-8"
 */
export function formatScriptureRef(
  ref: {
    book: string;
    chapter?: number;
    toChapter?: number;
    fromVerse?: number;
    toVerse?: number;
  },
  locale?: BibleLocale
): string {
  // Use localized abbreviation if locale provided, otherwise fallback to Russian
  const abbr = locale
    ? getLocalizedAbbrev(ref.book, locale)
    : BOOK_ABBREVIATIONS[ref.book] || ref.book;

  // Book-only reference (e.g., "Ezekiel")
  if (ref.chapter === undefined) {
    return abbr;
  }

  // Convert Psalm number from Hebrew (storage) to Septuagint (RU/UK display)
  let displayChapter = ref.chapter;
  if (ref.book === 'Psalms' && locale && (locale === 'ru' || locale === 'uk')) {
    displayChapter = psalmHebrewToSeptuagint(ref.chapter);
  }

  // Chapter range (e.g., "Matthew 5-7")
  if (ref.toChapter !== undefined) {
    let displayToChapter = ref.toChapter;
    if (ref.book === 'Psalms' && locale && (locale === 'ru' || locale === 'uk')) {
      displayToChapter = psalmHebrewToSeptuagint(ref.toChapter);
    }
    return `${abbr}.${displayChapter}-${displayToChapter}`;
  }

  // Chapter-only reference (e.g., "Psalm 23")
  if (ref.fromVerse === undefined) {
    return `${abbr}.${displayChapter}`;
  }

  // Verse or verse range
  const verseRange =
    ref.toVerse && ref.toVerse !== ref.fromVerse
      ? `${ref.fromVerse}-${ref.toVerse}`
      : String(ref.fromVerse);

  return `${abbr}.${displayChapter}:${verseRange}`;
}

