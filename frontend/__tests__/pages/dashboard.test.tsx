import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

import DashboardPage from '@/(pages)/(private)/dashboard/page';
import '@testing-library/jest-dom';
import { runScenarios } from '@test-utils/scenarioRunner';

// Mock child components for structural testing
jest.mock('@/components/navigation/DashboardNav', () => () => <div data-testid="dashboard-nav">Mocked Nav</div>);
jest.mock('@/components/dashboard/DashboardStats', () => ({ sermons }: { sermons: any[] }) => <div data-testid="dashboard-stats">Mocked Stats ({sermons.length})</div>);
jest.mock('@/components/AddSermonModal', () => ({ onNewSermonCreated }: { onNewSermonCreated: any }) => (
  <button data-testid="add-sermon-modal-trigger" onClick={() => onNewSermonCreated({ id: 'new', title: 'New' })}>
    Mocked Add Sermon
  </button>
));
jest.mock('@/components/dashboard/SermonCard', () => ({
  sermon,
  searchSnippets,
  onDelete,
  onUpdate,
}: { sermon: any; searchSnippets?: { type: string; value: string }[]; onDelete: any; onUpdate: any }) => (
  <div data-testid={`sermon-card-${sermon.id}`}>
    <span>{sermon.title}</span>
    <button data-testid={`delete-sermon-${sermon.id}`} onClick={() => onDelete(sermon.id)}>Delete</button>
    <button data-testid={`update-sermon-${sermon.id}`} onClick={() => onUpdate({ ...sermon, title: 'Updated' })}>Update</button>
    {searchSnippets?.map((snippet: any, idx: number) => (
      <div key={idx} data-testid={`sermon-snippet-${sermon.id}-${idx}`}>
        {[snippet.text, ...(snippet.tags || [])].filter(Boolean).join(' ')}
      </div>
    ))}
  </div>
));
jest.mock('@/components/skeletons/DashboardStatsSkeleton', () => ({
  DashboardStatsSkeleton: () => <div data-testid="dashboard-stats-skeleton">Stats Skeleton</div>
}));
jest.mock('@/components/skeletons/SermonCardSkeleton', () => ({
  SermonCardSkeleton: () => <div data-testid="sermon-card-skeleton">Card Skeleton</div>
}));

// Mock Firebase auth
jest.mock('@/services/firebaseAuth.service', () => ({
  auth: {
    currentUser: { uid: 'test-user', email: 'test@example.com' },
    onAuthStateChanged: jest.fn(),
  },
}));

// Mock next/navigation
const mockPush = jest.fn();
const mockUseSearchParams = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => mockUseSearchParams(),
  usePathname: () => '/dashboard',
}));

// Define mock sermons
const mockSermons = [
  {
    id: '1',
    title: 'Sermon 1',
    date: '2023-01-01',
    verse: 'John 3:16',
    thoughts: [
      { id: 't1', text: 'Love and faith', tags: ['agape'], date: '2023-01-01' }
    ],
    isPreached: false,
    seriesId: 'series-1'
  },
  {
    id: '2',
    title: 'Sermon 2',
    date: '2023-01-08',
    verse: 'Romans 8:28',
    thoughts: [
      { id: 't2', text: 'Hope in suffering', tags: ['пример'], date: '2023-01-08' }
    ],
    isPreached: true
  },
  {
    id: '3',
    title: 'Sermon 3',
    date: '2023-01-15',
    verse: 'Matthew 28:19',
    thoughts: [],
    isPreached: false
  },
];

// Mock hooks - expose mock function to control return value
// Mock hooks - expose mock function to control return value
const mockUseDashboardSermons = jest.fn();
const mockUseSeries = jest.fn();
const mockDeleteSermonFromCache = jest.fn();
const mockUpdateSermonCache = jest.fn();
const mockAddSermonToCache = jest.fn();

jest.mock('@/hooks/useDashboardSermons', () => ({
  useDashboardSermons: () => mockUseDashboardSermons(),
  useSermonMutations: () => ({
    deleteSermonFromCache: mockDeleteSermonFromCache,
    updateSermonCache: mockUpdateSermonCache,
    addSermonToCache: mockAddSermonToCache,
  }),
}));

