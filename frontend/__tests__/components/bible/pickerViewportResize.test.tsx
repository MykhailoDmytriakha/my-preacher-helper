import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, RefObject } from 'react';

import { BookNavigator, BookOnList, SearchPicker } from '@/components/bible/BiblePicker';
import { panelVerticalPlacement, type PanelSide } from '@/utils/panelPlacement';


jest.mock('@/components/bible/search/BibleSearch', () => ({
  BibleSearch: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/utils/bibleText', () => ({
  ...jest.requireActual('@/utils/bibleText'),
  fetchBookText: jest.fn(() => new Promise<never>(() => undefined)),
}));

type Rect = { left: number; top: number; width: number; height: number };

function domRect({ left, top, width, height }: Rect): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

function measured(element: HTMLElement, rect: () => DOMRect) {
  const read = jest.fn(rect);
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: read });
  return read;
}

function viewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

function resize(width: number, height: number) {
  act(() => {
    viewport(width, height);
    window.dispatchEvent(new Event('resize'));
  });
}

function pixels(value: string): number {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  if (!match) throw new Error(`Expected a numeric pixel style, received ${value || '(empty)'}`);
  return Number(match[1]);
}

function renderNavigator(options: { centered?: boolean; wide?: boolean } = {}) {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  const anchorRef: RefObject<HTMLElement | null> = { current: anchor };
  const anchorRead = measured(anchor, () => domRect({ left: 600, top: 552, width: 80, height: 40 }));
  const view = render(
    <BookNavigator
      start="books"
      bookId="Psalms"
      bible="kjv"
      currentChapter={119}
      currentVerse={1}
      text={null}
      locale="en"
      wide={options.wide ?? true}
      anchorRef={anchorRef}
      onClose={jest.fn()}
      onOpen={jest.fn()}
      centered={options.centered}
      label="Book navigation"
    />,
  );
  return { ...view, anchor, anchorRead, dialog: screen.getByRole('dialog', { name: 'Book navigation' }) };
}

const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');

