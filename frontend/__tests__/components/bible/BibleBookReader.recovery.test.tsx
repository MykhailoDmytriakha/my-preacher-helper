import { render, screen, waitFor } from '@testing-library/react';

import { BibleBookReader } from '@/components/bible/BibleBookReader';

let mockPendingDecision = true;
jest.mock('@/components/bible/marks/useReaderMarks', () => ({
  useReaderMarks: () => ({ tools: null, floatingTools: null, legend: null, translationClass: '',
    gestureIgnore: undefined, penSurface: undefined, textClass: '', signs: undefined,
    pendingDecision: mockPendingDecision,
    syncStatus: mockPendingDecision ? <button data-testid="marks-choice">Keep these marks</button> : null,
    elsewhere: { at: null, entries: [], close: jest.fn() },
  }),
}));
const book = { id: 'Ruth', chapters: [['First verse'], ['Second chapter'], ['Third chapter'], ['Fourth chapter']] };
const props = { bible: 'rst' as const, initialBible: 'rst' as const, onChangeBible: jest.fn(), bookId: 'Ruth', initialPlace: null, onOpenBook: jest.fn() };
let pageTop = 297;
let rect: jest.SpyInstance;
let scroll: jest.SpyInstance;
const bounds = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 390, width: 390, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect);

beforeEach(() => {
  mockPendingDecision = true;
  pageTop = 297;
  window.history.replaceState(null, '', '/bible?book=ruth&read=rst');
  window.sessionStorage.clear();
  window.matchMedia = jest.fn((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn() })) as unknown as typeof window.matchMedia;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => book, clone() { return this; } })) as unknown as typeof fetch;
  const original = Element.prototype.getBoundingClientRect;
  rect = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.tagName === 'NAV') return bounds(0, 121);
    if (this.firstElementChild?.getAttribute('data-testid') === 'marks-choice') return bounds(308 - pageTop, 100);
    return original.call(this);
  });
  scroll = jest.spyOn(window, 'scrollBy').mockImplementation((options: ScrollToOptions | number, y?: number) => { pageTop += typeof options === 'object' ? options.top ?? 0 : y ?? 0; });
  Element.prototype.scrollIntoView = jest.fn();
});
afterEach(() => { rect.mockRestore(); scroll.mockRestore(); });

it('reveals a recovery decision below the measured nav and does not pull later reading on a passive render', async () => {
  const view = render(<><nav /><BibleBookReader {...props} decideMarksOnArrival /></>);
  await screen.findByText('First verse');
  await waitFor(() => expect(308 - pageTop).toBeGreaterThanOrEqual(137));
  const calls = scroll.mock.calls.length;
  pageTop += 200;
  view.rerender(<><nav /><BibleBookReader {...props} decideMarksOnArrival /></>);
  expect(scroll).toHaveBeenCalledTimes(calls);
});

it('waits for a late pending decision instead of consuming the arrival before its controls exist', async () => {
  mockPendingDecision = false;
  const view = render(<><nav /><BibleBookReader {...props} decideMarksOnArrival /></>);
  await screen.findByText('First verse');
  expect(scroll).not.toHaveBeenCalled();
  mockPendingDecision = true;
  view.rerender(<><nav /><BibleBookReader {...props} decideMarksOnArrival /></>);
  await waitFor(() => expect(308 - pageTop).toBeGreaterThanOrEqual(137));
});

it('leaves an ordinary reader visit on the existing position-restoration path', async () => {
  render(<><nav /><BibleBookReader {...props} /></>);
  await screen.findByText('First verse');
  expect(scroll).not.toHaveBeenCalled();
});
