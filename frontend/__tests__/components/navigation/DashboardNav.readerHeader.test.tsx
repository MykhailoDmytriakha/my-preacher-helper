import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BibleBookReader } from '@/components/bible/BibleBookReader';
import { resetPlaceTrailForTests } from '@/components/bible/placeTrailStore';
import DashboardNav from '@/components/navigation/DashboardNav';
import { ShellHeaderProvider, useRevealShellHeader, useShellHeaderPageMoved } from '@/components/navigation/shellHeader';

jest.mock('@locales/i18n', () => ({}));
jest.mock('@/hooks/useShellPathname', () => ({ useShellPathname: () => '/bible/ruth' }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, handleLogout: jest.fn() }) }));
jest.mock('@/hooks/usePrepModeAccess', () => ({ usePrepModeAccess: () => ({ hasAccess: false, loading: false }) }));
const mockFeedback = jest.fn();
jest.mock('@/hooks/useFeedback', () => ({ useFeedback: () => ({ showFeedbackModal: false, handleFeedbackClick: mockFeedback, closeFeedbackModal: jest.fn(), handleSubmitFeedback: jest.fn() }) }));
jest.mock('@/components/usage/UsageGraceIndicator', () => ({
  UsageGraceController: ({ children }: { children: (model: null) => React.ReactNode }) => children(null),
  UsageGraceIndicator: () => null,
}));
jest.mock('@/components/navigation/OfflineIndicator', () => ({ OfflineIndicator: () => null }));
jest.mock('@/components/navigation/AppUpdateButton', () => ({ AppUpdateButton: () => null }));
jest.mock('@/components/navigation/UserProfileDropdown', () => () => null);
jest.mock('@/components/navigation/LanguageSwitcher', () => () => null);
jest.mock('@/components/navigation/ThemeModeToggle', () => () => null);
jest.mock('@/components/navigation/FeedbackModal', () => () => null);
jest.mock('@/hooks/useSermonRead', () => ({ useSermonRead: () => ({ sermon: null }), sermonIsMissing: () => false }));
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataDocument: () => ({ data: null, loading: true, commit: jest.fn(), status: null, recoveryIdentity: {} }),
}));

let screenWidth = 360;
beforeEach(() => {
  screenWidth = 360;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  window.matchMedia = jest.fn((query: string) => ({
    matches: Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity) <= screenWidth,
    media: query, onchange: null, addEventListener: jest.fn(), removeEventListener: jest.fn(),
    addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '');
  resetPlaceTrailForTests();
  Element.prototype.scrollIntoView = jest.fn();
  window.scrollTo = jest.fn();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'Ruth', chapters: [['First'], ['Second'], ['Third'], ['Fourth']] }), clone() { return this; } })) as unknown as typeof fetch;
});

function App({ reader = true, children = null }: { reader?: boolean; children?: React.ReactNode }) {
  return <ShellHeaderProvider><DashboardNav />{reader ? <BibleBookReader bible="rst" initialBible="rst" bookId="Ruth" initialPlace={null} onOpenBook={jest.fn()} onChangeBible={jest.fn()} /> : null}{children}</ShellHeaderProvider>;
}

/** The window scrolled by the person's finger, or by the page itself (a jump, a correction). */
const personScrolls = (top: number) => act(() => {
  fireEvent.touchMove(window);
  Object.defineProperty(window, 'scrollY', { configurable: true, value: top });
  fireEvent.scroll(window);
});
const pageScrolls = (top: number) => act(() => {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: top });
  fireEvent.scroll(window);
});

/** A page announcing its own move of the window, as the reader's surface does. */
let announcePageMove: () => void = () => undefined;
function PageMove() {
  announcePageMove = useShellHeaderPageMoved();
  return null;
}

/** A page's way to show the header whole, as the reader does on a jump. */
function Reveal() {
  const reveal = useRevealShellHeader();
  return <button type="button" onClick={reveal}>reveal</button>;
}

/** The phone row measures 56 px open and 36 px folded, so the scroll kept across a fold can be seen. */
function measureTheRow() {
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  return jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains('lg:hidden')) return realRect.call(this);
    return { ...realRect.call(this), height: this.classList.contains('py-0') ? 36 : 56 };
  });
}