describe('anchored Bible picker viewport', () => {
  afterEach(() => {
    cleanup();
    if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth);
    if (originalHeight) Object.defineProperty(window, 'innerHeight', originalHeight);
  });
  beforeEach(() => viewport(900, 1000));

  it('reclamps BookNavigator across two still-wide widths without rereading a scroll-locked anchor', async () => {
    const { dialog, anchor, anchorRead, unmount } = renderNavigator();
    try {
      expect(dialog.style.width).toBe('780px');
      expect(dialog.style.maxWidth).toBe('868px');
      expect(dialog.style.left).toBe('104px');
      expect(document.documentElement.style.overflow).toBe('hidden');
      expect(anchorRead).toHaveBeenCalledTimes(1);

      resize(790, 1000);
      await waitFor(() => {
        expect(dialog.style.width).toBe('758px');
        expect(dialog.style.maxWidth).toBe('758px');
        expect(dialog.style.left).toBe('16px');
      });
      expect(window.innerWidth).toBeGreaterThanOrEqual(768);
      expect(anchorRead).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
      anchor.remove();
    }
  });

  it('moves BookOnList above its frozen low anchor after the viewport height is reduced', async () => {
    viewport(900, 1000);
    const view = render(<BookOnList bookId="Psalms" bible="kjv" locale="en" wide here={{ chapter: 119, verse: 1 }} onOpen={jest.fn()} />);
    try {
      const trigger = screen.getByRole('button', { name: 'Psalms' });
      const anchorRead = measured(trigger, () => domRect({ left: 240, top: 552, width: 92, height: 40 }));
      await userEvent.click(trigger);
      const dialog = screen.getByRole('dialog', { name: 'bible.chooseChapter' });
      expect(dialog.style.top).toBe('600px');
      expect(dialog.style.maxHeight).toBe('384px');
      expect(anchorRead).toHaveBeenCalledTimes(1);

      resize(900, 600);
      await waitFor(() => {
        expect(dialog.style.top).toBe('');
        expect(dialog.style.bottom).toBe('56px');
        expect(dialog.style.maxHeight).toBe('528px');
      });
      expect(anchorRead).toHaveBeenCalledTimes(1);

    } finally {
      view.unmount();
    }
  });

  it('clamps an already-above window when its frozen anchor falls outside the shortened viewport', async () => {
    viewport(900, 600);
    const { dialog, anchor, anchorRead, unmount } = renderNavigator();
    try {
      expect(dialog.style.bottom).toBe('56px');
      expect(dialog.style.maxHeight).toBe('528px');
      resize(900, 300);
      await waitFor(() => {
        const available = window.innerHeight - 32;
        const maxHeight = pixels(dialog.style.maxHeight);
        const top = dialog.style.top ? pixels(dialog.style.top) : null;
        const bottom = dialog.style.bottom ? pixels(dialog.style.bottom) : null;
        expect(maxHeight).toBeLessThanOrEqual(available);
        expect(top === null || top >= 16).toBe(true);
        expect(bottom === null || bottom >= 16).toBe(true);
        expect(top === null || top + maxHeight <= window.innerHeight - 16).toBe(true);
        expect(bottom === null || bottom + maxHeight <= window.innerHeight - 16).toBe(true);
      });
      expect(anchorRead).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
      anchor.remove();
    }
  });

  it('removes its resize subscription when a BookOnList picker closes and when it unmounts', async () => {
    const add = jest.spyOn(window, 'addEventListener');
    const remove = jest.spyOn(window, 'removeEventListener');
    const view = render(<BookOnList bookId="Psalms" bible="kjv" locale="en" wide onOpen={jest.fn()} />);
    try {
      await userEvent.click(screen.getByRole('button', { name: 'Psalms' }));
      const firstHandlers = add.mock.calls.filter(([type]) => String(type) === 'resize').map(([, handler]) => handler);

      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      for (const expected of firstHandlers) expect(remove.mock.calls.some(([type, handler]) => String(type) === 'resize' && handler === expected)).toBe(true);

      await userEvent.click(screen.getByRole('button', { name: 'Psalms' }));
      const secondHandlers = add.mock.calls.filter(([type]) => String(type) === 'resize').map(([, handler]) => handler);
      view.unmount();
      for (const expected of secondHandlers) expect(remove.mock.calls.some(([type, handler]) => String(type) === 'resize' && handler === expected)).toBe(true);
    } finally {
      view.unmount();
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('keeps centered wide and phone-sheet sizing contracts unchanged', async () => {
    const centered = renderNavigator({ centered: true });
    try {
      const dialog = centered.dialog;
      expect(dialog.style.left).toBe('50%');
      expect(dialog.style.top).toBe('50%');
      expect(dialog.style.transform).toBe('translate(-50%, -50%)');
      resize(790, 600);
      expect(dialog.style.maxWidth).toBe('calc(100vw - 32px)');
      expect(dialog.style.maxHeight).toBe('calc(100dvh - 32px)');
    } finally {
      centered.unmount();
      centered.anchor.remove();
    }

    const phoneNavigator = renderNavigator({ wide: false });
    try {
      expect(phoneNavigator.dialog.className).toContain('max-h-[80dvh]');
    } finally {
      phoneNavigator.unmount();
      phoneNavigator.anchor.remove();
    }

    render(<SearchPicker bookId="Psalms" bible="kjv" locale="en" wide={false} look="header" onOpen={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'bible.search.openSearch' }));
    const tallPhoneSearch = screen.getByRole('dialog', { name: 'bible.search.openSearch' });
    expect(tallPhoneSearch.className).toContain('h-[85dvh]');
  });
});


const genericPlacements: {
  name: string;
  anchor: { top: number; bottom: number };
  height: number;
  space: { top: number; bottom: number };
  preferred: PanelSide;
  expected: { top: number; maxHeight: number };
}[] = [
  { name: 'below with enough room', anchor: { top: 100, bottom: 140 }, height: 200, space: { top: 0, bottom: 600 }, preferred: 'below', expected: { top: 148, maxHeight: 436 } },
  { name: 'above when below cannot fit', anchor: { top: 500, bottom: 540 }, height: 200, space: { top: 0, bottom: 600 }, preferred: 'below', expected: { top: 292, maxHeight: 476 } },
  { name: 'anchor below the viewport', anchor: { top: 800, bottom: 840 }, height: 200, space: { top: 0, bottom: 300 }, preferred: 'below', expected: { top: 84, maxHeight: 268 } },
  { name: 'anchor above the viewport', anchor: { top: -5000, bottom: -4956 }, height: 200, space: { top: 0, bottom: 300 }, preferred: 'above', expected: { top: 16, maxHeight: 268 } },
  { name: 'a clipping ancestor', anchor: { top: 250, bottom: 294 }, height: 100, space: { top: 50, bottom: 500 }, preferred: 'below', expected: { top: 302, maxHeight: 182 } },
  { name: 'an oversized panel on the roomier side', anchor: { top: 300, bottom: 344 }, height: 1000, space: { top: 0, bottom: 600 }, preferred: 'below', expected: { top: 16, maxHeight: 276 } },
];

it.each(genericPlacements)('preserves generic panel placement: $name', ({ anchor, height, space, preferred, expected }) => {
  expect(panelVerticalPlacement(anchor, height, space, preferred)).toEqual(expected);
});
