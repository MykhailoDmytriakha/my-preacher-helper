import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';

import { useMarkStrokes } from '@/components/bible/marks/useMarkStrokes';
import { wordAtPoint } from '@/components/bible/marks/verseWordDom';
import { countVerseWords, verseOrder } from '@/utils/bibleMarks';

import type { MarksChange } from '@/components/bible/marks/markStore';

jest.mock('@/utils/appDiagnostics', () => ({ ...jest.requireActual('@/utils/appDiagnostics'), recordDiagnostic: jest.fn() }));
jest.mock('@/components/bible/marks/verseWordDom', () => ({ ...jest.requireActual('@/components/bible/marks/verseWordDom'), wordAtPoint: jest.fn() }));

/*
 * The word under a moving pointer is looked up once a frame. A release that comes before that frame
 * — outside the text, where no word is — still keeps the word the pointer reached (Codex's review of
 * the marks, 2026-10-16).
 */
const order = verseOrder([['one two three']], countVerseWords);

const painter = () => ({ draw: jest.fn(), release: jest.fn(), drop: jest.fn(), shown: jest.fn(() => ({})) });

const pointer = (type: string, x: number, target: Element, pointerType = 'mouse') => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x });
  Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: 1 } });
  act(() => { target.dispatchEvent(event); });
};

function Harness({ save, paint, armed = true }: { save: (change: MarksChange) => boolean; paint: ReturnType<typeof painter>; armed?: boolean }) {
  const rootRef = useRef<HTMLElement | null>(null);
  useMarkStrokes({ rootRef, ready: true, order, save, armed, begin: () => (armed ? { tool: 'marker', color: 'red' } : null), painter: paint, enabled: true });
  return (
    <article ref={rootRef}>
      <div data-verse="1:1" data-testid="row"><span data-testid="words">one two three</span></div>
      <div data-verse="1:2" data-testid="other-row"><span>four five</span></div>
    </article>
  );
}

describe('a stroke released before its last move was drawn', () => {
  beforeEach(() => {
    jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    // x = 0: the first word; x = 20: the third; x = 100: outside the text.
    jest.mocked(wordAtPoint).mockImplementation((_root, x) => (x === 100 ? null : { verse: '1:1', index: x === 20 ? 2 : 0 }));
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps the word the pointer reached, though the release is outside the text, and holds the kept stroke shown', () => {
    const save = jest.fn((_change: MarksChange) => true);
    const paint = painter();
    render(<Harness save={save} paint={paint} />);
    const words = screen.getByTestId('words');
    pointer('pointerdown', 0, words);
    pointer('pointermove', 20, words);
    pointer('pointerup', 100, words);
    expect(save).toHaveBeenCalledTimes(1);
    const change = save.mock.calls[0][0];
    expect(change({})).toEqual({ '1:1': { m: [[0, 2, 'red']] } });
    // The stroke let go stays painted until its save arrives: the same change, held by the painter.
    expect(paint.release).toHaveBeenCalledWith(change);
  });

  it('a stroke that cannot be kept is let go unpainted', () => {
    const paint = painter();
    render(<Harness save={() => false} paint={paint} />);
    const words = screen.getByTestId('words');
    pointer('pointerdown', 0, words);
    pointer('pointerup', 0, words);
    expect(paint.release).toHaveBeenCalledWith(null);
  });

  it('starts from what the page shows: a stroke let go a moment ago, its save not back yet, included', () => {
    const paint = painter();
    paint.shown.mockReturnValue({ '1:1': { m: [[0, 0, 'red']] } });
    render(<Harness save={() => true} paint={paint} />);
    pointer('pointerdown', 0, screen.getByTestId('words'));
    // The first word already red: the red marker over it erases.
    expect(paint.draw).toHaveBeenLastCalledWith({});
  });
});

describe('the crosshair of a mouse with a tool in hand', () => {
  it('stands on the verse the mouse is over, never on the whole text, and goes with the tool', () => {
    const paint = painter();
    const { rerender } = render(<Harness save={() => true} paint={paint} />);
    pointer('pointermove', 0, screen.getByTestId('words'));
    expect(screen.getByTestId('row').style.cursor).toBe('crosshair');
    expect(screen.getByTestId('row').parentElement?.style.cursor).toBe('');
    pointer('pointermove', 0, screen.getByTestId('other-row'));
    expect(screen.getByTestId('row').style.cursor).toBe('');
    expect(screen.getByTestId('other-row').style.cursor).toBe('crosshair');
    rerender(<Harness save={() => true} paint={paint} armed={false} />);
    expect(screen.getByTestId('other-row').style.cursor).toBe('');
  });

  it('a finger or a Pencil wears none', () => {
    render(<Harness save={() => true} paint={painter()} />);
    pointer('pointermove', 0, screen.getByTestId('words'), 'touch');
    expect(screen.getByTestId('row').style.cursor).toBe('');
  });
});
