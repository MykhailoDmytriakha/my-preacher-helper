import { readFileSync } from 'node:fs';
import path from 'node:path';

import { BIBLE_BOOKS_DATA } from '@/utils/bibleBooks';
import { PROTESTANT_BOOKS, SYNODAL_BOOKS, bookSequence, booksOf, linesOf, partsOf } from '@/components/bible/bookOrder';
import { BOOK_PART_TONES } from '@/utils/themeColors';
import { bookSlug } from '@/utils/bibleText';

const TEXT = path.join(__dirname, '../../../public/bible-text/rst/v1');

/** The order of the RST+ module's `books` table, by MyBible book number (read 2026-10-13). */
const RST_MODULE_ORDER = [
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 190, 220, 230, 240, 250, 260, 290, 300, 310, 330, 340, 350,
  360, 370, 380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 510, 660, 670, 680, 690, 700, 710, 720, 520, 530, 540,
  550, 560, 570, 580, 590, 600, 610, 620, 630, 640, 650, 730,
];

describe('the order of the books', () => {
  it('lists every book once', () => {
    const ids = bookSequence(SYNODAL_BOOKS);
    expect(new Set(ids).size).toBe(66);
    expect([...ids].sort()).toEqual(BIBLE_BOOKS_DATA.map((book) => book.id).sort());
  });

  it('is the Synodal translation\'s own: the general epistles after Acts, then Paul\'s', () => {
    const sources = bookSequence(SYNODAL_BOOKS).map((id) => {
      const file = JSON.parse(readFileSync(path.join(TEXT, `${bookSlug(id)}.json`), 'utf8')) as { source: number };
      return file.source;
    });
    expect(sources).toEqual(RST_MODULE_ORDER);
  });

  it.each(['kjv', 'ubio'] as const)('is the %s edition\'s own: Paul\'s letters first, as MyBible numbers the books', (bible) => {
    expect(booksOf(bible)).toBe(PROTESTANT_BOOKS);
    const sources = bookSequence(PROTESTANT_BOOKS).map((id) => {
      const file = JSON.parse(readFileSync(path.join(__dirname, `../../../public/bible-text/${bible}/v1`, `${bookSlug(id)}.json`), 'utf8')) as { source: number };
      return file.source;
    });
    expect(sources).toEqual([...sources].sort((a, b) => a - b));
    expect(new Set(bookSequence(PROTESTANT_BOOKS)).size).toBe(66);
  });

  it('gives the Synodal its own order', () => {
    expect(booksOf('rst')).toBe(SYNODAL_BOOKS);
  });
});

/*
 * Parts are for the eye: a list shows a part's books together, in the part's colour (Philemon among the letters from
 * prison, after Colossians), while reading keeps the order the Bible prints (owner, 2026-11-21, canvas «Библия — группы книг»).
 */
describe('the parts of a group', () => {
  const everyGroup = [...SYNODAL_BOOKS, ...PROTESTANT_BOOKS].flatMap((testament) => testament.groups);

  it('hold exactly the books of their group, each once', () => {
    for (const group of everyGroup) {
      if (!group.parts) continue;
      expect([...group.parts.flatMap((part) => part.ids)].sort()).toEqual([...group.ids].sort());
    }
  });

  it('are never more than the colours there are', () => {
    for (const group of everyGroup) expect((partsOf(group) ?? []).length).toBeLessThanOrEqual(BOOK_PART_TONES.length);
  });

  it('are the ones the owner set, in his order, and Philemon stands among the letters from prison', () => {
    const shown = (testament: 0 | 1) => Object.fromEntries(SYNODAL_BOOKS[testament].groups.map((group) => [group.key, partsOf(group)?.map((part) => [part.key, part.ids]) ?? null]));
    expect(shown(0)).toEqual({
      law: null,
      history: [['enteredLand', ['Joshua', 'Judges', 'Ruth']], ['kings', ['1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles']], ['exile', ['Ezra', 'Nehemiah', 'Esther']]],
      wisdom: [['jobAndPsalms', ['Job', 'Psalms']], ['solomon', ['Proverbs', 'Ecclesiastes', 'Song of Solomon']]],
      prophets: [['majorProphets', ['Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel']], ['minorProphets', ['Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi']]],
    });
    expect(shown(1)).toEqual({
      gospels: null,
      acts: null,
      generalEpistles: [['james', ['James']], ['peter', ['1 Peter', '2 Peter']], ['john', ['1 John', '2 John', '3 John']], ['jude', ['Jude']]],
      paulineEpistles: [
        ['greatEpistles', ['Romans', '1 Corinthians', '2 Corinthians', 'Galatians']],
        ['prisonEpistles', ['Ephesians', 'Philippians', 'Colossians', 'Philemon']],
        ['thessalonians', ['1 Thessalonians', '2 Thessalonians']],
        ['pastoralEpistles', ['1 Timothy', '2 Timothy', 'Titus']],
        ['hebrews', ['Hebrews']],
      ],
      revelation: null,
    });
  });

  // The owner, 2026-11-21: «с новой строки — Первое Царство, Ездра, Осия, Иоанна, Ефесянам, Фессалоникийцам, Тимофею»;
  // Jude continues after 3 John.
  it('stand in the owner\'s lines', () => {
    const lines = Object.fromEntries([...SYNODAL_BOOKS[0].groups, ...SYNODAL_BOOKS[1].groups].map((group) => {
      const parts = partsOf(group);
      return [group.key, parts ? linesOf(parts).map((line) => line.map((part) => part.key)) : null];
    }));
    expect(lines).toEqual({
      law: null,
      history: [['enteredLand'], ['kings'], ['exile']],
      wisdom: [['jobAndPsalms', 'solomon']],
      prophets: [['majorProphets'], ['minorProphets']],
      gospels: null,
      acts: null,
      generalEpistles: [['james', 'peter'], ['john', 'jude']],
      paulineEpistles: [['greatEpistles'], ['prisonEpistles'], ['thessalonians'], ['pastoralEpistles', 'hebrews']],
      revelation: null,
    });
  });

  it('leave reading as the Bible prints it: after Colossians comes 1 Thessalonians, after Titus Philemon', () => {
    const reading = bookSequence(SYNODAL_BOOKS);
    expect(reading[reading.indexOf('Colossians') + 1]).toBe('1 Thessalonians');
    expect(reading[reading.indexOf('Titus') + 1]).toBe('Philemon');
    expect(reading[reading.indexOf('Philemon') + 1]).toBe('Hebrews');
  });
});
