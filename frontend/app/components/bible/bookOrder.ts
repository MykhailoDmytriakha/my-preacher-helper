/**
 * THE ORDER OF THE BOOKS IS THE TRANSLATION'S. A reader gets used to the order of the Bible he
 * reads, so every list of books and every "next book" follows the translation on screen (owner,
 * 2026-10-13). Read from each MyBible module's `books` table: the Old Testament is the same in
 * all three; in the New, the Synodal translation puts the general epistles (James … Jude) right
 * after Acts and Paul's after them, while King James and Ohienko put Paul's first.
 * Ids are BookInfo.id in bibleData.ts.
 */
import { BIBLES, type BibleId } from '@/utils/bibles';

/**
 * A part of a group: books remembered together (the Historical: into the land · the kings · exile and return).
 * Parts are for the eye — the list shows a part's books side by side, in the part's colour — never for reading.
 */
export type BookPart = { key: string; ids: string[] };
/** `ids` is the reading order, as the Bible prints the group; `parts`, when there are some, hold the same books. */
export type BookGroup = { key: string; ids: string[]; parts?: BookPart[] };
export type Testament = { key: 'old' | 'new'; groups: BookGroup[] };

const OLD_TESTAMENT: BookGroup[] = [
  { key: 'law', ids: ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'] },
  {
    key: 'history',
    ids: ['Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther'],
    parts: [
      { key: 'enteredLand', ids: ['Joshua', 'Judges', 'Ruth'] },
      { key: 'kings', ids: ['1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles'] },
      { key: 'exile', ids: ['Ezra', 'Nehemiah', 'Esther'] },
    ],
  },
  {
    key: 'wisdom',
    ids: ['Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon'],
    parts: [
      { key: 'jobAndPsalms', ids: ['Job', 'Psalms'] },
      { key: 'solomon', ids: ['Proverbs', 'Ecclesiastes', 'Song of Solomon'] },
    ],
  },
  {
    key: 'prophets',
    ids: ['Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi'],
    parts: [
      { key: 'majorProphets', ids: ['Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel'] },
      { key: 'minorProphets', ids: ['Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi'] },
    ],
  },
];

/** The Synodal translation (RST+), the text the app reads now. */
export const SYNODAL_BOOKS: Testament[] = [
  { key: 'old', groups: OLD_TESTAMENT },
  {
    key: 'new',
    groups: [
      { key: 'gospels', ids: ['Matthew', 'Mark', 'Luke', 'John'] },
      { key: 'acts', ids: ['Acts'] },
      {
        key: 'generalEpistles',
        ids: ['James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude'],
        // By author.
        parts: [
          { key: 'james', ids: ['James'] },
          { key: 'peter', ids: ['1 Peter', '2 Peter'] },
          { key: 'john', ids: ['1 John', '2 John', '3 John'] },
          { key: 'jude', ids: ['Jude'] },
        ],
      },
      {
        key: 'paulineEpistles',
        ids: ['Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews'],
        // Philemon, read after Titus, is shown among the letters from prison, after Colossians; Hebrews stands
        // apart at the end (owner, 2026-11-21).
        parts: [
          { key: 'greatEpistles', ids: ['Romans', '1 Corinthians', '2 Corinthians', 'Galatians'] },
          { key: 'prisonEpistles', ids: ['Ephesians', 'Philippians', 'Colossians', 'Philemon'] },
          { key: 'thessalonians', ids: ['1 Thessalonians', '2 Thessalonians'] },
          { key: 'pastoralEpistles', ids: ['1 Timothy', '2 Timothy', 'Titus'] },
          { key: 'hebrews', ids: ['Hebrews'] },
        ],
      },
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

/** The parts a group is shown in — `null` when it is not split: one part is the group itself. */
export const partsOf = (group: BookGroup): BookPart[] | null => (group.parts && group.parts.length > 1 ? group.parts : null);
