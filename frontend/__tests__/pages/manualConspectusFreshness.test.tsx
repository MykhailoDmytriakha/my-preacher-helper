import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import React from 'react';

import ManualConspectusPage from '@/(pages)/(private)/sermons/[id]/plan/manual/page';
import '@testing-library/jest-dom';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { draftKey, saveDraft } from '@/utils/durableDraft';

import { documentEngineHarness } from '../../test-utils/documentEngineHarness';

import type { Sermon } from '@/models/models';

/**
 * THE HAND-WRITTEN PLAN HAS TO SAY WHEN THE SERVER HOLDS A NEWER ONE.
 *
 * Its twin had this and it did not, which made this the dangerous half of the pair: the text
 * here is typed BY HAND, so nothing can regenerate it. Someone writes on a phone in the
 * morning with this tab open from the night before, and the only sign is their paragraph
 * quietly disappearing on the next save.
 *
 * The interesting assertion is not that a banner renders — a hard-coded one would satisfy
 * that. It is WHAT THE SCREEN HANDS THE DETECTOR: the same projection its twin uses, which
 * tells a real edit apart from a sermon merely moving between storage shapes.
 */

let mockSermon: Sermon | null = null;
let harness: ReturnType<typeof documentEngineHarness>;

jest.mock('@/hooks/useRouteId', () => ({ useRouteId: () => 'sermon-1' }));

// The page runs on the data engine: it opens the sermon document through the real engine,
// with only the server and the browser transport replaced.
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' }, loading: false }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/sermons/sermon-1/plan/manual',
}));

jest.mock('@/services/outline.service', () => ({ updateSermonOutline: jest.fn() }));
// The real module with only the write replaced: listing exports by hand meant every new
// helper the screen started using arrived here as `undefined`.
jest.mock('@/services/sermons.client', () => ({
  ...jest.requireActual('@/services/sermons.client'),
  savePlanTextViaClient: jest.fn(),
}));
jest.mock('@/services/thought.service', () => ({ updateThought: jest.fn() }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const sermon = (planText: Record<string, string>): Sermon => ({
  id: 'sermon-1',
  title: 'A sermon in progress',
  verse: '',
  date: new Date('2026-01-01').toISOString(),
  userId: 'user-1',
  thoughts: [],
  outline: {
    introduction: [{ id: 'p1', text: 'First point' }],
    main: [],
    conclusion: [],
  },
  planText,
} as unknown as Sermon);

/**
 * The page is mounted the way the app mounts it — inside the query cache and the data engine, on a
 * document the harness serves. The header asks react-query for the study this sermon was built on,
 * so a bare `render` here would fail on plumbing rather than on anything this file is about.
 */
const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const page = (client: QueryClient) => (
  <QueryClientProvider client={client}><DataEngineProvider><ManualConspectusPage /></DataEngineProvider></QueryClientProvider>
);
const render = async () => {
  const { id: _id, ...stored } = mockSermon as unknown as Record<string, unknown>;
  harness = documentEngineHarness({
    resource: { collection: 'sermons', id: 'sermon-1' },
    metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    value: JSON.parse(JSON.stringify(stored)),
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const client = queryClient();
  const view = rtlRender(page(client));
  await screen.findAllByText('A sermon in progress');
  return view;
};
const markers = () => screen.queryAllByTestId('plan-progress-point');
const filled = () => markers().filter((marker) => marker.style.backgroundColor !== '');

describe('the hand-written plan and a newer copy on the server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSermon = sermon({});
  });

  it('says nothing while the screen matches the server', async () => {
    await render();

    expect(screen.queryByText('freshness.title')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'freshness.refreshAction' })).not.toBeInTheDocument();
  });

  /**
   * On the engine nothing asks the person to reload: the document observer brings the newer copy in
   * (cells being typed into are left alone), so a paragraph written on a phone simply appears.
   */
  it('shows a paragraph written elsewhere without asking anything of the person', async () => {
    await render();
    expect(filled()).toHaveLength(0);

    await act(async () => { await harness.remote({ planText: { p1: 'Rewritten on the phone' } }); });

    await waitFor(() => expect(filled()).toHaveLength(1));
    expect(screen.queryByText('freshness.title')).not.toBeInTheDocument();
  });

  it('shows the same plan the same way when it is stored in the old shape', async () => {
    mockSermon = {
      ...sermon({}),
      plan: {
        introduction: { outline: '', outlinePoints: { p1: 'What this laptop has' } },
        main: { outline: '', outlinePoints: {} },
        conclusion: { outline: '', outlinePoints: {} },
      },
    } as unknown as Sermon;
    await render();

    await waitFor(() => expect(filled()).toHaveLength(1));
  });
});

/**
 * THE SAVE BUTTON MUST SAY WHETHER THE WORK IS STORED — the same signal the paired screen
 * gives. Two screens over one plan teaching different things about "is my work saved" is how
 * a card gets left behind.
 */
describe('the save button on the hand-written screen', () => {
  // Its own setup: this block sits outside the freshness describe and would otherwise render
  // the "could not load" state, where there is no card and no button to judge.
  beforeEach(() => {
    jest.clearAllMocks();
    mockSermon = sermon({ p1: 'What this laptop has' });
    window.localStorage.clear();
  });

  const saveButton = () => screen.getAllByRole('button', { name: 'plan.save' })[0];

  it('is quiet and unavailable while nothing is unsaved', async () => {
    await render();

    expect(saveButton()).toBeDisabled();
    expect(saveButton().className).toContain('bg-gray-200');
  });

  /**
   * Driven through a REAL user action that leaves a cell unsaved — taking back a recovered
   * draft. The rich editor does not expose a text box in jsdom, and reaching past it into the
   * hook would prove the mock rather than the screen.
   */
  it('shows the text a previous session left before offering it back', async () => {
    saveDraft(draftKey('user-1', 'sermon-1', 'plan:p1'), 'текст, который сервер не принял');

    await render();
    expect(await screen.findByText('текст, который сервер не принял')).toBeInTheDocument();
    expect(screen.getByText('plan.draftRecoveryFromDraft')).toBeInTheDocument();
  });

  it('keeps unsaved text in sight when its point is removed elsewhere', async () => {
    saveDraft(draftKey('user-1', 'sermon-1', 'plan:p1'), 'абзац, набранный здесь');
    await render();
    fireEvent.click(await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' }));
    expect(screen.queryByText('plan.orphanedTitle')).not.toBeInTheDocument();

    // Another device removes the point this card belonged to.
    await act(async () => { await harness.remote({ outline: { introduction: [], main: [], conclusion: [] } }); });

    expect(await screen.findByText('plan.orphanedTitle')).toBeInTheDocument();
    expect(screen.getByText('абзац, набранный здесь')).toBeInTheDocument();
    fireEvent.click(screen.getByText('plan.orphanedDiscard'));
    expect(screen.queryByText('plan.orphanedTitle')).not.toBeInTheDocument();
  });

  it('lights up in the section colour the moment something is unsaved', async () => {
    saveDraft(draftKey('user-1', 'sermon-1', 'plan:p1'), 'текст, который сервер не принял');

    await render();
    fireEvent.click(await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' }));

    expect(saveButton()).toBeEnabled();
    // Introduction's tone — literal classes, because Tailwind cannot see a computed one.
    expect(saveButton().className).toContain('bg-amber-600');
  });
});
