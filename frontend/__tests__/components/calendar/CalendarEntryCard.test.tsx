import { render, screen } from '@testing-library/react';
import React from 'react';

import { CalendarEntryCard } from '@/components/calendar/CalendarEntryCard';
import '@testing-library/jest-dom';

import type { CalendarEntry } from '@/utils/calendarEntries';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const noteEntry = (over: Partial<CalendarEntry> = {}): CalendarEntry => ({
  kind: 'note',
  id: 'note-n1-written',
  refId: 'n1',
  date: '2026-09-03',
  title: 'Молитва Иависа',
  subtitle: '1 Пар 4:9-10',
  href: '/studies/n1',
  ...over,
});

describe('CalendarEntryCard — a note or a prayer on its day', () => {
  it('shows a note on the day it was written with no chip: that day it was simply written', () => {
    render(<CalendarEntryCard entry={noteEntry()} />);

    expect(screen.getByTestId('calendar-entry-note')).toHaveAttribute('href', '/studies/n1');
    expect(screen.getByText('Молитва Иависа')).toBeInTheDocument();
    expect(screen.getByText('1 Пар 4:9-10')).toBeInTheDocument();
    expect(screen.queryByText('calendar.status.updated')).not.toBeInTheDocument();
  });

  it('says why a note is on the calendar a second time', () => {
    render(<CalendarEntryCard entry={noteEntry({ id: 'note-n1-updated', date: '2026-09-10', status: 'updated' })} />);

    expect(screen.getByText('calendar.status.updated')).toBeInTheDocument();
  });

  it("marks an answered prayer with the prayer section's own word for it", () => {
    render(
      <CalendarEntryCard
        entry={{
          kind: 'prayer',
          id: 'prayer-p1-answered',
          refId: 'p1',
          date: '2026-09-20',
          title: 'За церковь',
          href: '/prayers/p1',
          status: 'answered',
        }}
      />
    );

    expect(screen.getByTestId('calendar-entry-prayer')).toHaveAttribute('href', '/prayers/p1');
    expect(screen.getByText('prayer.status.answered')).toBeInTheDocument();
  });
});
