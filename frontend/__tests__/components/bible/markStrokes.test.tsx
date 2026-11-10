import { act, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';

import { useMarkStrokes, type TakeForHold } from '@/components/bible/marks/useMarkStrokes';
import { wordAtPoint } from '@/components/bible/marks/verseWordDom';
import { VerseCopyBar } from '@/components/bible/verseCopy/VerseCopyBar';
import { VerseHoldSurface } from '@/components/bible/verseCopy/VerseHoldSurface';
import { useVerseCopy } from '@/components/bible/verseCopy/useVerseCopy';
import { LONG_PRESS_MS } from '@/hooks/useLongPress';
import { countVerseWords, verseOrder, type BookMarks } from '@/utils/bibleMarks';

import type { MarksChange } from '@/components/bible/marks/markStore';

jest.mock('@/utils/appDiagnostics', () => ({ ...jest.requireActual('@/utils/appDiagnostics'), recordDiagnostic: jest.fn() }));
jest.mock('@/components/bible/marks/verseWordDom', () => ({ ...jest.requireActual('@/components/bible/marks/verseWordDom'), wordAtPoint: jest.fn() }));

/*
 * The word under a moving pointer is looked up once a frame. A release that comes before that frame
 * — outside the text, where no word is — still keeps the word the pointer reached (Codex's review of
 * the marks, 2026-10-16).
 */
const order = verseOrder([['one two three']], countVerseWords);

const painter = () => ({ draw: jest.fn(), release: jest.fn(), drop: jest.fn(), shown: jest.fn((): BookMarks => ({})) });

const pointer = (type: string, x: number, target: Element, pointerType = 'mouse', pointerId = 1) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x });
  Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: pointerId } });
  act(() => { target.dispatchEvent(event); });
};

