import { MINIMAP_GEOMETRY, buildMinimapLayout, firstVisibleLine, minimapOffset, verseAtY } from '@/components/bible/minimapLayout';

const geometry = { ...MINIMAP_GEOMETRY, width: 90, charsPerLine: 90, lineStep: 3, verseGap: 1, chapterGap: 8, labelHeight: 13 };

describe('buildMinimapLayout', () => {
  const chapters = [
    ['¶' + 'а'.repeat(45), 'б'.repeat(200)],
    ['<J>' + 'в'.repeat(90) + '</J>'],
  ];
  const layout = buildMinimapLayout(chapters, geometry);

  it('draws one stroke per line of a verse, its length following the words without marks', () => {
    expect(layout.lines.map(({ y, width, chapter, verse }) => [y, width, chapter, verse])).toEqual([
      [13, 45, 1, 1],
      [17, 90, 1, 2],
      [20, 90, 1, 2],
      [23, 20, 1, 2],
      [48, 90, 2, 1],
    ]);
  });

  it('puts a label above every chapter and remembers where each verse starts', () => {
    expect(layout.labels).toEqual([{ y: 0, chapter: 1 }, { y: 35, chapter: 2 }]);
    expect(layout.verseTop).toEqual([[13, 17], [48]]);
    expect(layout.height).toBe(52);
  });
});

describe('verseAtY', () => {
  const layout = buildMinimapLayout([['а'.repeat(10), 'б'.repeat(10)], ['в'.repeat(10)]], geometry);

  it('finds the verse under a point, and clamps above the first and below the last line', () => {
    expect(verseAtY(layout, 0)).toEqual({ chapter: 1, verse: 1 });
    expect(verseAtY(layout, 17)).toEqual({ chapter: 1, verse: 2 });
    expect(verseAtY(layout, 19)).toEqual({ chapter: 1, verse: 2 });
    expect(verseAtY(layout, 999)).toEqual({ chapter: 2, verse: 1 });
    expect(verseAtY(buildMinimapLayout([], geometry), 5)).toBeNull();
  });

  it('opens the chapter whose label is pressed, not the end of the chapter before it', () => {
    // Chapter 2's label is at y 29, its first stroke at 42; the last stroke above the label belongs to 1:2.
    expect(layout.labels[1]).toEqual({ y: 29, chapter: 2 });
    expect(verseAtY(layout, 30)).toEqual({ chapter: 2, verse: 1 });
    expect(verseAtY(layout, 25)).toEqual({ chapter: 1, verse: 2 });
  });

  it('starts drawing at the first stroke that can show in the box', () => {
    expect(firstVisibleLine(layout, -10)).toBe(0);
    expect(firstVisibleLine(layout, 18)).toBe(1);
    expect(firstVisibleLine(layout, 999)).toBe(layout.lines.length - 1);
  });
});

describe('minimapOffset', () => {
  it('stays still while the map fits, and moves with the page when it does not', () => {
    expect(minimapOffset(400, 600, 0.5)).toBe(0);
    expect(minimapOffset(1600, 600, 0)).toBe(0);
    expect(minimapOffset(1600, 600, 0.5)).toBe(500);
    expect(minimapOffset(1600, 600, 1.4)).toBe(1000);
  });
});
