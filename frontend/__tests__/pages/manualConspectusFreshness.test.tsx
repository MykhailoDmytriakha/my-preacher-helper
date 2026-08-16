import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import ManualConspectusPage from '@/(pages)/(private)/sermons/[id]/plan/manual/page';
import '@testing-library/jest-dom';

import { draftKey, saveDraft } from '@/utils/durableDraft';

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

const mockRefreshSermon = jest.fn().mockResolvedValue(undefined);
let mockSermon: Sermon | null = null;

type FreshnessOptions = {
  known: unknown;
  select: (data: Record<string, unknown>) => unknown;
  enabled: boolean;
  collection: string;
  docId: string | null;
};
let capturedFreshness: FreshnessOptions | null = null;
let freshnessState: 'fresh' | 'stale' | 'unknown' = 'fresh';

jest.mock('@/hooks/useRouteId', () => ({ useRouteId: () => 'sermon-1' }));

jest.mock('@/hooks/useSermon', () => ({
  __esModule: true,
  default: () => ({
    sermon: mockSermon,
    setSermon: jest.fn(),
    loading: false,
    error: null,
    refreshSermon: mockRefreshSermon,
  }),
}));

jest.mock('@/hooks/useFreshnessUid', () => ({ useFreshnessUid: () => 'user-1' }));

jest.mock('@/hooks/useDocumentFreshness', () => ({
  useDocumentFreshness: (options: FreshnessOptions) => {
    capturedFreshness = options;
    return { state: freshnessState, remote: null, remotelyDeleted: false, markSynced: jest.fn() };
  },
}));

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

const mockToastSuccess = jest.fn();
jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

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

describe('the hand-written plan and a newer copy on the server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedFreshness = null;
    freshnessState = 'fresh';
    mockSermon = sermon({ p1: 'What this laptop has' });
  });

  it('says nothing while the screen matches the server', () => {
    render(<ManualConspectusPage />);

    expect(screen.queryByText('freshness.title')).not.toBeInTheDocument();
  });

  it('offers the newer version once the server has one', () => {
    freshnessState = 'stale';

    render(<ManualConspectusPage />);

    expect(screen.getByText('freshness.title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'freshness.refreshAction' })).toBeInTheDocument();
  });

  /**
   * Taking the newer version is SAFE mid-edit here, which is why the button is offered at all:
   * the seeding effect lays storage over every cell EXCEPT the ones being typed into. A screen
   * that could only warn would leave the person reloading by hand — the exact dead end the
   * banner's own documentation warns about.
   */
  it('pulls the newer plan in place when asked', async () => {
    freshnessState = 'stale';

    render(<ManualConspectusPage />);
    fireEvent.click(screen.getByRole('button', { name: 'freshness.refreshAction' }));

    await waitFor(() => expect(mockRefreshSermon).toHaveBeenCalled());
    expect(mockToastSuccess).toHaveBeenCalledWith('freshness.refreshedToast');
  });

  it('stops nagging once dismissed', () => {
    freshnessState = 'stale';

    render(<ManualConspectusPage />);
    fireEvent.click(screen.getByRole('button', { name: 'freshness.dismissAction' }));

    expect(screen.queryByText('freshness.title')).not.toBeInTheDocument();
  });

  describe('what the screen actually asks the detector to watch', () => {
    it('watches this sermon, and only while one is loaded', () => {
      render(<ManualConspectusPage />);

      expect(capturedFreshness?.collection).toBe('sermons');
      expect(capturedFreshness?.docId).toBe('sermon-1');
      expect(capturedFreshness?.enabled).toBe(true);
    });

    /**
     * A detector fed a projection that ignores the plan's text is a detector that stays silent
     * about the only thing this screen edits. Comparing what it was HANDED against what it
     * would compute for a changed server copy is what proves the wire is live.
     */
    it('sees a paragraph rewritten elsewhere as a difference', () => {
      render(<ManualConspectusPage />);

      const fromServer = capturedFreshness?.select({
        ...(mockSermon as unknown as Record<string, unknown>),
        planText: { p1: 'Rewritten on the phone' },
      });

      expect(fromServer).not.toEqual(capturedFreshness?.known);
    });

    /**
     * And the other half, without which the banner cries wolf on every migrated sermon: the
     * same readable plan stored differently is NOT an edit.
     */
    it('sees the same plan moved between storage shapes as no change at all', () => {
      mockSermon = sermon({ p1: 'What this laptop has' });

      render(<ManualConspectusPage />);

      const storedTheOldWay = capturedFreshness?.select({
        ...(mockSermon as unknown as Record<string, unknown>),
        planText: undefined,
        plan: {
          introduction: { outline: '', outlinePoints: { p1: 'What this laptop has' } },
          main: { outline: '', outlinePoints: {} },
          conclusion: { outline: '', outlinePoints: {} },
        },
      });

      expect((storedTheOldWay as { planText: string }).planText).toEqual(
        (capturedFreshness?.known as { planText: string }).planText
      );
    });
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
    freshnessState = 'fresh';
    mockSermon = sermon({ p1: 'What this laptop has' });
    window.localStorage.clear();
  });

  const saveButton = () => screen.getAllByRole('button', { name: 'plan.save' })[0];

  it('is quiet and unavailable while nothing is unsaved', () => {
    render(<ManualConspectusPage />);

    expect(saveButton()).toBeDisabled();
    expect(saveButton().className).toContain('bg-gray-200');
  });

  /**
   * Driven through a REAL user action that leaves a cell unsaved — taking back a recovered
   * draft. The rich editor does not expose a text box in jsdom, and reaching past it into the
   * hook would prove the mock rather than the screen.
   */
  it('lights up in the section colour the moment something is unsaved', () => {
    saveDraft(draftKey('user-1', 'sermon-1', 'plan:p1'), 'текст, который сервер не принял');

    render(<ManualConspectusPage />);
    fireEvent.click(screen.getByRole('button', { name: 'plan.draftRecoveryRestore' }));

    expect(saveButton()).toBeEnabled();
    // Introduction's tone — literal classes, because Tailwind cannot see a computed one.
    expect(saveButton().className).toContain('bg-amber-600');
  });
});
