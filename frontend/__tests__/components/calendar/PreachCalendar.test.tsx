import { render } from '@testing-library/react';
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

  it('marks dates with events using modifiers', () => {
    const selectedDate = new Date(2024, 0, 15);

    render(
      <PreachCalendar
        eventsByDate={sermonsByDate}
        selectedDate={selectedDate}
        onDateSelect={jest.fn()}
      />
    );

    const props = mockDayPicker.mock.calls[0][0];
    expect(props.modifiers.hasEvent(new Date(2024, 0, 15))).toBe(true);
    expect(props.modifiers.hasEvent(new Date(2024, 0, 16))).toBeFalsy();
  });
});
