import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bibleCrossRefsBase, isCrossRefsShaped } from '@/utils/bibleCrossRefsCache';
import { getBookIds } from '@/utils/bibleBooks';
import {
  countCrossReferences,
  coversChapter,
  crossReferenceLabel,
  crossReferencesAt,
  crossRefsUrl,
  forgetLoadedCrossRefs,
  isMainReference,
  linksAt,
  loadCrossRefs,
  type CrossRefsBook,
} from '@/utils/crossReferences';
import { chapterCount, verseCount } from '@/utils/versification';

const index = (bookId: string) => getBookIds().indexOf(bookId);

/** A book's set in the King James numbering with the given links: "chapter:verse" → [[book, chapter, from, to, weight], …]. */
function setOf(bookId: string, links: Record<string, [string, number, number, number, number][]>): CrossRefsBook {
  const chapters: number[][][] = [];
  for (let chapter = 1; chapter <= chapterCount('kjv', bookId); chapter += 1) {
    const verses: number[][] = [];
    for (let verse = 1; verse <= verseCount('kjv', bookId, chapter); verse += 1) {
      verses.push((links[`${chapter}:${verse}`] ?? []).flatMap(([book, ...rest]) => [index(book), ...rest]));
    }
    chapters.push(verses);
  }
  return { id: bookId, chapters };
}

const realSet = (slug: string): CrossRefsBook =>
  JSON.parse(readFileSync(join(__dirname, '../../public', bibleCrossRefsBase, `${slug}.json`), 'utf8'));

