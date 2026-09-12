import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import CalendarPage from '../../../app/(pages)/(private)/calendar/page';
import { PreachDate, Sermon } from '@/models/models';
import { useCalendarSermons } from '@/hooks/useCalendarSermons';
import { useCalendarCouncils } from '@/hooks/useCalendarCouncils';
import { useCalendarGroups } from '@/hooks/useCalendarGroups';
import { useSeries } from '@/hooks/useSeries';
import '@testing-library/jest-dom';

// Mock all the hooks and services
jest.mock('@/hooks/useCalendarSermons', () => ({
  useCalendarSermons: jest.fn(),
}));

jest.mock('@/hooks/useCalendarGroups', () => ({
  useCalendarGroups: jest.fn(),
}));

jest.mock('@/hooks/useCalendarCouncils', () => ({
  useCalendarCouncils: jest.fn(),
}));

jest.mock('@/hooks/useSeries', () => ({
  useSeries: jest.fn(),
}));

jest.mock('@/providers/AuthProvider', () => ({
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
  return function MockPreachCalendar({ onDateSelect, kindsByDate, shown, onToggleKind }: any) {
    return (
      <div
        data-testid="preach-calendar"
        data-marked-days={Object.keys(kindsByDate || {}).sort().join(',')}
        data-kinds={Object.entries(kindsByDate || {}).map(([day, kinds]: any) => `${day}:${kinds.join('+')}`).sort().join(' ')}
        data-shown={Object.entries(shown || {}).filter(([, on]) => on).map(([kind]) => kind).sort().join(',')}
      >
        <button onClick={() => onDateSelect(new Date('2024-01-15'))}>
          Select Date
        </button>
        <button data-testid="turn-off-councils" onClick={() => onToggleKind('council')}>
          Councils
        </button>
      </div>
    );
  };
});

jest.mock('@/components/calendar/DateEventList', () => {
  return function MockDateEventList({ month, entries, series }: any) {
    return (
      <div data-testid="date-event-list" data-kinds={entries.map((entry: any) => entry.kind).sort().join(',')}>
        Month: {month.toISOString().split('T')[0]}
        Sermons: {entries.filter((entry: any) => entry.kind === 'sermon').length}
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
  return function MockAgendaView({ entries, series }: any) {
    return (
      <div data-testid="agenda-view" data-kinds={entries.map((entry: any) => entry.kind).sort().join(',')}>
        Agenda: {entries.length} entries, {series?.length || 0} series
      </div>
    );
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
const mockUseCalendarSermons = jest.mocked(useCalendarSermons);
const mockUseCalendarGroups = jest.mocked(useCalendarGroups);
const mockUseCalendarCouncils = jest.mocked(useCalendarCouncils);
const mockUseSeries = jest.mocked(useSeries);

describe('CalendarPage', () => {
  const mockSermon: Sermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2024-01-01',
    thoughts: [],
    userId: 'user-1',
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
    date: '2024-01-02',
    thoughts: [],
    userId: 'user-1',
    isPreached: false,
    preachDates: []
  };

  const mockCouncilEntry = {
    kind: 'council' as const,
    id: 'council-k1',
    refId: 'k1',
    date: '2024-01-15',
    title: 'Совет — Bible Truck',
    href: '/care/council/k1',
    status: 'preparing' as const,
    progress: { done: 0, total: 3 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCalendarGroups.mockReturnValue({
      groups: [],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as any);
    mockUseCalendarCouncils.mockReturnValue({
      entries: [],
      isLoading: false,
      error: null,
    });
  });

  it('renders calendar header and components', () => {
    mockUseCalendarSermons.mockReturnValue({
      sermons: [mockSermon],
      sermonsByDate: {
        '2024-01-15': [
          { ...mockSermon, currentPreachDate: mockSermon.preachDates![0] } as Sermon & { currentPreachDate: PreachDate }
        ]
      },
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
    });

    render(<CalendarPage />);

    expect(screen.getByTestId('calendar-header')).toBeInTheDocument();
    expect(screen.getByTestId('preach-calendar')).toBeInTheDocument();
    expect(screen.getByTestId('date-event-list')).toBeInTheDocument();
  });

  it('normalizes sermon status date keys to date-only format', () => {
    const sermonWithTimestampDate: Sermon = {
      ...mockSermon,
      preachDates: [
        {
          ...mockSermon.preachDates![0],
          date: '2024-01-15T00:00:00.000Z',
          status: 'planned'
        }
      ]
    };

    mockUseCalendarSermons.mockReturnValue({
      sermons: [sermonWithTimestampDate],
      sermonsByDate: {
        '2024-01-15': [
          { ...sermonWithTimestampDate, currentPreachDate: sermonWithTimestampDate.preachDates![0] } as Sermon & { currentPreachDate: PreachDate }
        ]
      },
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
    });

    render(<CalendarPage />);

    // Dates arrive in several shapes; the calendar marks one day, keyed date-only.


    expect(screen.getByTestId('preach-calendar')).toHaveAttribute('data-marked-days', '2024-01-15');
  });

  it('displays Quick Summary with total preachings count', () => {
    // USE LOCAL DATE to match the component's default state (new Date())
    // This avoids the "midnight UTC" mismatch where local is Feb 28 but UTC is Mar 01
    const todayDate = new Date();
    const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;

    const sermonForCurrentMonth: Sermon = {
      ...mockSermon,
      preachDates: [
        {
          ...mockSermon.preachDates![0],
          date: today,
          status: 'preached',
        }
      ]
    };

    mockUseCalendarSermons.mockReturnValue({
      sermons: [sermonForCurrentMonth],
      sermonsByDate: {
        [today]: [
          { ...sermonForCurrentMonth, currentPreachDate: sermonForCurrentMonth.preachDates![0] } as Sermon & { currentPreachDate: PreachDate }
        ]
      },
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
    });

    render(<CalendarPage />);

    expect(screen.getByText('Quick Summary')).toBeInTheDocument();
    expect(screen.getByText('Total Preachings')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // Total preachings count
  });

  it('shows pending sermons count when there are pending sermons', () => {
    mockUseCalendarSermons.mockReturnValue({
      sermons: [mockSermon, mockSermonWithoutDates],
      sermonsByDate: {
        '2024-01-15': [
          { ...mockSermon, currentPreachDate: mockSermon.preachDates![0] } as Sermon & { currentPreachDate: PreachDate }
        ]
      },
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
      sermonsByDate: {
        '2024-01-15': [
          { ...mockSermon, currentPreachDate: mockSermon.preachDates![0] } as Sermon & { currentPreachDate: PreachDate }
        ]
      },
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
        preachDates: [{ ...mockSermon.preachDates![0], date: '2024-01-15' }] // January
      },
      {
        ...mockSermon,
        id: 'sermon-feb',
        preachDates: [{ ...mockSermon.preachDates![0], date: '2024-02-15' }] // February
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
    });

    mockUseCalendarSermons.mockReturnValue({
      sermons: sermonsInDifferentMonths,
      sermonsByDate: {
        '2024-01-15': [
          { ...sermonsInDifferentMonths[0], currentPreachDate: sermonsInDifferentMonths[0].preachDates![0] } as Sermon & { currentPreachDate: PreachDate }
        ],
        '2024-02-15': [
          { ...sermonsInDifferentMonths[1], currentPreachDate: sermonsInDifferentMonths[1].preachDates![0] } as Sermon & { currentPreachDate: PreachDate }
        ]
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
    });

    mockUseCalendarSermons.mockReturnValue({
      sermons: [mockSermon],
      sermonsByDate: {
        '2024-01-15': [
          { ...mockSermon, currentPreachDate: mockSermon.preachDates![0] } as Sermon & { currentPreachDate: PreachDate }
        ]
      },
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
    });

    mockUseCalendarSermons.mockReturnValue({
      sermons: [mockSermon],
      sermonsByDate: {
        '2024-01-15': [
          { ...mockSermon, currentPreachDate: mockSermon.preachDates![0] } as Sermon & { currentPreachDate: PreachDate }
        ]
      },
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
      sermonsByDate: {
        '2024-01-15': [
          { ...mockSermon, currentPreachDate: mockSermon.preachDates![0] } as Sermon & { currentPreachDate: PreachDate }
        ]
      },
      pendingSermons: [mockSermonWithoutDates],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(<CalendarPage />);

    expect(screen.getByTestId('legacy-data-warning')).toBeInTheDocument();
    expect(screen.getByText('Pending: 1')).toBeInTheDocument();
  });

  describe('the brothers\' council in the calendar', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    const sermonsOnly = () =>
      mockUseCalendarSermons.mockReturnValue({
        sermons: [mockSermon],
        sermonsByDate: {},
        pendingSermons: [],
        isLoading: false,
        error: null,
        refetch: jest.fn(),
      } as any);

    it('marks the day of a council and names its kind, not a group', () => {
      sermonsOnly();
      mockUseCalendarCouncils.mockReturnValue({ entries: [mockCouncilEntry], isLoading: false, error: null });

      render(<CalendarPage />);

      expect(screen.getByTestId('preach-calendar')).toHaveAttribute('data-kinds', '2024-01-15:sermon+council');
    });

    it('puts the council among the events of its day', () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-01-15T12:00:00Z'));
      sermonsOnly();
      mockUseCalendarCouncils.mockReturnValue({ entries: [mockCouncilEntry], isLoading: false, error: null });

      render(<CalendarPage />);

      expect(screen.getByTestId('date-event-list')).toHaveAttribute('data-kinds', 'council,sermon');
    });

    it('takes the councils off the calendar when the person switches them off', () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-01-15T12:00:00Z'));
      sermonsOnly();
      mockUseCalendarCouncils.mockReturnValue({ entries: [mockCouncilEntry], isLoading: false, error: null });

      render(<CalendarPage />);
      fireEvent.click(screen.getByTestId('turn-off-councils'));

      expect(screen.getByTestId('preach-calendar')).toHaveAttribute('data-shown', 'group,sermon');
      expect(screen.getByTestId('date-event-list')).toHaveAttribute('data-kinds', 'sermon');
    });

    it('waits for the councils before drawing the month', () => {
      sermonsOnly();
      mockUseCalendarCouncils.mockReturnValue({ entries: [], isLoading: true, error: null });

      render(<CalendarPage />);

      expect(screen.queryByTestId('preach-calendar')).not.toBeInTheDocument();
    });

    it('says the calendar failed only when it has nothing at all to show', () => {
      mockUseCalendarSermons.mockReturnValue({
        sermons: [],
        sermonsByDate: {},
        pendingSermons: [],
        isLoading: false,
        error: null,
        refetch: jest.fn(),
      } as any);
      mockUseCalendarCouncils.mockReturnValue({ entries: [], isLoading: false, error: new Error('nope') });

      render(<CalendarPage />);

      expect(screen.getByText('Error loading calendar')).toBeInTheDocument();
    });

    it('carries the same entries into the agenda, with the switches visible there too', () => {
      sermonsOnly();
      mockUseCalendarCouncils.mockReturnValue({ entries: [mockCouncilEntry], isLoading: false, error: null });

      render(<CalendarPage />);
      fireEvent.click(screen.getByText('Agenda'));

      expect(screen.getByTestId('agenda-view')).toHaveAttribute('data-kinds', 'council,sermon');
    });

    it('keeps the calendar standing when one source fails but others answered', () => {
      sermonsOnly();
      mockUseCalendarCouncils.mockReturnValue({ entries: [], isLoading: false, error: new Error('read failed') });

      render(<CalendarPage />);

      expect(screen.queryByText('Error loading calendar')).not.toBeInTheDocument();
      expect(screen.getByTestId('preach-calendar')).toBeInTheDocument();
    });
  });
});
