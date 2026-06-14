import { render, screen } from '@testing-library/react';
import React from 'react';

import ThoughtList from '@/components/sermon/ThoughtList';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockThoughtCard = jest.fn(({ thought }: any) => (
  <div data-testid={`thought-card-${thought.id}`}>{thought.text}</div>
));

jest.mock('@/components/ThoughtCard', () => ({
  __esModule: true,
  default: (props: any) => mockThoughtCard(props),
}));

describe('ThoughtList', () => {
  const thoughts = [
    { id: 'thought-1', text: 'First', tags: [], date: '2024-01-01' },
    { id: 'thought-2', text: 'Second', tags: [], date: '2024-01-02' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders one ThoughtCard per filtered thought', () => {
    render(
      <ThoughtList
        filteredThoughts={thoughts as any}
        totalThoughtsCount={thoughts.length}
        allowedTags={[]}
        sermonOutline={undefined}
        sermonId="sermon-1"
        onDelete={jest.fn()}
        onEditStart={jest.fn()}
        resetFilters={jest.fn()}
      />
    );

    expect(mockThoughtCard).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('thought-card-thought-1')).toBeInTheDocument();
    expect(screen.getByTestId('thought-card-thought-2')).toBeInTheDocument();
  });
});