it('the phone reader lends its controls to the app header; feedback becomes the first menu item and keeps its handler', async () => {
  render(<App />);
  const controls = screen.getByTestId('mobile-navigation-controls');
  await waitFor(() => expect(within(controls).getByRole('button', { name: 'bible.navigate' })).toBeInTheDocument());
  expect(within(controls).queryByRole('button', { name: 'feedback.button' })).not.toBeInTheDocument();
  expect(document.querySelector('article')?.closest('[data-reader-panes]')).toBeNull();
  expect(document.querySelectorAll('header')).toHaveLength(0);
  await userEvent.click(within(controls).getByRole('button', { name: 'navigation.openMenu' }));
  const menu = screen.getByRole('dialog', { name: 'navigation.menu' });
  const feedback = within(menu).getByRole('button', { name: 'feedback.button' });
  expect(feedback.parentElement?.firstElementChild).toBe(feedback);
  await userEvent.click(feedback);
  expect(mockFeedback).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each([768, 820, 1024])('at %i px the app keeps feedback and the reader keeps its wide book line and text button', async (width) => {
  screenWidth = width;
  render(<App />);
  await screen.findByText('Fourth');
  const controls = screen.getByTestId('mobile-navigation-controls');
  expect(within(controls).getByRole('button', { name: 'feedback.button' })).toBeInTheDocument();
  expect(within(controls).queryByRole('button', { name: 'bible.navigate' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'bible.changeChapter' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Text size' })).toBeInTheDocument();
  expect(document.querySelector('[data-reader-panes]')).toBeInTheDocument();
});

it('scrolling down collapses the actual row; tapping its place or scrolling up expands it, and leaving restores the normal header', async () => {
  const view = render(<App />);
  await screen.findByRole('button', { name: 'bible.navigate' });
  const controls = screen.getByTestId('mobile-navigation-controls');
  const scroll = personScrolls;
  scroll(75);
  expect(screen.queryByRole('button', { name: 'bible.expandHeader' })).not.toBeInTheDocument();
  scroll(100);
  const expand = screen.getByRole('button', { name: 'bible.expandHeader' });
  expect(expand).toHaveClass('h-9');
  expect(controls.parentElement).toHaveClass('py-0');
  expect(within(controls).getByRole('button', { name: 'navigation.openMenu' })).toHaveClass('h-9');
  await userEvent.click(expand);
  expect(within(controls).getByRole('button', { name: 'bible.navigate' })).toBeInTheDocument();
  scroll(140);
  scroll(120);
  expect(screen.queryByRole('button', { name: 'bible.expandHeader' })).not.toBeInTheDocument();
  view.rerender(<App reader={false} />);
  expect(within(controls).getByRole('button', { name: 'feedback.button' })).toBeInTheDocument();
});

it('compensates the row height once without treating its own scroll as an upward gesture', async () => {
  const measure = measureTheRow();
  window.scrollTo = jest.fn((options: ScrollToOptions) => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: options.top });
  }) as typeof window.scrollTo;
  try {
    render(<App />);
    await screen.findByRole('button', { name: 'bible.navigate' });
    personScrolls(100);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 80, behavior: 'instant' });
    fireEvent.scroll(window);
    expect(screen.getByRole('button', { name: 'bible.expandHeader' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'bible.expandHeader' }));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 100, behavior: 'instant' });
    fireEvent.scroll(window);
    expect(screen.queryByRole('button', { name: 'bible.expandHeader' })).not.toBeInTheDocument();
  } finally {
    measure.mockRestore();
  }
});

// Live 2026-10-26: Rom 8:7 opened with the header folded — the reader's jump to the verse scrolled the window and
// was taken for reading down, hiding the way back and the trail right when they are needed.
it('the page moving itself — a jump, the chapters drawn around the place — neither folds nor opens the header', async () => {
  render(<App><PageMove /></App>);
  await screen.findByRole('button', { name: 'bible.navigate' });
  // No finger, wheel or key started it: the arrival's jump to the verse.
  pageScrolls(2000);
  expect(screen.queryByRole('button', { name: 'bible.expandHeader' })).not.toBeInTheDocument();
  personScrolls(2100);
  expect(screen.getByRole('button', { name: 'bible.expandHeader' })).toBeInTheDocument();
  // Under the person's finger, the reader keeps its place 600 px up as chapters are drawn: it said so.
  act(() => {
    fireEvent.touchMove(window);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1500 });
    announcePageMove();
    fireEvent.scroll(window);
  });
  expect(screen.getByRole('button', { name: 'bible.expandHeader' })).toBeInTheDocument();
  // The person's next move up is theirs again.
  personScrolls(1480);
  expect(screen.queryByRole('button', { name: 'bible.expandHeader' })).not.toBeInTheDocument();
});

