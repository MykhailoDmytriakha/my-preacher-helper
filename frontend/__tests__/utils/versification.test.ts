import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getBookIds } from '@/utils/bibleBooks';
import { BIBLE_IDS, BIBLES, type BibleId } from '@/utils/bibles';
import { chapterCount, numberingEntries, placeIn, placesIn, placesInEach, verseCount, type VersePlace } from '@/utils/versification';

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');
const slug = (id: string) => id.toLowerCase().replace(/\s+/g, '-');
const text = (bible: BibleId, book: string): string[][] =>
  JSON.parse(readFileSync(join(PUBLIC_DIR, BIBLES[bible].textBase, `${slug(book)}.json`), 'utf8')).chapters;

const at = (book: string, chapter: number, verse: number): VersePlace => ({ book, chapter, verse });
const short = (places: VersePlace[]) => places.map((place) => `${place.chapter}:${place.verse}`).join(' ');

describe('every Bible is numbered as its own text', () => {
  // The net under every description in numberings.ts: a wrong rule moves a verse, and a moved verse
  // shows here as a chapter of the wrong length, a verse with no source or one fed from two chapters.
  it.each(BIBLE_IDS)('%s: every chapter has the verses its text has, and every verse a source in the original', (bible) => {
    const wrong: string[] = [];
    const sourced = new Set(numberingEntries(bible).map(([place]) => `${place.book} ${place.chapter}:${place.verse}`));
    for (const book of getBookIds()) {
      const chapters = text(bible, book);
      if (chapterCount(bible, book) !== chapters.length) wrong.push(`${book}: ${chapterCount(bible, book)} chapters, the text ${chapters.length}`);
      chapters.forEach((verses, index) => {
        if (verseCount(bible, book, index + 1) !== verses.length) wrong.push(`${book} ${index + 1}: ${verseCount(bible, book, index + 1)} verses, the text ${verses.length}`);
        verses.forEach((_, verse) => {
          if (!sourced.has(`${book} ${index + 1}:${verse + 1}`)) wrong.push(`${book} ${index + 1}:${verse + 1} has no source in the original`);
        });
      });
    }
    expect(wrong).toEqual([]);
  });

  it.each(BIBLE_IDS)('%s: no verse is fed from two chapters of the original but where a verse crosses a chapter', (bible) => {
    const crossing = numberingEntries(bible)
      .filter(([, origins]) => new Set(origins.map((origin) => `${origin.book} ${origin.chapter}`)).size > 1)
      .map(([place, origins]) => `${place.book} ${place.chapter}:${place.verse} ← ${short(origins)}`);
    // Num 25:19 and Rev 12:18 are the first words of the next chapter's first verse in both the
    // Synodal and the King James; 1 Sam 20:42 is two verses of the original in the King James.
    const known: Record<BibleId, string[]> = {
      rst: ['Numbers 26:1 ← 25:19 26:1', 'Revelation 13:1 ← 12:18 13:1'],
      kjv: ['Numbers 26:1 ← 25:19 26:1', '1 Samuel 20:42 ← 20:42 21:1', 'Revelation 13:1 ← 12:18 13:1'],
      ubio: [],
    };
    expect(crossing.sort()).toEqual(known[bible].sort());
  });
});

