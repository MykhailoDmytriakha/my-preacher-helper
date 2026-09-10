import { act, render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import DashboardNav from '@/components/navigation/DashboardNav';
import { hasGroupsAccess } from '@/services/userSettings.service';
import { TestProviders } from '../../../test-utils/test-providers';

/**
 * THE BAR MUST NEVER MAKE A SECTION UNREACHABLE.
 *
 * It used to clip: the list of sections sat in an `overflow-hidden` capsule and the labels
 * appeared at a fixed breakpoint, so on any width where the labelled list was wider than the
 * space left over, the LAST item — the calendar — was cut off the right edge with no menu
 * holding it and no hamburger on a desktop to reach it.
 *
 * These tests drive the measurement by hand (jsdom reports every width as zero) and pin the
 * order in which things give way: the app's name first, then the word on the feedback
 * button, and only then the section labels — which turn into icons that are still links.
 */

jest.mock('@locales/i18n', () => ({}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => ({ get: () => undefined, toString: () => '' }),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'test@example.com' }, handleLogout: jest.fn() }),
}));

jest.mock('@/hooks/useFeedback', () => ({
  useFeedback: () => ({
    showFeedbackModal: false,
    handleFeedbackClick: jest.fn(),
    closeFeedbackModal: jest.fn(),
    handleSubmitFeedback: jest.fn(),
  }),
}));

jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
jest.mock('@/hooks/usePrepModeAccess', () => ({
  usePrepModeAccess: () => ({ hasAccess: false, loading: false }),
}));

jest.mock('@/components/navigation/LanguageSwitcher', () => ({
  __esModule: true,
  default: () => <div data-testid="lang-switch" />,
}));
jest.mock('@/components/navigation/UserProfileDropdown', () => ({
  __esModule: true,
  default: () => <div data-testid="user-dropdown" />,
}));
jest.mock('@/components/navigation/FeedbackModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/navigation/MobileMenu', () => ({
  __esModule: true,
  default: () => <div data-testid="mobile-menu" />,
}));
jest.mock('@/components/navigation/ModeToggle', () => ({
  __esModule: true,
  default: () => <div data-testid="mode-toggle" />,
}));

jest.mock('@/services/userSettings.service', () => ({
  ...jest.requireActual('@/services/userSettings.service'),
  hasGroupsAccess: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => ({
      'navigation.appName': 'Помощник проповедника',
      'navigation.primary': 'Основная навигация',
      'navigation.dashboard': 'Панель',
      'navigation.sermons': 'Проповеди',
      'navigation.series': 'Серии',
      'navigation.studies': 'Изучения',
      'navigation.groups': 'Группы',
      'navigation.care': 'Дела сердечные',
      'navigation.calendar': 'Календарь',
      'navigation.settings': 'Настройки',
      'feedback.button': 'Обратная связь',
    } as Record<string, string>)[key] ?? options?.defaultValue ?? key,
  }),
}));

const mockHasGroupsAccess = hasGroupsAccess as jest.MockedFunction<typeof hasGroupsAccess>;

const observerCallbacks: ResizeObserverCallback[] = [];

class TestResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    observerCallbacks.push(callback);
  }
  observe() { }
  unobserve() { }
  disconnect() { }
}

const LABELLED_LIST = 900;
const WORDMARK = 200;
const FEEDBACK_LABEL = 100;

const fix = (element: Element | null, property: string, value: number) => {
  if (!element) throw new Error(`no element to size for ${property}`);
  Object.defineProperty(element, property, { configurable: true, value });
};

const sizeWords = () => {
  const wordmark = screen.queryByText('Помощник проповедника');
  if (wordmark) fix(wordmark, 'offsetWidth', WORDMARK);
  const feedbackLabel = screen.queryByText('Обратная связь');
  if (feedbackLabel) fix(feedbackLabel, 'offsetWidth', FEEDBACK_LABEL);
};

/**
 * Models the bar the way the browser lays it out, which a fixed number cannot: the zone
 * holding the list is `flex-1`, so every word the bar gives up hands its width straight to
 * the zone. `available` is therefore the width the zone has WITH EVERY WORD SHOWN, and the
 * stub recomputes from whatever is on the bar at the moment it is read. A constant here
 * would make dropping a word look like it bought nothing, and the component would read as
 * broken while being right.
 */
