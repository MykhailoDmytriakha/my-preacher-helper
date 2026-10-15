import { MINIMAP_GEOMETRY, buildMinimapLayout, firstVisibleLine, frameOnMap, minimapOffset, verseAtY } from '@/components/bible/minimapLayout';

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
  it('stays still while the map fits, and shows the start and the end of a longer book', () => {
    expect(minimapOffset(400, 600, { top: 200, height: 50 })).toBe(0);
    expect(minimapOffset(1600, 600, { top: 0, height: 50 })).toBe(0);
    expect(minimapOffset(1600, 600, { top: 1550, height: 50 })).toBe(1000);
  });

  // BUG-20261015-minimap-frame-clipped-at-book-end: moved by the page's scroll, the map let the frame
  // run past the bottom of the box over the last tenth of a long book.
  it('keeps the frame whole inside the box wherever it stands in the book', () => {
    const layoutHeight = 1600;
    const boxHeight = 600;
    const height = 50;
    for (let top = 0; top <= layoutHeight - height; top += 10) {
      const drawnTop = top - minimapOffset(layoutHeight, boxHeight, { top, height });
      expect(drawnTop).toBeGreaterThanOrEqual(0);
      expect(drawnTop + height).toBeLessThanOrEqual(boxHeight);
    }
  });

  it('keeps the top of a frame taller than the box in sight', () => {
    const frame = { top: 50, height: 150 };
    expect(frame.top - minimapOffset(1000, 120, frame)).toBe(0);
  });
});

describe('frameOnMap', () => {
  it('frames the verses on screen and ends with the map at the last verse of the book', () => {
    const layout = buildMinimapLayout([['a', 'b'], ['c', 'd', 'e']]);
    const middle = frameOnMap(layout, [{ chapter: 1, verse: 2 }, { chapter: 2, verse: 1 }]);
    expect(middle.top).toBe(layout.verseTop[0][1] - 2);
    expect(middle.top + middle.height).toBe(layout.verseTop[1][0] + MINIMAP_GEOMETRY.lineStep * 2);
    const end = frameOnMap(layout, [{ chapter: 2, verse: 3 }, { chapter: 2, verse: 3 }]);
    expect(end.top + end.height).toBe(layout.height);
  });

  it('takes in the label of a chapter whose first verse is on screen, so the map stands still at the start of the book', () => {
    const layout = buildMinimapLayout([['a', 'b'], ['c', 'd', 'e']]);
    const start = frameOnMap(layout, [{ chapter: 1, verse: 1 }, { chapter: 1, verse: 2 }]);
    expect(start.top).toBe(0);
    expect(minimapOffset(layout.height + 400, 400, start)).toBe(0);
    expect(frameOnMap(layout, [{ chapter: 2, verse: 1 }, { chapter: 2, verse: 2 }]).top).toBe(layout.labels[1].y);
  });
});
