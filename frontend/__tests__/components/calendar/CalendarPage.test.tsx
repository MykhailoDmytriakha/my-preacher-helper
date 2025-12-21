import { render, screen } from '@testing-library/react';
import React from 'react';
import CalendarPage from '../../../app/(pages)/(private)/calendar/page';
import { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

// Mock all the hooks and services
jest.mock('@/hooks/useCalendarSermons', () => ({
  useCalendarSermons: jest.fn(),
}));

jest.mock('@/hooks/useSeries', () => ({
  useSeries: jest.fn(),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'test-user' },
  }),
}));

jest.mock('@/components/calendar/CalendarHeader', () => {
  return function MockCalendarHeader({ onViewChange }: any) {
    return (
      <div data-testid="calendar-header">
        <button onClick={() => onViewChange('month')}>Month</button>
        <button onClick={() => onViewChange('agenda')}>Agenda</button>
      </div>
    );
  };
});

jest.mock('@/components/calendar/PreachCalendar', () => {
  return function MockPreachCalendar({ onDateSelect }: any) {
    return (
      <div data-testid="preach-calendar">
        <button onClick={() => onDateSelect(new Date('2024-01-15'))}>
          Select Date
        </button>
      </div>
    );
  };
});

jest.mock('@/components/calendar/DateEventList', () => {
  return function MockDateEventList({ month, sermons, series }: any) {
    return (
      <div data-testid="date-event-list">
        Month: {month.toISOString().split('T')[0]}
        Sermons: {sermons.length}
        Series: {series?.length || 0}
      </div>
    );
  };
});

jest.mock('@/components/calendar/LegacyDataWarning', () => {
  return function MockLegacyDataWarning({ pendingSermons }: any) {
    return (
      <div data-testid="legacy-data-warning">
        Pending: {pendingSermons.length}
      </div>
    );
  };
});

jest.mock('@/components/calendar/AgendaView', () => {
  return function MockAgendaView({ sermons, series }: any) {
    return <div data-testid="agenda-view">Agenda: {sermons.length} sermons, {series?.length || 0} series</div>;
  };
});

jest.mock('@/components/calendar/AnalyticsSection', () => {
  return function MockAnalyticsSection({ sermonsByDate }: any) {
    return (
      <div data-testid="analytics-section">
        Analytics: {Object.keys(sermonsByDate).length} dates
      </div>
    );
  };
});

