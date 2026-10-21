import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import SermonCard from '@/components/dashboard/SermonCard';
import { Sermon, Series } from '@/models/models';
import '@testing-library/jest-dom';

// Mock Next.js router
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'dashboard.moreMatchingThoughts') return `more: ${options?.count}`;
      const translations: { [key: string]: string } = {
        'dashboard.thought': 'thought',
        'dashboard.thoughts': 'thoughts',
        'dashboard.hasOutline': 'Has outline',
        'dashboard.created': 'Created',
        'dashboard.preached': 'Preached',
        'dashboard.plan': 'Plan',
        'dashboard.toStructure': 'To structure',
        'dashboard.goToStructure': 'Go to structure',
        'export.txtTitle': 'TXT',
        'export.soonAvailable': 'export.soonAvailable',
        'optionMenu.options': 'optionMenu.options',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock dateFormatter
jest.mock('@utils/dateFormatter', () => ({
  formatDate: jest.fn(() => '18.02.2025, 11:24'),
  formatDateOnly: jest.fn(() => '18.02.2025'),
  extractIsoString: jest.fn((v) => v ? String(v) : null),
}));

// Mock exportContent
jest.mock('@utils/exportContent', () => ({
  getExportContent: jest.fn(() => Promise.resolve('Test export content')),
}));

// Mock @tanstack/react-query
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
  }),
}));

