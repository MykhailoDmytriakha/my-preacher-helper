import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import SeriesDetailPage from '@/(pages)/(private)/series/[id]/page';

import { TestProviders } from '../../test-utils/test-providers';

const mockAddSermons = jest.fn();
const mockRefreshSeriesDetail = jest.fn();
const mockInvalidateQueries = jest.fn();

// Mock Next.js router
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockUseParams = jest.fn(() => ({ id: 'test-series-id' }));

const mockUseAuth = jest.fn<{ user: { uid: string } | null }, []>(() => ({ user: { uid: 'test-user-id' } }));
const mockUseSeries = jest.fn((_userId: string | null) => ({ deleteExistingSeries: jest.fn() }));
const mockUseSeriesDetail = jest.fn();

jest.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
  }),
}));

// Mock hooks
jest.mock('@/hooks/useSeriesDetail', () => ({
  useSeriesDetail: (seriesId: string) => mockUseSeriesDetail(seriesId),
}));

jest.mock('@/hooks/useSeries', () => ({
  useSeries: (userId: string | null) => mockUseSeries(userId),
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  };
});

// Mock icons
jest.mock('@heroicons/react/24/outline', () => ({
  ArrowLeftIcon: () => <div data-testid="arrow-left-icon" />,
  PencilIcon: () => <div data-testid="pencil-icon" />,
  TrashIcon: () => <div data-testid="trash-icon" />,
  PlusIcon: () => <div data-testid="plus-icon" />,
  ExclamationTriangleIcon: () => <div data-testid="exclamation-icon" />,
}));

// Mock debugMode
jest.mock('@/utils/debugMode', () => ({
  __esModule: true,
  debugLog: jest.fn(),
  isDebugModeEnabled: jest.fn(() => false),
  setDebugModeEnabled: jest.fn(),
}));

// Mock i18n
jest.mock('@locales/i18n', () => { }, { virtual: true });
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock components
jest.mock('@/components/series/SermonInSeriesCard', () => {
  return function MockSermonInSeriesCard() {
    return <div data-testid="sermon-in-series-card">Sermon Card</div>;
  };
});

jest.mock('@/components/series/EditSeriesModal', () => {
  return function MockEditSeriesModal({ showEditModal }: { showEditModal: boolean }) {
    return showEditModal ? <div data-testid="edit-series-modal">Edit Modal</div> : null;
  };
});

jest.mock('@/components/series/AddSermonToSeriesModal', () => {
  return function MockAddSermonToSeriesModal({
    onCreateNewSermon
  }: {
    onCreateNewSermon?: () => void;
    onClose?: () => void;
    onAddSermons?: (sermonIds: string[]) => void;
    currentSeriesSermonIds?: string[];
    seriesId?: string;
  }) {
    return (
      <div data-testid="add-sermon-modal">
        Add Sermon Modal
        <button
          data-testid="create-new-sermon-btn"
          onClick={onCreateNewSermon}
        >
          Create New Sermon
        </button>
      </div>
    );
  };
});

// Mock AddSermonModal
jest.mock('@/components/AddSermonModal', () => {
  return function MockAddSermonModal({
    isOpen,
    onCancel,
    onNewSermonCreated
  }: {
    isOpen?: boolean;
    onCancel?: () => void;
    showTriggerButton?: boolean;
    preSelectedSeriesId?: string;
    onNewSermonCreated?: (sermon: any) => void;
  }) {
    return isOpen ? (
      <div data-testid="create-sermon-modal">
        Create Sermon Modal
        <button data-testid="cancel-create-sermon" onClick={onCancel}>
          Cancel
        </button>
        <button
          data-testid="create-sermon-button"
          onClick={() => onNewSermonCreated?.({
            id: 'new-sermon-id',
            title: 'New Test Sermon',
            verse: 'John 3:16',
            date: new Date().toISOString(),
            thoughts: [],
            userId: 'user-1',
          })}
        >
          Create Sermon
        </button>
      </div>
    ) : null;
  };
});

// Mock sonner
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