describe('cross references', () => {
  it('reads a verse of the set in fives: book, chapter, first verse, last verse, weight', () => {
    const set = setOf('Isaiah', { '19:1': [['Jeremiah', 46, 1, 28, 6], ['Exodus', 12, 12, 12, 5]] });
    expect(linksAt(set, { book: 'Isaiah', chapter: 19, verse: 1 })).toEqual([
      { book: 'Jeremiah', chapter: 46, fromVerse: 1, toVerse: 28, weight: 6 },
      { book: 'Exodus', chapter: 12, fromVerse: 12, toVerse: 12, weight: 5 },
    ]);
    expect(linksAt(set, { book: 'Isaiah', chapter: 19, verse: 2 })).toEqual([]);
    expect(linksAt(set, { book: 'Isaiah', chapter: 99, verse: 1 })).toEqual([]);
  });

  it('gives a verse of the Synodal its links as places of the Synodal — the psalms move by one', () => {
    // King James Ps 18:10 is Synodal Ps 17:11; its link to KJV Ps 104:3 is Synodal Ps 103:3.
    const set = setOf('Psalms', { '18:10': [['Psalms', 104, 3, 3, 4], ['Isaiah', 19, 1, 1, 2]] });
    const found = crossReferencesAt(set, 'rst', { book: 'Psalms', chapter: 17, verse: 11 });
    expect(found).toEqual([
      { book: 'Psalms', chapter: 103, fromVerse: 3, toVerse: 3, weight: 4 },
      { book: 'Isaiah', chapter: 19, fromVerse: 1, toVerse: 1, weight: 2 },
    ]);
    expect(crossReferencesAt(set, 'kjv', { book: 'Psalms', chapter: 18, verse: 10 })[0]).toEqual({ book: 'Psalms', chapter: 104, fromVerse: 3, toVerse: 3, weight: 4 });
  });

  it('puts the strongest first, then the Bible\'s order, and keeps a link found twice once with its larger weight', () => {
    const set = setOf('Isaiah', { '19:1': [['Exodus', 12, 12, 12, 2], ['Genesis', 1, 1, 1, 2], ['Joshua', 2, 11, 11, 5], ['Exodus', 12, 12, 12, 4]] });
    const found = crossReferencesAt(set, 'kjv', { book: 'Isaiah', chapter: 19, verse: 1 });
    expect(found.map((reference) => `${reference.book} ${reference.chapter}:${reference.fromVerse} ${reference.weight}`)).toEqual([
      'Joshua 2:11 5',
      'Exodus 12:12 4',
      'Genesis 1:1 2',
    ]);
  });

  it('never gives a verse itself as its link', () => {
    const set = setOf('Isaiah', { '19:2': [['Isaiah', 19, 1, 3, 4], ['Isaiah', 19, 5, 5, 3]] });
    expect(crossReferencesAt(set, 'kjv', { book: 'Isaiah', chapter: 19, verse: 2 }).map((reference) => reference.fromVerse)).toEqual([5]);
  });

  it('a passage the numbering carries into the next chapter ends at its own chapter\'s last verse, not at its first', () => {
    // KJV Numbers 29:12-40 is Synodal 29:12-39 and 30:1 (review finding, 2026-10-16: it collapsed to "29:12").
    const set = setOf('1 Kings', { '12:32': [['Numbers', 29, 12, 40, 7]] });
    const anchor = crossReferencesAt(set, 'kjv', { book: '1 Kings', chapter: 12, verse: 32 });
    expect(anchor[0]).toMatchObject({ book: 'Numbers', chapter: 29, fromVerse: 12, toVerse: 40 });
    const synodal = crossReferencesAt(set, 'rst', { book: '1 Kings', chapter: 12, verse: 32 });
    expect(synodal[0]).toMatchObject({ book: 'Numbers', chapter: 29, fromVerse: 12, toVerse: verseCount('rst', 'Numbers', 29) });
    expect(verseCount('rst', 'Numbers', 29)).toBe(39);
  });

  it('counts each verse\'s main links (three or more independent sources) and all of them', () => {
    const set = setOf('Isaiah', { '19:1': [['Exodus', 12, 12, 12, 5], ['Joshua', 2, 11, 11, 3], ['Genesis', 1, 1, 1, 1]], '19:10': [['Exodus', 7, 19, 19, 1]] });
    const chapters = Array.from({ length: chapterCount('rst', 'Isaiah') }, (_, chapter) => Array.from({ length: verseCount('rst', 'Isaiah', chapter + 1) }, () => ''));
    const counts = countCrossReferences(set, 'rst', chapters);
    expect(counts.get('19:1')).toEqual({ main: 2, total: 3 });
    expect(counts.get('19:10')).toEqual({ main: 0, total: 1 });
    expect(counts.has('19:2')).toBe(false);
    expect(isMainReference({ book: 'Exodus', chapter: 1, fromVerse: 1, toVerse: 1, weight: 3 })).toBe(true);
    expect(isMainReference({ book: 'Exodus', chapter: 1, fromVerse: 1, toVerse: 1, weight: 2 })).toBe(false);
  });

  it('names a link as the reader names places, and a whole chapter by the chapter alone', () => {
    const whole = { book: 'Jeremiah', chapter: 46, fromVerse: 1, toVerse: 28, weight: 6 };
    expect(coversChapter(whole, 'rst')).toBe(true);
    expect(crossReferenceLabel(whole, 'rst', 'ru')).toBe('Иер 46');
    expect(crossReferenceLabel({ book: 'Exodus', chapter: 12, fromVerse: 12, toVerse: 12, weight: 5 }, 'rst', 'ru')).toBe('Исх 12:12');
    expect(crossReferenceLabel({ book: 'Psalms', chapter: 17, fromVerse: 11, toVerse: 13, weight: 4 }, 'rst', 'ru')).toBe('Пс 17:11-13');
    expect(crossReferenceLabel({ book: 'Exodus', chapter: 12, fromVerse: 12, toVerse: 12, weight: 5 }, 'kjv', 'en')).toMatch(/^Ex\w* 12:12$/);
  });

  describe('the set on disk', () => {
    it('Isaiah 19:1 in the Synodal: 14 main links, led by Jeremiah 46, Exodus 12:12 and Joshua 2:11', () => {
      const set = realSet('isaiah');
      expect(isCrossRefsShaped(set)).toBe(true);
      const found = crossReferencesAt(set, 'rst', { book: 'Isaiah', chapter: 19, verse: 1 });
      expect(found.filter(isMainReference)).toHaveLength(14);
      expect(found.slice(0, 3).map((reference) => crossReferenceLabel(reference, 'rst', 'ru'))).toEqual(['Иер 46', 'Исх 12:12', 'И.Нав 2:11']);
      // The link to KJV Psalm 18:10-12 is read as the Synodal Psalm 17:11-13.
      expect(found.map((reference) => crossReferenceLabel(reference, 'rst', 'ru'))).toContain('Пс 17:11-13');
    });

    it('every book has its file, shaped as the set and named by the book, and every passage lies inside its chapter', () => {
      const outside: string[] = [];
      for (const bookId of getBookIds()) {
        const set = realSet(bookId.toLowerCase().replace(/\s+/g, '-'));
        expect(set.id).toBe(bookId);
        expect(set.chapters).toHaveLength(chapterCount('kjv', bookId));
        set.chapters.forEach((verses, chapter) => verses.forEach((_, verse) => {
          for (const link of linksAt(set, { book: bookId, chapter: chapter + 1, verse: verse + 1 })) {
            // The modules write "Isaiah 52:13-53" for 52:13-53:12 (review finding, 2026-10-16).
            if (link.fromVerse < 1 || link.toVerse < link.fromVerse || link.toVerse > verseCount('kjv', link.book, link.chapter)) {
              outside.push(`${bookId} ${chapter + 1}:${verse + 1} → ${link.book} ${link.chapter}:${link.fromVerse}-${link.toVerse}`);
            }
          }
        }));
      }
      expect(outside).toEqual([]);
    });

    it('an anchor that is two King James verses gives its links to both — Synodal Song of Solomon 1:1 → 1 Kings 4:32', () => {
      const set = realSet('song-of-solomon');
      const kjv12 = linksAt(set, { book: 'Song of Solomon', chapter: 1, verse: 2 });
      expect(kjv12).toEqual(expect.arrayContaining([expect.objectContaining({ book: '1 Kings', chapter: 4, fromVerse: 32 })]));
    });
  });

  describe('loading a book\'s set', () => {
    beforeEach(() => forgetLoadedCrossRefs());

    const answer = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(body) } as Response);

    it('fetches the book\'s file once per visit', async () => {
      const set = setOf('Jude', {});
      const fetchFn = jest.fn(() => answer(set));
      await expect(loadCrossRefs('Jude', fetchFn as unknown as typeof fetch)).resolves.toEqual(set);
      await loadCrossRefs('Jude', fetchFn as unknown as typeof fetch);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn).toHaveBeenCalledWith(crossRefsUrl('Jude'));
      expect(crossRefsUrl('1 John')).toBe(`${bibleCrossRefsBase}/1-john.json`);
    });

    it('refuses an answer that is not the book\'s set, and asks again next time', async () => {
      const fetchFn = jest.fn()
        .mockReturnValueOnce(answer({ id: 'Jude', chapters: 'nope' }))
        .mockReturnValueOnce(answer(setOf('Jude', {})));
      await expect(loadCrossRefs('Jude', fetchFn as unknown as typeof fetch)).rejects.toThrow('not the book');
      await expect(loadCrossRefs('Jude', fetchFn as unknown as typeof fetch)).resolves.toMatchObject({ id: 'Jude' });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('refuses a failed answer', async () => {
      const fetchFn = jest.fn(() => answer(null, false));
      await expect(loadCrossRefs('Jude', fetchFn as unknown as typeof fetch)).rejects.toThrow('404');
    });
  });

  it('the shape check keeps only fives of whole numbers', () => {
    expect(isCrossRefsShaped({ id: 'Jude', chapters: [[[1, 2, 3, 3, 4], []]] })).toBe(true);
    expect(isCrossRefsShaped({ id: 'Jude', chapters: [[[1, 2, 3]]] })).toBe(false);
    expect(isCrossRefsShaped({ id: 'Jude', chapters: [[['1', 2, 3, 3, 4]]] })).toBe(false);
    expect(isCrossRefsShaped({ id: 'Jude', chapters: [] })).toBe(false);
    expect(isCrossRefsShaped('<html>')).toBe(false);
  });
});
