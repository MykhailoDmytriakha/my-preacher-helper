import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import ThoughtList from '@/components/sermon/ThoughtList';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockThoughtCard = jest.fn(({ thought, onRetrySync }: any) => (
  <div data-testid={`thought-card-${thought.id}`}>
    <button type="button" onClick={() => onRetrySync?.(thought.id)}>
      Retry {thought.id}
    </button>
  </div>
));

jest.mock('@/components/ThoughtCard', () => ({
  __esModule: true,
  default: (props: any) => mockThoughtCard(props),
}));

describe('ThoughtList', () => {
  const thoughts = [
    { id: 'thought-1', text: 'First', tags: [], date: '2024-01-01' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes sync state and retry callbacks through to ThoughtCard', () => {
    const onRetrySync = jest.fn();

    render(
      <ThoughtList
        filteredThoughts={thoughts as any}
        totalThoughtsCount={thoughts.length}
        allowedTags={[]}
        sermonOutline={undefined}
        sermonId="sermon-1"
        onDelete={jest.fn()}
        onEditStart={jest.fn()}
        onRetrySync={onRetrySync}
        syncStatesById={{
          'thought-1': { status: 'error', operation: 'update', lastError: 'Failed' },
        }}
        resetFilters={jest.fn()}
      />
    );

    expect(mockThoughtCard).toHaveBeenCalled();
    expect(mockThoughtCard.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        thought: expect.objectContaining({ id: 'thought-1' }),
        syncState: { status: 'error', operation: 'update', lastError: 'Failed' },
        onRetrySync,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry thought-1' }));
    expect(onRetrySync).toHaveBeenCalledWith('thought-1');
  });
});
