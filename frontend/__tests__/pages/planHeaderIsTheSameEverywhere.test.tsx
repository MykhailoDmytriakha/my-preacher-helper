import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import ManualConspectusPage from '@/(pages)/(private)/sermons/[id]/plan/manual/page';
import AiPlanPage from '@/(pages)/(private)/sermons/[id]/plan/page';

import type { Sermon } from '@/models/models';

/**
 * ONE PLAN PAGE, THREE MODES, ONE HEADER.
 *
 * The tools above the plan — go back, read it whole, walk out and preach, export, switch
 * editor — belong to the DOCUMENT, not to the mode it is being typed in. They were built
 * twice, once per route, and drifted: the mode switch sat 1221px apart horizontally and every
 * document button 157px apart vertically, so switching editors moved the button under the
 * preacher's cursor.
 *
 * This test does not check that a header renders — each route could satisfy that on its own
 * and drift again. It compares the two routes AGAINST EACH OTHER: same parts, same order.
 * That is the only assertion that fails when one of them is edited alone.
 */

let mockSermon: Sermon | null = null;
let mockSearchParams = new URLSearchParams();

const sermonFixture = (): Sermon =>
  ({
    id: 'sermon-1',
    title: 'A sermon in progress',
    verse: '1 Chronicles 4:9-10',
    date: new Date('2026-01-01').toISOString(),
    userId: 'user-1',
    thoughts: [],
    sourceNoteIds: ['note-1'],
    outline: {
      introduction: [{ id: 'p1', text: 'Who stood out' }],
      main: [{ id: 'p2', text: 'About Jabez' }],
      conclusion: [{ id: 'p3', text: 'What to take home' }],
    },
    planText: { p1: 'Warriors, marksmen, craftsmen', p2: 'He called on God', p3: 'Ask' },
  }) as unknown as Sermon;

jest.mock('@/hooks/useRouteId', () => ({ useRouteId: () => 'sermon-1' }));
jest.mock('@/hooks/useSermon', () => ({
  sermonIsMissing: jest.requireActual('@/hooks/useSermon').sermonIsMissing,
  __esModule: true,
  default: () => ({
    sermon: mockSermon,
    setSermon: jest.fn(),
    loading: false,
    error: null,
    refreshSermon: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('@/hooks/useFreshnessUid', () => ({ useFreshnessUid: () => 'user-1' }));
jest.mock('@/hooks/useDocumentFreshness', () => ({
  useDocumentFreshness: () => ({
    state: 'fresh',
    remote: null,
    remotelyDeleted: false,
    markSynced: jest.fn(),
  }),
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'user-1' }, loading: false }),
}));
jest.mock('@/hooks/useAiUsage', () => ({
  useAiUsage: () => ({ aiBlocked: false, refresh: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/sermons/sermon-1/plan',
}));
jest.mock('@/services/outline.service', () => ({ updateSermonOutline: jest.fn() }));
jest.mock('@/services/sermons.client', () => ({
  ...jest.requireActual('@/services/sermons.client'),
  savePlanTextViaClient: jest.fn(),
  savePlanModeViaClient: jest.fn(),
}));
jest.mock('@/services/thought.service', () => ({ updateThought: jest.fn() }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

// The heavy leaves are stubbed by NAME so the header's own order stays observable.
jest.mock('@/components/plan/ViewPlanMenu', () => ({
  __esModule: true,
  default: () => <div data-testid="plan-header-view-menu" />,
}));
jest.mock('@/components/ExportButtons', () => ({
  __esModule: true,
  default: () => <div data-testid="plan-header-export" />,
}));
jest.mock('@/components/plan/PlanStyleSelector', () => ({
  __esModule: true,
  default: () => <div data-testid="plan-style-selector" />,
}));
jest.mock('@components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: () => <div data-testid="rich-editor" />,
}));
jest.mock('@/components/plan/KeyFragmentsModal', () => ({
  __esModule: true,
  default: () => <div data-testid="key-fragments-modal" />,
}));
jest.mock('@/components/PreachingTimer', () => ({
  __esModule: true,
  default: () => <div data-testid="preaching-timer" />,
}));
jest.mock('@/components/FloatingTextScaleControls', () => ({
  __esModule: true,
  default: () => <div data-testid="floating-text-controls" />,
}));
jest.mock('react-textarea-autosize', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => <textarea {...props} />,
}));

// The paired editor measures the viewport to pair card heights; jsdom has no matchMedia.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
    onchange: null,
  }),
});

const renderPage = (page: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {page}
    </QueryClientProvider>
  );

/** The header's parts, in the order the person reads them down the page. */
const headerOrder = () => {
  const header = screen.getByTestId('plan-page-header');
  return [...header.querySelectorAll('[data-testid]')]
    .map((element) => element.getAttribute('testid') ?? element.getAttribute('data-testid'))
    .filter((name): name is string => Boolean(name) && name !== 'plan-page-header');
};

describe('the plan header is the same in every mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockSermon = sermonFixture();
  });

  it('is mounted by the paired editor', () => {
    renderPage(<AiPlanPage />);

    expect(screen.getByTestId('plan-page-header')).toBeInTheDocument();
  });

  it('is mounted by the hand-written editor', () => {
    renderPage(<ManualConspectusPage />);

    expect(screen.getByTestId('plan-page-header')).toBeInTheDocument();
  });

  /**
   * The assertion that actually guards against the drift: the two routes are compared with
   * each other, not with a list written down here. Editing one route's header alone breaks
   * this and nothing else does.
   */
  it('carries the same parts in the same order on both routes', () => {
    renderPage(<AiPlanPage />);
    const paired = headerOrder();

    document.body.innerHTML = '';

    renderPage(<ManualConspectusPage />);
    const handWritten = headerOrder();

    expect(handWritten).toEqual(paired);
    expect(paired).toEqual([
      'plan-header-back',
      'plan-header-title',
      'plan-header-verse',
      'plan-header-subtitle',
      'plan-header-mode-switch',
      'plan-header-view-menu',
      'plan-header-export',
    ]);
  });

  it('names the mode the person is in, on every route', () => {
    renderPage(<AiPlanPage />);
    expect(screen.getByTestId('plan-header-subtitle')).toHaveTextContent(
      'plan.fromThoughtsSubtitle'
    );

    document.body.innerHTML = '';

    renderPage(<ManualConspectusPage />);
    expect(screen.getByTestId('plan-header-subtitle')).toHaveTextContent('plan.manualSubtitle');
  });

  it('offers no second door to the assembled plan now that the switch is there', () => {
    renderPage(<ManualConspectusPage />);

    expect(screen.queryByText('plan.backToAssembled')).not.toBeInTheDocument();
  });
});
