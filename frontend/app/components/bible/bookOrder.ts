/**
 * THE ORDER OF THE BOOKS IS THE TRANSLATION'S. A reader gets used to the order of the Bible he
 * reads, so every list of books and every "next book" follows the translation on screen (owner,
 * 2026-10-13). Read from each MyBible module's `books` table: the Old Testament is the same in
 * all three; in the New, the Synodal translation puts the general epistles (James … Jude) right
 * after Acts and Paul's after them, while King James and Ohienko put Paul's first.
 * Ids are BookInfo.id in bibleData.ts.
 */
import { BIBLES, type BibleId } from '@/utils/bibles';

export type BookGroup = { key: string; ids: string[] };
export type Testament = { key: 'old' | 'new'; groups: BookGroup[] };

const OLD_TESTAMENT: BookGroup[] = [
  { key: 'law', ids: ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'] },
  { key: 'history', ids: ['Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther'] },
  { key: 'wisdom', ids: ['Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon'] },
  { key: 'prophets', ids: ['Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi'] },
];

/** The Synodal translation (RST+), the text the app reads now. */
export const SYNODAL_BOOKS: Testament[] = [
  { key: 'old', groups: OLD_TESTAMENT },
  {
    key: 'new',
    groups: [
      { key: 'gospels', ids: ['Matthew', 'Mark', 'Luke', 'John'] },
      { key: 'acts', ids: ['Acts'] },
      { key: 'generalEpistles', ids: ['James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude'] },
      { key: 'paulineEpistles', ids: ['Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews'] },
      { key: 'revelation', ids: ['Revelation'] },
    ],
  },
];

/** The King James and Ohienko: Paul's letters first, then James … Jude. */
export const PROTESTANT_BOOKS: Testament[] = [
  { key: 'old', groups: OLD_TESTAMENT },
  {
    key: 'new',
    groups: [
      SYNODAL_BOOKS[1].groups[0],
      SYNODAL_BOOKS[1].groups[1],
      SYNODAL_BOOKS[1].groups[3],
      SYNODAL_BOOKS[1].groups[2],
      SYNODAL_BOOKS[1].groups[4],
    ],
  },
];

/** The books of a Bible in the order its edition prints them (`BibleInfo.bookOrder`). */
export const booksOf = (bible: BibleId): Testament[] => (BIBLES[bible].bookOrder === 'synodal' ? SYNODAL_BOOKS : PROTESTANT_BOOKS);

/** Every book of the translation, in its reading order. */
export const bookSequence = (testaments: Testament[]): string[] =>
  testaments.flatMap((testament) => testament.groups.flatMap((group) => group.ids));