describe('placesIn — one place in every Bible', () => {
  it.each([
    // The Psalter: the Synodal and Ohienko follow the Septuagint, the King James the Hebrew.
    ['the shepherd psalm', 'kjv', at('Psalms', 23, 1), { rst: '22:1', ubio: '22:1' }],
    ['a clean heart', 'kjv', at('Psalms', 51, 10), { rst: '50:12', ubio: '50:12' }],
    ['Psalm 10, the second half of the Synodal 9', 'kjv', at('Psalms', 10, 1), { rst: '9:22', ubio: '9:22' }],
    ['Psalm 115, the second half of the Synodal 113', 'kjv', at('Psalms', 115, 1), { rst: '113:9', ubio: '113:9' }],
    ['Psalm 116:10, the start of the Synodal 115', 'kjv', at('Psalms', 116, 10), { rst: '115:1', ubio: '115:1' }],
    ['Psalm 147:12, the start of the Synodal 147', 'kjv', at('Psalms', 147, 12), { rst: '147:1', ubio: '147:1' }],
    // Chapters that end elsewhere.
    ['Malachi 4 is Malachi 3 of the original', 'kjv', at('Malachi', 4, 1), { rst: '4:1', ubio: '4:1' }],
    ['Joel 2:28 is Joel 3:1 in Ohienko', 'kjv', at('Joel', 2, 28), { rst: '2:28', ubio: '3:1' }],
    ['Genesis 32:1 is 32:2 of the original, as in Ohienko', 'kjv', at('Genesis', 32, 1), { rst: '32:1', ubio: '32:2' }],
    ['Exodus 8:1 is 7:26 in Ohienko', 'kjv', at('Exodus', 8, 1), { rst: '8:1', ubio: '7:26' }],
    ['the closing doxology of Romans stands after chapter 14 in the Synodal', 'kjv', at('Romans', 16, 25), { rst: '14:24', ubio: '16:25' }],
    // Verses this edition joins or divides.
    ['Acts 19:41 joins 19:40', 'kjv', at('Acts', 19, 41), { rst: '19:40', ubio: '19:40' }],
    ['the grace of Philemon is verse 24 of the Synodal', 'kjv', at('Philemon', 1, 25), { rst: '1:24', ubio: '1:25' }],
    ['Neh 7:68 (the horses) is a verse in all three', 'kjv', at('Nehemiah', 7, 68), { rst: '7:68', ubio: '7:68' }],
    ['Esther 1:7 is 1:8 of the Synodal', 'kjv', at('Esther', 1, 7), { rst: '1:8', ubio: '1:7' }],
    ['Jer 5:31 joins 5:30 in Ohienko', 'kjv', at('Jeremiah', 5, 31), { rst: '5:31', ubio: '5:30' }],
  ] as const)('%s', (_name, from, place, expected) => {
    for (const [to, where] of Object.entries(expected) as [BibleId, string][]) {
      expect(`${to} ${short(placesIn(to, from, place))}`).toBe(`${to} ${where}`);
    }
  });

  it('gives every verse that holds the place where the other Bible divides it', () => {
    // Rev 20:9 is two verses of the Synodal; a psalm's title and first words, two verses there too.
    expect(short(placesIn('rst', 'kjv', at('Revelation', 20, 9)))).toBe('20:8 20:9');
    expect(short(placesIn('rst', 'kjv', at('Psalms', 3, 1)))).toBe('3:1 3:2');
    expect(short(placesIn('kjv', 'rst', at('Psalms', 3, 1)))).toBe('3:1');
    expect(short(placesIn('kjv', 'rst', at('Psalms', 3, 2)))).toBe('3:1');
  });

  it('opens at the first of them, finds the place in several Bibles at once, and the same Bible is itself', () => {
    expect(placeIn('rst', 'kjv', at('Revelation', 20, 9))).toEqual(at('Revelation', 20, 8));
    expect(placesInEach(['rst', 'ubio'], 'kjv', at('Psalms', 23, 1))).toEqual({ rst: [at('Psalms', 22, 1)], ubio: [at('Psalms', 22, 1)] });
    expect(placesIn('rst', 'rst', at('John', 3, 16))).toEqual([at('John', 3, 16)]);
  });

  it('finds nothing for a place the Bible does not have', () => {
    expect(placesIn('kjv', 'rst', at('John', 3, 99))).toEqual([]);
    expect(placesIn('kjv', 'rst', at('Joel', 4, 1))).toEqual([]);
    expect(placesIn('kjv', 'ubio', at('Joel', 4, 1))).toEqual([at('Joel', 3, 1)]);
    expect(placesIn('kjv', 'rst', at('Nowhere', 1, 1))).toEqual([]);
  });

  it.each([['rst', 'kjv'], ['kjv', 'rst'], ['ubio', 'rst'], ['rst', 'ubio'], ['ubio', 'kjv'], ['kjv', 'ubio']] as const)(
    'brings every verse of %s back home through %s',
    (home, away) => {
      const lost = numberingEntries(home)
        .filter(([place]) => !placesIn(away, home, place).some((there) => placesIn(home, away, there).some((back) => back.book === place.book && back.chapter === place.chapter && back.verse === place.verse)))
        .map(([place]) => `${place.book} ${place.chapter}:${place.verse}`);
      expect(lost).toEqual([]);
    },
  );
});
