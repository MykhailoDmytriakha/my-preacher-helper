import { act, render } from '@testing-library/react';
import { startTransition, Suspense, useRef, useState } from 'react';

import { useMarkHighlights, type MarkPainter } from '@/components/bible/marks/useMarkHighlights';

import type { BookMarks } from '@/utils/bibleMarks';

/*
 * The marks drawn over the text (CSS Custom Highlight API; jsdom has none, so a registry stands in and
 * counts what is drawn). A save hands the reader a new copy at each of its steps, and the same marks
 * drawn again at each one left an iPad's Psalms stiff after every stroke (2026-10-16). A stroke let go
 * stays drawn until its save arrives, so it never blinks out and back.
 */
let changes = 0;
class FakeHighlight extends Set<Range> {
  add(range: Range) {
    changes += 1;
    return super.add(range);
  }
  delete(range: Range) {
    changes += 1;
    return super.delete(range);
  }
}

const drawn = new Map<string, FakeHighlight>();
const set = jest.fn((name: string, highlight: FakeHighlight) => drawn.set(name, highlight));
/** The words drawn in a layer, as text. */
const words = (layer: string) => [...(drawn.get(`bible-mark-${layer}`) ?? [])].map((range) => range.toString()).sort();

beforeAll(() => {
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { highlights: { set, delete: (name: string) => drawn.delete(name) } } });
  Object.defineProperty(window, 'Highlight', { configurable: true, value: FakeHighlight });
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, 'CSS');
  Reflect.deleteProperty(window, 'Highlight');
});
beforeEach(() => {
  set.mockClear();
  drawn.clear();
  changes = 0;
});

const red = (verse: string): BookMarks => ({ [verse]: { m: [[0, 0, 'red']] } });
/** A stroke: paints the first word of a verse red; applied twice it changes nothing more. */
const strokeOn = (verse: string) => (marks: BookMarks): BookMarks => ({ ...marks, ...red(verse) });

function setUp(initial: BookMarks, text: unknown = 'book') {
  let painter: MarkPainter | null = null;
  function Reader({ marks, textKey }: { marks: BookMarks; textKey: unknown }) {
    const rootRef = useRef<HTMLElement | null>(null);
    painter = useMarkHighlights(rootRef, true, marks, textKey);
    return (
      <article ref={rootRef}>
        <div data-verse="1:1"><span data-verse-text="">alpha beta</span></div>
        <div data-verse="1:2"><span data-verse-text="">gamma delta</span></div>
        <div data-verse="1:3"><span data-verse-text="">epsilon zeta</span></div>
      </article>
    );
  }
  const view = render(<Reader marks={initial} textKey={text} />);
  return {
    painter: () => painter as unknown as MarkPainter,
    show: (marks: BookMarks, textKey: unknown = text) => view.rerender(<Reader marks={marks} textKey={textKey} />),
  };
}

