import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

import SermonsPage from '@/(pages)/(private)/sermons/page';
import '@testing-library/jest-dom';
import { runScenarios } from '@test-utils/scenarioRunner';

// Mock child components for structural testing
jest.mock('@/components/navigation/DashboardNav', () => () => <div data-testid="dashboard-nav">Mocked Nav</div>);
jest.mock('@/components/dashboard/DashboardStats', () => ({ sermons }: { sermons: any[] }) => <div data-testid="dashboard-stats">Mocked Stats ({sermons.length})</div>);
jest.mock('@/components/AddSermonModal', () => ({ onCreateRequest }: { onCreateRequest: any }) => (
  <button
    data-testid="add-sermon-modal-trigger"
    onClick={() => onCreateRequest({ title: 'New', verse: 'John 1:1' })}
  >
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
const mockReplace = jest.fn();
const mockUseSearchParams = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    prefetch: jest.fn(),
  }),
  useSearchParams: () => mockUseSearchParams(),
  usePathname: () => '/sermons',
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
const mockOptimisticCreateSermon = jest.fn();

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

jest.mock('@/hooks/useDashboardOptimisticSermons', () => ({
  useDashboardOptimisticSermons: () => ({
    syncStatesById: {},
    actions: {
      createSermon: mockOptimisticCreateSermon,
      saveEditedSermon: jest.fn(),
      deleteSermon: jest.fn(),
      markAsPreachedFromPreferred: jest.fn(),
      unmarkAsPreached: jest.fn(),
      savePreachDate: jest.fn(),
      retrySync: jest.fn(),
      dismissSyncError: jest.fn(),
    },
  }),
}));

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'dashboard.mySermons': 'My Sermons',
        'dashboard.searchSermons': 'Search sermons...',
        'dashboard.searchSettings': 'Search settings',
        'dashboard.searchInThoughts': 'Search in thoughts',
        'dashboard.searchInTags': 'Search in tags',
        'dashboard.newest': 'Newest',
        'dashboard.oldest': 'Oldest',
        'dashboard.alphabetical': 'Alphabetical',
        'dashboard.recentlyUpdated': 'Recently updated',
        'filters.resetFilters': 'Reset filters',
        'filters.activeFilters': 'Active filters',
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

// localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

