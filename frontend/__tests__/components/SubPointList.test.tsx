import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('@hello-pangea/dnd', () => {
  const React = require('react');

  return {
    DragDropContext: ({ children }: any) => <div data-testid="subpoint-dnd-context">{children}</div>,
    Droppable: ({ children }: any) => (
      <div data-testid="subpoint-droppable">
        {children({
          innerRef: jest.fn(),
          droppableProps: {},
          placeholder: null,
        })}
      </div>
    ),
    Draggable: ({ children }: any) => (
      <div data-testid="subpoint-draggable">
        {children(
          {
            innerRef: jest.fn(),
            draggableProps: { style: {} },
            dragHandleProps: { 'data-testid': 'subpoint-drag-handle' },
          },
          { isDragging: false }
        )}
      </div>
    ),
  };
});

import { SubPointList } from '@/components/column/SubPointList';

const t = (key: string, options?: Record<string, unknown>) =>
  typeof options?.defaultValue === 'string' ? options.defaultValue : key;

describe('SubPointList', () => {
  it('uses readable dark-mode styling for sub-point labels on colored focus backgrounds', () => {
    render(
      <SubPointList
        subPoints={[{ id: 'sub-1', text: 'Saul', position: 1000 }]}
        outlinePointId="point-1"
        isPointLocked={false}
        onAdd={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        t={t}
      />
    );

    const label = screen.getByText('Saul');
    expect(label).toHaveClass('dark:text-blue-50/90');
    expect(label).toHaveClass('font-medium');

    const list = label.closest('div.ml-7');
    expect(list).toHaveClass('dark:bg-white/[0.07]');
    expect(list).toHaveClass('dark:border-blue-100/35');
  });

  it('keeps sub-point action controls inside the visual boundary', () => {
    render(
      <SubPointList
        subPoints={[{ id: 'sub-1', text: 'Long sub-point title that needs room for controls', position: 1000 }]}
        outlinePointId="point-1"
        isPointLocked={false}
        onAdd={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        t={t}
      />
    );

    const editButton = screen.getByLabelText('common.edit');
    const actionSlot = editButton.parentElement;
    const row = editButton.closest('.group\\/sp');
    const list = screen.getByText('Long sub-point title that needs room for controls').closest('div.ml-7');

    expect(list).toHaveClass('mr-4');
    expect(list).toHaveClass('max-w-[calc(100%-2.75rem)]');
    expect(row).toHaveClass('min-w-0');
    expect(actionSlot).toHaveClass('w-10');
    expect(actionSlot).toHaveClass('justify-end');
  });

  it('enters sub-point edit mode on double-click and saves the edited text', () => {
    const handleEdit = jest.fn();

    render(
      <SubPointList
        subPoints={[{ id: 'sub-1', text: 'Saul', position: 1000 }]}
        outlinePointId="point-1"
        isPointLocked={false}
        onAdd={jest.fn()}
        onEdit={handleEdit}
        onDelete={jest.fn()}
        t={t}
      />
    );

    const label = screen.getByText('Saul');
    expect(label).toHaveClass('cursor-text');

    fireEvent.doubleClick(label);

    const input = screen.getByDisplayValue('Saul');
    fireEvent.change(input, { target: { value: 'Paul' } });
    fireEvent.click(screen.getByLabelText('common.save'));

    expect(handleEdit).toHaveBeenCalledWith('point-1', 'sub-1', 'Paul');
  });

  it('keeps the drag handle mounted while editing a reorderable sub-point', () => {
    render(
      <SubPointList
        subPoints={[
          { id: 'sub-1', text: 'Saul', position: 1000 },
          { id: 'sub-2', text: 'Barnabas', position: 2000 },
        ]}
        outlinePointId="point-1"
        isPointLocked={false}
        onAdd={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onReorder={jest.fn()}
        t={t}
      />
    );

    expect(screen.getAllByTestId('subpoint-drag-handle')).toHaveLength(2);

    fireEvent.doubleClick(screen.getByText('Saul'));

    expect(screen.getByDisplayValue('Saul')).toBeInTheDocument();
    expect(screen.getAllByTestId('subpoint-drag-handle')).toHaveLength(2);
  });

  it('ignores sub-point double-click editing when the point is locked', () => {
    render(
      <SubPointList
        subPoints={[{ id: 'sub-1', text: 'Saul', position: 1000 }]}
        outlinePointId="point-1"
        isPointLocked={true}
        onAdd={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        t={t}
      />
    );

    const label = screen.getByText('Saul');
    expect(label).not.toHaveClass('cursor-text');

    fireEvent.doubleClick(label);

    expect(screen.queryByDisplayValue('Saul')).not.toBeInTheDocument();
  });
});
