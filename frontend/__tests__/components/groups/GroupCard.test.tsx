import { fireEvent, render, screen } from '@testing-library/react';

import GroupCard from '@/components/groups/GroupCard';

jest.mock('next/link', () => {
  return function MockLink({ href, children, className }: any) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

const isoDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

describe('GroupCard', () => {
  it('renders group details and resolves next meeting date', () => {
    const now = new Date();
    const past = new Date(now);
    past.setDate(now.getDate() - 4);
    const upcoming = new Date(now);
    upcoming.setDate(now.getDate() + 3);

    render(
      <GroupCard
        group={{
          id: 'g1',
          userId: 'user-1',
          title: 'Family Group',
          description: 'Weekly meeting',
          status: 'active',
          templates: [{ id: 't1' } as any],
          flow: [{ id: 'f1' } as any],
          meetingDates: [
            { id: 'd1', date: isoDate(past), createdAt: 'x' },
            { id: 'd2', date: isoDate(upcoming), createdAt: 'x' },
          ],
          createdAt: 'x',
          updatedAt: 'x',
          seriesId: null,
          seriesPosition: null,
        }}
      />
    );

    expect(screen.getByText('Family Group')).toBeInTheDocument();
    expect(screen.getByText('Weekly meeting')).toBeInTheDocument();
    expect(screen.getByText('Next meeting')).toBeInTheDocument();
    expect(screen.getByText('Meetings: 2')).toBeInTheDocument();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/groups/g1');
  });

  it('falls back to last meeting and no-date labels', () => {
    const now = new Date();
    const oldA = new Date(now);
    oldA.setDate(now.getDate() - 10);
    const oldB = new Date(now);
    oldB.setDate(now.getDate() - 1);

    const { rerender } = render(
      <GroupCard
        group={{
          id: 'g1',
          userId: 'user-1',
          title: 'Group 1',
          status: 'draft',
          templates: [],
          flow: [],
          meetingDates: [
            { id: 'd1', date: isoDate(oldA), createdAt: 'x' },
            { id: 'd2', date: isoDate(oldB), createdAt: 'x' },
          ],
          createdAt: 'x',
          updatedAt: 'x',
          seriesId: null,
          seriesPosition: null,
        }}
      />
    );

    expect(screen.getByText('Last meeting')).toBeInTheDocument();

    rerender(
      <GroupCard
        group={{
          id: 'g1',
          userId: 'user-1',
          title: 'Group 1',
          status: 'draft',
          templates: [],
          flow: [],
          meetingDates: [{ id: 'd1', date: 'invalid', createdAt: 'x' }],
          createdAt: 'x',
          updatedAt: 'x',
          seriesId: null,
          seriesPosition: null,
        }}
      />
    );

    expect(screen.getByText('No date')).toBeInTheDocument();
  });

  it('calls delete handler and reflects deleting state', () => {
    const onDelete = jest.fn();
    const { rerender } = render(
      <GroupCard
        group={{
          id: 'g1',
          userId: 'user-1',
          title: 'Group 1',
          status: 'completed',
          templates: [],
          flow: [],
          meetingDates: [],
          createdAt: 'x',
          updatedAt: 'x',
          seriesId: null,
          seriesPosition: null,
        }}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);

    rerender(
      <GroupCard
        group={{
          id: 'g1',
          userId: 'user-1',
          title: 'Group 1',
          status: 'completed',
          templates: [],
          flow: [],
          meetingDates: [],
          createdAt: 'x',
          updatedAt: 'x',
          seriesId: null,
          seriesPosition: null,
        }}
        onDelete={onDelete}
        deleting
      />
    );

    expect(screen.getByRole('button', { name: 'Deleting...' })).toBeDisabled();
  });
});
