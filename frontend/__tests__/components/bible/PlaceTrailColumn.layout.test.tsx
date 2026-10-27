import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';

import { PlaceTrailColumn, PlaceTrailStrip } from '@/components/bible/PlaceTrail';

import type { Trail } from '@/utils/placeTrail';

jest.mock('@/components/bible/useBookTexts', () => ({ useBookTexts: () => new Map() }));

const trail: Trail = {
  links: Array.from({ length: 25 }, (_, index) => ({ book: 'Genesis', chapter: index + 1, verse: 1, bible: 'kjv' })),
  at: 12,
};
const looks = ['reader', 'page', 'drawer'] as const;
const column = (look: typeof looks[number], value = trail) => <PlaceTrailColumn trail={value} bible="kjv" locale="en" verseStart={false} onToggleVerseStart={jest.fn()} onGo={jest.fn()} look={look} />;

/** Actual list/row geometry missing from jsdom; resize deliveries follow a real viewport/content change. */
function geometry() {
  const layout = { height: 900, width: 162, content: 900, row: 36, horizontal: false, contentWidth: 2500 };
  const callbacks = new Set<() => void>();
  const originalObserver = globalThis.ResizeObserver;
  const originalRect = Element.prototype.getBoundingClientRect;
  const names = ['clientHeight', 'clientWidth', 'scrollHeight', 'scrollWidth', 'offsetLeft', 'offsetWidth'] as const;
  const originals = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]));
  const isList = (element: Element) => element.tagName === 'DIV' && element.firstElementChild?.tagName === 'OL';
  const isContent = (element: Element) => element.tagName === 'OL' && element.parentElement && isList(element.parentElement);
  const listOf = (element: Element) => element.closest('ol')?.parentElement;
  const sizes: Record<typeof names[number], (element: HTMLElement) => number> = {
    clientWidth: element => isList(element) ? layout.width : isContent(element) ? (layout.horizontal ? layout.contentWidth : layout.width) : 0,
    scrollWidth: () => layout.horizontal ? layout.contentWidth : layout.width,
    offsetWidth: element => layout.horizontal && listOf(element) ? 98 : layout.width,
    offsetLeft: element => {
      const item = element.closest('li');
      return layout.horizontal && item ? Array.from(item.parentElement!.children).indexOf(item) * 100 : 0;
    },
    scrollHeight: element => isList(element) || isContent(element) ? layout.content : 0,
    clientHeight: element => isList(element) ? (layout.horizontal ? 36 : layout.height) : isContent(element) ? (layout.horizontal ? 36 : layout.content) : 0,
  };
  for (const name of names) Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    get(this: HTMLElement) { return sizes[name](this); },
  });
  Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (!isList(this) && !isContent(this) && !listOf(this)) return originalRect.call(this);
    const list = isList(this) ? this : listOf(this);
    const item = this.closest('li');
    const index = item ? Array.from(item.parentElement!.children).indexOf(item) : 0;
    const top = item && !layout.horizontal ? index * layout.row - (list?.scrollTop ?? 0) : 0;
    const left = item && layout.horizontal ? index * 100 - (list?.scrollLeft ?? 0) : 0;
    const height = layout.horizontal ? 36 : isList(this) ? layout.height : isContent(this) ? layout.content : layout.row - 2;
    const width = layout.horizontal && item ? 98 : layout.horizontal && isContent(this) ? layout.contentWidth : layout.width;
    return { top, bottom: top + height, height, left, right: left + width, width, x: left, y: top, toJSON: () => ({}) } as DOMRect;
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
    resize: () => act(() => { for (const callback of [...callbacks]) callback(); }),
    restore: () => {
      cleanup();
      globalThis.ResizeObserver = originalObserver;
      Element.prototype.getBoundingClientRect = originalRect;
      for (const name of names) {
        if (originals[name]) Object.defineProperty(HTMLElement.prototype, name, originals[name]!);
        else Reflect.deleteProperty(HTMLElement.prototype, name);
      }
    },
  };
}

const list = () => screen.getByRole('navigation', { name: 'bible.trail.title' }).querySelector('ol')!.parentElement!;
const centerError = () => {
  const pane = list();
  const current = pane.querySelector<HTMLElement>('[data-trail-at]')!.getBoundingClientRect();
  return current.top + current.height / 2 - pane.getBoundingClientRect().top - pane.clientHeight / 2;
};

it.each(looks)('centers the %s column after its parent constrains the initial viewport', look => {
  const g = geometry();
  function ParentLayout() {
    useLayoutEffect(() => { g.layout.height = 700; g.resize(); }, []);
    return column(look);
  }
  try {
    render(<ParentLayout />);
    expect(Math.abs(centerError())).toBeLessThanOrEqual(2);
  } finally { g.restore(); }
});

