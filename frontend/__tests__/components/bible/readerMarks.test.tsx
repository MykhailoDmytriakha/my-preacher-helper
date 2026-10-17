import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';

import { useReaderMarks } from '@/components/bible/marks/useReaderMarks';

import type { BookText } from '@/utils/bibleText';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { meaning?: string }) => (options?.meaning ? `${key}:${options.meaning}` : key) }),
}));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'alice' } }) }));
jest.mock('@/components/bible/marks/markStore', () => ({
  ...jest.requireActual('@/components/bible/marks/markStore'),
  useBookMarks: () => ({ marks: {}, save: jest.fn(), ready: true, writable: true, others: [], sync: null }),
}));

/*
 * The text's manner where marks can be made is set once: switched with the tool, it restyled every word
 * of the book on each tap — half a second in the iPad's Psalms (2026-10-16, measured in WebKit).
 */
beforeAll(() => {
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { highlights: { set: jest.fn(), delete: jest.fn() } } });
  Object.defineProperty(window, 'Highlight', { configurable: true, value: class {} });
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, 'CSS');
  Reflect.deleteProperty(window, 'Highlight');
});

const text = { chapters: [['In the beginning']] } as unknown as BookText;

function Reader() {
  const textRef = useRef<HTMLElement | null>(null);
  const marks = useReaderMarks({ textRef, text, ready: true, bible: 'kjv', bookId: 'Genesis' });
  return (
    <>
      {marks.tools}
      <article ref={textRef} data-testid="text" className={marks.textClass} data-gesture-ignore={marks.gestureIgnore} />
    </>
  );
}

describe('the text where marks can be made', () => {
  it('keeps its manner when a tool is taken and put away: only the swipe back is kept off it', () => {
    render(<Reader />);
    const manner = screen.getByTestId('text').className;
    expect(manner).toContain('[touch-action:pan-y_pinch-zoom]');
    const marker = screen.getByRole('button', { name: /bible\.marks\.marker/ });
    fireEvent.click(marker);
    expect(screen.getByTestId('text').className).toBe(manner);
    expect(screen.getByTestId('text')).toHaveAttribute('data-gesture-ignore');
    fireEvent.click(marker);
    expect(screen.getByTestId('text').className).toBe(manner);
    expect(screen.getByTestId('text')).not.toHaveAttribute('data-gesture-ignore');
  });

  // Codex's review, 2026-10-16: pinched bigger with no tool in hand, the sideways pull pans to the clipped side.
  it('gives the sideways pull back to the browser while the page is pinched bigger and no tool is in hand', () => {
    const viewport = Object.assign(new EventTarget(), { scale: 2 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    try {
      render(<Reader />);
      expect(screen.getByTestId('text').className).not.toContain('touch-action');
      fireEvent.click(screen.getByRole('button', { name: /bible\.marks\.marker/ }));
      expect(screen.getByTestId('text').className).toContain('[touch-action:pan-y_pinch-zoom]');
    } finally {
      Reflect.deleteProperty(window, 'visualViewport');
    }
  });
});
