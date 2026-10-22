import {
  MINIMAP_GEOMETRY,
  SETTLE_RATE,
  buildMinimapLayout,
  firstVisibleLine,
  fitPressedFrame,
  MINIMAP_INSET,
  frameOnMap,
  minimapMarkRects,
  minimapOffset,
  settleOffset,
  verseAtY,
} from '@/components/bible/minimapLayout';

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

describe('settleOffset — a pressed frame comes to its place as the person reads', () => {
  // A long book: following puts the map at 0.9 of the frame's top, less 200; a box of 600 px, a frame of 100.
  const following = (frameTop: number) => 0.9 * frameTop - 200;
  const box = 600;
  const height = 100;

  /** Reads `steps` steps of `reading` map px from a frame pressed at `shown` px from the top of the box. */
  function read(shown: number, reading: number, steps: number) {
    let frameTop = 1000;
    let attachedBefore = following(frameTop);
    let mapTop = frameTop - shown;
    const shownAt = [shown];
    let settledAt: number | null = null;
    for (let index = 1; index <= steps; index++) {
      frameTop += reading;
      const attachedNow = following(frameTop);
      const step = settleOffset({ mapTop, attachedBefore, attachedNow, reading, frame: { top: frameTop, height }, boxHeight: box });
      mapTop = step.top;
      attachedBefore = attachedNow;
      shownAt.push(frameTop - mapTop);
      if (step.settled && settledAt === null) settledAt = index;
    }
    return { shownAt, settledAt, placeAt: frameTop - following(frameTop) };
  }

  it('never moves the frame against the hand: pressed near the top and read upwards, it stays near the top', () => {
    const { shownAt, settledAt } = read(20, -11, 12);
    // Its place is 300 px down; reading up it only drifts up with following, never down towards it.
    shownAt.slice(1).forEach((shown, index) => expect(shown).toBeLessThanOrEqual(shownAt[index] + 1e-9));
    expect(shownAt[shownAt.length - 1]).toBeGreaterThan(0);
    expect(settledAt).toBeNull();
  });

  it('read the way it has to go, closes the gap at an even pace no faster than twice the reading, then slows and arrives', () => {
    const { shownAt, settledAt, placeAt } = read(20, 11, 40);
    const moves = shownAt.slice(1).map((shown, index) => shown - shownAt[index]);
    // Always downwards, with the hand; never a jump: at most the reading's own on-screen pace plus SETTLE_RATE × reading.
    moves.forEach((move) => {
      expect(move).toBeGreaterThanOrEqual(0);
      expect(move).toBeLessThanOrEqual(11 * 0.1 + SETTLE_RATE * 11 + 1e-9);
    });
    // The first steps are equal; the last ones are smaller.
    expect(moves[1]).toBeCloseTo(moves[0], 6);
    expect(moves[25]).toBeLessThan(moves[0] / 4);
    expect(settledAt).not.toBeNull();
    expect(settledAt as number).toBeLessThanOrEqual(30);
    expect(shownAt[shownAt.length - 1]).toBeCloseTo(placeAt, 6);
  });

  it('pressed near the bottom, it stays there read downwards and comes up read upwards', () => {
    const downwards = read(480, 11, 12);
    downwards.shownAt.slice(1).forEach((shown, index) => expect(shown).toBeGreaterThanOrEqual(downwards.shownAt[index] - 1e-9));
    expect(downwards.settledAt).toBeNull();
    const upwards = read(480, -11, 40);
    upwards.shownAt.slice(1).forEach((shown, index) => expect(shown).toBeLessThanOrEqual(upwards.shownAt[index] + 1e-9));
    expect(upwards.settledAt).not.toBeNull();
  });

  it('pulls a frame stretched past the bottom edge back a little at a time, not at once', () => {
    // Longer verses came in: the frame is 160 px and hangs 61 px below the box.
    const step = settleOffset({ mapTop: 500, attachedBefore: 600, attachedNow: 610, reading: 11, frame: { top: 1011, height: 160 }, boxHeight: box });
    expect(step.top).toBe(543);
    expect(1011 + 160 - step.top - box).toBe(28);
  });

  it('is in place at once when nothing is left to close', () => {
    expect(settleOffset({ mapTop: 710.4, attachedBefore: 710, attachedNow: 720, reading: 11, frame: { top: 1011, height }, boxHeight: box })).toEqual({ top: 720, settled: true });
  });
});

describe('fitPressedFrame', () => {
  it('shows a frame pressed at the bottom edge whole, leaves one that fits, and keeps the top of a tall one in sight', () => {
    expect(fitPressedFrame({ top: 1000, height: 100 }, 500, 600)).toBeNull();
    expect(fitPressedFrame({ top: 1000, height: 100 }, 450, 600)).toBe(500);
    expect(fitPressedFrame({ top: 1000, height: 700 }, 900, 600)).toBe(1000);
  });
});

describe('minimapMarkRects — the person\'s marks on the map\'s right edge', () => {
  const layout = buildMinimapLayout([['a', 'b', 'c'], ['d', 'e']], geometry);

  it('stands at the height of the verse a passage starts at, a little longer than tall, as far from the right end as the text is from the left', () => {
    const [rect] = minimapMarkRects(layout, [{ chapter: 1, verse: 2, kinds: ['note'] }], 132);
    expect(rect).toEqual({ x: 120, y: layout.verseTop[0][1] + 1 - 2.5, width: 8, height: 5, kind: 'note' });
    expect(rect.width).toBeGreaterThan(rect.height);
    expect(132 - (rect.x + rect.width)).toBe(MINIMAP_INSET);
  });

  it('puts what names a whole chapter by its label, and several kinds side by side, the first outermost', () => {
    const rects = minimapMarkRects(layout, [{ chapter: 2, verse: null, kinds: ['sermon', 'note'] }], 132);
    expect(rects.map(({ x, kind }) => [x, kind])).toEqual([[120, 'sermon'], [110, 'note']]);
    expect(rects[0].y).toBe(layout.labels[1].y + 5 - 2.5);
  });

  it('leaves out a place the map does not have', () => {
    expect(minimapMarkRects(layout, [{ chapter: 7, verse: 1, kinds: ['note'] }, { chapter: 1, verse: 40, kinds: ['note'] }], 132)).toEqual([]);
  });
});