it.each(looks)('keeps the selected link centered when the %s column content grows', look => {
  const g = geometry(); g.layout.height = 700;
  try {
    render(column(look));
    expect(Math.abs(centerError())).toBeLessThanOrEqual(2);
    g.layout.row = 56; g.layout.content = 1400; g.resize();
    expect(Math.abs(centerError())).toBeLessThanOrEqual(2);
  } finally { g.restore(); }
});

it.each(looks)('centers a %s column whose viewport is already settled', look => {
  const g = geometry(); g.layout.height = 700;
  try {
    render(column(look));
    expect(list().querySelector('[aria-current="location"]')).toBeNull();
    expect(Math.abs(centerError())).toBeLessThanOrEqual(2);
  }
  finally { g.restore(); }
});

it('preserves manual scrolling on a same-place render and unchanged size notification', () => {
  const g = geometry(); g.layout.height = 700;
  try {
    const view = render(column('reader'));
    list().scrollTop = 180; fireEvent.wheel(list(), { deltaY: 120 }); fireEvent.scroll(list());
    view.rerender(column('reader', { ...trail, links: [...trail.links] })); g.resize();
    expect(list().scrollTop).toBe(180);
  } finally { g.restore(); }
});

it('preserves a deliberate manual position if the layout later changes', () => {
  const g = geometry(); g.layout.height = 700;
  try {
    render(column('reader'));
    list().scrollTop = 180; fireEvent.wheel(list(), { deltaY: 120 }); fireEvent.scroll(list());
    g.layout.height = 600; g.resize();
    expect(list().scrollTop).toBe(180);
  } finally { g.restore(); }
});

it('centers a newly selected link after the person manually scrolled the list', () => {
  const g = geometry(); g.layout.height = 700;
  try {
    const view = render(column('reader'));
    list().scrollTop = 180; fireEvent.wheel(list(), { deltaY: 120 }); fireEvent.scroll(list());
    view.rerender(column('reader', { ...trail, at: 10 }));
    expect(Math.abs(centerError())).toBeLessThanOrEqual(2);
  } finally { g.restore(); }
});


it.each(['line', 'page'] as const)('centers the selected link after the %s row viewport changes width', look => {
  const g = geometry(); g.layout.horizontal = true; g.layout.width = 700;
  const error = () => {
    const pane = list(); const selected = pane.querySelector<HTMLElement>('[data-trail-at]')!.getBoundingClientRect();
    return selected.left + selected.width / 2 - pane.getBoundingClientRect().left - pane.clientWidth / 2;
  };
  try {
    render(<PlaceTrailStrip trail={trail} bible="kjv" locale="en" look={look} onGo={jest.fn()} />);
    expect(Math.abs(error())).toBeLessThanOrEqual(2);
    g.layout.width = 600; g.resize();
    expect(Math.abs(error())).toBeLessThanOrEqual(2);
  } finally { g.restore(); }
});

it.each(['line', 'page'] as const)('keeps the %s row under manual horizontal control until another place is chosen', look => {
  const g = geometry(); g.layout.horizontal = true; g.layout.width = 700;
  const row = (value = trail) => <PlaceTrailStrip trail={value} bible="kjv" locale="en" look={look} onGo={jest.fn()} />;
  try {
    const view = render(row());
    fireEvent.wheel(list(), { deltaX: 100, deltaY: 0 }); list().scrollLeft = 300;
    g.layout.width = 600; g.resize();
    view.rerender(row({ ...trail, links: [...trail.links] }));
    expect(list().scrollLeft).toBe(300);
    view.rerender(row({ ...trail, at: 10 }));
    const selected = list().querySelector<HTMLElement>('[data-trail-at]')!.getBoundingClientRect();
    expect(Math.abs(selected.left + selected.width / 2 - list().clientWidth / 2)).toBeLessThanOrEqual(2);
  } finally { g.restore(); }
});

it('keeps button Space activation eligible for later column layout correction', () => {
  const g = geometry(); g.layout.height = 700;
  try {
    render(column('reader'));
    fireEvent.keyDown(list().querySelector('[data-trail-at]')!, { key: ' ' });
    g.layout.height = 600; g.resize();
    expect(Math.abs(centerError())).toBeLessThanOrEqual(2);
  } finally { g.restore(); }
});

it('lets a touch scroll keep control through later column content growth', () => {
  const g = geometry(); g.layout.height = 700;
  try {
    render(column('reader'));
    fireEvent.touchMove(list()); list().scrollTop = 180;
    g.layout.row = 56; g.layout.content = 1400; g.resize();
    expect(list().scrollTop).toBe(180);
  } finally { g.restore(); }
});
