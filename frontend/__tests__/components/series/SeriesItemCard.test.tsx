import { fireEvent, render, screen } from '@testing-library/react';

import SeriesItemCard from '@/components/series/SeriesItemCard';

jest.mock('next/link', () => {
  return function MockLink({ href, children, className }: any) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  };
});

jest.mock('@utils/dateFormatter', () => ({
  formatDate: (value: string) => `formatted:${value}`,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

describe('SeriesItemCard', () => {
  it('renders sermon item with preview and remove action', () => {
    const onRemove = jest.fn();
    render(
      <SeriesItemCard
        id="item-1"
        resolvedItem={{
          item: { id: 'item-1', type: 'sermon', refId: 'sermon-1', position: 1 },
          sermon: {
            id: 'sermon-1',
            title: 'Faith Sermon',
            verse: 'John 3:16',
            date: '2026-02-10',
            userId: 'user-1',
            thoughts: [{ id: 'th1', text: 'First thought', tags: [], date: 'x' }],
            preparation: { thesis: { oneSentence: 'One sentence thesis' } },
            outline: { introduction: [], main: [], conclusion: [] },
            isPreached: true,
          } as any,
        }}
        position={2}
        onRemove={onRemove}
      />
    );

    expect(screen.getByText('Faith Sermon')).toBeInTheDocument();
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    expect(screen.getByText('One sentence thesis')).toBeInTheDocument();
    expect(screen.getByText('formatted:2026-02-10')).toBeInTheDocument();
    expect(screen.getByText('Sermons')).toBeInTheDocument();
    expect(screen.getByText('dashboard.preached')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('workspaces.series.actions.removeFromSeries'));
    expect(onRemove).toHaveBeenCalledWith('sermon', 'sermon-1');
  });

  it('renders group item and fallback unknown label', () => {
    const { rerender } = render(
      <SeriesItemCard
        id="item-2"
        resolvedItem={{
          item: { id: 'item-2', type: 'group', refId: 'group-1', position: 1 },
          group: {
            id: 'group-1',
            title: 'Cell Group',
            description: 'Small group',
            updatedAt: '2026-02-11',
            flow: [{ id: 'f1' }],
            meetingDates: [{ id: 'd1', date: '2026-02-12', createdAt: 'x' }],
          } as any,
        }}
        position={1}
      />
    );

    expect(screen.getByText('Cell Group')).toBeInTheDocument();
    expect(screen.getByText('Groups')).toBeInTheDocument();
    expect(screen.getByText('Meetings: 1')).toBeInTheDocument();
    expect(screen.getByText('formatted:2026-02-11')).toBeInTheDocument();
    expect(screen.getByText('1 flow steps')).toBeInTheDocument();

    rerender(
      <SeriesItemCard
        id="item-3"
        resolvedItem={{
          item: { id: 'item-3', type: 'group', refId: 'missing', position: 2 },
        }}
        position={2}
      />
    );

    expect(screen.getByText('Unknown item')).toBeInTheDocument();
  });
});