describe('SeriesDetailPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddSermons.mockResolvedValue(undefined);
    mockUseParams.mockReturnValue({ id: 'test-series-id' });
    mockUseAuth.mockReturnValue({ user: { uid: 'test-user-id' } });
    mockUseSeries.mockReturnValue({ deleteExistingSeries: jest.fn() });
    mockUseSeriesDetail.mockReturnValue({
      series: {
        id: 'test-series-id',
        title: 'Test Series',
        theme: 'Test Theme',
        status: 'active',
        color: '#FF0000',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      sermons: [],
      loading: false,
      error: null,
      addSermons: mockAddSermons,
      addSermon: jest.fn(),
      removeSermon: jest.fn(),
      reorderSeriesSermons: jest.fn(),
      updateSeriesDetail: jest.fn(),
      refreshSeriesDetail: mockRefreshSeriesDetail,
    });
  });

  it('renders series details correctly', () => {
    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    expect(screen.getByText('Test Series')).toBeInTheDocument();
    expect(screen.getByText('Test Theme')).toBeInTheDocument();
    expect(screen.getAllByText('workspaces.series.form.statuses.active')).toHaveLength(2); // status badge and indicator
  });

  it('renders skeleton when loading', () => {
    mockUseSeriesDetail.mockReturnValue({
      series: null,
      sermons: [],
      loading: true,
      error: null,
      addSermons: mockAddSermons,
      addSermon: jest.fn(),
      removeSermon: jest.fn(),
      reorderSeriesSermons: jest.fn(),
      updateSeriesDetail: jest.fn(),
      refreshSeriesDetail: mockRefreshSeriesDetail,
    });

    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    expect(screen.queryByText('Test Series')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders error state when series is missing', () => {
    mockUseSeriesDetail.mockReturnValue({
      series: null,
      sermons: [],
      loading: false,
      error: new Error('Failed'),
      addSermons: mockAddSermons,
      addSermon: jest.fn(),
      removeSermon: jest.fn(),
      reorderSeriesSermons: jest.fn(),
      updateSeriesDetail: jest.fn(),
      refreshSeriesDetail: mockRefreshSeriesDetail,
    });

    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    expect(screen.getByText('Series not found or failed to load.')).toBeInTheDocument();
  });

  it('uses empty seriesId when params id is not a string', () => {
    mockUseParams.mockReturnValue({ id: ['bad-id'] as unknown as string });

    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    expect(mockUseSeriesDetail).toHaveBeenCalledWith('');
  });

  it('uses null user id when user is missing', () => {
    mockUseAuth.mockReturnValue({ user: null });

    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    expect(mockUseSeries).toHaveBeenCalledWith(null);
  });

  it('renders completed status dot and updatedAt placeholder', () => {
    mockUseSeriesDetail.mockReturnValue({
      series: {
        id: 'test-series-id',
        title: 'Test Series',
        theme: 'Test Theme',
        status: 'completed',
        color: '#FF0000',
      },
      sermons: [
        { id: 'sermon-1', isPreached: true },
        { id: 'sermon-2', isPreached: false },
      ],
      loading: false,
      error: null,
      addSermons: mockAddSermons,
      addSermon: jest.fn(),
      removeSermon: jest.fn(),
      reorderSeriesSermons: jest.fn(),
      updateSeriesDetail: jest.fn(),
      refreshSeriesDetail: mockRefreshSeriesDetail,
    });

    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    expect(document.querySelector('span.h-2.w-2.rounded-full.bg-emerald-500')).toBeTruthy();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('navigates to /series when Back to Series button is clicked', () => {
    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    const backButton = screen.getByText('navigation.series');
    fireEvent.click(backButton);

    expect(mockPush).toHaveBeenCalledWith('/series');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('opens add sermon modal when Add Sermon button is clicked', async () => {
    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    const addButtons = screen.getAllByText('workspaces.series.actions.addSermon');
    const addButton = addButtons[0]; // Get the first one (header button)
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getByTestId('add-sermon-modal')).toBeInTheDocument();
    });
  });

  it('opens create sermon modal when Create New Sermon is clicked', async () => {
    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    // First open add sermon modal
    const addButtons = screen.getAllByText('workspaces.series.actions.addSermon');
    const addButton = addButtons[0]; // Get the first one (header button)
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getByTestId('add-sermon-modal')).toBeInTheDocument();
    });

    // Then click create new sermon button
    const createButton = screen.getByTestId('create-new-sermon-btn');
    fireEvent.click(createButton);

    // Should close first modal and open second
    await waitFor(() => {
      expect(screen.queryByTestId('add-sermon-modal')).not.toBeInTheDocument();
      expect(screen.getByTestId('create-sermon-modal')).toBeInTheDocument();
    });
  });

  it('returns to add sermon modal when create sermon is cancelled', async () => {
    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    // Open add sermon modal
    const addButtons = screen.getAllByText('workspaces.series.actions.addSermon');
    const addButton = addButtons[0]; // Get the first one (header button)
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getByTestId('add-sermon-modal')).toBeInTheDocument();
    });

    // Click create new sermon
    const createButton = screen.getByTestId('create-new-sermon-btn');
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByTestId('create-sermon-modal')).toBeInTheDocument();
    });

    // Cancel create sermon
    const cancelButton = screen.getByTestId('cancel-create-sermon');
    fireEvent.click(cancelButton);

    // Should return to add sermon modal
    await waitFor(() => {
      expect(screen.getByTestId('add-sermon-modal')).toBeInTheDocument();
      expect(screen.queryByTestId('create-sermon-modal')).not.toBeInTheDocument();
    });
  });

  it('creates sermon, closes modals, and invalidates cache', async () => {
    jest.useFakeTimers();

    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    const addButtons = screen.getAllByText('workspaces.series.actions.addSermon');
    fireEvent.click(addButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId('add-sermon-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('create-new-sermon-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('create-sermon-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('create-sermon-button'));

    await waitFor(() => {
      expect(screen.queryByTestId('add-sermon-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('create-sermon-modal')).not.toBeInTheDocument();
    });

    act(() => {
      jest.runAllTimers();
    });

    expect(mockAddSermons).toHaveBeenCalledWith(['new-sermon-id']);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['series-detail', 'test-series-id'] });

    jest.useRealTimers();
  });

  it('keeps create modal open when adding sermon to series fails', async () => {
    mockAddSermons.mockRejectedValueOnce(new Error('Add failed'));

    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    const addButtons = screen.getAllByText('workspaces.series.actions.addSermon');
    fireEvent.click(addButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId('add-sermon-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('create-new-sermon-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('create-sermon-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('create-sermon-button'));

    await waitFor(() => {
      expect(screen.getByTestId('create-sermon-modal')).toBeInTheDocument();
    });
  });

});