let take: TakeForHold = () => () => true;
function Harness({ save, paint, armed = true }: { save: (change: MarksChange) => boolean; paint: ReturnType<typeof painter>; armed?: boolean }) {
  const rootRef = useRef<HTMLElement | null>(null);
  take = useMarkStrokes({ rootRef, ready: true, order, save, armed, begin: (pen: boolean) => (armed || pen ? { tool: 'marker', color: 'red' } : null), painter: paint, enabled: true });
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

// The owner, 2026-11-02: a Pencil held still on a verse is the verse's hold — the stroke its press began gives way to it.
describe('a Pencil\'s stroke and the verse\'s hold', () => {
  beforeEach(() => {
    jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    jest.mocked(wordAtPoint).mockImplementation((_root, x) => (x === 100 ? null : { verse: '1:1', index: x === 20 ? 2 : 0 }));
  });
  afterEach(() => jest.restoreAllMocks());

  it('hides the preview of a reserved hold and drops it on lift without saving', () => {
    const save = jest.fn((_change: MarksChange) => true);
    const paint = painter();
    render(<Harness save={save} paint={paint} armed={false} />);
    const words = screen.getByTestId('words');
    pointer('pointerdown', 0, words, 'pen');
    expect(paint.draw).toHaveBeenCalled();
    act(() => { expect(take(1, () => true)).toEqual(expect.any(Function)); });
    expect(paint.release).toHaveBeenCalledWith(null);
    pointer('pointerup', 0, words, 'pen');
    expect(save).not.toHaveBeenCalled();
  });

  it('has nothing to give up for a pointer that drew nothing', () => {
    render(<Harness save={() => true} paint={painter()} armed={false} />);
    expect(take(7, () => true)).toEqual(expect.any(Function));
  });

  // Codex, 02.11: a finger still painting while the Pencil rests — the hold does not open over it.
  it('refuses a hold while another pointer\'s stroke goes on', () => {
    render(<Harness save={() => true} paint={painter()} />);
    pointer('pointerdown', 0, screen.getByTestId('words'), 'touch');
    expect(take(7, () => true)).toBe(false);
  });
});

describe('the reader deciding between a Pencil hold and a saved stroke', () => {
  const existing: BookMarks = { '1:1': { m: [[0, 0, 'red']] } };
  const text = { id: 'hebrews', chapters: [['one two three']] };
  const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

  function Reader({ save, paint, startArmed = false }: {
    save: (change: MarksChange) => boolean; paint: ReturnType<typeof painter>; startArmed?: boolean;
  }) {
    const rootRef = useRef<HTMLElement | null>(null);
    const [armed, setArmed] = useState(startArmed);
    const copy = useVerseCopy({ textRef: rootRef, text, bible: 'kjv', bookId: 'Hebrews', enabled: !armed });
    const takeForHold = useMarkStrokes({
      rootRef, ready: true, order, save, armed,
      begin: (pen) => armed || pen ? { tool: 'marker', color: 'red' } : null, painter: paint, enabled: true,
    });
    return (
      <>
        <button aria-pressed={armed}>Marker</button>
        <VerseHoldSurface copy={copy} articleRef={rootRef} className="" onPenHold={(pointerId, stillHeldAt) => {
          const ownsStroke = takeForHold(pointerId, stillHeldAt);
          if (!ownsStroke) return false;
          return () => {
            if (!ownsStroke()) return false;
            setArmed(false);
            return true;
          };
        }}>
          <p data-verse="1:1"><span data-verse-text="">one two three</span></p>
        </VerseHoldSurface>
        <VerseCopyBar copy={copy} wide />
      </>
    );
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(wordAtPoint).mockImplementation((_root, x) => ({ verse: '1:1', index: x === 0 ? 0 : 1 }));
  });
  afterEach(() => jest.useRealTimers());

  it.each([0, 2])('selects the verse without saving after a small crossing and release at %ipx', (lift) => {
    const save = jest.fn((_change: MarksChange) => true);
    const paint = painter();
    paint.shown.mockReturnValue(existing);
    render(<Reader save={save} paint={paint} startArmed />);
    const verse = screen.getByText('one two three');

    pointer('pointerdown', 0, verse, 'pen');
    pointer('pointermove', 2, verse, 'pen');
    advance(32);
    if (lift === 0) pointer('pointermove', 0, verse, 'pen');
    advance(LONG_PRESS_MS);
    pointer('pointerup', lift, verse, 'pen');

    expect(screen.getByRole('region')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marker' })).toHaveAttribute('aria-pressed', 'false');
    expect(save).not.toHaveBeenCalled();
    expect(paint.release).toHaveBeenLastCalledWith(null);
  });

  it.each([
    [2, 32, 2, { '1:1': { m: [[0, 1, 'red']] } }],
    [20, LONG_PRESS_MS + 30, 0, { '1:1': { m: [[0, 0, 'red']] } }],
  ])('keeps a stroke moved %ipx and released after %ims', (reach, duration, lift, expected) => {
    const save = jest.fn((_change: MarksChange) => true);
    render(<Reader save={save} paint={painter()} />);
    const verse = screen.getByText('one two three');

    pointer('pointerdown', 0, verse, 'pen');
    pointer('pointermove', reach, verse, 'pen');
    advance(16);
    if (lift === 0) pointer('pointermove', 0, verse, 'pen');
    advance(duration - 16);
    pointer('pointerup', lift, verse, 'pen');

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]({})).toEqual(expected);
  });

  it.each([true, false])('keeps movement beyond the hold limit after arming (move event: %s)', (sendMove) => {
    const save = jest.fn((_change: MarksChange) => true);
    render(<Reader save={save} paint={painter()} startArmed />);
    const verse = screen.getByText('one two three');

    pointer('pointerdown', 0, verse, 'pen');
    pointer('pointermove', 2, verse, 'pen');
    advance(LONG_PRESS_MS + 30);
    if (sendMove) {
      pointer('pointermove', 20, verse, 'pen');
      advance(32);
    }
    pointer('pointerup', 20, verse, 'pen');

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marker' })).toHaveAttribute('aria-pressed', 'true');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]({})).toEqual({ '1:1': { m: [[0, 1, 'red']] } });
  });

  it('does not select a verse over a finger stroke that started after the Pencil armed', () => {
    jest.mocked(wordAtPoint).mockImplementation((_root, x) => x === 0 ? null : { verse: '1:1', index: 1 });
    const save = jest.fn((_change: MarksChange) => true);
    render(<Reader save={save} paint={painter()} startArmed />);
    const verse = screen.getByText('one two three');

    pointer('pointerdown', 0, verse, 'pen');
    advance(LONG_PRESS_MS + 30);
    pointer('pointerdown', 2, verse, 'touch', 2);
    pointer('pointerup', 0, verse, 'pen');
    pointer('pointerup', 2, verse, 'touch', 2);

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marker' })).toHaveAttribute('aria-pressed', 'true');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]({})).toEqual({ '1:1': { m: [[1, 1, 'red']] } });
  });
});
