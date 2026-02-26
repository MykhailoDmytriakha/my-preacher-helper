import { render, screen } from '@testing-library/react';
import React from 'react';
import PreachCalendar from '@/components/calendar/PreachCalendar';
import '@testing-library/jest-dom';
import { Sermon } from '@/models/models';

const mockDayPicker = jest.fn();

jest.mock('react-day-picker', () => ({
  DayPicker: (props: any) => {
    mockDayPicker(props);
    return <div data-testid="day-picker" />;
  },
}));

jest.mock('react-day-picker/dist/style.css', () => ({}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

describe('PreachCalendar', () => {
  const sermonsByDate: Record<string, Sermon[]> = {
    '2024-01-15': [
      {
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
      }
    ]
  };

  beforeEach(() => {
    mockDayPicker.mockClear();
  });

  it('uses selectedDate as month when currentMonth is not provided', () => {
    const selectedDate = new Date(2024, 0, 15);

    render(
      <PreachCalendar
        eventsByDate={sermonsByDate}
        selectedDate={selectedDate}
        onDateSelect={jest.fn()}
      />
    );

    const props = mockDayPicker.mock.calls[0][0];
    expect(props.month).toEqual(selectedDate);
  });

  it('uses currentMonth when provided', () => {
    const selectedDate = new Date(2024, 0, 15);
    const currentMonth = new Date(2024, 1, 1);

    render(
      <PreachCalendar
        eventsByDate={sermonsByDate}
        selectedDate={selectedDate}
        onDateSelect={jest.fn()}
        currentMonth={currentMonth}
      />
    );

    const props = mockDayPicker.mock.calls[0][0];
    expect(props.month).toEqual(currentMonth);
  });

  it('forwards onMonthChange and onDateSelect handlers', () => {
    const selectedDate = new Date(2024, 0, 15);
    const onDateSelect = jest.fn();
    const onMonthChange = jest.fn();

    render(
      <PreachCalendar
        eventsByDate={sermonsByDate}
        selectedDate={selectedDate}
        onDateSelect={onDateSelect}
        onMonthChange={onMonthChange}
      />
    );

    const props = mockDayPicker.mock.calls[0][0];
    const nextDate = new Date(2024, 2, 5);
    const nextMonth = new Date(2024, 2, 1);

    props.onSelect(nextDate);
    props.onMonthChange(nextMonth);

    expect(onDateSelect).toHaveBeenCalledWith(nextDate);
    expect(onMonthChange).toHaveBeenCalledWith(nextMonth);
  });

  it('marks sermon dates with hasSermon modifier', () => {
    const selectedDate = new Date(2024, 0, 15);
    // Must include currentPreachDate so hasSermonsDate returns true
    const eventsWithCurrentPreachDate: Record<string, unknown[]> = {
      '2024-01-15': [
        {
          id: 'sermon-1',
          title: 'Test Sermon',
          verse: 'John 3:16',
          date: '2024-01-01',
          thoughts: [],
          userId: 'user-1',
          isPreached: true,
          currentPreachDate: {
            id: 'pd-1',
            date: '2024-01-15',
            church: { id: 'c1', name: 'Test Church', city: 'Test City' },
            audience: '100 people',
            outcome: 'excellent',
            createdAt: '2024-01-01T00:00:00Z',
          },
        },
      ],
    };

    render(
      <PreachCalendar
        eventsByDate={eventsWithCurrentPreachDate}
        selectedDate={selectedDate}
        onDateSelect={jest.fn()}
      />
    );

    const props = mockDayPicker.mock.calls[0][0];
    // event has currentPreachDate on Jan 15 → hasSermon returns true
    expect(props.modifiers.hasSermon(new Date(2024, 0, 15))).toBe(true);
    expect(props.modifiers.hasSermon(new Date(2024, 0, 16))).toBeFalsy();
  });

  it('uses event-derived sermon status and marks hasSermon correctly', () => {
    const selectedDate = new Date(2026, 1, 10);
    const eventsWithCurrentPreachDate = {
      '2026-02-15': [
        {
          id: 'sermon-1',
          title: 'Planned Sermon',
          verse: 'John 3:16',
          date: '2026-01-30',
          thoughts: [],
          userId: 'user-1',
          isPreached: false,
          currentPreachDate: {
            id: 'pd-1',
            date: '2026-02-15',
            status: 'planned',
            church: { id: 'c1', name: 'Church', city: 'City' },
            createdAt: '2026-01-30T00:00:00Z'
          }
        }
      ]
    } as Record<string, unknown[]>;

    render(
      <PreachCalendar
        eventsByDate={eventsWithCurrentPreachDate}
        sermonStatusByDate={{
          '2026-02-26': { planned: 1, preached: 0 }
        }}
        selectedDate={selectedDate}
        onDateSelect={jest.fn()}
      />
    );

    const props = mockDayPicker.mock.calls[0][0];
    // The event has currentPreachDate, so Feb 15 is a sermon date
    expect(props.modifiers.hasSermon(new Date(2026, 1, 15))).toBe(true);
    // Feb 26 is not in eventsByDate, so it should not be a sermon
    expect(props.modifiers.hasSermon(new Date(2026, 1, 26))).toBe(false);
  });

  it('renders status markers on day button instead of table cell pseudo-elements', () => {
    const selectedDate = new Date(2026, 1, 10);
    const { container } = render(
      <PreachCalendar
        eventsByDate={sermonsByDate}
        selectedDate={selectedDate}
        onDateSelect={jest.fn()}
      />
    );

    const styleTag = container.querySelector('style');
    expect(styleTag?.textContent).toContain('.has-sermon .rdp-day_button::before');
    expect(styleTag?.textContent).toContain('.has-group .rdp-day_button::after');
  });

  it('renders legend Sermons and Groups toggle buttons', () => {
    const selectedDate = new Date(2024, 0, 15);

    render(
      <PreachCalendar
        eventsByDate={sermonsByDate}
        selectedDate={selectedDate}
        onDateSelect={jest.fn()}
      />
    );

    expect(screen.getByText('Sermons')).toBeInTheDocument();
    expect(screen.getByText('Groups')).toBeInTheDocument();
  });

  it('calls onToggleSermons when Sermons legend button is clicked', () => {
    const selectedDate = new Date(2024, 0, 15);
    const onToggleSermons = jest.fn();
    const onToggleGroups = jest.fn();

    render(
      <PreachCalendar
        eventsByDate={sermonsByDate}
        selectedDate={selectedDate}
        onDateSelect={jest.fn()}
        onToggleSermons={onToggleSermons}
        onToggleGroups={onToggleGroups}
      />
    );

    const sermonsBtn = screen.getByText('Sermons').closest('button');
    sermonsBtn?.click();
    expect(onToggleSermons).toHaveBeenCalledTimes(1);

    const groupsBtn = screen.getByText('Groups').closest('button');
    groupsBtn?.click();
    expect(onToggleGroups).toHaveBeenCalledTimes(1);
  });

  it('applies inactive styling when filterSermons is false', () => {
    const selectedDate = new Date(2024, 0, 15);

    render(
      <PreachCalendar
        eventsByDate={sermonsByDate}
        selectedDate={selectedDate}
        onDateSelect={jest.fn()}
        filterSermons={false}
        filterGroups={true}
      />
    );

    const sermonsBtn = screen.getByText('Sermons').closest('button');
    expect(sermonsBtn?.className).toContain('opacity-50');
    const groupsBtn = screen.getByText('Groups').closest('button');
    expect(groupsBtn?.className).not.toContain('opacity-50');
  });

  it('hasSermonsDate returns false when filterSermons is false', () => {
    const selectedDate = new Date(2024, 0, 15);

    render(
      <PreachCalendar
        eventsByDate={sermonsByDate}
        selectedDate={selectedDate}
        onDateSelect={jest.fn()}
        filterSermons={false}
      />
    );

    const props = mockDayPicker.mock.calls[0][0];
    // With filterSermons=false, the hasSermon modifier should return false for any date
    expect(props.modifiers.hasSermon(new Date(2024, 0, 15))).toBe(false);
  });

  it('hasGroupsDate returns false when filterGroups is false', () => {
    const selectedDate = new Date(2024, 0, 15);
    // Add a group-like event (no currentPreachDate)
    const eventsByDateWithGroup: Record<string, unknown[]> = {
      '2024-01-15': [{ id: 'group-1', title: 'Group' }], // no currentPreachDate → group
    };

    render(
      <PreachCalendar
        eventsByDate={eventsByDateWithGroup}
        selectedDate={selectedDate}
        onDateSelect={jest.fn()}
        filterGroups={false}
      />
    );

    const props = mockDayPicker.mock.calls[0][0];
    expect(props.modifiers.hasGroup(new Date(2024, 0, 15))).toBe(false);
  });

  it('hasGroupsDate returns true when filterGroups is true and event without currentPreachDate exists', () => {
    const selectedDate = new Date(2024, 0, 15);
    const eventsByDateWithGroup: Record<string, unknown[]> = {
      '2024-01-15': [{ id: 'group-1', title: 'Group' }],
    };

    render(
      <PreachCalendar
        eventsByDate={eventsByDateWithGroup}
        selectedDate={selectedDate}
        onDateSelect={jest.fn()}
        filterGroups={true}
      />
    );

    const props = mockDayPicker.mock.calls[0][0];
    expect(props.modifiers.hasGroup(new Date(2024, 0, 15))).toBe(true);
    expect(props.modifiers.hasGroup(new Date(2024, 0, 16))).toBe(false);
  });
});
