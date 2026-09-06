import { render, screen } from '@testing-library/react';
import React from 'react';

import DashboardPage from '@/(pages)/(private)/dashboard/page';

/**
 * The dashboard lays its panels out in a grid row, and a grid row stretches every cell to
 * the height of the tallest one. The sermons panel is the tallest, so the studies panel
 * next to it is handed far more height than three notes can fill — and the person sees
 * three of their fourteen notes above a third of a card of white space.
 *
 * The contract pinned here is what the owner asked for in his own words: fill the list to
 * the end if there is anything to fill it with. Whole rows only — a half-drawn note at the
 * bottom edge is worse than the gap.
 *
 * The geometry has to be stubbed because jsdom does no layout at all: every rect it
 * reports is zero, so a panel measuring itself would always see "no room" and the test
 * would pass on a dead feature. The numbers below are the ones measured in Chrome on the
 * screen the owner reported: card 581px, header 53px, note row 74px.
 */

const PANEL_HEIGHT = 581;
const HEADER_HEIGHT = 53;
const ROW_HEIGHT = 74;

const notes = Array.from({ length: 14 }, (_, index) => ({
  id: `note-${index + 1}`,
  userId: 'user-1',
  content: `Content ${index + 1}`,
  title: `Note ${index + 1}`,
  scriptureRefs: [],
  tags: ['tag'],
  createdAt: `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
  updatedAt: `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
  isDraft: false,
  type: 'note' as const,
}));

const sermons = Array.from({ length: 6 }, (_, index) => ({
  id: `sermon-${index + 1}`,
  title: `Sermon ${index + 1}`,
  verse: 'John 1:1',
  date: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  userId: 'user-1',
  thoughts: [],
  isPreached: false,
}));

jest.mock('@/hooks/useDashboardSermons', () => ({
  useDashboardSermons: () => ({ sermons, loading: false, error: null, refresh: jest.fn() }),
}));
jest.mock('@/hooks/useDashboardOptimisticSermons', () => ({
  useDashboardOptimisticSermons: () => ({
    actions: { createSermon: jest.fn(), updateSermon: jest.fn(), deleteSermon: jest.fn() },
    syncStatesById: {},
  }),
}));
jest.mock('@/hooks/useSeries', () => ({ useSeries: () => ({ series: [] }) }));
let mockNotes = notes;
jest.mock('@/hooks/useStudyNotes', () => ({ useStudyNotes: () => ({ notes: mockNotes }) }));
jest.mock('@/hooks/useGroups', () => ({ useGroups: () => ({ groups: [] }) }));
jest.mock('@/hooks/usePrayerRequests', () => ({
  usePrayerRequests: () => ({ prayerRequests: [], createPrayer: jest.fn() }),
}));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock('@/components/AddSermonModal', () => () => null);
jest.mock('@/components/prayer/CreatePrayerModal', () => () => null);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));
jest.mock('@locales/i18n', () => ({
  i18n: { t: (key: string, fallback?: string) => fallback ?? key, language: 'en' },
}));

const isPanel = (element: Element) =>
  element.tagName === 'SECTION' && element.hasAttribute('aria-labelledby');

/**
 * Reports the geometry of a stretched panel: the panel itself is as tall as the grid row
 * made it, its list is as tall as the rows currently inside it, and every row is one row
 * high. Everything else measures zero, which is what jsdom would have said anyway.
 */
function stubPanelGeometry({ stretched = true }: { stretched?: boolean } = {}) {
  const rect = (top: number, height: number) =>
    ({ top, height, bottom: top + height, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

  const listOf = (panel: Element) =>
    Array.from(panel.children).find((child) => child !== panel.firstElementChild);

  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (isPanel(this)) {
      // Stacked on a phone, a panel is exactly as tall as its own content: nothing stretches
      // it, so there is no free space and nothing for the hook to fill.
      if (!stretched) {
        const rows = listOf(this)?.childElementCount ?? 0;
        return rect(0, HEADER_HEIGHT + rows * ROW_HEIGHT);
      }
      return rect(0, PANEL_HEIGHT);
    }

    const parent = this.parentElement;
    if (parent && isPanel(parent) && this !== parent.firstElementChild) {
      return rect(HEADER_HEIGHT, this.childElementCount * ROW_HEIGHT);
    }

    const grandParent = parent?.parentElement;
    if (parent && grandParent && isPanel(grandParent) && parent !== grandParent.firstElementChild) {
      return rect(0, ROW_HEIGHT);
    }

    return rect(0, 0);
  };
}

describe('dashboard panels fill the height the grid row hands them', () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    mockNotes = notes;
    stubPanelGeometry();
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('shows as many recent notes as fit, not the first three', async () => {
    render(<DashboardPage />);

    // 581px of card, 53px of header, 74px per row: seven whole rows fit, an eighth does not.
    // Newest first, so the seventh row is "Note 8" and "Note 7" is the one left out.
    expect(await screen.findByText('Note 8')).toBeInTheDocument();
    expect(screen.queryByText('Note 7')).not.toBeInTheDocument();

    // The order the panel promises is still newest first — filling must not reshuffle.
    const noteLinks = screen.getAllByRole('link', { name: /^Note \d+/ });
    expect(noteLinks.map((link) => link.textContent?.match(/^Note \d+/)?.[0])).toEqual([
      'Note 14', 'Note 13', 'Note 12', 'Note 11', 'Note 10', 'Note 9', 'Note 8',
    ]);
  });

  it('stops at the last note instead of inventing rows to fill the card', async () => {
    mockNotes = notes.slice(0, 4);

    render(<DashboardPage />);

    // Room for seven, only four exist: the card keeps the gap, because the alternative is
    // showing something that is not there. "If there is anything to fill it with."
    expect(await screen.findByText('Note 1')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Note \d+/ })).toHaveLength(4);
  });

  it('leaves the list alone where nothing stretches the panel', async () => {
    stubPanelGeometry({ stretched: false });

    render(<DashboardPage />);

    // A phone stacks the panels, so each one is its own height and there is no dead space.
    // The count has to stay exactly what it was before this hook existed: three.
    expect(await screen.findByText('Note 14')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Note \d+/ })).toHaveLength(3);
  });
});
