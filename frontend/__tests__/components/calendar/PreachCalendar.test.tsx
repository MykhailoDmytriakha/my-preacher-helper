import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import PreachCalendar from '@/components/calendar/PreachCalendar';
import '@testing-library/jest-dom';

import type { CalendarKind } from '@/utils/calendarEntries';

const mockDayPicker = jest.fn();
const mockUseUserSettings = jest.fn((_userId?: string) => ({ settings: { firstDayOfWeek: 'sunday' } }));

jest.mock('react-day-picker', () => ({
  // Close to the real thing in the one way that matters here: the day cells are rendered by the
  // picker, inside whatever the calendar wrapped it in, not conjured up on their own in a test.
  DayPicker: (props: any) => {
    mockDayPicker(props);
    const DayButton = props.components?.DayButton;
    const month = props.month ?? new Date();
    const days = Array.from({ length: 28 }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1));
    return (
      <div data-testid="day-picker">
        {DayButton &&
          days.map((date) => (
            <DayButton
              key={date.toISOString()}
              day={{ date }}
              modifiers={{ selected: props.selected && date.getDate() === props.selected.getDate() }}
              className="rdp-day_button"
            >
              {date.getDate()}
            </DayButton>
          ))}
      </div>
    );
  },
}));

jest.mock('react-day-picker/dist/style.css', () => ({}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'user-1' } }),
}));

jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: (userId?: string) => mockUseUserSettings(userId),
}));

const allShown: Record<CalendarKind, boolean> = { sermon: true, group: true, council: true };

const renderCalendar = (props: Partial<React.ComponentProps<typeof PreachCalendar>> = {}) =>
  render(
    <PreachCalendar
      kindsByDate={{ '2024-01-15': ['sermon', 'group'] }}
      selectedDate={new Date(2024, 0, 15)}
      onDateSelect={jest.fn()}
      shown={allShown}
      onToggleKind={jest.fn()}
      {...props}
    />
  );

/** The dots drawn on one day of the rendered month. */
const dotsOn = (container: HTMLElement, day: number) => {
  const cell = [...container.querySelectorAll('.preach-day')].find((button) => button.textContent?.startsWith(String(day)));
  return [...(cell?.querySelectorAll('.preach-day-dot') ?? [])];
};

describe('PreachCalendar', () => {
  beforeEach(() => {
    mockDayPicker.mockClear();
    mockUseUserSettings.mockReturnValue({ settings: { firstDayOfWeek: 'sunday' } });
  });

  it('uses selectedDate as month when currentMonth is not provided', () => {
    const selectedDate = new Date(2024, 0, 15);
    renderCalendar({ selectedDate });
    expect(mockDayPicker.mock.calls[0][0].month).toEqual(selectedDate);
  });

  it('uses currentMonth when provided', () => {
    const currentMonth = new Date(2024, 1, 1);
    renderCalendar({ currentMonth });
    expect(mockDayPicker.mock.calls[0][0].month).toEqual(currentMonth);
  });

  it('passes first day of week preference to DayPicker', () => {
    mockUseUserSettings.mockReturnValue({ settings: { firstDayOfWeek: 'monday' } });
    renderCalendar();
    expect(mockDayPicker.mock.calls[0][0].weekStartsOn).toBe(1);
  });

  it('forwards onMonthChange and onDateSelect handlers', () => {
    const onDateSelect = jest.fn();
    const onMonthChange = jest.fn();
    renderCalendar({ onDateSelect, onMonthChange });

    const props = mockDayPicker.mock.calls[0][0];
    const nextDate = new Date(2024, 2, 5);
    props.onSelect(nextDate);
    props.onMonthChange(new Date(2024, 2, 1));

    expect(onDateSelect).toHaveBeenCalledWith(nextDate);
    expect(onMonthChange).toHaveBeenCalledWith(new Date(2024, 2, 1));
  });

  it('draws one dot per kind that falls on the day, in a fixed order', () => {
    const { container } = renderCalendar({ currentMonth: new Date(2024, 0, 1), selectedDate: new Date(2024, 0, 2) });
    const dots = dotsOn(container, 15);
    expect(dots.map((dot) => dot.getAttribute('data-kind'))).toEqual(['sermon', 'group']);
    expect(dots[0]).toHaveClass('bg-blue-500');
    expect(dots[1]).toHaveClass('bg-emerald-500');
  });

  it('draws the council dot in its own colour, without being mistaken for a group', () => {
    const { container } = renderCalendar({
      kindsByDate: { '2024-01-20': ['council'] },
      currentMonth: new Date(2024, 0, 1),
      selectedDate: new Date(2024, 0, 2),
    });
    const dots = dotsOn(container, 20);
    expect(dots).toHaveLength(1);
    expect(dots[0].getAttribute('data-kind')).toBe('council');
    expect(dots[0]).toHaveClass('bg-indigo-500');
  });

  it('leaves a day with nothing on it unmarked', () => {
    const { container } = renderCalendar({ currentMonth: new Date(2024, 0, 1), selectedDate: new Date(2024, 0, 2) });
    expect(dotsOn(container, 16)).toHaveLength(0);
  });

  it('turns the dots white on the selected day, where the cell is filled', () => {
    const { container } = renderCalendar({ currentMonth: new Date(2024, 0, 1), selectedDate: new Date(2024, 0, 15) });
    dotsOn(container, 15).forEach((dot) => expect(dot).toHaveClass('bg-white'));
  });

  it('takes over the keyboard behaviour it took over the cell from', () => {
    const { container } = renderCalendar({ currentMonth: new Date(2024, 0, 1), selectedDate: new Date(2024, 0, 2) });
    // The picker marks a day focused; the cell must actually take the focus, or the arrow keys
    // move the calendar's idea of "here" while the focus stays behind.
    const { components } = mockDayPicker.mock.calls[0][0];
    const DayButton = components.DayButton;
    render(<DayButton day={{ date: new Date(2024, 0, 17) }} modifiers={{ focused: true }} className="rdp-day_button">17</DayButton>, {
      container: container.appendChild(document.createElement('div')),
    });
    expect(document.activeElement?.textContent).toContain('17');
  });

  it('renders a legend button for every kind, councils included', () => {
    renderCalendar();
    expect(screen.getByTestId('calendar-filter-sermon')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-filter-group')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-filter-council')).toBeInTheDocument();
  });

  it('says which kind was switched, so the page does not have to keep a flag per kind', () => {
    const onToggleKind = jest.fn();
    renderCalendar({ onToggleKind });
    fireEvent.click(screen.getByTestId('calendar-filter-council'));
    expect(onToggleKind).toHaveBeenCalledWith('council');
  });

  it('shows a switched-off kind as switched off', () => {
    renderCalendar({ shown: { ...allShown, council: false } });
    const council = screen.getByTestId('calendar-filter-council');
    expect(council).toHaveAttribute('aria-pressed', 'false');
    expect(council.className).toContain('opacity-50');
  });

  it('keeps the filled contrast of a selected day in dark mode', () => {
    const { container } = renderCalendar();
    const styles = container.querySelector('style')?.textContent ?? '';
    expect(styles).toContain('.rdp-selected .rdp-day_button');
    expect(styles).toContain('--preach-calendar-selected-background');
  });
});
