import { fireEvent, render, screen } from '@testing-library/react';

import { CareSectionHeader } from '@/components/care/CareSectionHeader';

const props = {
  title: 'Section title',
  titleClassName: 'text-emerald-700',
  description: 'Section description',
  icon: <svg aria-hidden="true" />,
};

describe('CareSectionHeader', () => {
  it('renders one section heading and its description without requiring actions', () => {
    render(<CareSectionHeader {...props} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: props.title })).toBeInTheDocument();
    expect(screen.getByText(props.description)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps each action once and updates the actions and description together', () => {
    const onReorder = jest.fn();
    const { rerender } = render(
      <CareSectionHeader
        {...props}
        actions={<button onClick={onReorder}>Reorder</button>}
      />,
    );

    expect(screen.getAllByRole('button', { name: 'Reorder' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reorder' }));
    expect(onReorder).toHaveBeenCalledTimes(1);

    rerender(<CareSectionHeader {...props} description="Arrange the list" actions={<button>Done</button>} />);
    expect(screen.queryByRole('button', { name: 'Reorder' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByText('Arrange the list')).toBeInTheDocument();
    expect(screen.queryByText(props.description)).not.toBeInTheDocument();
  });
});
