import { render, screen } from '@testing-library/react';
import { createRef } from 'react';

import { BookNavigator } from '@/components/bible/BiblePicker';

import type React from 'react';

/*
 * The reader's window of books, chapters and verses: under its button in the reader; in the middle of the screen where it
 * chooses a place for a comment, opened from a button low in a form (the owner, 2026-10-28: «должно было быть по центру»).
 */
jest.mock('@/components/bible/search/BibleSearch', () => ({ BibleSearch: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), fetchBookText: jest.fn(() => new Promise(() => undefined)) }));

function open(props: Partial<React.ComponentProps<typeof BookNavigator>>) {
  const anchorRef = createRef<HTMLButtonElement>();
  render(
    <>
      <button ref={anchorRef} type="button">anchor</button>
      <BookNavigator start="books" bookId="Isaiah" bible="rst" currentChapter={40} currentVerse={31} text={null} locale="ru" wide anchorRef={anchorRef} onClose={jest.fn()} onOpen={jest.fn()} label="window" {...props} />
    </>,
  );
  return screen.getByRole('dialog', { name: 'window' });
}

describe('the place window', () => {
  it('stands in the middle of the screen, as tall as it allows, where it chooses a place', () => {
    const window = open({ centered: true, choosing: 'verse' });
    expect(window.style.top).toBe('50%');
    expect(window.style.left).toBe('50%');
    expect(window.style.transform).toBe('translate(-50%, -50%)');
    expect(window.getAttribute('style')).toContain('max-height: calc(100dvh - 32px)');
  });

  it('keeps inside a screen made smaller while it is open: its size follows the screen, not numbers read at opening', () => {
    const window = open({ centered: true, choosing: 'verse' });
    const style = window.getAttribute('style') ?? '';
    expect(style).toContain('100vw');
    expect(style).not.toContain(`${globalThis.innerHeight - 32}px`);
    expect(style).not.toContain(`${globalThis.innerWidth - 32}px`);
  });

  it('stays under its button in the reader', () => {
    const window = open({});
    expect(window.style.transform).toBe('');
    expect(window.style.top).not.toBe('50%');
  });
});
