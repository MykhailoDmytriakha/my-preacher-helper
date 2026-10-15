import { visibleVerseRange } from '@/components/bible/BibleMinimap';

/** Verse rows 31.09 px high from `start`, the way a browser lays out lines: at fractions of a pixel. */
function rows(start: number, count: number): HTMLElement[] {
  return Array.from({ length: count }, (_, index) => {
    const row = document.createElement('div');
    row.dataset.verse = `7:${index + 1}`;
    const top = start + index * 31.09375;
    row.getBoundingClientRect = () => ({ top, bottom: top + 31.09375, left: 0, right: 100, width: 100, height: 31.09375, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    return row;
  });
}

describe('visibleVerseRange — the verse the person is at', () => {
  it('is the verse put at the reading top, though a scroll of whole pixels leaves the one above a strip of a fraction of a pixel', () => {
    // Rom 7:10 jumped to under a reading top of 137 px: the browser scrolls by whole pixels and the
    // row lands at 137.09, so 7:9 ends 0.09 px below the top — nothing a person sees.
    const list = rows(137.09375 - 9 * 31.09375, 20);
    expect(visibleVerseRange(list, 137, 963)?.[0]).toEqual({ chapter: 7, verse: 10 });
  });

  it('is the verse above while a line of it still shows', () => {
    const list = rows(137 + 4 - 9 * 31.09375, 20);
    expect(visibleVerseRange(list, 137, 963)?.[0]).toEqual({ chapter: 7, verse: 9 });
  });
});
