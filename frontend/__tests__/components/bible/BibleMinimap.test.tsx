import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BibleMinimap, visibleVerseRange } from '@/components/bible/BibleMinimap';
import { buildMinimapLayout, frameOnMap, minimapOffset, verseAtY } from '@/components/bible/minimapLayout';

// Forty chapters of twenty-five one-line verses: a map of ~4800 px, far taller than its box.
const CHAPTERS = 40;
const VERSES = 25;
const ROW = 30;
const READING_TOP = 100;
const chapters = Array.from({ length: CHAPTERS }, () => Array.from({ length: VERSES }, () => 'а'.repeat(60)));
const layout = buildMinimapLayout(chapters);
// The box the minimap gives itself in a 768 px window under a reading top of 100.
const BOX = 768 - READING_TOP - 24;

let pageY = 0;
const rowOf = ({ chapter, verse }: { chapter: number; verse: number }) => (chapter - 1) * VERSES + verse - 1;

function bookArticle() {
  const article = document.createElement('article');
  for (let chapter = 1; chapter <= CHAPTERS; chapter++) {
    for (let verse = 1; verse <= VERSES; verse++) {
      const row = document.createElement('div');
      row.dataset.verse = `${chapter}:${verse}`;
      const index = rowOf({ chapter, verse });
      row.getBoundingClientRect = () => {
        const top = READING_TOP + index * ROW - pageY;
        return { top, bottom: top + ROW, left: 0, right: 100, width: 100, height: ROW, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
      };
      article.appendChild(row);
    }
  }
  Object.defineProperty(article, 'scrollHeight', { configurable: true, value: CHAPTERS * VERSES * ROW });
  return article;
}

const fakeContext = () =>
  ({ setTransform: jest.fn(), clearRect: jest.fn(), fillRect: jest.fn(), strokeRect: jest.fn(), fillText: jest.fn() }) as unknown as CanvasRenderingContext2D;

// jsdom has no PointerEvent, and fireEvent.pointerDown would drop clientY: a MouseEvent under the pointer's name keeps it.
const pointer = (target: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', clientY: number) =>
  fireEvent(target, new MouseEvent(type, { bubbles: true, clientY, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));

const scrollPage = (to: number) => {
  pageY = to;
  fireEvent.scroll(window);
};

const framesPass = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 40));
});

/** Where the map stands when it follows the text at the current page position. */
function followingTop(article: HTMLElement) {
  const rows = Array.from(article.querySelectorAll<HTMLElement>('[data-verse]'));
  const range = visibleVerseRange(rows, READING_TOP, window.innerHeight);
  return minimapOffset(layout.height, BOX, frameOnMap(layout, range!));
}

describe('BibleMinimap — the map leafs on its own, the text moves only on a press', () => {
  let onJump: jest.Mock;
  let article: HTMLElement;

  beforeEach(() => {
    pageY = 0;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => pageY });
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(fakeContext as never);
    article = bookArticle();
    document.body.appendChild(article);
    // The reader puts the verse pressed at the reading top.
    onJump = jest.fn((place) => {
      pageY = rowOf(place) * ROW;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    article.remove();
  });

  const renderMap = () => {
    render(
      <BibleMinimap
        layout={layout}
        textRef={{ current: article }}
        chapterLabel={(chapter) => `Chapter ${chapter}`}
        placeLabel={({ chapter, verse }) => `${chapter}:${verse}`}
        readingLabel={({ chapter, verse }) => `Reading ${chapter}:${verse}`}
        title="Book minimap"
        readingTop={READING_TOP}
        onJump={onJump}
      />,
    );
    return screen.getByTestId('bible-minimap-scroller');
  };

  it('moves the text to the verse pressed when the press ends, not when it starts', () => {
    const map = renderMap();
    pointer(map, 'pointerdown', 300);
    expect(onJump).not.toHaveBeenCalled();
    pointer(map, 'pointerup', 300);
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(verseAtY(layout, 300));
  });

  it('a drag leafs through the map and moves no text', () => {
    const map = renderMap();
    pointer(map, 'pointerdown', 400);
    pointer(map, 'pointermove', 100);
    pointer(map, 'pointerup', 100);
    expect(map.scrollTop).toBe(300);
    expect(onJump).not.toHaveBeenCalled();
    expect(pageY).toBe(0);
  });

  it('leafed far from the verse being read, shows a mark at the edge that brings the map back without moving the text', async () => {
    const map = renderMap();
    map.scrollTop = 2000;
    fireEvent.scroll(map);
    const back = await screen.findByTestId('bible-minimap-back');
    expect(back).toHaveTextContent('↑ Reading 1:1');

    fireEvent.click(back);
    await waitFor(() => expect(map.scrollTop).toBe(0), { timeout: 2000 });
    expect(onJump).not.toHaveBeenCalled();
    expect(pageY).toBe(0);
    await waitFor(() => expect(screen.queryByTestId('bible-minimap-back')).not.toBeInTheDocument());
  });

  it('after a press near the top, the frame comes to its place a little at a time as the text is read on', async () => {
    scrollPage(rowOf({ chapter: 20, verse: 1 }) * ROW);
    const map = renderMap();
    await framesPass();
    // A press near the top of the box: the text goes there and the map stays, the frame under the pointer.
    const pressedAt = map.scrollTop;
    pointer(map, 'pointerdown', 20);
    pointer(map, 'pointerup', 20);
    expect(onJump).toHaveBeenCalledWith(verseAtY(layout, pressedAt + 20));
    fireEvent.scroll(window);
    expect(map.scrollTop).toBe(pressedAt);

    const gap = pressedAt - followingTop(article);
    expect(gap).toBeGreaterThan(100);
    scrollPage(pageY + 100);
    // One step of reading closes a part of the gap, not all of it.
    expect(pressedAt - map.scrollTop).toBeGreaterThan(0);
    expect(map.scrollTop - followingTop(article)).toBeGreaterThan(gap / 2);

    for (let step = 0; step < 40; step++) scrollPage(pageY + 100);
    expect(map.scrollTop).toBe(followingTop(article));
  });
});