describe('Sermons Page', () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
    // Default to empty search params
    mockUseSearchParams.mockReturnValue(new URLSearchParams(''));

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
    mockPush.mockClear();
    mockOptimisticCreateSermon.mockReset();
  });

  describe('Basic Rendering', () => {
    it('covers baseline layout', async () => {
      await runScenarios(
        [
          {
            name: 'shows heading and stats',
            run: async () => {
              render(<SermonsPage />);
              await waitFor(() => {
                expect(screen.getByRole('heading', { name: /My Sermons/i })).toBeInTheDocument();
                expect(screen.getByTestId('dashboard-stats')).toHaveTextContent('Mocked Stats (3)');
              });
            }
          },
          {
            name: 'renders sermon grid with active sermons by default',
            run: async () => {
              render(<SermonsPage />);
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
      mockUseSearchParams.mockReturnValue(new URLSearchParams(''));
      const { rerender } = render(<SermonsPage />);

      // Initially Active tab - should show active sermons only
      expect(screen.getByTestId('sermon-card-1')).toBeInTheDocument();
      expect(screen.getByTestId('sermon-card-3')).toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-2')).not.toBeInTheDocument();

      // Click All tab
      fireEvent.click(screen.getByText('All'));
      expect(mockPush).toHaveBeenCalledWith('/sermons?tab=all');

      // Simulate router update
      mockUseSearchParams.mockReturnValue(new URLSearchParams('tab=all'));
      rerender(<SermonsPage />);

      // Should show all sermons
      expect(screen.getByTestId('sermon-card-1')).toBeInTheDocument();
      expect(screen.getByTestId('sermon-card-2')).toBeInTheDocument();
      expect(screen.getByTestId('sermon-card-3')).toBeInTheDocument();

      // Click Preached tab
      fireEvent.click(screen.getByText('Preached'));
      expect(mockPush).toHaveBeenCalledWith('/sermons?tab=preached');

      // Simulate router update
      mockUseSearchParams.mockReturnValue(new URLSearchParams('tab=preached'));
      rerender(<SermonsPage />);

      // Should show Preached sermon only
      expect(screen.getByTestId('sermon-card-2')).toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-3')).not.toBeInTheDocument();
    });
  });

  describe('Sorting', () => {
    it('sorts preached sermons by latest preach date (newest first)', async () => {
      localStorageMock.setItem('sermons:sort', 'newest');
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

      render(<SermonsPage />);

      // Simulate switching to preached tab directly via props or mock, 
      // but since we rely on URL, we just mock the return value for this test scenario:
      mockUseSearchParams.mockReturnValue(new URLSearchParams('tab=preached'));

      // Re-render to pick up new mock value
      render(<SermonsPage />);

      // We don't need to click anymore since we forced the state via mock
      // fireEvent.click(screen.getByText('Preached')); 

      const cards = screen.getAllByTestId(/sermon-card-/);
      expect(cards[0]).toHaveTextContent('Newer Preached Date');
      expect(cards[1]).toHaveTextContent('Older Preached Date');
    });
  });

  describe('Search Functionality', () => {
    it('filters sermons', async () => {
      render(<SermonsPage />);

      const searchInput = screen.getByPlaceholderText('Search sermons...');
      fireEvent.change(searchInput, { target: { value: 'Sermon 1' } });

      expect(screen.getByTestId('sermon-card-1')).toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-3')).not.toBeInTheDocument();
    });

    it('matches by thought text', async () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('tab=all'));
      render(<SermonsPage />);

      // fireEvent.click(screen.getByText('All'));

      const searchInput = screen.getByPlaceholderText('Search sermons...');
      fireEvent.change(searchInput, { target: { value: 'Hope' } });

      expect(screen.getByTestId('sermon-card-2')).toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-1')).not.toBeInTheDocument();
    });

    it('matches by thought tags', async () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('tab=all'));
      render(<SermonsPage />);

      // fireEvent.click(screen.getByText('All'));

      const searchInput = screen.getByPlaceholderText('Search sermons...');
      fireEvent.change(searchInput, { target: { value: 'пример' } });

      expect(screen.getByTestId('sermon-card-2')).toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sermon-card-3')).not.toBeInTheDocument();
    });

    it('shows snippet for thought match', async () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('tab=all'));
      render(<SermonsPage />);

      // fireEvent.click(screen.getByText('All'));

      const searchInput = screen.getByPlaceholderText('Search sermons...');
      fireEvent.change(searchInput, { target: { value: 'Hope' } });

      expect(screen.getByTestId('sermon-snippet-2-0')).toHaveTextContent('Hope in suffering');
    });

    it('shows snippet for tag match', async () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('tab=all'));
      render(<SermonsPage />);

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

      render(<SermonsPage />);
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

      render(<SermonsPage />);
      expect(screen.getByText('No sermons yet')).toBeInTheDocument();
    });
  });

  describe('Interactions', () => {
    it('handles tab change to active explicitly', async () => {
      // Setup mockUseSearchParams for this test specifically
      mockUseSearchParams.mockReturnValue(new URLSearchParams(''));

      render(<SermonsPage />);

      const activeTab = screen.getByRole('button', { name: /Active Sermons/i });
      fireEvent.click(activeTab);

      // Wait for any potential updates
      await waitFor(() => {
        expect(activeTab).toHaveClass('bg-blue-50');
      });
    });

    it('updates URL with search query via debounce', async () => {
      jest.useFakeTimers();
      mockUseSearchParams.mockReturnValue(new URLSearchParams(''));

      render(<SermonsPage />);

      // Open search
      fireEvent.click(screen.getByRole('button', { name: 'Search sermons...' }));
      const searchInput = screen.getByPlaceholderText('Search sermons...');

      fireEvent.change(searchInput, { target: { value: 'faith' } });

      // Fast forward the debounce timer (300ms)
      jest.advanceTimersByTime(300);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/sermons?q=faith', { scroll: false });
      });

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });
      jest.advanceTimersByTime(300);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/sermons?', { scroll: false });
      });

      jest.useRealTimers();
    });

    it('collapses search input on blur when empty', async () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams(''));

      render(<SermonsPage />);

      // Click search icon to expand
      const searchButton = screen.getByRole('button', { name: 'Search sermons...' });
      fireEvent.click(searchButton);

      const searchInput = screen.getByPlaceholderText('Search sermons...');
      expect(searchInput).toHaveClass('opacity-100'); // Expanded

      // Blur the search container by focusing an element outside
      const activeTabButton = screen.getByRole('button', { name: /Active Sermons/i });
      fireEvent.blur(searchInput, { relatedTarget: activeTabButton });

      // Note: React's fireEvent.blur with relatedTarget on the input bubbles to the onBlur handler
      // of the container div. Let's trigger the container's blur directly to be safe,
      // as fireEvent doesn't perfectly simulate the focusout bubbling in all JSDOM setups.
      const searchContainer = searchInput.closest('div.group\\/search');
      if (searchContainer) {
        fireEvent.blur(searchContainer, { relatedTarget: activeTabButton });
      }

      await waitFor(() => {
        expect(searchInput).toHaveClass('opacity-0'); // Collapsed
      });
    });

    it('auto-expands search input if URL has a query on load', () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('q=faith'));

      render(<SermonsPage />);

      const searchInput = screen.getByPlaceholderText('Search sermons...');

      // It should be expanded auto-magically due to the URL parameter
      expect(searchInput).toHaveClass('opacity-100');
    });
    it('handles sermon actions', async () => {
      const { deleteSermonFromCache, updateSermonCache } = require('@/hooks/useDashboardSermons').useSermonMutations();

      render(<SermonsPage />);

      // Delete
      fireEvent.click(screen.getByTestId('delete-sermon-1'));
      expect(deleteSermonFromCache).toHaveBeenCalledWith('1');

      // Update
      fireEvent.click(screen.getByTestId('update-sermon-1'));
      expect(updateSermonCache).toHaveBeenCalledWith(expect.objectContaining({ title: 'Updated' }));

      // Add
      fireEvent.click(screen.getByTestId('add-sermon-modal-trigger'));
      expect(mockOptimisticCreateSermon).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New', verse: 'John 1:1' })
      );
    });
  });

  describe('Toolbar — sort & filter dropdowns (Popover)', () => {
    it('renders recentlyUpdated option in sort dropdown', async () => {
      render(<SermonsPage />);
      fireEvent.click(screen.getByRole('button', { name: /common.filters/i }));

      expect(await screen.findByDisplayValue('Recently updated')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Newest' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Recently updated' })).toBeInTheDocument();
    });

    it('persists sort selection to localStorage and shows active filter pill', async () => {
      render(<SermonsPage />);
      fireEvent.click(screen.getByRole('button', { name: /common.filters/i }));

      const sortSelect = await screen.findByDisplayValue('Recently updated');
      fireEvent.change(sortSelect, { target: { value: 'oldest' } });

      expect(localStorageMock.getItem('sermons:sort')).toBe('oldest');
      // Should show the pill
      expect(screen.getAllByText(/Oldest/).length).toBeGreaterThan(0);
    });

    it('reads initial sort from localStorage and renders pill immediately', async () => {
      localStorageMock.setItem('sermons:sort', 'alphabetical');
      render(<SermonsPage />);

      // Pill should be visible without opening popover
      expect(screen.getAllByText(/Alphabetical/).length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole('button', { name: /common.filters/i }));
      expect(await screen.findByDisplayValue('Alphabetical')).toBeInTheDocument();
    });

    it('persists series filter to localStorage and shows pill', async () => {
      render(<SermonsPage />);
      fireEvent.click(screen.getByRole('button', { name: /common.filters/i }));

      const seriesSelect = await screen.findByDisplayValue('All Sermons');
      fireEvent.change(seriesSelect, { target: { value: 'inSeries' } });

      expect(localStorageMock.getItem('sermons:seriesFilter')).toBe('inSeries');
      expect(screen.getAllByText(/In Series/).length).toBeGreaterThan(0);
    });

    it('reset restores default values in localStorage', async () => {
      localStorageMock.setItem('sermons:sort', 'oldest');
      localStorageMock.setItem('sermons:seriesFilter', 'inSeries');
      render(<SermonsPage />);

      // Pills area has a clear button
      const resetBtn = screen.getByText('filters.clear');
      fireEvent.click(resetBtn);

      expect(localStorageMock.getItem('sermons:sort')).not.toBe('oldest');
      expect(localStorageMock.getItem('sermons:seriesFilter')).not.toBe('inSeries');

      // Open popover to verify defaults
      fireEvent.click(screen.getByRole('button', { name: /common.filters/i }));
      expect(await screen.findByDisplayValue('Recently updated')).toBeInTheDocument();
      expect(screen.getByDisplayValue('All Sermons')).toBeInTheDocument();
    });
  });

  describe('Toolbar — search modifiers (Popover)', () => {
    it('persists searchInThoughts to localStorage', async () => {
      render(<SermonsPage />);

      // Open search
      fireEvent.click(screen.getByRole('button', { name: 'Search sermons...' }));

      // Open search settings
      fireEvent.click(screen.getByRole('button', { name: 'Search settings' }));

      // The popover should be open now, we can find the checkbox
      const checkbox = await screen.findByRole('checkbox', { name: /Search in thoughts/i });
      fireEvent.click(checkbox);

      expect(localStorageMock.getItem('sermons:searchInThoughts')).toBe('false');
    });
  });
});