describe('SermonCard Component', () => {
  const baseSermon: Sermon = {
    id: 'test-sermon-id',
    title: 'Test Sermon Title',
    verse: 'John 3:16',
    date: '2025-02-18',
    thoughts: [
      { id: 'thought-1', text: 'Test thought', date: '2025-02-18', tags: [] }
    ],
    userId: 'test-user-id',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders sermon card with basic information', () => {
    render(
      <SermonCard
        sermon={baseSermon}
      />
    );

    expect(screen.getByText('Test Sermon Title')).toBeInTheDocument();
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    expect(screen.getByText('18.02.2025')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    // No preached/planned date → status badge is hidden
    expect(screen.queryByText('Preached')).not.toBeInTheDocument();
  });

  // The list is for choosing, not reading (BUG-20260911-collapsed-card-renders-unbounded-search-snippets):
  // a sermon with many matching thoughts showed every one, and the card grew over several screens.
  it('shows at most two matching thoughts in search and says how many more there are', () => {
    const snippets = Array.from({ length: 5 }, (_, i) => ({ text: `grace thought ${i + 1}`, tags: [] }));
    render(
      <SermonCard
        sermon={baseSermon}
        searchQuery="grace"
        searchSnippets={snippets}
      />
    );

    expect(screen.getAllByText(/thought \d/)).toHaveLength(2);
    expect(screen.getByText('more: 3')).toBeInTheDocument();
  });

  it('says nothing more when every matching thought is already shown', () => {
    render(
      <SermonCard
        sermon={baseSermon}
        searchQuery="grace"
        searchSnippets={[{ text: 'grace thought 1', tags: [] }]}
      />
    );

    expect(screen.getAllByText(/thought \d/)).toHaveLength(1);
    expect(screen.queryByText(/^more:/)).not.toBeInTheDocument();
  });

  it('displays thought count correctly for singular', () => {
    const sermonWithOneThought: Sermon = {
      ...baseSermon,
      thoughts: [{ id: 'thought-1', text: 'Test thought', date: '2025-02-18', tags: [] }],
    };

    render(
      <SermonCard
        sermon={sermonWithOneThought}
      />
    );

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('displays thought count correctly for plural', () => {
    const sermonWithMultipleThoughts: Sermon = {
      ...baseSermon,
      thoughts: [
        { id: 'thought-1', text: 'Test thought 1', date: '2025-02-18', tags: [] },
        { id: 'thought-2', text: 'Test thought 2', date: '2025-02-18', tags: [] },
      ],
    };

    render(
      <SermonCard
        sermon={sermonWithMultipleThoughts}
      />
    );

    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('displays "Has outline" badge when sermon has outline', () => {
    const sermonWithOutline: Sermon = {
      ...baseSermon,
      outline: {
        introduction: [{ id: 'intro-1', text: 'Intro point' }],
        main: [{ id: 'main-1', text: 'Main point' }],
        conclusion: [{ id: 'conclusion-1', text: 'Conclusion point' }],
      },
    };

    render(
      <SermonCard
        sermon={sermonWithOutline}
      />
    );

    expect(screen.getByText('Has outline')).toBeInTheDocument();
  });

  it('shows missing-preach-dates warning for legacy preached sermon without dates', () => {
    const preachedSermon: Sermon = {
      ...baseSermon,
      isPreached: true,
    };

    render(
      <SermonCard
        sermon={preachedSermon}
      />
    );

    // Legacy case: isPreached=true but no preachDates → header badge hidden (no date to show)
    expect(screen.queryByText('Preached')).not.toBeInTheDocument();
    // Missing-preach-dates warning should appear
    expect(screen.getByText('calendar.noPreachDatesWarning')).toBeInTheDocument();
  });

  it('displays "Preached" badge in header when sermon has preachDates with preached status', () => {
    const preachedSermon: Sermon = {
      ...baseSermon,
      isPreached: true,
      preachDates: [{ id: 'pd-1', date: '2025-03-01', church: { id: 'c1', name: 'Test Church' }, status: 'preached', createdAt: '2025-03-01T00:00:00Z' }],
    };

    render(
      <SermonCard
        sermon={preachedSermon}
      />
    );

    // Preached badge appears once in header only (no duplicate in bottom badges)
    expect(screen.getAllByText('Preached')).toHaveLength(1);
  });

  it('applies consistent styling for all sermons regardless of preached status', () => {
    const preachedSermon: Sermon = {
      ...baseSermon,
      isPreached: true,
    };

    render(
      <SermonCard
        sermon={preachedSermon}
      />
    );

    const card = screen.getByTestId(`sermon-card-${preachedSermon.id}`);
    expect(card).toHaveClass('bg-white', 'dark:bg-gray-800');
  });

  it('applies consistent styling for non-preached sermons', () => {
    const nonPreachedSermon: Sermon = {
      ...baseSermon,
      isPreached: false,
    };

    render(
      <SermonCard
        sermon={nonPreachedSermon}
      />
    );

    const card = screen.getByTestId(`sermon-card-${nonPreachedSermon.id}`);
    expect(card).toHaveClass('bg-white', 'dark:bg-gray-800');
  });

  it('displays series badge when sermon has seriesId', () => {
    const sermonWithSeries: Sermon = {
      ...baseSermon,
      seriesId: 'test-series-id',
    };

    const series: Series[] = [
      {
        id: 'test-series-id',
        title: 'Test Series',
        color: '#FF0000',
        userId: 'test-user-id',
        theme: 'Test Theme',
        bookOrTopic: 'Romans',
        sermonIds: ['test-sermon-id'],
        status: 'active',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
      },
    ];

    render(
      <SermonCard
        sermon={sermonWithSeries}
        series={series}
      />
    );

    expect(screen.getByText('Test Series')).toBeInTheDocument();
  });

  it('opens the series inside the app, without reloading the page', () => {
    // A full reload freezes the page Safari keeps for Back and makes the series wait for the device
    // storage it holds (BUG-20261020-released-page-back-says-local-failure).
    const series: Series[] = [{
      id: 'test-series-id', title: 'Test Series', color: '#FF0000', userId: 'test-user-id', theme: 'Test Theme',
      bookOrTopic: 'Romans', sermonIds: ['test-sermon-id'], status: 'active', createdAt: '2024-01-01', updatedAt: '2024-01-02',
    }];
    const before = window.location.href;
    render(<SermonCard sermon={{ ...baseSermon, seriesId: 'test-series-id' }} series={series} />);
    fireEvent.click(screen.getByText('Test Series'));
    expect(mockPush).toHaveBeenCalledWith('/series/test-series-id');
    expect(window.location.href).toBe(before);
  });

  it('offers the series actions in the card menu, not only on the sermon page', () => {
    // The card already derives its badge from this list; the menu was the one place the
    // list did not reach, so filing a list of sermons meant opening each one in turn.
    const series: Series[] = [
      {
        id: 'series-1',
        title: 'Test Series',
        userId: 'test-user-id',
        theme: 'Test Theme',
        bookOrTopic: 'Romans',
        sermonIds: [],
        status: 'active',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-02',
      },
    ];

    render(
      <SermonCard sermon={baseSermon} series={series} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'optionMenu.options' }));

    expect(screen.getByText('workspaces.series.actions.addToSeries')).toBeInTheDocument();
  });

  it('renders export buttons with icon variant', () => {
    render(
      <SermonCard
        sermon={baseSermon}
      />
    );

    // Check that export buttons are rendered (they should be icon variant in the footer)
    const exportButtons = screen.getAllByRole('button').filter(button =>
      button.querySelector('svg') && !button.textContent?.trim()
    );
    expect(exportButtons.length).toBeGreaterThan(0);
  });
});
