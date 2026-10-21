import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import ManualConspectusPage from '@/(pages)/(private)/sermons/[id]/plan/manual/page';
import AiPlanPage from '@/(pages)/(private)/sermons/[id]/plan/page';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';

import { documentEngineHarness } from '../../test-utils/documentEngineHarness';

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
jest.mock('@/hooks/useFreshnessUid', () => ({ useFreshnessUid: () => 'user-1' }));
// Both routes run on the data engine: they open the sermon document through the real engine, with
// only the server and the browser transport replaced.
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' }, loading: false }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'user-1' }, loading: false }),
}));
jest.mock('@/hooks/useAiUsage', () => ({
  useAiUsage: () => require('@test-utils/aiUsage').aiUsageStub(),
}));
// Empty by default so the order assertion below sees the header a plain sermon draws; the
// provenance test fills it in.
let mockSourceNotes: { id: string; title: string }[] = [];
jest.mock('@/hooks/useSermonNoteLinks', () => ({
  ...jest.requireActual('@/hooks/useSermonNoteLinks'),
  useSourceNotes: () => ({ notes: mockSourceNotes, missingIds: [], loading: false }),
}));
const mockPush = jest.fn();
let mockPathname = '/sermons/sermon-1/plan';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => mockPathname,
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
// Records what the screen HANDS the selector: a stub that merely renders would be
// satisfied by a screen that forgot the preference entirely.
const styleSelectorProps: { value?: string; onChange?: (style: string) => void }[] = [];
jest.mock('@/components/plan/PlanStyleSelector', () => ({
  __esModule: true,
  default: (props: { value?: string; onChange?: (style: string) => void }) => {
    styleSelectorProps.push(props);
    return <div data-testid="plan-style-selector" data-value={props.value} />;
  },
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

/** Opens the page over the sermon fixture the harness serves, and waits until the header is drawn. */
const renderPage = async (page: React.ReactElement) => {
  const { id: _id, ...stored } = mockSermon as unknown as Record<string, unknown>;
  const harness = documentEngineHarness({
    resource: { collection: 'sermons', id: 'sermon-1' },
    metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    value: JSON.parse(JSON.stringify(stored)),
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const view = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DataEngineProvider>{page}</DataEngineProvider>
    </QueryClientProvider>
  );
  await screen.findByTestId('plan-page-header');
  return view;
};

/** The header's parts, in the order the person reads them down the page. */
const headerOrder = () => {
  const header = screen.getByTestId('plan-page-header');
  return [...header.querySelectorAll('[data-testid]')]
    .map((element) => element.getAttribute('testid') ?? element.getAttribute('data-testid'))
    .filter((name): name is string => Boolean(name) && name !== 'plan-page-header');
};

/**
 * THE CHOSEN PLAN VOLUME IS REMEMBERED, AND BOTH EDITORS AGREE ON IT.
 *
 * It was `useState('memory')` in each screen separately, and the from-a-note workspace
 * remounts by key — so every entry silently reset the setting to Short, and the two editors
 * could sit on different volumes at the same time. A preacher who picked Detailed, walked
 * away and came back got a short plan and no clue why.
 */
describe('the plan volume the preacher picked', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    styleSelectorProps.length = 0;
    mockSearchParams = new URLSearchParams();
    mockSermon = sermonFixture();
    window.localStorage.clear();
  });

  it('comes back after the screen is left and reopened', async () => {
    mockSearchParams = new URLSearchParams('source=note');
    await renderPage(<ManualConspectusPage />);

    const handed = styleSelectorProps.at(-1);
    act(() => { handed?.onChange?.('exegetical'); });

    document.body.innerHTML = '';
    styleSelectorProps.length = 0;
    await renderPage(<ManualConspectusPage />);

    await waitFor(() => expect(styleSelectorProps.at(-1)?.value).toBe('exegetical'));
  });

  /** Switching editor must not silently change how much the next generation writes. */
  it('is the same setting on the paired editor', async () => {
    mockSearchParams = new URLSearchParams('source=note');
    await renderPage(<ManualConspectusPage />);
    act(() => { styleSelectorProps.at(-1)?.onChange?.('narrative'); });

    document.body.innerHTML = '';
    styleSelectorProps.length = 0;
    mockSearchParams = new URLSearchParams();
    await renderPage(<AiPlanPage />);

    await waitFor(() => expect(styleSelectorProps.at(-1)?.value).toBe('narrative'));
  });

  it('falls back to the short plan when nothing was ever chosen', async () => {
    mockSearchParams = new URLSearchParams('source=note');
    await renderPage(<ManualConspectusPage />);

    expect(styleSelectorProps.at(-1)?.value).toBe('memory');
  });
});

describe('the plan header is the same in every mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockSermon = sermonFixture();
    mockSourceNotes = [];
    mockPathname = '/sermons/sermon-1/plan';
  });

  it('is mounted by the paired editor', async () => {
    await renderPage(<AiPlanPage />);

    expect(screen.getByTestId('plan-page-header')).toBeInTheDocument();
  });

  it('is mounted by the hand-written editor', async () => {
    await renderPage(<ManualConspectusPage />);

    expect(screen.getByTestId('plan-page-header')).toBeInTheDocument();
  });

  /**
   * The assertion that actually guards against the drift: the two routes are compared with
   * each other, not with a list written down here. Editing one route's header alone breaks
   * this and nothing else does.
   */
  it('carries the same parts in the same order on both routes', async () => {
    await renderPage(<AiPlanPage />);
    const paired = headerOrder();

    document.body.innerHTML = '';

    await renderPage(<ManualConspectusPage />);
    const handWritten = headerOrder();

    expect(handWritten).toEqual(paired);
    expect(paired).toEqual([
      'plan-header-back',
      'plan-header-title',
      'plan-header-source',
      'plan-header-verse',
      'plan-header-subtitle',
      'plan-header-mode-switch',
      'plan-header-view-menu',
      'plan-header-export',
    ]);
  });

  it('names the mode the person is in, on every route', async () => {
    await renderPage(<AiPlanPage />);
    expect(screen.getByTestId('plan-header-subtitle')).toHaveTextContent(
      'plan.fromThoughtsSubtitle'
    );

    document.body.innerHTML = '';

    await renderPage(<ManualConspectusPage />);
    expect(screen.getByTestId('plan-header-subtitle')).toHaveTextContent('plan.manualSubtitle');
  });

  /**
   * WHERE THIS PLAN'S MATERIAL CAME FROM, said the way the sermon says it.
   *
   * It used to be a titled card below the export row — a heading, the links and a paragraph of
   * explanation — and it pushed the plan itself off the first screen. The sermon header had
   * already answered this with one chip under the title, so the plan borrows that chip instead
   * of keeping a second, louder answer to the same question. Provenance belongs to the document,
   * so it shows in every mode; and it opens in a NEW tab, because this screen holds unsaved cells.
   */
  it('names the note it was built on, as a chip under the title, on every route', async () => {
    mockSourceNotes = [{ id: 'note-1', title: 'Jabez, a study' }];

    await renderPage(<AiPlanPage />);
    const paired = screen.getByTestId('plan-page-header');
    const pairedChip = within(paired).getByTestId('source-note-chip');
    expect(pairedChip).toHaveTextContent('Jabez, a study');
    expect(pairedChip).toHaveAttribute('target', '_blank');
    expect(pairedChip).toHaveAttribute('href', '/studies/note-1');

    document.body.innerHTML = '';

    await renderPage(<ManualConspectusPage />);
    expect(
      within(screen.getByTestId('plan-page-header')).getByTestId('source-note-chip')
    ).toHaveTextContent('Jabez, a study');
  });

  /**
   * The verse's opening reference opens over the plan (the owner, 2026-10-21); the window leads into the
   * Bible, and the reader offers the way back to this plan.
   */
  it('opens the passage the verse names over the plan, and from it the Bible with the way back to the plan, on every route', async () => {
    // The hand-written editor saves its cells before any door out, so the move may come a moment later.
    const openVerse = async () => {
      mockPush.mockClear();
      const link = within(screen.getByTestId('plan-header-verse')).getByRole('button', { name: '1 Chronicles 4:9-10' });
      act(() => { link.click(); });
      const dialog = await screen.findByRole('dialog', { name: '1 Chronicles 4:9-10' });
      expect(mockPush).not.toHaveBeenCalled();
      act(() => { within(dialog).getByRole('button', { name: 'bible.sheet.openInBible' }).click(); });
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      return Object.fromEntries(new URL(mockPush.mock.calls[0][0], 'https://app.test').searchParams);
    };

    await renderPage(<AiPlanPage />);
    expect(await openVerse()).toEqual(expect.objectContaining({ book: '1-chronicles', at: '4:9', to: '10', from: '/sermons/sermon-1/plan' }));

    document.body.innerHTML = '';
    mockPathname = '/sermons/sermon-1/plan/manual';
    await renderPage(<ManualConspectusPage />);
    expect(await openVerse()).toEqual(expect.objectContaining({ book: '1-chronicles', at: '4:9', to: '10', from: '/sermons/sermon-1/plan/manual' }));
  });

  /**
   * Not just "no chip" — no ROW either. An always-present wrapper draws nothing yet still takes
   * a gap under the title of every sermon that was never built on a note, which is the opposite
   * of what shrinking this was for.
   */
  it('draws nothing about provenance when the sermon was not built on a note', async () => {
    mockSourceNotes = [];
    mockSermon = { ...sermonFixture(), sourceNoteIds: [] } as Sermon;
    await renderPage(<AiPlanPage />);

    expect(screen.queryByTestId('source-note-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-header-source')).not.toBeInTheDocument();
  });

  /**
   * The row is reserved from `sourceNoteIds` alone, before the note titles are read, so the
   * verse, the mode switch and the buttons below do not jump once the titles arrive.
   */
  it('holds the row open while the note titles are still being read', async () => {
    mockSourceNotes = [];
    await renderPage(<AiPlanPage />);

    const row = screen.getByTestId('plan-header-source');
    expect(row).toBeInTheDocument();
    expect(row.className).toContain('min-h-[26px]');
  });

  it('offers no second door to the assembled plan now that the switch is there', async () => {
    await renderPage(<ManualConspectusPage />);

    expect(screen.queryByText('plan.backToAssembled')).not.toBeInTheDocument();
  });
});