it('a jump opens a folded header whole and leaves the page where the jump put it', async () => {
  const measure = measureTheRow();
  window.scrollTo = jest.fn((options: ScrollToOptions) => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: options.top });
  }) as typeof window.scrollTo;
  try {
    render(<App><Reveal /></App>);
    await screen.findByRole('button', { name: 'bible.navigate' });
    personScrolls(400);
    expect(screen.getByRole('button', { name: 'bible.expandHeader' })).toBeInTheDocument();
    (window.scrollTo as jest.Mock).mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'reveal' }));
    expect(screen.getByRole('button', { name: 'bible.navigate' })).toBeInTheDocument();
    expect(window.scrollTo).not.toHaveBeenCalled();
  } finally {
    measure.mockRestore();
  }
});

// Codex, 2026-10-26: a book that did not load left only «Повторить» on a phone — no other book, no search.
it('a book that did not load keeps the book picker and the search in the phone header', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
  render(<App />);
  await screen.findByRole('button', { name: 'bible.retry' });
  const controls = screen.getByTestId('mobile-navigation-controls');
  expect(within(controls).getByRole('button', { name: 'bible.changeBook' })).toBeInTheDocument();
  expect(within(controls).getByRole('button', { name: 'bible.search.openSearch' })).toBeInTheDocument();
});

// Codex, 2026-10-26: crossing 768 px ran the opening's jump again — `jumpTo` had come to depend on the width — and
// the reader went back from chapter 3, where the person read, to chapter 2, where the book was opened.
it('crossing 768 px keeps the place the person reads', async () => {
  const listeners: Array<(event: { matches: boolean }) => void> = [];
  let wide = false;
  window.matchMedia = jest.fn((query: string) => ({
    get matches() { return query === '(min-width: 768px)' && wide; },
    media: query, onchange: null,
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => { if (query === '(min-width: 768px)') listeners.push(listener); },
    removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  // Chapter n stands at n × 500 px of the page, or of the text's pane on a wide screen.
  const pane = () => document.querySelector('article')?.parentElement as HTMLElement | null;
  const rect = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const chapter = Number(this.dataset.chapter ?? this.dataset.verse?.split(':')[0]);
    const top = chapter ? chapter * 500 - (wide ? pane()?.scrollTop ?? 0 : window.scrollY) : 0;
    return { top, bottom: top + 100, width: 300, height: 100, left: 0, right: 300, x: 0, y: top, toJSON() { return {}; } } as DOMRect;
  });
  const jump = jest.fn(function (this: HTMLElement) {
    const chapter = Number(this.dataset.chapter ?? this.dataset.verse?.split(':')[0]);
    if (wide) {
      const box = pane();
      if (box) box.scrollTop = chapter * 500 - 16;
    } else {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: chapter * 500 - 16 });
    }
  });
  Element.prototype.scrollIntoView = jump;
  try {
    render(<ShellHeaderProvider><DashboardNav /><BibleBookReader bible="rst" initialBible="rst" bookId="Ruth" initialPlace={{ chapter: 2, verse: 1 }} onOpenBook={jest.fn()} onChangeBible={jest.fn()} /></ShellHeaderProvider>);
    await screen.findByText('Fourth');
    act(() => { fireEvent.scroll(window); });
    // Chapter 3 crosses the reading line under the app's header (100 px here).
    personScrolls(1450);
    expect(screen.getByRole('button', { name: 'bible.expandHeader' })).toHaveTextContent('Ruth 3:1');
    jump.mockClear();
    act(() => {
      wide = true;
      listeners.forEach((listener) => listener({ matches: true }));
    });
    expect(jump.mock.contexts.map((element) => (element as HTMLElement).dataset.chapter ?? (element as HTMLElement).dataset.verse)).toEqual(['3']);
  } finally {
    rect.mockRestore();
  }
});
