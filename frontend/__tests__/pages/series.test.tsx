import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

import SeriesPage from '@/(pages)/(private)/series/page';
import '@testing-library/jest-dom';

// Mock next/link
jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href} data-testid="series-link">
            {children}
        </a>
    );
});

// Mock child components for structural testing
jest.mock('@/components/series/SeriesCard', () => {
    return ({ series }: { series: any }) => (
        <div data-testid={`series-card-${series.id}`}>{series.title}</div>
    );
});

// Stub exposes the props the page passes, so tests can assert the arguments.
jest.mock('@/components/series/EngineCreateSeriesModal', () => ({
    EngineCreateSeriesModal: ({ seriesId, recoveryId, onClose, onQueued }: { seriesId: string; recoveryId?: string; onClose: () => void; onQueued: (id: string) => void }) => (
        <div data-testid="engine-create-series-modal" data-series-id={seriesId} data-recovery-id={recoveryId ?? ''}>
            <button data-testid="close-modal" onClick={onClose}>Close</button>
            <button data-testid="queue-create" onClick={() => onQueued(seriesId)}>Queue</button>
        </div>
    ),
}));

jest.mock('@/components/skeletons/SeriesCardSkeleton', () => ({
    SeriesGridSkeleton: () => <div data-testid="series-grid-skeleton">Loading...</div>,
}));

// Mock hooks
const mockUseSeriesDataCollection = jest.fn();
const mockPush = jest.fn();

jest.mock('@/hooks/useSeriesDataCollection', () => ({
    useSeriesDataCollection: () => mockUseSeriesDataCollection(),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

jest.mock('@/utils/clientId', () => ({
    newClientId: jest.fn(() => 'fresh-series-id'),
}));

// The page reads the engine through these; there is no DataEngineProvider in this test.
jest.mock('@/data-engine/react.client', () => ({
    useDataEngine: jest.fn(() => ({ browser: null, owner: 'test-user-id' })),
    useRecoveryDiscovery: jest.fn(() => ({ choices: [], loading: false, error: null, recover: jest.fn() })),
}));

jest.mock('@/data-engine/DataCollectionStatus', () => ({
    DataCollectionStatus: ({ state }: { state: unknown }) => <div data-testid="collection-status">{state ? 'has-state' : 'no-state'}</div>,
}));

jest.mock('@/data-engine/DataSyncStatus', () => ({
    DataSyncStatus: ({ subject }: { subject: unknown }) => <div data-testid="sync-status">{String(subject)}</div>,
}));

// Mock Auth Provider
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({
        user: { uid: 'test-user-id', email: 'test@example.com' },
    }),
}));

// Mock i18n
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const translations: { [key: string]: string } = {
                'navigation.series': 'Series',
                'workspaces.series.title': 'Sermon Series',
                'workspaces.series.description': 'Organize your sermons into meaningful series',
                'workspaces.series.newSeries': 'New Series',
                'workspaces.series.noSeries': 'No series yet',
                'workspaces.series.createFirstSeries': 'Create your first series to get started',
                'workspaces.series.form.statuses.active': 'Active',
                'workspaces.series.form.statuses.draft': 'Draft',
                'workspaces.series.form.statuses.completed': 'Completed',
                'common.refresh': 'Refresh',
                'common.search': 'Search by title, book, theme...',
            };
            return translations[key] || key;
        },
    }),
}));

// Mock series data
const mockSeries = [
    {
        id: 'series-1',
        userId: 'test-user-id',
        title: 'First Series',
        theme: 'Faith',
        description: 'A series about faith',
        bookOrTopic: 'Romans',
        sermonIds: ['sermon-1', 'sermon-2'],
        status: 'active' as const,
        color: '#3B82F6',
        startDate: '2024-01-01',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-15T00:00:00Z',
    },
    {
        id: 'series-2',
        userId: 'test-user-id',
        title: 'Second Series',
        theme: 'Hope',
        description: 'A series about hope',
        bookOrTopic: 'Corinthians',
        sermonIds: ['sermon-3'],
        status: 'draft' as const,
        color: '#10B981',
        startDate: '2024-02-01',
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-02-10T00:00:00Z',
    },
    {
        id: 'series-3',
        userId: 'test-user-id',
        title: 'Third Series',
        theme: 'Love',
        description: 'A series about love',
        bookOrTopic: 'John',
        sermonIds: [],
        status: 'completed' as const,
        color: '#8B5CF6',
        startDate: '2023-12-01',
        createdAt: '2023-12-01T00:00:00Z',
        updatedAt: '2023-12-20T00:00:00Z',
    },
];

const withCollection = (patch: Record<string, unknown> = {}) =>
    mockUseSeriesDataCollection.mockReturnValue({
        series: [],
        loading: false,
        error: null,
        refreshSeries: jest.fn(),
        state: null,
        complete: true,
        freshness: 'fresh',
        ...patch,
    });

