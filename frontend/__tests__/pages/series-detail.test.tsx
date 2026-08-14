import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { persistedWrite } from '@/utils/recoverableWrite';
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

const createSeriesDetailMock = (overrides: Record<string, unknown> = {}) => ({
  series: {
    id: 'test-series-id',
    title: 'Test Series',
    theme: 'Test Theme',
    status: 'active',
    color: '#FF0000',
    updatedAt: '2024-01-01T00:00:00Z',
    items: [],
    sermonIds: [],
  },
  items: [],
  sermons: [],
  groups: [],
  loading: false,
  error: null,
  addSermons: mockAddSermons,
  addSermon: jest.fn(),
  addGroup: jest.fn(),
  removeItem: jest.fn(),
  removeSermon: jest.fn(),
  reorderSeriesSermons: jest.fn(),
  reorderMixedItems: jest.fn(),
  updateSeriesDetail: jest.fn(),
  refreshSeriesDetail: mockRefreshSeriesDetail,
  ...overrides,
});

jest.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
  }),
}));

// Mock hooks
// The freshness banner only appears when the record IS stale, so the suite has to put it
// there — otherwise a test about "which banner wins" passes with neither on screen.
const mockFreshness = jest.fn();
jest.mock('@/hooks/useDocumentFreshness', () => ({
  useDocumentFreshness: () => mockFreshness(),
}));

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
jest.mock('@/components/series/EditSeriesModal', () => {
  return function MockEditSeriesModal({
    series,
    onClose,
    onUpdate,
  }: {
    series: { id: string; title: string };
    onClose: () => void;
    // THE PRODUCTION CONTRACT: a submission, not a bare promise. The stand-in used to
    // `await onUpdate(...)` directly, so it closed on whatever the page returned — a page
    // that closed the editor on a REFUSAL would still have looked fine here.
    onUpdate: (
      seriesId: string,
      updates: { title: string }
    ) => { acceptance: Promise<unknown>; persistence: Promise<void> };
  }) {
    const [title, setTitle] = React.useState(series.title);
    const [saveError, setSaveError] = React.useState('');

    return (
      <div role="dialog" aria-label="Edit series page modal" data-testid="edit-series-modal">
        <label htmlFor="page-series-title">Series title in page modal</label>
        <input
          id="page-series-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button
          type="button"
          onClick={async () => {
            setSaveError('');
            try {
              // Close only once the write is ACCEPTED — the same rule the real modal follows.
              await onUpdate(series.id, { title }).acceptance;
              onClose();
            } catch {
              setSaveError('Save refused in page modal');
            }
          }}
        >
          Save page series
        </button>
        {saveError && <p role="alert">{saveError}</p>}
      </div>
    );
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
    onClose,
    onNewSermonCreated
  }: {
    isOpen?: boolean;
    onCancel?: () => void;
    onClose?: () => void;
    showTriggerButton?: boolean;
    preSelectedSeriesId?: string;
    onNewSermonCreated?: (sermon: any) => Promise<void> | void;
  }) {
    return isOpen ? (
      <div data-testid="create-sermon-modal">
        Create Sermon Modal
        <button data-testid="cancel-create-sermon" onClick={onCancel}>
          Cancel
        </button>
        <button
          data-testid="create-sermon-button"
          onClick={async () => {
            try {
              await onNewSermonCreated?.({
                id: 'new-sermon-id',
                title: 'New Test Sermon',
                verse: 'John 3:16',
                date: new Date().toISOString(),
                thoughts: [],
                userId: 'user-1',
              });
              onClose?.();
            } catch {
              // Keep the mock modal open on failure to mirror the real component contract.
            }
          }}
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
    // The hook returns a WriteSubmission — callers await its ACCEPTANCE, not the object.
    mockAddSermons.mockReturnValue(persistedWrite(Promise.resolve(undefined)));
    mockUseParams.mockReturnValue({ id: 'test-series-id' });
    mockUseAuth.mockReturnValue({ user: { uid: 'test-user-id' } });
    mockUseSeries.mockReturnValue({ deleteExistingSeries: jest.fn() });
    mockUseSeriesDetail.mockReturnValue(createSeriesDetailMock());
    mockFreshness.mockReturnValue({
      state: 'fresh',
      remote: null,
      remotelyDeleted: false,
      markSynced: jest.fn(),
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
    expect(screen.getAllByText('workspaces.series.form.statuses.active')).toHaveLength(1);
  });

  it('shows ONE banner when a save conflict is on screen, not two', async () => {
    /**
     * Found in the browser, not by a test: a refused save rendered the conflict banner
     * ("your edit was not saved — here is your text, choose") AND the freshness banner
     * ("this changed elsewhere, load the newer version?") at the same time. One event,
     * two headlines, four buttons — and "take theirs" and "load newer" meant the same
     * thing. The conflict banner holds the person's text, so it is the one that stays.
     */
    // The record HAS changed elsewhere — so without the rule under test both banners
    // would be on screen at once.
    mockFreshness.mockReturnValue({
      state: 'stale',
      remote: { title: 'Изменено на другом устройстве' },
      remotelyDeleted: false,
      markSynced: jest.fn(),
    });
    mockUseSeriesDetail.mockReturnValue(
      createSeriesDetailMock({
        saveConflict: { payload: { title: 'Название с моего ноутбука' }, actualRevision: 2 },
        keepMineOnConflict: jest.fn(),
        takeTheirsOnConflict: jest.fn(),
        resolvingConflict: false,
      })
    );

    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    expect(screen.getByText('freshness.conflictTitle')).toBeInTheDocument();
    expect(screen.getByText('Название с моего ноутбука')).toBeInTheDocument();
    expect(screen.queryByText('freshness.title')).not.toBeInTheDocument();
  });

  it('renders skeleton when loading', () => {
    mockUseSeriesDetail.mockReturnValue(createSeriesDetailMock({ series: null, loading: true }));

    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    expect(screen.queryByText('Test Series')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders error state when series is missing', () => {
    mockUseSeriesDetail.mockReturnValue(createSeriesDetailMock({ series: null, error: new Error('Failed') }));

    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    expect(screen.getByText('workspaces.series.errors.updateFailed')).toBeInTheDocument();
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

  it('renders completed status badge', () => {
    mockUseSeriesDetail.mockReturnValue(createSeriesDetailMock({
      series: {
        id: 'test-series-id',
        title: 'Test Series',
        theme: 'Test Theme',
        status: 'completed',
        color: '#FF0000',
        items: [],
        sermonIds: [],
      },
      sermons: [
        { id: 'sermon-1', isPreached: true },
        { id: 'sermon-2', isPreached: false },
      ],
    }));

    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    expect(screen.getByText('workspaces.series.form.statuses.completed')).toBeInTheDocument();
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

  it('keeps the rendered edit modal and its exact title after the page update rejects', async () => {
    // A REAL submission whose acceptance rejects — that is what the page hands the editor.
    // Mocking a bare rejected promise let this pass no matter how the page was wired.
    const refusal = Object.assign(new Error('Permission denied'), { code: 'permission-denied' });
    const updateSeriesDetail = jest.fn(() => {
      const acceptance = Promise.reject(refusal);
      const persistence = Promise.reject(refusal);
      void acceptance.catch(() => undefined);
      void persistence.catch(() => undefined);
      return { acceptance, persistence };
    });
    mockUseSeriesDetail.mockReturnValue(createSeriesDetailMock({ updateSeriesDetail }));

    render(
      <TestProviders>
        <SeriesDetailPage />
      </TestProviders>
    );

    fireEvent.click(screen.getByText('workspaces.series.editSeries'));
    const title = screen.getByLabelText('Series title in page modal');
    fireEvent.change(title, { target: { value: 'Exact refused page series title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save page series' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Save refused in page modal');
    expect(screen.getByRole('dialog', { name: 'Edit series page modal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Series title in page modal')).toHaveValue(
      'Exact refused page series title'
    );
    expect(screen.queryByText('workspaces.series.errors.updateFailed')).not.toBeInTheDocument();
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

  it('creates sermon in series and closes modals', async () => {
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
    // D1 fix: the page no longer fires a racy setTimeout(invalidate, 100); reconcile now
    // lives in the sweep's onSuccess (useSeriesMembership), tied to the real commit-ack.
    // With addSermons mocked here that path is bypassed, so there is no page-level invalidate to assert.

    jest.useRealTimers();
  });

  it('keeps create modal open when adding sermon to series fails', async () => {
    // A REFUSED SUBMISSION, not a rejected bare promise. Mocking the old shape is why
    // this test stayed green while production `await`-ed the submission object itself
    // and never saw the refusal: the modal closed and the new sermon silently stayed
    // outside the series.
    mockAddSermons.mockReturnValueOnce(
      persistedWrite(
        Promise.reject(Object.assign(new Error('Add failed'), { code: 'permission-denied' }))
      )
    );

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
