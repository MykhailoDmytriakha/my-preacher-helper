import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';

import { useMarkStrokes } from '@/components/bible/marks/useMarkStrokes';
import { wordAtPoint } from '@/components/bible/marks/verseWordDom';
import { countVerseWords, verseOrder } from '@/utils/bibleMarks';

jest.mock('@/utils/appDiagnostics', () => ({ ...jest.requireActual('@/utils/appDiagnostics'), recordDiagnostic: jest.fn() }));
jest.mock('@/components/bible/marks/verseWordDom', () => ({ ...jest.requireActual('@/components/bible/marks/verseWordDom'), wordAtPoint: jest.fn() }));

/*
 * The word under a moving pointer is looked up once a frame. A release that comes before that frame
 * — outside the text, where no word is — still keeps the word the pointer reached (Codex's review of
 * the marks, 2026-10-16).
 */
const order = verseOrder([['one two three']], countVerseWords);

describe('a stroke released before its last move was drawn', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the word the pointer reached, though the release is outside the text', () => {
    const save = jest.fn();
    jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    // x = 0: the first word; x = 20: the third; x = 100: outside the text.
    jest.mocked(wordAtPoint).mockImplementation((_root, x) => (x === 100 ? null : { verse: '1:1', index: x === 20 ? 2 : 0 }));
    function Harness() {
      const rootRef = useRef<HTMLElement | null>(null);
      useMarkStrokes({ rootRef, ready: true, order, marks: {}, save, armed: true, begin: () => ({ tool: 'marker', color: 'red' }), preview: jest.fn(), enabled: true });
      return <article ref={rootRef}><div data-verse="1:1"><span data-testid="words">one two three</span></div></article>;
    }
    render(<Harness />);
    const pointer = (type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x });
      Object.defineProperties(event, { pointerType: { value: 'mouse' }, pointerId: { value: 1 } });
      act(() => { screen.getByTestId('words').dispatchEvent(event); });
    };
    pointer('pointerdown', 0);
    pointer('pointermove', 20);
    pointer('pointerup', 100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]({})).toEqual({ '1:1': { m: [[0, 2, 'red']] } });
  });
});
