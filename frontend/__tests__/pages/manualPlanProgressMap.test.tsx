import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import ManualConspectusPage from '@/(pages)/(private)/sermons/[id]/plan/manual/page';
import '@testing-library/jest-dom';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { SERMON_SECTION_COLORS } from '@/utils/themeColors';

import { documentEngineHarness } from '../../test-utils/documentEngineHarness';

import type { Sermon } from '@/models/models';

/**
 * THE FULLNESS MAP BELONGS TO EVERY PLAN EDITOR, NOT JUST THE PAIRED ONE.
 *
 * The strip of markers down the left edge answers one question at a glance: how much of the
 * plan is still empty. It lived only inside the paired screen's layout, so the two hand-written
 * modes — which share the other route — never had it. That is backwards: filling cells in by
 * hand IS the whole work here, and this is the screen where the count matters most.
 *
 * The assertion that earns its keep is not "a strip renders" — a hard-coded one would satisfy
 * that. It is WHAT THIS SCREEN CALLS FILLED: text written under a SUB-POINT counts for its
 * point. The paired screen has no sub-point cells at all, so a copy of its notion would leave
 * a fully written point looking untouched.
 */

let mockSermon: Sermon | null = null;
let mockSearchParams = new URLSearchParams();

jest.mock('@/hooks/useRouteId', () => ({ useRouteId: () => 'sermon-1' }));

// The page runs on the data engine: it opens the sermon document through the real engine,
// with only the server and the browser transport replaced.
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' }, loading: false }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/sermons/sermon-1/plan/manual',
}));

jest.mock('@/services/outline.service', () => ({ updateSermonOutline: jest.fn() }));
jest.mock('@/services/sermons.client', () => ({
  ...jest.requireActual('@/services/sermons.client'),
  savePlanTextViaClient: jest.fn(),
}));
jest.mock('@/services/thought.service', () => ({ updateThought: jest.fn() }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const sermonWithPlan = (planText: Record<string, string>): Sermon =>
  ({
    id: 'sermon-1',
    title: 'A sermon in progress',
    verse: '',
    date: new Date('2026-01-01').toISOString(),
    userId: 'user-1',
    thoughts: [],
    sourceNoteIds: ['note-1'],
    outline: {
      introduction: [{ id: 'p1', text: 'Who stood out' }],
      main: [
        {
          id: 'p2',
          text: 'About Jabez',
          subPoints: [{ id: 'p2-a', text: 'His prayer', position: 0 }],
        },
      ],
      conclusion: [{ id: 'p3', text: 'What to take home' }],
    },
    planText,
  }) as unknown as Sermon;

/**
 * The from-a-note mode reaches for the linked study through React Query, so the page needs a
 * client. Stubbing that hook instead would have taken the note workspace out of the render —
 * and the note mode is exactly one of the two this test exists for.
 */
const renderPage = async () => {
  const { id: _id, ...stored } = mockSermon as unknown as Record<string, unknown>;
  const harness = documentEngineHarness({
    resource: { collection: 'sermons', id: 'sermon-1' },
    metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    value: JSON.parse(JSON.stringify(stored)),
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DataEngineProvider>
        <ManualConspectusPage />
      </DataEngineProvider>
    </QueryClientProvider>
  );
  // The sermon has to arrive before anything on the screen means anything.
  await screen.findAllByText('A sermon in progress');
  return view;
};

const markers = () => screen.queryAllByTestId('plan-progress-point');

const markerFor = (pointText: string) =>
  markers().find((marker) => (marker.getAttribute('title') ?? '').startsWith(pointText));

describe('the fullness map on the hand-written plan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockSermon = sermonWithPlan({ p1: 'Warriors, marksmen, craftsmen' });
  });

  it('shows one marker per outline point', async () => {
    await renderPage();

    expect(await screen.findByTestId('plan-progress-map')).toBeInTheDocument();
    expect(markers()).toHaveLength(3);
  });

  it('shows the map in the from-a-note mode too', async () => {
    mockSearchParams = new URLSearchParams('source=note');

    await renderPage();

    expect(markers()).toHaveLength(3);
  });

  it.each(['p2', 'p2-a'])('folds only the reminder belonging to the filled cell %s', async (filledId) => {
    mockSearchParams = new URLSearchParams('source=note');
    mockSermon = sermonWithPlan({ [filledId]: 'Current plan', p3: '  \n ' });
    mockSermon.outline!.main[0].note = 'Parent scratch';
    mockSermon.outline!.main[0].subPoints![0].note = 'Child scratch';
    mockSermon.outline!.conclusion[0].note = 'Empty plan scratch';
    await renderPage();

    const folded = screen.getByText(filledId === 'p2' ? 'Parent scratch' : 'Child scratch');
    const expanded = screen.getByText(filledId === 'p2' ? 'Child scratch' : 'Parent scratch');
    await waitFor(() => expect(folded).not.toBeVisible());
    expect(expanded).toBeVisible();
    expect(screen.getByText('Empty plan scratch')).toBeVisible();
  });

  it('paints a written point in the colour of its section', async () => {
    await renderPage();

    await waitFor(() => expect(markerFor('Who stood out')).toHaveStyle({
      backgroundColor: SERMON_SECTION_COLORS.introduction.light,
    }));
  });

  /**
   * The half a copy of the paired screen's notion would get wrong: nothing is written in the
   * point's own cell, everything is under its sub-point, and the point is nonetheless done.
   */
  it('counts text written under a sub-point as its point being filled', async () => {
    mockSermon = sermonWithPlan({ 'p2-a': 'He asked God to enlarge his border' });

    await renderPage();

    await waitFor(() => expect(markerFor('About Jabez')).toHaveStyle({
      backgroundColor: SERMON_SECTION_COLORS.mainPart.light,
    }));
  });

  it('leaves an empty point uncoloured and says so in its label', async () => {
    await renderPage();

    const empty = markerFor('What to take home');

    expect(empty).toHaveAttribute('title', expect.stringContaining('plan.progressMap.empty'));
    expect(empty?.style.backgroundColor).toBe('');
  });

  it('stays away entirely while the plan has no points', async () => {
    mockSermon = {
      ...(sermonWithPlan({}) as unknown as Record<string, unknown>),
      outline: { introduction: [], main: [], conclusion: [] },
    } as unknown as Sermon;

    await renderPage();

    expect(screen.queryByTestId('plan-progress-map')).not.toBeInTheDocument();
  });
});