jest.mock('@/hooks/useSeries', () => ({
  useSeries: () => mockUseSeries(),
}));

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'dashboard.mySermons': 'My Sermons',
        'dashboard.searchSermons': 'Search sermons...',
        'dashboard.searchInThoughts': 'Search in thoughts',
        'dashboard.searchInTags': 'Search in tags',
        'dashboard.newest': 'Newest',
        'dashboard.oldest': 'Oldest',
        'dashboard.alphabetical': 'Alphabetical',
        'dashboard.noSermons': 'No sermons yet',
        'dashboard.createFirstSermon': 'Create your first sermon to get started',
        'dashboard.noSearchResults': 'No search results',
        'dashboard.tryDifferentSearch': 'Try a different search term',
        'common.loading': 'Loading...',
        'common.hideSearch': 'Hide Search',
        'common.showSearch': 'Show Search',
        'workspaces.series.filters.allSermons': 'All Sermons',
        'workspaces.series.filters.inSeries': 'In Series',
        'workspaces.series.filters.standalone': 'Standalone',
        'dashboard.activeSermons': 'Active Sermons',
        'dashboard.preached': 'Preached',
        'dashboard.all': 'All',
      };
      return translations[key] || key;
    },
  }),
}));

describe('Dashboard Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default hook return values
    mockUseDashboardSermons.mockReturnValue({
      sermons: mockSermons,
      loading: false,
      error: null,
      refresh: jest.fn(),
    });
    mockUseSeries.mockReturnValue({
      series: [{ id: 'series-1', title: 'Series 1' }],
      createNewSeries: jest.fn(),
    });
    mockUseSearchParams.mockReturnValue({
      get: (_key: string) => null, // Default: no query params = 'active'
    });
    mockPush.mockClear();
  });

  describe('Basic Rendering', () => {
    it('covers baseline layout', async () => {
      await runScenarios(
        [
          {
            name: 'shows heading and stats',
            run: async () => {
              render(<DashboardPage />);
              await waitFor(() => {
                expect(screen.getByRole('heading', { name: /My Sermons/i })).toBeInTheDocument();
                expect(screen.getByTestId('dashboard-stats')).toHaveTextContent('Mocked Stats (3)');
              });
            }
          },
          {
            name: 'renders sermon grid with active sermons by default',
            run: async () => {
              render(<DashboardPage />);
              await waitFor(() => {
                // Should show active sermons (1 and 3)
                expect(screen.getByTestId('sermon-grid')).toBeInTheDocument();
                expect(screen.getByTestId('sermon-card-1')).toBeInTheDocument();
                expect(screen.getByTestId('sermon-card-3')).toBeInTheDocument();
                // Preached sermon (2) should NOT be in active tab
                expect(screen.queryByTestId('sermon-card-2')).not.toBeInTheDocument();
              });
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Tabs Functionality', () => {
    it('switches between Active, All, and Preached tabs', async () => {
      // Setup initial state: tab=null -> active
      mockUseSearchParams.mockReturnValue({ get: () => null });
      const { rerender } = render(<DashboardPage />);

      // Initially Active tab - should show active sermons only
      expect(screen.getByTestId('sermon-card-1')).toBeInTheDocument();
      expect(screen.getByTestId('sermon-card-3')).toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-2')).not.toBeInTheDocument();

      // Click All tab
      fireEvent.click(screen.getByText('All'));
      expect(mockPush).toHaveBeenCalledWith('/dashboard?tab=all');

      // Simulate router update
      mockUseSearchParams.mockReturnValue({ get: () => 'all' });
      rerender(<DashboardPage />);

      // Should show all sermons
      expect(screen.getByTestId('sermon-card-1')).toBeInTheDocument();
      expect(screen.getByTestId('sermon-card-2')).toBeInTheDocument();
      expect(screen.getByTestId('sermon-card-3')).toBeInTheDocument();

      // Click Preached tab
      fireEvent.click(screen.getByText('Preached'));
      expect(mockPush).toHaveBeenCalledWith('/dashboard?tab=preached');

      // Simulate router update
      mockUseSearchParams.mockReturnValue({ get: () => 'preached' });
      rerender(<DashboardPage />);

      // Should show Preached sermon only
      expect(screen.getByTestId('sermon-card-2')).toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-3')).not.toBeInTheDocument();
    });
  });

  describe('Sorting', () => {
    it('sorts preached sermons by latest preach date (newest first)', async () => {
      const preachedSermons = [
        {
          id: 'preached-older',
          title: 'Older Preached Date',
          date: '2024-02-01',
          verse: 'John 1:1',
          thoughts: [],
          isPreached: true,
          preachDates: [
            {
              id: 'pd-1',
              date: '2024-01-10',
              church: { id: 'c1', name: 'Church One' },
              createdAt: '2024-01-10T10:00:00Z',
            },
          ],
        },
        {
          id: 'preached-newer',
          title: 'Newer Preached Date',
          date: '2023-12-31',
          verse: 'John 1:2',
          thoughts: [],
          isPreached: true,
          preachDates: [
            {
              id: 'pd-2',
              date: '2024-03-05',
              church: { id: 'c2', name: 'Church Two' },
              createdAt: '2024-03-05T10:00:00Z',
            },
          ],
        },
      ];

      mockUseDashboardSermons.mockReturnValue({
        sermons: preachedSermons,
        loading: false,
        error: null,
        refresh: jest.fn(),
      });

      render(<DashboardPage />);

      // Simulate switching to preached tab directly via props or mock, 
      // but since we rely on URL, we just mock the return value for this test scenario:
      mockUseSearchParams.mockReturnValue({ get: () => 'preached' });

      // Re-render to pick up new mock value
      render(<DashboardPage />);

      // We don't need to click anymore since we forced the state via mock
      // fireEvent.click(screen.getByText('Preached')); 

      const cards = screen.getAllByTestId(/sermon-card-/);
      expect(cards[0]).toHaveTextContent('Newer Preached Date');
      expect(cards[1]).toHaveTextContent('Older Preached Date');
    });
  });

  describe('Search Functionality', () => {
    it('filters sermons', async () => {
      render(<DashboardPage />);

      const searchInput = screen.getByPlaceholderText('Search sermons...');
      fireEvent.change(searchInput, { target: { value: 'Sermon 1' } });

      expect(screen.getByTestId('sermon-card-1')).toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-3')).not.toBeInTheDocument();
    });

    it('matches by thought text', async () => {
      mockUseSearchParams.mockReturnValue({ get: () => 'all' });
      render(<DashboardPage />);

      // fireEvent.click(screen.getByText('All'));

      const searchInput = screen.getByPlaceholderText('Search sermons...');
      fireEvent.change(searchInput, { target: { value: 'Hope' } });

      expect(screen.getByTestId('sermon-card-2')).toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-1')).not.toBeInTheDocument();
    });

    it('matches by thought tags', async () => {
      mockUseSearchParams.mockReturnValue({ get: () => 'all' });
      render(<DashboardPage />);

      // fireEvent.click(screen.getByText('All'));

      const searchInput = screen.getByPlaceholderText('Search sermons...');
      fireEvent.change(searchInput, { target: { value: 'пример' } });

      expect(screen.getByTestId('sermon-card-2')).toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-3')).not.toBeInTheDocument();
    });

    it('shows snippet for thought match', async () => {
      mockUseSearchParams.mockReturnValue({ get: () => 'all' });
      render(<DashboardPage />);

      // fireEvent.click(screen.getByText('All'));

      const searchInput = screen.getByPlaceholderText('Search sermons...');
      fireEvent.change(searchInput, { target: { value: 'Hope' } });

      expect(screen.getByTestId('sermon-snippet-2-0')).toHaveTextContent('Hope in suffering');
    });

    it('shows snippet for tag match', async () => {
      mockUseSearchParams.mockReturnValue({ get: () => 'all' });
      render(<DashboardPage />);

      // fireEvent.click(screen.getByText('All'));

      const searchInput = screen.getByPlaceholderText('Search sermons...');
      fireEvent.change(searchInput, { target: { value: 'agape' } });

      expect(screen.getByTestId('sermon-snippet-1-0')).toHaveTextContent('agape');
    });
  });

  describe('Loading State', () => {
    it('shows skeletons when loading', async () => {
      mockUseDashboardSermons.mockReturnValue({
        sermons: [],
        loading: true,
        error: null,
        refresh: jest.fn(),
      });

      render(<DashboardPage />);
      expect(screen.getByTestId('dashboard-stats-skeleton')).toBeInTheDocument();
      expect(screen.getAllByTestId('sermon-card-skeleton').length).toBeGreaterThan(0);
    });
  });

  describe('Empty State', () => {
    it('shows empty message when no sermons', async () => {
      mockUseDashboardSermons.mockReturnValue({
        sermons: [],
        loading: false,
        error: null,
        refresh: jest.fn(),
      });

      render(<DashboardPage />);
      expect(screen.getByText('No sermons yet')).toBeInTheDocument();
    });
  });

  describe('Interactions', () => {
    it('handles tab change to active explicitly', async () => {
      mockUseSearchParams.mockReturnValue({ get: () => 'all' });
      render(<DashboardPage />);

      fireEvent.click(screen.getByText('Active Sermons'));
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });

    it('handles sermon actions', async () => {
      const { deleteSermonFromCache, updateSermonCache, addSermonToCache } = require('@/hooks/useDashboardSermons').useSermonMutations();

      render(<DashboardPage />);

      // Delete
      fireEvent.click(screen.getByTestId('delete-sermon-1'));
      expect(deleteSermonFromCache).toHaveBeenCalledWith('1');

      // Update
      fireEvent.click(screen.getByTestId('update-sermon-1'));
      expect(updateSermonCache).toHaveBeenCalledWith(expect.objectContaining({ title: 'Updated' }));

      // Add
      fireEvent.click(screen.getByTestId('add-sermon-modal-trigger'));
      expect(addSermonToCache).toHaveBeenCalledWith(expect.objectContaining({ id: 'new' }));
    });
  });
});
