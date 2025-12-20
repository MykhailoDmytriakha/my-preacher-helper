import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import CalendarHeader from '@/components/calendar/CalendarHeader';
import '@testing-library/jest-dom';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'calendar.title': 'Preach Calendar',
        'calendar.today': 'Today',
        'calendar.goToToday': 'Go to current month',
        'calendar.monthView': 'Month',
        'calendar.agendaView': 'Agenda',
        'calendar.analytics.title': 'Analytics',
      };
      return translations[key] || key;
    },
  }),
}));

jest.mock('@heroicons/react/24/outline', () => ({
  CalendarDaysIcon: () => <svg data-testid="calendar-days-icon" />,
  ChartBarIcon: () => <svg data-testid="chart-bar-icon" />,
  ListBulletIcon: () => <svg data-testid="list-bullet-icon" />,
  HomeIcon: () => <svg data-testid="home-icon" />,
}));

describe('CalendarHeader', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2024, 4, 15));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders title and view buttons', () => {
    render(
      <CalendarHeader
        view="month"
        onViewChange={jest.fn()}
      />
    );

    expect(screen.getByText('Preach Calendar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analytics' })).toBeInTheDocument();
  });

  it('shows Today button when month view and not current month', () => {
    const onGoToToday = jest.fn();

    render(
      <CalendarHeader
        view="month"
        onViewChange={jest.fn()}
        currentMonth={new Date(2024, 3, 1)}
        onGoToToday={onGoToToday}
      />
    );

    const todayButton = screen.getByRole('button', { name: 'Today' });
    expect(todayButton).toBeInTheDocument();

    fireEvent.click(todayButton);
    expect(onGoToToday).toHaveBeenCalledTimes(1);
  });

  it('hides Today button when viewing current month', () => {
    render(
      <CalendarHeader
        view="month"
        onViewChange={jest.fn()}
        currentMonth={new Date(2024, 4, 1)}
        onGoToToday={jest.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
  });

  it('hides Today button when not in month view', () => {
    render(
      <CalendarHeader
        view="agenda"
        onViewChange={jest.fn()}
        currentMonth={new Date(2024, 3, 1)}
        onGoToToday={jest.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
  });
});
