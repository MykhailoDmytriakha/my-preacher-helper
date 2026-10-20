import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { CrossReferenceSheet } from '@/components/bible/CrossReferenceSheet';
import { resetCrossReferencePrefsForTests } from '@/components/bible/crossReferencePrefs';
import { VerseSheet } from '@/components/bible/VerseSheet';
import { getBookIds } from '@/utils/bibleBooks';
import { fetchBookText } from '@/utils/bibleText';

jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), fetchBookText: jest.fn() }));

const book = { id: 'Ruth', chapters: [['First verse', 'Second verse', 'Third verse']] };

function geometry() {
  const layout = { top: 1000, rowHeight: 40, height: 600, width: 600, textHeight: 2000 };
  const callbacks = new Set<() => void>();
  const originalObserver = globalThis.ResizeObserver;
  const originalRect = Element.prototype.getBoundingClientRect;
  const properties = ['clientHeight', 'clientWidth', 'scrollHeight', 'offsetTop', 'offsetHeight'] as const;
  const original = Object.fromEntries(properties.map(name => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]));
  const isPane = (element: Element) => element.matches('div[tabindex="0"]');
  const isTarget = (element: Element) => element.matches('[data-verse="1:2"], [data-arrival="on"]');
  for (const name of properties) Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    get(this: HTMLElement) {
      if (name === 'clientHeight') return isPane(this) ? layout.height : 0;
      if (name === 'clientWidth') return layout.width;
      if (name === 'scrollHeight') return layout.textHeight;
      if (name === 'offsetTop') return isTarget(this) ? layout.top : 0;
      return isTarget(this) ? layout.rowHeight : 40;
    },
  });
  Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const pane = this.closest<HTMLElement>('div[tabindex="0"]');
    const top = isTarget(this) ? layout.top - (pane?.scrollTop ?? 0) : 0;
    const height = isPane(this) ? layout.height : isTarget(this) ? layout.rowHeight : layout.textHeight;
    return { top, bottom: top + height, height, left: 0, right: layout.width, width: layout.width, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  };
  globalThis.ResizeObserver = class {
    private readonly run: () => void;
    constructor(callback: ResizeObserverCallback) { this.run = () => callback([], this as unknown as ResizeObserver); }
    observe() { callbacks.add(this.run); }
    unobserve() { callbacks.delete(this.run); }
    disconnect() { callbacks.delete(this.run); }
  } as unknown as typeof ResizeObserver;
  return {
    layout,
    reflow: () => act(() => { for (const callback of [...callbacks]) callback(); }),
    restore: () => {
      globalThis.ResizeObserver = originalObserver;
      Element.prototype.getBoundingClientRect = originalRect;
      for (const name of properties) {
        if (original[name]) Object.defineProperty(HTMLElement.prototype, name, original[name]!);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
      }
    },
  };
}

async function open(kind: 'verse' | 'reference') {
  window.localStorage.setItem('bible:translation', 'kjv');
  resetCrossReferencePrefsForTests();
  jest.mocked(fetchBookText).mockResolvedValue(book as never);
  let view;
  if (kind === 'verse') view = render(<VerseSheet reference={{ bible: 'kjv', book: 'Ruth', chapter: 1, fromVerse: 2, label: 'Ruth 1:2' }} onClose={jest.fn()} />);
  else {
    const index = getBookIds().indexOf('Ruth');
    view = render(<CrossReferenceSheet at={{ chapter: 1, verse: 1 }} bookId="Ruth" bible="kjv" locale="en"
      set={{ id: 'Ruth', chapters: [[[index, 1, 2, 2, 3]]] }} onClose={jest.fn()} onOpenReference={jest.fn()} />);
    const list = screen.getByRole('dialog', { name: 'bible.crossRefs.listTitle' });
    fireEvent.click(await within(list).findByText('Ruth 1:2'));
  }
  const dialog = await screen.findByRole('dialog', { name: 'Ruth 1:2' });
  const pane = dialog.querySelector<HTMLElement>('div[tabindex="0"]')!;
  await waitFor(() => expect(pane.scrollTop).toBe(720));
  return { ...view, dialog, pane };
}

describe.each(['verse', 'reference'] as const)('%s passage resting position', kind => {
  it('recenters after late text growth without a person scrolling', async () => {
    const probe = geometry();
    let view;
    try {
      view = await open(kind);
      probe.layout.top = 1200;
      probe.layout.rowHeight = 80;
      probe.layout.textHeight = 2240;
      probe.reflow();
      expect(view.pane.scrollTop).toBe(940);
    } finally { view?.unmount(); probe.restore(); }
  });

  it('keeps the passage through a native clamp before the height observer', async () => {
    const probe = geometry();
    let view;
    try {
      view = await open(kind);
      probe.layout.height = 1800;
      view.pane.scrollTop = 200;
      fireEvent.scroll(view.pane);
      probe.reflow();
      expect(view.pane.scrollTop).toBe(120);
    } finally { view?.unmount(); probe.restore(); }
  });

  it('settles a changed layout before newer wheel input and does not undo that input', async () => {
    const probe = geometry();
    let view;
    try {
      view = await open(kind);
      probe.layout.width = 700;
      probe.layout.top = 1200;
      probe.layout.rowHeight = 80;
      probe.layout.textHeight = 2240;
      fireEvent.wheel(view.pane, { deltaY: 120 });
      view.pane.scrollTop = 1060;
      fireEvent.scroll(view.pane);
      probe.reflow();
      expect(view.pane.scrollTop).toBe(1060);
      expect(view.pane.style.overflowAnchor).toBe('');
    } finally { view?.unmount(); probe.restore(); }
  });

  it.each(['none', 'wheel', 'copy'] as const)('holds a smooth return until deliberate interruption: %s', async interruption => {
    const interrupted = interruption === 'wheel';
    const probe = geometry();
    let view;
    try {
      view = await open(kind);
      const pane = view.pane;
      pane.scrollTop = 1600;
      fireEvent.scroll(pane);
      pane.scrollTo = jest.fn((options: ScrollToOptions | number) => {
        if (typeof options === 'number') throw Error('Expected named smooth scroll');
        expect(options.behavior).toBe('smooth');
        pane.scrollTop = 1160;
        fireEvent.scroll(pane);
      }) as typeof pane.scrollTo;
      fireEvent.click(await within(view.dialog).findByRole('button', { name: 'bible.sheet.backToPassage' }));
      expect(pane.scrollTo).toHaveBeenCalledTimes(1);
      if (interrupted) {
        fireEvent.wheel(pane, { deltaY: 120 });
        pane.scrollTop = 1280;
        fireEvent.scroll(pane);
      }
      if (!interrupted) {
        if (interruption === 'copy') fireEvent.keyDown(pane, { key: 'c', ctrlKey: true });
        pane.scrollTop = 720;
        fireEvent.scroll(pane);
      }
      probe.layout.top = 1200;
      probe.layout.rowHeight = 80;
      probe.layout.textHeight = 2240;
      probe.reflow();
      expect(pane.scrollTop).toBe(interrupted ? 1280 : 940);
    } finally { view?.unmount(); probe.restore(); }
  });

  it('leaves a deliberate reading position alone when text grows', async () => {
    const probe = geometry();
    let view;
    try {
      view = await open(kind);
      view.pane.scrollTop = 840;
      fireEvent.scroll(view.pane);
      probe.layout.top = 1200;
      probe.layout.rowHeight = 80;
      probe.layout.textHeight = 2240;
      probe.reflow();
      expect(view.pane.scrollTop).toBe(840);
    } finally { view?.unmount(); probe.restore(); }
  });
});
