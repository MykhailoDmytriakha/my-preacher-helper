import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import PrayerRequestCard from '@/components/prayer/PrayerRequestCard';
import '@testing-library/jest-dom';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'prayer.updates_count') {
        return `${options?.count ?? 0} updates`;
      }

      const translations: Record<string, string> = {
        'prayer.actions.addUpdate': 'Add Update',
        'prayer.actions.markAnswered': 'Mark Answered',
        'prayer.actions.markNotAnswered': 'Mark Not Answered',
        'prayer.actions.markActive': 'Mark Active',
        'prayer.actions.edit': 'Edit',
        'prayer.actions.delete': 'Delete',
        'prayer.delete.confirm_button': 'Delete forever',
      };

      return translations[key] || key;
    },
  }),
}));

const basePrayer = {
  id: 'prayer-1',
  userId: 'user-1',
  title: 'Pray for family',
  description: 'Health and peace',
  status: 'active' as const,
  tags: ['family', 'health'],
  updates: [
    { id: 'u1', text: 'Older note', createdAt: '2026-03-10T10:00:00.000Z' },
    { id: 'u2', text: 'Latest note', createdAt: '2026-03-11T10:00:00.000Z' },
  ],
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-12T10:00:00.000Z',
};

describe('PrayerRequestCard', () => {
  it('renders active prayers and routes action menu callbacks', async () => {
    const onSetStatus = jest.fn().mockResolvedValue(undefined);
    const onDelete = jest.fn().mockResolvedValue(undefined);
    const onAddUpdate = jest.fn();
    const onEdit = jest.fn();

    render(
      <PrayerRequestCard
        prayer={basePrayer as any}
        onSetStatus={onSetStatus}
        onDelete={onDelete}
        onAddUpdate={onAddUpdate}
        onEdit={onEdit}
      />
    );

    expect(screen.getByText('Pray for family')).toBeInTheDocument();
    expect(screen.getByText('Health and peace')).toBeInTheDocument();
    expect(screen.getByText('Latest note')).toBeInTheDocument();
    expect(screen.getByText('family')).toBeInTheDocument();
    expect(screen.getByText('2 updates')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Update' }));
    expect(onAddUpdate).toHaveBeenCalledWith('prayer-1');

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark Answered' }));
    await waitFor(() => {
      expect(onSetStatus).toHaveBeenCalledWith('prayer-1', 'answered');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark Not Answered' }));
    await waitFor(() => {
      expect(onSetStatus).toHaveBeenCalledWith('prayer-1', 'not_answered');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith(basePrayer);

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Delete forever?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete forever?' }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('prayer-1');
    });
  });

  it('highlights matched terms and surfaces a matching older update snippet during search', () => {
    const { container } = render(
      <PrayerRequestCard
        prayer={{
          ...basePrayer,
          title: 'Pray for family breakthrough',
          description: 'Health and peace for the family',
          answerText: 'A hopeful answer arrived',
          tags: ['family', 'hope'],
          updates: [
            { id: 'u1', text: 'Family breakthrough during prayer night', createdAt: '2026-03-10T10:00:00.000Z' },
            { id: 'u2', text: 'Latest note', createdAt: '2026-03-11T10:00:00.000Z' },
          ],
        } as any}
        searchQuery="family breakthrough"
        onSetStatus={jest.fn().mockResolvedValue(undefined)}
        onDelete={jest.fn().mockResolvedValue(undefined)}
        onAddUpdate={jest.fn()}
        onEdit={jest.fn()}
      />
    );

    expect(container).toHaveTextContent('Family breakthrough during prayer night');
    expect(screen.queryByText('Latest note')).not.toBeInTheDocument();

    const highlighted = container.querySelectorAll('mark');
    expect(highlighted.length).toBeGreaterThan(0);
    expect(container).toHaveTextContent('Pray for family breakthrough');
    expect(container).toHaveTextContent('family');
  });

  it('renders answered prayers with answer text and restore action', async () => {
    const onSetStatus = jest.fn().mockResolvedValue(undefined);

    render(
      <PrayerRequestCard
        prayer={{
          ...basePrayer,
          status: 'answered',
          answerText: 'God answered this prayer.',
          answeredAt: '2026-03-15T10:00:00.000Z',
        } as any}
        onSetStatus={onSetStatus}
        onDelete={jest.fn().mockResolvedValue(undefined)}
        onAddUpdate={jest.fn()}
        onEdit={jest.fn()}
      />
    );

    expect(screen.getByText('God answered this prayer.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

    expect(screen.getByRole('button', { name: 'Mark Active' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark Answered' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark Not Answered' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark Active' }));

    await waitFor(() => {
      expect(onSetStatus).toHaveBeenCalledWith('prayer-1', 'active');
    });
  });

  it('handles prayers without updates without rendering a latest-update preview', () => {
    render(
      <PrayerRequestCard
        prayer={{
          ...basePrayer,
          updates: [],
        } as any}
        onSetStatus={jest.fn().mockResolvedValue(undefined)}
        onDelete={jest.fn().mockResolvedValue(undefined)}
        onAddUpdate={jest.fn()}
        onEdit={jest.fn()}
      />
    );

    expect(screen.queryByText('Latest note')).not.toBeInTheDocument();
    expect(screen.queryByText('0 updates')).not.toBeInTheDocument();
  });
});
