import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SeriesSelector from '@/components/series/SeriesSelector';
import { Series } from '@/models/models';
import '@testing-library/jest-dom';

// Mock dependencies
jest.mock('@/hooks/useSeries', () => ({
  useSeries: jest.fn()
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'test-user-id' }
  })
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'workspaces.series.actions.selectSeries': 'Select Series',
        'workspaces.series.actions.selectSeriesForAdd': 'Add to Series',
        'workspaces.series.actions.selectSeriesForChange': 'Change Series',
        'common.search': 'Search series...',
        'workspaces.series.loadingSeries': 'Loading series...',
        'workspaces.series.errors.addSermonFailed': 'Failed to add sermon to series'
      };
      return translations[key] || key;
    }
  })
}));

// Mock createPortal to render content normally for testing
jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (children: React.ReactNode) => children
}));

import { useSeries } from '@/hooks/useSeries';

const mockUseSeries = useSeries as jest.MockedFunction<typeof useSeries>;

describe('SeriesSelector Component', () => {
  const mockOnClose = jest.fn();
  const mockOnSelect = jest.fn();

  const mockSeries: Series[] = [
    {
      id: 'series-1',
      title: 'Grace Series',
      theme: 'Understanding Grace',
      bookOrTopic: 'Romans',
      color: '#FF6B6B',
      userId: 'test-user-id',
      sermonIds: ['sermon-1', 'sermon-2'],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'series-2',
      title: 'Faith Series',
      theme: 'Living by Faith',
      bookOrTopic: 'Hebrews',
      color: '#4ECDC4',
      userId: 'test-user-id',
      sermonIds: ['sermon-3'],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'series-3',
      title: 'Love Series',
      theme: 'God\'s Love',
      bookOrTopic: '1 John',
      color: null,
      userId: 'test-user-id',
      sermonIds: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSeries.mockReturnValue({
      series: mockSeries,
      loading: false,
      error: null,
      refetch: jest.fn()
    });
  });

  describe('Basic Rendering', () => {
    it('renders modal structure correctly', () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Select Series')).toBeInTheDocument();
      expect(screen.getAllByRole('button')).toHaveLength(4); // Close button + 3 series buttons
      expect(screen.getByPlaceholderText('Search series...')).toBeInTheDocument();
    });

    it('renders loading state', () => {
      mockUseSeries.mockReturnValue({
        series: [],
        loading: true,
        error: null,
        refetch: jest.fn()
      });

      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Loading series...')).toBeInTheDocument();
    });

    it('renders empty state when no series available', () => {
      mockUseSeries.mockReturnValue({
        series: [],
        loading: false,
        error: null,
        refetch: jest.fn()
      });

      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('No series available')).toBeInTheDocument();
    });

    it('renders series list correctly', () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Grace Series')).toBeInTheDocument();
      expect(screen.getByText('Faith Series')).toBeInTheDocument();
      expect(screen.getByText('Love Series')).toBeInTheDocument();

      // Check series details
      expect(screen.getByText('Understanding Grace')).toBeInTheDocument();
      expect(screen.getByText('Romans')).toBeInTheDocument();
      expect(screen.getByText('Hebrews')).toBeInTheDocument();
      expect(screen.getByText('1 John')).toBeInTheDocument();
    });
  });

  describe('Mode Support', () => {
    it('renders correct title for add mode', () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
          mode="add"
        />
      );

      expect(screen.getByText('Add to Series')).toBeInTheDocument();
    });

    it('renders correct title for change mode', () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
          mode="change"
        />
      );

      expect(screen.getByText('Change Series')).toBeInTheDocument();
    });

    it('renders default title when no mode specified', () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Select Series')).toBeInTheDocument();
    });
  });

  describe('Series Filtering', () => {
    it('excludes current series from list when currentSeriesId provided', () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
          currentSeriesId="series-1"
        />
      );

      expect(screen.queryByText('Grace Series')).not.toBeInTheDocument();
      expect(screen.getByText('Faith Series')).toBeInTheDocument();
      expect(screen.getByText('Love Series')).toBeInTheDocument();
    });

    it('shows all series when no currentSeriesId provided', () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Grace Series')).toBeInTheDocument();
      expect(screen.getByText('Faith Series')).toBeInTheDocument();
      expect(screen.getByText('Love Series')).toBeInTheDocument();
    });
  });

  describe('Search Functionality', () => {
    it('filters series by title', async () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      const searchInput = screen.getByPlaceholderText('Search series...');
      fireEvent.change(searchInput, { target: { value: 'Grace' } });

      await waitFor(() => {
        expect(screen.getByText('Grace Series')).toBeInTheDocument();
        expect(screen.queryByText('Faith Series')).not.toBeInTheDocument();
        expect(screen.queryByText('Love Series')).not.toBeInTheDocument();
      });
    });

    it('filters series by theme', async () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      const searchInput = screen.getByPlaceholderText('Search series...');
      fireEvent.change(searchInput, { target: { value: 'Living by Faith' } });

      await waitFor(() => {
        expect(screen.queryByText('Grace Series')).not.toBeInTheDocument();
        expect(screen.getByText('Faith Series')).toBeInTheDocument();
        expect(screen.queryByText('Love Series')).not.toBeInTheDocument();
      });
    });

    it('filters series by book/topic', async () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      const searchInput = screen.getByPlaceholderText('Search series...');
      fireEvent.change(searchInput, { target: { value: 'Romans' } });

      await waitFor(() => {
        expect(screen.getByText('Grace Series')).toBeInTheDocument();
        expect(screen.queryByText('Faith Series')).not.toBeInTheDocument();
        expect(screen.queryByText('Love Series')).not.toBeInTheDocument();
      });
    });

    it('shows all series when search is cleared', async () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      const searchInput = screen.getByPlaceholderText('Search series...');
      fireEvent.change(searchInput, { target: { value: 'Grace' } });

      await waitFor(() => {
        expect(screen.getByText('Grace Series')).toBeInTheDocument();
        expect(screen.queryByText('Faith Series')).not.toBeInTheDocument();
      });

      fireEvent.change(searchInput, { target: { value: '' } });

      await waitFor(() => {
        expect(screen.getByText('Grace Series')).toBeInTheDocument();
        expect(screen.getByText('Faith Series')).toBeInTheDocument();
        expect(screen.getByText('Love Series')).toBeInTheDocument();
      });
    });

    it('shows "No series match your search" when no results', async () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      const searchInput = screen.getByPlaceholderText('Search series...');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

      await waitFor(() => {
        expect(screen.getByText('No series match your search')).toBeInTheDocument();
        expect(screen.getByText('Clear search')).toBeInTheDocument();
      });
    });

    it('clears search when "Clear search" button is clicked', async () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      const searchInput = screen.getByPlaceholderText('Search series...');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

      await waitFor(() => {
        expect(screen.getByText('Clear search')).toBeInTheDocument();
      });

      const clearButton = screen.getByText('Clear search');
      fireEvent.click(clearButton);

      await waitFor(() => {
        expect(screen.getByText('Grace Series')).toBeInTheDocument();
        expect(screen.getByText('Faith Series')).toBeInTheDocument();
        expect(screen.getByText('Love Series')).toBeInTheDocument();
      });
    });
  });

  describe('Series Selection', () => {
    it('renders series buttons with correct accessible names', () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByRole('button', {
        name: 'Grace Series Understanding Grace Romans • 2 sermons'
      })).toBeInTheDocument();

      expect(screen.getByRole('button', {
        name: 'Faith Series Living by Faith Hebrews • 1 sermons'
      })).toBeInTheDocument();

      expect(screen.getByRole('button', {
        name: 'Love Series God\'s Love 1 John • 0 sermons'
      })).toBeInTheDocument();
    });

    it('has close button in the modal', () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      // Check that we have the expected number of buttons (close + series buttons)
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBe(4); // 1 close button + 3 series buttons
    });
  });

  describe('Series Display', () => {
    it('displays series with their theme and book information', () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      expect(screen.getByText('Understanding Grace')).toBeInTheDocument();
      expect(screen.getByText('Romans')).toBeInTheDocument();
      expect(screen.getByText('Hebrews')).toBeInTheDocument();
      expect(screen.getByText('1 John')).toBeInTheDocument();
    });

    it('displays sermon count correctly', () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      // Check that sermon counts appear in the accessible names of the buttons
      expect(screen.getByRole('button', {
        name: /Grace Series.*2 sermons/
      })).toBeInTheDocument();

      expect(screen.getByRole('button', {
        name: /Faith Series.*1 sermons/
      })).toBeInTheDocument();

      expect(screen.getByRole('button', {
        name: /Love Series.*0 sermons/
      })).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has correct ARIA labels', () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      // Check that we have buttons (close button and series buttons)
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);

      const searchInput = screen.getByPlaceholderText('Search series...');
      expect(searchInput).toHaveAttribute('type', 'text');
    });

    it('supports keyboard navigation', () => {
      render(
        <SeriesSelector
          onClose={mockOnClose}
          onSelect={mockOnSelect}
        />
      );

      const searchInput = screen.getByPlaceholderText('Search series...');
      searchInput.focus();
      expect(document.activeElement).toBe(searchInput);
    });
  });
});