describe('Series Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        withCollection({ series: mockSeries });
    });

    afterEach(() => {
        cleanup();
    });

    describe('Basic Rendering', () => {
        it('renders page header correctly', () => {
            render(<SeriesPage />);

            expect(screen.getByRole('heading', { name: /Sermon Series/i })).toBeInTheDocument();
            expect(screen.getByText(/Organize your sermons into meaningful series/i)).toBeInTheDocument();
        });

        it('renders series grid with all series', () => {
            render(<SeriesPage />);

            expect(screen.getByTestId('series-grid')).toBeInTheDocument();
            expect(screen.getByTestId('series-card-series-1')).toBeInTheDocument();
            expect(screen.getByTestId('series-card-series-2')).toBeInTheDocument();
            expect(screen.getByTestId('series-card-series-3')).toBeInTheDocument();
        });

        it('renders stats cards with correct counts', () => {
            render(<SeriesPage />);

            // Total series: 3
            expect(screen.getByText('3')).toBeInTheDocument();
            // Active: 1, Completed: 1, Drafts: 1
            expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(3);
        });
    });

    describe('Series Card Navigation', () => {
        it('wraps each series card in a link to the detail page', () => {
            render(<SeriesPage />);

            const links = screen.getAllByTestId('series-link');
            expect(links.length).toBe(3);

            // Check that all expected links exist (order may vary due to sorting)
            const hrefs = links.map(link => link.getAttribute('href'));
            expect(hrefs).toContain('/series/series-1');
            expect(hrefs).toContain('/series/series-2');
            expect(hrefs).toContain('/series/series-3');
        });

        it('series cards are clickable through the link wrapper', () => {
            render(<SeriesPage />);

            // Each series card should be contained within a link
            const seriesCard1 = screen.getByTestId('series-card-series-1');
            const seriesCard2 = screen.getByTestId('series-card-series-2');
            const seriesCard3 = screen.getByTestId('series-card-series-3');

            // Verify each card has a link parent
            expect(seriesCard1.closest('[data-testid="series-link"]')).toHaveAttribute('href', '/series/series-1');
            expect(seriesCard2.closest('[data-testid="series-link"]')).toHaveAttribute('href', '/series/series-2');
            expect(seriesCard3.closest('[data-testid="series-link"]')).toHaveAttribute('href', '/series/series-3');
        });
    });

    describe('Search Functionality', () => {
        it('filters series by title', () => {
            render(<SeriesPage />);

            const searchInput = screen.getByPlaceholderText('Search by title, book, theme...');
            fireEvent.change(searchInput, { target: { value: 'First' } });

            expect(screen.getByTestId('series-card-series-1')).toBeInTheDocument();
            expect(screen.queryByTestId('series-card-series-2')).not.toBeInTheDocument();
            expect(screen.queryByTestId('series-card-series-3')).not.toBeInTheDocument();
        });

        it('filters series by book/topic', () => {
            render(<SeriesPage />);

            const searchInput = screen.getByPlaceholderText('Search by title, book, theme...');
            fireEvent.change(searchInput, { target: { value: 'John' } });

            expect(screen.queryByTestId('series-card-series-1')).not.toBeInTheDocument();
            expect(screen.queryByTestId('series-card-series-2')).not.toBeInTheDocument();
            expect(screen.getByTestId('series-card-series-3')).toBeInTheDocument();
        });

        it('filters series by theme', () => {
            render(<SeriesPage />);

            const searchInput = screen.getByPlaceholderText('Search by title, book, theme...');
            fireEvent.change(searchInput, { target: { value: 'Hope' } });

            expect(screen.queryByTestId('series-card-series-1')).not.toBeInTheDocument();
            expect(screen.getByTestId('series-card-series-2')).toBeInTheDocument();
            expect(screen.queryByTestId('series-card-series-3')).not.toBeInTheDocument();
        });

        it('clears search when clicking clear button', () => {
            render(<SeriesPage />);

            const searchInput = screen.getByPlaceholderText('Search by title, book, theme...');
            fireEvent.change(searchInput, { target: { value: 'First' } });

            expect(screen.queryByTestId('series-card-series-2')).not.toBeInTheDocument();

            // Click clear button
            const clearButton = screen.getByText('×');
            fireEvent.click(clearButton);

            // All series should be visible again
            expect(screen.getByTestId('series-card-series-1')).toBeInTheDocument();
            expect(screen.getByTestId('series-card-series-2')).toBeInTheDocument();
            expect(screen.getByTestId('series-card-series-3')).toBeInTheDocument();
        });

        it('clears search when Escape is pressed', () => {
            render(<SeriesPage />);

            const searchInput = screen.getByPlaceholderText('Search by title, book, theme...');
            fireEvent.change(searchInput, { target: { value: 'First' } });

            expect(screen.queryByTestId('series-card-series-2')).not.toBeInTheDocument();

            fireEvent.keyDown(searchInput, { key: 'Escape' });

            expect(searchInput).toHaveValue('');
            expect(screen.getByTestId('series-card-series-1')).toBeInTheDocument();
            expect(screen.getByTestId('series-card-series-2')).toBeInTheDocument();
            expect(screen.getByTestId('series-card-series-3')).toBeInTheDocument();
        });
    });

    describe('Status Filter', () => {
        it('filters by active status', () => {
            render(<SeriesPage />);

            const statusSelect = screen.getAllByRole('combobox')[0];
            fireEvent.change(statusSelect, { target: { value: 'active' } });

            expect(screen.getByTestId('series-card-series-1')).toBeInTheDocument();
            expect(screen.queryByTestId('series-card-series-2')).not.toBeInTheDocument();
            expect(screen.queryByTestId('series-card-series-3')).not.toBeInTheDocument();
        });

        it('filters by draft status', () => {
            render(<SeriesPage />);

            const statusSelect = screen.getAllByRole('combobox')[0];
            fireEvent.change(statusSelect, { target: { value: 'draft' } });

            expect(screen.queryByTestId('series-card-series-1')).not.toBeInTheDocument();
            expect(screen.getByTestId('series-card-series-2')).toBeInTheDocument();
            expect(screen.queryByTestId('series-card-series-3')).not.toBeInTheDocument();
        });

        it('filters by completed status', () => {
            render(<SeriesPage />);

            const statusSelect = screen.getAllByRole('combobox')[0];
            fireEvent.change(statusSelect, { target: { value: 'completed' } });

            expect(screen.queryByTestId('series-card-series-1')).not.toBeInTheDocument();
            expect(screen.queryByTestId('series-card-series-2')).not.toBeInTheDocument();
            expect(screen.getByTestId('series-card-series-3')).toBeInTheDocument();
        });
    });

    describe('Loading State', () => {
        it('shows skeleton when loading', () => {
            withCollection({
                series: [],
                loading: true,
                error: null,
                    refreshSeries: jest.fn(),
            });

            render(<SeriesPage />);

            expect(screen.getByTestId('series-grid-skeleton')).toBeInTheDocument();
        });
    });

    describe('Empty State', () => {
        it('shows empty message when no series exist', () => {
            withCollection({
                series: [],
                loading: false,
                error: null,
                    refreshSeries: jest.fn(),
            });

            render(<SeriesPage />);

            expect(screen.getByText('No series yet')).toBeInTheDocument();
            expect(screen.getByText('Create your first series to get started')).toBeInTheDocument();
        });
    });

    describe('Error State', () => {
        it('shows error message when loading fails', () => {
            withCollection({
                series: [],
                loading: false,
                error: new Error('Failed to load'),
                    refreshSeries: jest.fn(),
            });

            render(<SeriesPage />);

            expect(screen.getByRole('alert')).toHaveTextContent('dataSync.readFailed');
        });
    });

    describe('Create Series Modal', () => {
        it('opens the engine create modal with a fresh id when clicking New Series', () => {
            render(<SeriesPage />);

            expect(screen.queryByTestId('engine-create-series-modal')).not.toBeInTheDocument();
            fireEvent.click(screen.getByText('New Series'));

            const modal = screen.getByTestId('engine-create-series-modal');
            expect(modal).toHaveAttribute('data-series-id', 'fresh-series-id');
            expect(modal).toHaveAttribute('data-recovery-id', '');
        });

        it('keeps creation reachable from the empty state', () => {
            withCollection({ series: [] });
            render(<SeriesPage />);

            fireEvent.click(screen.getAllByText('New Series')[1]);

            expect(screen.getByTestId('engine-create-series-modal')).toHaveAttribute('data-series-id', 'fresh-series-id');
        });

        it('closes modal when close button is clicked', () => {
            render(<SeriesPage />);

            fireEvent.click(screen.getByText('New Series'));
            expect(screen.getByTestId('engine-create-series-modal')).toBeInTheDocument();

            fireEvent.click(screen.getByTestId('close-modal'));
            expect(screen.queryByTestId('engine-create-series-modal')).not.toBeInTheDocument();
            expect(mockPush).not.toHaveBeenCalled();
        });

        it('navigates to the new series and closes the modal once the create is queued', () => {
            render(<SeriesPage />);

            fireEvent.click(screen.getByText('New Series'));
            fireEvent.click(screen.getByTestId('queue-create'));

            expect(mockPush).toHaveBeenCalledTimes(1);
            expect(mockPush).toHaveBeenCalledWith('/series/fresh-series-id');
            expect(screen.queryByTestId('engine-create-series-modal')).not.toBeInTheDocument();
        });
    });

    describe('Refresh Functionality', () => {
        it('calls refreshSeries when clicking refresh button', () => {
            const mockRefreshSeries = jest.fn();
            withCollection({
                series: mockSeries,
                loading: false,
                error: null,
                    refreshSeries: mockRefreshSeries,
            });

            render(<SeriesPage />);

            const refreshButton = screen.getByText('Refresh');
            fireEvent.click(refreshButton);

            expect(mockRefreshSeries).toHaveBeenCalled();
        });
    });
});
