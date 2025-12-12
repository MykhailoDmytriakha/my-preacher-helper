import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
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

jest.mock('@/components/series/CreateSeriesModal', () => {
    return ({ onClose, onCreate }: { onClose: () => void; onCreate: (data: any) => void }) => (
        <div data-testid="create-series-modal">
            <button data-testid="close-modal" onClick={onClose}>Close</button>
            <button data-testid="create-series-btn" onClick={() => onCreate({ title: 'New Series' })}>Create</button>
        </div>
    );
});

jest.mock('@/components/skeletons/SeriesCardSkeleton', () => ({
    SeriesGridSkeleton: () => <div data-testid="series-grid-skeleton">Loading...</div>,
}));

// Mock hooks
const mockUseSeries = jest.fn();

jest.mock('@/hooks/useSeries', () => ({
    useSeries: () => mockUseSeries(),
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

describe('Series Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUseSeries.mockReturnValue({
            series: mockSeries,
            loading: false,
            error: null,
            createNewSeries: jest.fn(),
            refreshSeries: jest.fn(),
        });
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
            mockUseSeries.mockReturnValue({
                series: [],
                loading: true,
                error: null,
                createNewSeries: jest.fn(),
                refreshSeries: jest.fn(),
            });

            render(<SeriesPage />);

            expect(screen.getByTestId('series-grid-skeleton')).toBeInTheDocument();
        });
    });

    describe('Empty State', () => {
        it('shows empty message when no series exist', () => {
            mockUseSeries.mockReturnValue({
                series: [],
                loading: false,
                error: null,
                createNewSeries: jest.fn(),
                refreshSeries: jest.fn(),
            });

            render(<SeriesPage />);

            expect(screen.getByText('No series yet')).toBeInTheDocument();
            expect(screen.getByText('Create your first series to get started')).toBeInTheDocument();
        });
    });

    describe('Error State', () => {
        it('shows error message when loading fails', () => {
            mockUseSeries.mockReturnValue({
                series: [],
                loading: false,
                error: new Error('Failed to load'),
                createNewSeries: jest.fn(),
                refreshSeries: jest.fn(),
            });

            render(<SeriesPage />);

            expect(screen.getByText('Failed to load series. Please try again.')).toBeInTheDocument();
        });
    });

    describe('Create Series Modal', () => {
        it('opens create modal when clicking New Series button', () => {
            render(<SeriesPage />);

            const newSeriesButton = screen.getByText('New Series');
            fireEvent.click(newSeriesButton);

            expect(screen.getByTestId('create-series-modal')).toBeInTheDocument();
        });

        it('closes modal when close button is clicked', () => {
            render(<SeriesPage />);

            // Open modal
            fireEvent.click(screen.getByText('New Series'));
            expect(screen.getByTestId('create-series-modal')).toBeInTheDocument();

            // Close modal
            fireEvent.click(screen.getByTestId('close-modal'));
            expect(screen.queryByTestId('create-series-modal')).not.toBeInTheDocument();
        });

        it('calls createNewSeries when creating a series', async () => {
            const mockCreateNewSeries = jest.fn().mockResolvedValue({});
            mockUseSeries.mockReturnValue({
                series: mockSeries,
                loading: false,
                error: null,
                createNewSeries: mockCreateNewSeries,
                refreshSeries: jest.fn(),
            });

            render(<SeriesPage />);

            // Open modal
            fireEvent.click(screen.getByText('New Series'));

            // Create series
            fireEvent.click(screen.getByTestId('create-series-btn'));

            await waitFor(() => {
                expect(mockCreateNewSeries).toHaveBeenCalledWith({ title: 'New Series' });
            });
        });
    });

    describe('Refresh Functionality', () => {
        it('calls refreshSeries when clicking refresh button', () => {
            const mockRefreshSeries = jest.fn();
            mockUseSeries.mockReturnValue({
                series: mockSeries,
                loading: false,
                error: null,
                createNewSeries: jest.fn(),
                refreshSeries: mockRefreshSeries,
            });

            render(<SeriesPage />);

            const refreshButton = screen.getByText('Refresh');
            fireEvent.click(refreshButton);

            expect(mockRefreshSeries).toHaveBeenCalled();
        });
    });
});
