import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { toast } from 'sonner';

import { VerseCopyBar } from '@/components/bible/verseCopy/VerseCopyBar';
import { VerseHoldSurface } from '@/components/bible/verseCopy/VerseHoldSurface';
import { VerseMenu } from '@/components/bible/verseCopy/VerseMenu';
import { useVerseCopy } from '@/components/bible/verseCopy/useVerseCopy';
import { LONG_PRESS_MS } from '@/hooks/useLongPress';

jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

const text = { id: 'hebrews', chapters: [['First verse.', 'Second verse.']] };

/** The real hold adapter, copy state and visible controls; the reader supplies the current input owner. */
function Reader({ enabled = true }: { enabled?: boolean }) {
  const articleRef = useRef<HTMLElement | null>(null);
  const copy = useVerseCopy({ textRef: articleRef, text, bible: 'kjv', bookId: 'Hebrews', enabled });
  return (
    <>
      <VerseHoldSurface copy={copy} articleRef={articleRef} className="">
        <p data-verse="1:1"><span data-verse-text="">First verse.</span></p>
        <p data-verse="1:2"><span data-verse-text="">Second verse.</span></p>
      </VerseHoldSurface>
      <VerseMenu copy={copy} />
      <VerseCopyBar copy={copy} wide />
    </>
  );
}

function pointer(target: Element, type: string, pointerType = 'touch') {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 0 });
  Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: 1 } });
  fireEvent(target, event);
}
const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
const verse = () => screen.getByText('First verse.');

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  window.getSelection()?.removeAllRanges();
});
afterEach(() => { jest.useRealTimers(); });

describe('the current owner of a held verse', () => {
  it.each([200, LONG_PRESS_MS + 30])('does not open a menu after a tool takes the input at %ims', (delay) => {
    const { rerender } = render(<Reader />);
    const words = verse();
    pointer(words, 'pointerdown');
    advance(delay);
    rerender(<Reader enabled={false} />);
    advance(LONG_PRESS_MS + 30);
    pointer(words, 'pointerup');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('does not revive a cleared multiple-verse choice when an old hold ends under a tool', () => {
    const { rerender } = render(<Reader />);
    fireEvent.contextMenu(verse());
    fireEvent.click(screen.getByRole('menuitem', { name: 'bible.copy.several' }));
    expect(screen.getByRole('region')).toBeInTheDocument();
    const second = screen.getByText('Second verse.');
    pointer(second, 'pointerdown');
    advance(LONG_PRESS_MS + 30);
    rerender(<Reader enabled={false} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    pointer(second, 'pointerup');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  // The owner, 2026-11-06: «долгий тап на стихе начинает выбирать» — a hold chooses the verse and brings the bar. How to
  // add more is said in the bar, in the words of the hand that held (visual pass, 2026-11-07): no toast over the text.
  it.each([['touch', 'bible.copy.severalHint'], ['mouse', 'bible.copy.severalHintMouse']])('starts the choice of verses on an ordinary %s hold: the bar with its hint, no menu', (kind, hint) => {
    render(<Reader />);
    const words = verse();
    pointer(words, 'pointerdown', kind);
    advance(LONG_PRESS_MS + 30);
    pointer(words, 'pointerup', kind);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const bar = screen.getByRole('region');
    expect(bar.querySelector('[data-copy-hint]')).toHaveTextContent(new RegExp(`^${hint}$`));
    expect(toast).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'bible.copy.copy' })).toBeInTheDocument();
  });

  it.each(['touch', 'mouse'])('takes no %s hold that starts with a tool already in hand', (kind) => {
    render(<Reader enabled={false} />);
    const words = verse();
    pointer(words, 'pointerdown', kind);
    advance(LONG_PRESS_MS + 30);
    pointer(words, 'pointerup', kind);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps right-click available for reading and silent while a tool owns the text', () => {
    const { rerender } = render(<Reader />);
    fireEvent.contextMenu(verse());
    expect(screen.getByRole('menu')).toBeInTheDocument();
    rerender(<Reader enabled={false} />);
    fireEvent.contextMenu(verse());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it.each(['pointercancel', 'pointerout'])('does not open a menu after %s gives up an armed hold', (cancel) => {
    render(<Reader />);
    const words = verse();
    pointer(words, 'pointerdown');
    advance(LONG_PRESS_MS + 30);
    pointer(words, cancel);
    pointer(words, 'pointerup');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('accepts a new hold after the person puts the tool down', () => {
    const { rerender } = render(<Reader enabled={false} />);
    rerender(<Reader />);
    const words = verse();
    pointer(words, 'pointerdown');
    advance(LONG_PRESS_MS + 30);
    pointer(words, 'pointerup');
    expect(screen.getByRole('region')).toBeInTheDocument();
  });
});
