import { passageAway, passageKeys, restingScrollTop } from '@/components/bible/verseSheetGeometry';
import { verseCount } from '@/utils/versification';

describe('passageKeys — the rows a reference lights in the Bible read', () => {
  it('lights a verse and a passage as named', () => {
    expect(passageKeys({ bible: 'rst', book: 'Romans', chapter: 8, fromVerse: 28 }, 'rst')).toEqual(['8:28']);
    expect(passageKeys({ bible: 'rst', book: 'Romans', chapter: 12, fromVerse: 1, toVerse: 2 }, 'rst')).toEqual(['12:1', '12:2']);
  });

  it('lights every verse of a chapter named whole', () => {
    const keys = passageKeys({ bible: 'rst', book: 'Romans', chapter: 13 }, 'rst');
    expect(keys).toHaveLength(verseCount('rst', 'Romans', 13));
    expect(keys[0]).toBe('13:1');
    expect(keys.at(-1)).toBe(`13:${verseCount('rst', 'Romans', 13)}`);
  });

  it('reads a verse over a chapter range left beside it, as every screen does', () => {
    // Old data carries both; the printed reference and the numbering module let the verse win.
    expect(passageKeys({ bible: 'rst', book: 'John', chapter: 3, fromVerse: 16, toChapter: 4, toVerse: 18 }, 'rst')).toEqual(['3:16', '3:17', '3:18']);
  });

  it('reads a chapter range only as far as the book goes, at once', () => {
    const started = Date.now();
    const keys = passageKeys({ bible: 'rst', book: 'Revelation', chapter: 22, toChapter: 999_999_999_999 }, 'rst');
    expect(keys).toHaveLength(verseCount('rst', 'Revelation', 22));
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('lights nothing for a chapter or a verse the book does not have', () => {
    expect(passageKeys({ bible: 'rst', book: 'Romans', chapter: 25 }, 'rst')).toEqual([]);
    expect(passageKeys({ bible: 'rst', book: 'Romans', chapter: 8, fromVerse: 999 }, 'rst')).toEqual([]);
  });

  it('finds the verses in the Bible read when the reference is numbered in another', () => {
    // "Create in me a clean heart": Synodal Psalm 50:12 is King James Psalm 51:10.
    expect(passageKeys({ bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12 }, 'kjv')).toEqual(['51:10']);
    // A whole Synodal Psalm 22 is the whole King James Psalm 23.
    const shepherd = passageKeys({ bible: 'rst', book: 'Psalms', chapter: 22 }, 'kjv');
    expect(new Set(shepherd.map((key) => key.split(':')[0]))).toEqual(new Set(['23']));
  });

  it('lights nothing for a reference with no chapter', () => {
    expect(passageKeys({ bible: 'rst', book: 'Romans' }, 'rst')).toEqual([]);
  });
});

describe('restingScrollTop — where the passage comes to rest', () => {
  it('puts a short passage in the middle of the window', () => {
    // A 60 px passage at 1000 in a 600 px window: its middle at the window's middle.
    expect(restingScrollTop({ top: 1000, bottom: 1060 }, 600, 5000)).toBe(1000 - 270);
  });

  it('puts a passage taller than the window at its start, just under the top', () => {
    expect(restingScrollTop({ top: 1000, bottom: 2400 }, 600, 5000)).toBe(988);
  });

  it('never scrolls before the start or past the end', () => {
    expect(restingScrollTop({ top: 20, bottom: 60 }, 600, 5000)).toBe(0);
    expect(restingScrollTop({ top: 4950, bottom: 4990 }, 600, 5000)).toBe(4400);
  });
});

describe('passageAway — which way the passage went', () => {
  const box = { top: 1000, bottom: 1060 };
  it('is up when scrolled off the top, down off the bottom, and none while any of it shows', () => {
    expect(passageAway(box, 1100, 600)).toBe('up');
    expect(passageAway(box, 200, 600)).toBe('down');
    expect(passageAway(box, 700, 600)).toBeNull();
    expect(passageAway(box, 1030, 600)).toBeNull();
  });
});