jest.mock('@/components/calendar/PreachDateModal', () => {
  return function MockPreachDateModal({ isOpen, onClose, onSave }: any) {
    return isOpen ? (
      <div data-testid="preach-date-modal">
        <button onClick={onClose}>Close</button>
        <button onClick={() => onSave({
          date: '2024-01-15',
          church: { id: 'c1', name: 'Test Church', city: 'City' },
          audience: '100 people'
        })}>
          Save
        </button>
      </div>
    ) : null;
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const translations: { [key: string]: string } = {
        'calendar.analytics.quickSummary': 'Quick Summary',
        'calendar.analytics.totalPreachings': 'Total Preachings',
        'calendar.analytics.pendingDateEntry': 'Pending Date Entry',
        'sermon.outline.thoughts': options?.count === 1 ? 'thought' : 'thoughts',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock the useCalendarSermons hook
const mockUseCalendarSermons = require('@/hooks/useCalendarSermons').useCalendarSermons;
const mockUseSeries = require('@/hooks/useSeries').useSeries;

describe('CalendarPage', () => {
  const mockSermon: Sermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    isPreached: true,
    preachDates: [
      {
        id: 'pd-1',
        date: '2024-01-15',
        church: { id: 'c1', name: 'Test Church', city: 'Test City' },
        audience: '100 people',
        notes: 'Great sermon',
        outcome: 'excellent',
        createdAt: '2024-01-01T00:00:00Z'
      }
    ]
  };

  const mockSermonWithoutDates: Sermon = {
    id: 'sermon-2',
    title: 'Pending Sermon',
    verse: 'Romans 8:28',
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    isPreached: false,
    preachDates: []
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders calendar header and components', () => {
    mockUseCalendarSermons.mockReturnValue({
      sermons: [mockSermon],
      sermonsByDate: { '2024-01-15': [mockSermon] },
      pendingSermons: [],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    mockUseSeries.mockReturnValue({
      series: [],
      loading: false,
      error: null,
      refreshSeries: jest.fn(),
      createNewSeries: jest.fn(),
      updateExistingSeries: jest.fn(),
      deleteExistingSeries: jest.fn(),
      addSermon: jest.fn(),
      removeSermon: jest.fn(),
      reorderSeriesSermons: jest.fn(),
    });

    render(<CalendarPage />);

    expect(screen.getByTestId('calendar-header')).toBeInTheDocument();
    expect(screen.getByTestId('preach-calendar')).toBeInTheDocument();
    expect(screen.getByTestId('date-event-list')).toBeInTheDocument();
  });

  it('displays Quick Summary with total preachings count', () => {
    mockUseCalendarSermons.mockReturnValue({
      sermons: [mockSermon],
      sermonsByDate: { '2024-01-15': [mockSermon] },
      pendingSermons: [],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    mockUseSeries.mockReturnValue({
      series: [],
      loading: false,
      error: null,
      refreshSeries: jest.fn(),
      createNewSeries: jest.fn(),
      updateExistingSeries: jest.fn(),
      deleteExistingSeries: jest.fn(),
      addSermon: jest.fn(),
      removeSermon: jest.fn(),
      reorderSeriesSermons: jest.fn(),
    });

    render(<CalendarPage />);

    expect(screen.getByText('Quick Summary')).toBeInTheDocument();
    expect(screen.getByText('Total Preachings')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // Total preachings count
  });

  it('shows pending sermons count when there are pending sermons', () => {
    mockUseCalendarSermons.mockReturnValue({
      sermons: [mockSermon, mockSermonWithoutDates],
      sermonsByDate: { '2024-01-15': [mockSermon] },
      pendingSermons: [mockSermonWithoutDates],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    mockUseSeries.mockReturnValue({
      series: [],
      loading: false,
      error: null,
      refreshSeries: jest.fn(),
      createNewSeries: jest.fn(),
      updateExistingSeries: jest.fn(),
      deleteExistingSeries: jest.fn(),
      addSermon: jest.fn(),
      removeSermon: jest.fn(),
      reorderSeriesSermons: jest.fn(),
    });

    render(<CalendarPage />);

    expect(screen.getByText('Pending Date Entry')).toBeInTheDocument();
    // Find the span with pending count by looking for the element after "Pending Date Entry"
    const pendingEntry = screen.getByText('Pending Date Entry');
    const pendingCount = pendingEntry.nextElementSibling;
    expect(pendingCount).toHaveTextContent('1');
  });

  it('hides pending sermons section when count is 0', () => {
    mockUseCalendarSermons.mockReturnValue({
      sermons: [mockSermon],
      sermonsByDate: { '2024-01-15': [mockSermon] },
      pendingSermons: [], // Empty array
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    mockUseSeries.mockReturnValue({
      series: [],
      loading: false,
      error: null,
      refreshSeries: jest.fn(),
      createNewSeries: jest.fn(),
      updateExistingSeries: jest.fn(),
      deleteExistingSeries: jest.fn(),
      addSermon: jest.fn(),
      removeSermon: jest.fn(),
      reorderSeriesSermons: jest.fn(),
    });

    render(<CalendarPage />);

    expect(screen.queryByText('Pending Date Entry')).not.toBeInTheDocument();
  });

  it('filters sermons for the selected month correctly', () => {
    // Mock current date to be in January 2024
    const mockCurrentDate = new Date('2024-01-15');

    const sermonsInDifferentMonths = [
      {
        ...mockSermon,
        preachDates: [{ ...mockSermon.preachDates[0], date: '2024-01-15' }] // January
      },
      {
        ...mockSermon,
        id: 'sermon-feb',
        preachDates: [{ ...mockSermon.preachDates[0], date: '2024-02-15' }] // February
      }
    ];

    mockUseSeries.mockReturnValue({
      series: [],
      loading: false,
      error: null,
      refreshSeries: jest.fn(),
      createNewSeries: jest.fn(),
      updateExistingSeries: jest.fn(),
      deleteExistingSeries: jest.fn(),
      addSermon: jest.fn(),
      removeSermon: jest.fn(),
      reorderSeriesSermons: jest.fn(),
    });

    mockUseCalendarSermons.mockReturnValue({
      sermons: sermonsInDifferentMonths,
      sermonsByDate: {
        '2024-01-15': [sermonsInDifferentMonths[0]],
        '2024-02-15': [sermonsInDifferentMonths[1]]
      },
      pendingSermons: [],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    // Mock Date constructor to return January 2024
    const originalDate = global.Date;
    global.Date = jest.fn(() => mockCurrentDate) as any;
    global.Date.now = originalDate.now;

    render(<CalendarPage />);

    const dateEventList = screen.getByTestId('date-event-list');
    expect(dateEventList).toHaveTextContent('Sermons: 1'); // Only 1 sermon in January

    // Restore original Date
    global.Date = originalDate;
  });

  it('passes correct month to DateEventList', () => {
    // Mock current date to be in January 2024
    const mockCurrentDate = new Date('2024-01-15');

    mockUseSeries.mockReturnValue({
      series: [],
      loading: false,
      error: null,
      refreshSeries: jest.fn(),
      createNewSeries: jest.fn(),
      updateExistingSeries: jest.fn(),
      deleteExistingSeries: jest.fn(),
      addSermon: jest.fn(),
      removeSermon: jest.fn(),
      reorderSeriesSermons: jest.fn(),
    });

    mockUseCalendarSermons.mockReturnValue({
      sermons: [mockSermon],
      sermonsByDate: { '2024-01-15': [mockSermon] },
      pendingSermons: [],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    // Mock Date constructor
    const originalDate = global.Date;
    global.Date = jest.fn(() => mockCurrentDate) as any;
    global.Date.now = originalDate.now;

    render(<CalendarPage />);

    const dateEventList = screen.getByTestId('date-event-list');
    expect(dateEventList).toHaveTextContent('Month: 2024-01-15');

    // Restore original Date
    global.Date = originalDate;
  });

  it('shows loading skeleton when loading', () => {
    mockUseSeries.mockReturnValue({
      series: [],
      loading: false,
      error: null,
      refreshSeries: jest.fn(),
      createNewSeries: jest.fn(),
      updateExistingSeries: jest.fn(),
      deleteExistingSeries: jest.fn(),
      addSermon: jest.fn(),
      removeSermon: jest.fn(),
      reorderSeriesSermons: jest.fn(),
    });

    mockUseCalendarSermons.mockReturnValue({
      sermons: [],
      sermonsByDate: {},
      pendingSermons: [],
      isLoading: true,
      error: null,
      refetch: jest.fn(),
    });

    render(<CalendarPage />);

    // Should not show main content when loading
    expect(screen.queryByText('Quick Summary')).not.toBeInTheDocument();
  });

  it('shows error message when there is an error', () => {
    mockUseSeries.mockReturnValue({
      series: [],
      loading: false,
      error: null,
      refreshSeries: jest.fn(),
      createNewSeries: jest.fn(),
      updateExistingSeries: jest.fn(),
      deleteExistingSeries: jest.fn(),
      addSermon: jest.fn(),
      removeSermon: jest.fn(),
      reorderSeriesSermons: jest.fn(),
    });

    mockUseCalendarSermons.mockReturnValue({
      sermons: [],
      sermonsByDate: {},
      pendingSermons: [],
      isLoading: false,
      error: new Error('Test error'),
      refetch: jest.fn(),
    });

    render(<CalendarPage />);

    expect(screen.getByText('Error loading calendar')).toBeInTheDocument();
    expect(screen.getByText('Please try again later.')).toBeInTheDocument();
  });

  it('renders agenda view infrastructure', () => {
    // This test verifies that the view switching infrastructure exists
    // In a real scenario, we would test the actual view change with proper state mocking
    mockUseSeries.mockReturnValue({
      series: [],
      loading: false,
      error: null,
      refreshSeries: jest.fn(),
      createNewSeries: jest.fn(),
      updateExistingSeries: jest.fn(),
      deleteExistingSeries: jest.fn(),
      addSermon: jest.fn(),
      removeSermon: jest.fn(),
      reorderSeriesSermons: jest.fn(),
    });

    mockUseCalendarSermons.mockReturnValue({
      sermons: [mockSermon],
      sermonsByDate: { '2024-01-15': [mockSermon] },
      pendingSermons: [],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(<CalendarPage />);

    // Verify that agenda button exists (infrastructure for view switching)
    expect(screen.getByText('Agenda')).toBeInTheDocument();
  });

  it('shows legacy data warning when there are pending sermons', () => {
    mockUseCalendarSermons.mockReturnValue({
      sermons: [mockSermon, mockSermonWithoutDates],
      sermonsByDate: { '2024-01-15': [mockSermon] },
      pendingSermons: [mockSermonWithoutDates],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(<CalendarPage />);

    expect(screen.getByTestId('legacy-data-warning')).toBeInTheDocument();
    expect(screen.getByText('Pending: 1')).toBeInTheDocument();
  });
});
