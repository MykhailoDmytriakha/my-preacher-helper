import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SortableItem from '@/components/SortableItem';
import '@testing-library/jest-dom';
import { Item } from '@/models/models';

// Mock the useSortable hook
jest.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: { 'data-test': 'sortable-item' },
    listeners: { 'data-testid': 'drag-handle' },
    setNodeRef: jest.fn(),
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    transition: 'transform 250ms ease',
    isDragging: false,
  }),
}));

// Mock the CSS utility
jest.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: jest.fn().mockReturnValue('translate3d(0px, 0px, 0)'),
    },
  },
}));

// Mock the getContrastColor function
jest.mock('@utils/color', () => ({
  getContrastColor: jest.fn().mockReturnValue('#ffffff'),
}));

// Mock the EditIcon component
jest.mock('@components/Icons', () => {
  return {
    EditIcon: function MockEditIcon() {
      return <div data-testid="edit-icon" className="mock-edit-icon" />;
    }
  };
});

describe('SortableItem Component', () => {
  const mockItem: Item = {
    id: 'test-item-1',
    content: 'Test content for the item',
    customTagNames: [
      { name: 'Tag1', color: '#ff0000' },
      { name: 'Tag2', color: '#00ff00' },
    ],
    requiredTags: ['Introduction'],
  };

  const mockContainerId = 'introduction';
  const mockOnEdit = jest.fn();

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('renders correctly with all props', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
      />
    );

    // Check if content is rendered
    expect(screen.getByText('Test content for the item')).toBeInTheDocument();

    // Check if tags are rendered
    expect(screen.getByText('Tag1')).toBeInTheDocument();
    expect(screen.getByText('Tag2')).toBeInTheDocument();

    // Check if edit button is rendered
    expect(screen.getByTestId('edit-icon')).toBeInTheDocument();
  });

  test('renders correctly without onEdit prop', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
      />
    );

    // Check if content is rendered
    expect(screen.getByText('Test content for the item')).toBeInTheDocument();

    // Check if tags are rendered
    expect(screen.getByText('Tag1')).toBeInTheDocument();
    expect(screen.getByText('Tag2')).toBeInTheDocument();

    // Edit button should not be rendered
    expect(screen.queryByTestId('edit-icon')).not.toBeInTheDocument();
  });

  test('renders correctly without tags', () => {
    const itemWithoutTags: Item = {
      id: 'test-item-2',
      content: 'Item without tags',
    };

    render(
      <SortableItem
        item={itemWithoutTags}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
      />
    );

    // Check if content is rendered
    expect(screen.getByText('Item without tags')).toBeInTheDocument();

    // No tags should be rendered
    expect(screen.queryByText('Tag1')).not.toBeInTheDocument();
    expect(screen.queryByText('Tag2')).not.toBeInTheDocument();

    // Edit button should be rendered
    expect(screen.getByTestId('edit-icon')).toBeInTheDocument();
  });

  test('calls onEdit when edit button is clicked', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
      />
    );

    // Get the edit button and click it
    const editButton = screen.getByRole('button', { name: /edit thought/i });
    fireEvent.click(editButton);

    // Check if onEdit was called with the correct item
    expect(mockOnEdit).toHaveBeenCalledTimes(1);
    expect(mockOnEdit).toHaveBeenCalledWith(mockItem);
  });

  test('edit button has proper accessibility attributes', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
      />
    );

    // Get the edit button
    const editButton = screen.getByRole('button', { name: /edit thought/i });
    
    // Check for proper accessibility attributes
    expect(editButton).toHaveAttribute('title', 'Edit Thought');
    expect(editButton).toBeInTheDocument();
  });
}); 