const layout = ({ available }: { available: number }) => {
  const list = screen.getByRole('list', { name: 'Основная навигация' });
  fix(list, 'scrollWidth', LABELLED_LIST);
  const zone = list.parentElement;
  if (!zone) throw new Error('no nav zone');
  Object.defineProperty(zone, 'clientWidth', {
    configurable: true,
    get: () =>
      available +
      (screen.queryByText('Помощник проповедника') ? 0 : WORDMARK + 8) +
      (screen.queryByText('Обратная связь') ? 0 : FEEDBACK_LABEL + 8),
  });
  sizeWords();

  act(() => {
    observerCallbacks.forEach((callback) => callback([], {} as ResizeObserver));
  });
  // The words are re-sized after each pass too: a span that has just come back has no stub.
  sizeWords();
};

describe('DashboardNav fitting the width it actually has', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(async () => {
    jest.clearAllMocks();
    observerCallbacks.length = 0;
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
    mockHasGroupsAccess.mockResolvedValue(true);

    render(
      <TestProviders>
        <DashboardNav />
      </TestProviders>
    );
    await screen.findByRole('list', { name: 'Основная навигация' });
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('keeps every word on the bar when the sections fit as they are', () => {
    layout({ available: 1200 });

    expect(screen.getByText('Помощник проповедника')).toBeInTheDocument();
    expect(screen.getByText('Обратная связь')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Календарь/ })).toHaveTextContent('Календарь');
  });

  it("gives up the app's own name before a section label", () => {
    // 900 needed (+8 slack), 800 free: only the wordmark (200 + its gap) has to go.
    layout({ available: 800 });

    expect(screen.queryByText('Помощник проповедника')).not.toBeInTheDocument();
    expect(screen.getByText('Обратная связь')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Календарь/ })).toHaveTextContent('Календарь');
  });

  it('gives up the word on the feedback button next, and still not a section label', () => {
    // 900 needed (+8 slack), 650 free: the wordmark alone is not enough (650 + 208 < 908).
    layout({ available: 650 });

    expect(screen.queryByText('Помощник проповедника')).not.toBeInTheDocument();
    expect(screen.queryByText('Обратная связь')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Календарь/ })).toHaveTextContent('Календарь');
  });

  /**
   * Stuck compact was a real defect: the measuring pass used to be guarded by dependencies,
   * so once the bar had collapsed, a state change that put the labels back (a new locale,
   * groups access arriving) never got measured again.
   */
  it('comes back out of icon mode when the width returns', () => {
    layout({ available: 400 });
    expect(screen.getByRole('link', { name: 'Календарь' })).toHaveTextContent('');

    layout({ available: 1200 });
    expect(screen.getByRole('link', { name: /Календарь/ })).toHaveTextContent('Календарь');
    expect(screen.getByText('Помощник проповедника')).toBeInTheDocument();
  });

  /**
   * The safety net, pinned on purpose. Measurement has moments when it is not true yet — the
   * server's first paint, a cold start, a font landing late — and the failure mode of those
   * moments must be "scroll to it", never "it is gone": a desktop has no menu holding the
   * sections that fell off the edge.
   */
  it('never clips the list out of reach', () => {
    const list = screen.getByRole('list', { name: 'Основная навигация' });

    expect(list.className).toContain('overflow-x-auto');
    expect(list.className).not.toContain('overflow-hidden');
  });

  /**
   * The assertion that would have caught the original defect: the label may go, but the
   * link stays — named, clickable, and pointing at the same route.
   */
  it('collapses labels into icons that are still reachable links', () => {
    layout({ available: 400 });

    const calendar = screen.getByRole('link', { name: 'Календарь' });
    expect(calendar).toHaveAttribute('href', '/calendar');
    expect(calendar).toHaveTextContent('');
    expect(calendar).toHaveAttribute('title', 'Календарь');
    expect(screen.getByRole('link', { name: 'Дела сердечные' })).toHaveAttribute('href', '/care');
  });
});