describe('marks drawn over the text', () => {
  it('draws the marks once, and not again for a new copy of the same marks', () => {
    const reader = setUp(red('1:1'));
    expect(words('red')).toEqual(['alpha']);
    const drawnOnce = changes;
    reader.show({ '1:1': { m: [[0, 0, 'red']] } });
    expect(changes).toBe(drawnOnce);
    reader.show({ ...red('1:1'), ...red('1:2') });
    expect(words('red')).toEqual(['alpha', 'gamma']);
  });

  it('touches only the verses whose marks changed, each colour registered once', () => {
    // WebKit repaints every range of a highlight replaced whole: ninety marks redrawn on each word of a stroke.
    const reader = setUp({ ...red('1:1'), '1:2': { p: [[1, 1, 'gray']] } });
    const registered = set.mock.calls.length;
    const before = changes;
    reader.show({ ...red('1:1'), '1:2': { p: [[1, 1, 'gray']] }, ...red('1:3') });
    expect(changes - before).toBe(1);
    expect(set.mock.calls.length).toBe(registered);
    expect(words('red')).toEqual(['alpha', 'epsilon']);
    expect(words('pencil-gray')).toEqual(['delta']);
    reader.show({ '1:2': { p: [[1, 1, 'gray']] } });
    expect(words('red')).toEqual([]);
    expect(words('pencil-gray')).toEqual(['delta']);
  });

  it('keeps a stroke let go drawn until the marks hold it, though an earlier stroke\'s save comes first', () => {
    const reader = setUp({});
    const first = strokeOn('1:1');
    const second = strokeOn('1:2');
    act(() => reader.painter().release(first));
    act(() => reader.painter().release(second));
    expect(words('red')).toEqual(['alpha', 'gamma']);
    // The first stroke's save arrives, without the second yet: the second stays drawn.
    reader.show(first({}));
    expect(words('red')).toEqual(['alpha', 'gamma']);
    const drawnBefore = changes;
    // The second's save arrives: the marks hold both, and nothing is drawn again.
    reader.show(second(first({})));
    expect(changes).toBe(drawnBefore);
    expect(reader.painter().shown()).toEqual(second(first({})));
  });

  it('a stroke the marks never come to hold — the person took the server\'s version — is let go after a moment', () => {
    jest.useFakeTimers();
    try {
      const reader = setUp({});
      act(() => reader.painter().release(strokeOn('1:3')));
      expect(words('red')).toEqual(['epsilon']);
      act(() => { jest.advanceTimersByTime(3_100); });
      expect(words('red')).toEqual([]);
      expect(reader.painter().shown()).toEqual({});
    } finally {
      jest.useRealTimers();
    }
  });

  it('a stroke whose save failed is no longer drawn', () => {
    const reader = setUp({});
    const stroke = strokeOn('1:2');
    act(() => reader.painter().release(stroke));
    act(() => reader.painter().drop(stroke));
    expect(words('red')).toEqual([]);
  });

  it('a stroke not kept leaves the marks as they were', () => {
    const reader = setUp(red('1:1'));
    act(() => reader.painter().draw({ ...red('1:1'), ...red('1:3') }));
    expect(words('red')).toEqual(['alpha', 'epsilon']);
    act(() => reader.painter().release(null));
    expect(words('red')).toEqual(['alpha']);
  });

  it('a stroke being drawn stays over the marks when they change under it', () => {
    const reader = setUp({});
    act(() => reader.painter().draw(red('1:2')));
    reader.show(red('1:1'));
    expect(words('red')).toEqual(['gamma']);
  });

  // Codex's review, 2026-10-16: an eraser over bare words, held, hid what came after it.
  it('holds nothing for a stroke that changes nothing: an eraser over bare words hides no mark from another device', () => {
    const reader = setUp({});
    const erase = (marks: BookMarks): BookMarks => {
      const next = { ...marks };
      delete next['1:1'];
      return next;
    };
    act(() => reader.painter().release(erase));
    reader.show({ '1:1': { m: [[0, 0, 'blue']] } });
    expect(words('blue')).toEqual(['alpha']);
  });

  it('settles strokes over the same words in their order: erased then red again, saved together, shows red', () => {
    const reader = setUp(red('1:1'));
    const erase = (marks: BookMarks): BookMarks => {
      const next = { ...marks };
      delete next['1:1'];
      return next;
    };
    act(() => reader.painter().release(erase));
    expect(words('red')).toEqual([]);
    act(() => reader.painter().release(strokeOn('1:1')));
    expect(words('red')).toEqual(['alpha']);
    // Both saves arrive as one draft: red, as the last stroke left it. The eraser before it holds on
    // until it expires, and the red after it still shows over it.
    reader.show({ '1:1': { m: [[0, 0, 'red']] } });
    expect(words('red')).toEqual(['alpha']);
    expect(reader.painter().shown()).toEqual(red('1:1'));
  });

  it('a stroke being drawn does not cross to another text', () => {
    const reader = setUp({});
    act(() => reader.painter().draw(red('1:2')));
    reader.show({}, 'another book');
    expect(words('red')).toEqual([]);
  });

  it('another text — another book or Bible — drops the strokes held over the last one', () => {
    const reader = setUp({});
    act(() => reader.painter().release(strokeOn('1:2')));
    reader.show({}, 'another book');
    expect(words('red')).toEqual([]);
    expect(reader.painter().shown()).toEqual({});
  });

  // Codex's review, 2026-10-16: marks written into the painter while React rendered leaked from a render
  // that was set aside, and a held stroke's timer painted marks the page never showed.
  it('paints only what React has committed, never a render set aside', async () => {
    jest.useFakeTimers();
    try {
      const never = new Promise(() => undefined);
      let painter: MarkPainter | null = null;
      let showMarks: (marks: BookMarks) => void = () => undefined;
      const blue: BookMarks = { '1:1': { m: [[0, 0, 'blue']] } };
      function Reader({ marks }: { marks: BookMarks }) {
        const rootRef = useRef<HTMLElement | null>(null);
        painter = useMarkHighlights(rootRef, true, marks, 'book');
        if (marks === blue) throw never;
        return <article ref={rootRef}><div data-verse="1:1"><span data-verse-text="">alpha beta</span></div></article>;
      }
      function App() {
        const [marks, setMarks] = useState<BookMarks>({});
        showMarks = setMarks;
        return <Suspense fallback={<p>wait</p>}><Reader marks={marks} /></Suspense>;
      }
      render(<App />);
      act(() => (painter as unknown as MarkPainter).release(strokeOn('1:1')));
      await act(async () => { startTransition(() => showMarks(blue)); });
      expect(words('red')).toEqual(['alpha']);
      act(() => { jest.advanceTimersByTime(3_100); });
      expect(words('blue')).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });
});
