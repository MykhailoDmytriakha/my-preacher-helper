import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SortableItem from '@/components/SortableItem';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Item } from '@/models/models';

// Mock the useSortable hook
jest.mock('@dnd-kit/sortable', () => ({
  useSortable: jest.fn().mockReturnValue({
    attributes: { role: 'button' },
    listeners: { onKeyDown: jest.fn() },
    setNodeRef: jest.fn(),
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    transition: 'transform 250ms ease-in-out',
    isDragging: false
  }),
}));

// Mock the CSS utility
jest.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: jest.fn(),
    },
  },
}));

// Mock the getContrastColor function
jest.mock('@/utils/color', () => ({
  getContrastColor: jest.fn().mockReturnValue('#ffffff'),
}));

// Mock the EditIcon and TrashIcon components
jest.mock('@components/Icons', () => {
  return {
    EditIcon: function MockEditIcon() {
      return <div data-testid="edit-icon" className="mock-edit-icon" />;
    },
    TrashIcon: function MockTrashIcon() {
      return <div data-testid="trash-icon" className="mock-trash-icon" />;
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
  const mockOnDelete = jest.fn();

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('renders correctly with all props', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
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
        onDelete={mockOnDelete}
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
        onDelete={mockOnDelete}
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
        onDelete={mockOnDelete}
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
        onDelete={mockOnDelete}
      />
    );

    // Get the edit button
    const editButton = screen.getByRole('button', { name: /edit thought/i });
    
    // Check for proper accessibility attributes
    expect(editButton).toHaveAttribute('title', 'Edit Thought');
    expect(editButton).toBeInTheDocument();
  });

  test('preserves line breaks in item content', () => {
    const itemWithLineBreaks: Item = {
      id: 'test-item-with-breaks',
      content: 'Line 1\nLine 2\nLine 3',
    };

    const { container } = render(
      <SortableItem
        item={itemWithLineBreaks}
        containerId={mockContainerId}
        onDelete={mockOnDelete}
      />
    );

    // Check if the content div has the whitespace-pre-wrap class
    const contentDiv = container.querySelector('div.whitespace-pre-wrap');
    expect(contentDiv).toBeInTheDocument();
    expect(contentDiv).toHaveClass('whitespace-pre-wrap');
    
    // Check if the content is rendered with preserved line breaks
    // Note: Browser rendering adds spaces when rendering newlines with whitespace-pre-wrap
    expect(contentDiv).toHaveTextContent('Line 1 Line 2 Line 3');
  });

  test('handles multiline content correctly in focus mode', () => {
    // Create a test item with multiple paragraphs and various whitespace
    const multilineContent = `First paragraph with some text.
    
Second paragraph with indentation.
  - Bullet point 1
  - Bullet point 2`;

    const itemWithMultilineContent: Item = {
      id: 'multiline-item',
      content: multilineContent,
    };

    const { container } = render(
      <SortableItem
        item={itemWithMultilineContent}
        containerId={mockContainerId}
        onDelete={mockOnDelete}
      />
    );

    // Check if the content div has the whitespace-pre-wrap class
    const contentDiv = container.querySelector('div.whitespace-pre-wrap');
    expect(contentDiv).toBeInTheDocument();
    
    // Verify the content is rendered with proper whitespace preservation
    expect(contentDiv?.textContent).toBe(multilineContent);
  });

  test('does not render delete icon when showDeleteIcon is false or omitted', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
      />
    );
    expect(screen.queryByTestId('trash-icon')).not.toBeInTheDocument();

    // Explicitly set to false
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        showDeleteIcon={false}
        onDelete={mockOnDelete}
      />
    );
    expect(screen.queryByTestId('trash-icon')).not.toBeInTheDocument();
  });

  test('renders delete icon when showDeleteIcon is true', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        showDeleteIcon={true}
        onDelete={mockOnDelete}
      />
    );
    expect(screen.getByTestId('trash-icon')).toBeInTheDocument();
  });

  test('calls onDelete with correct arguments when delete button is clicked', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        showDeleteIcon={true}
        onDelete={mockOnDelete}
      />
    );

    // Find the delete button (using title attribute)
    const deleteButton = screen.getByRole('button', { name: /remove from structure/i });
    fireEvent.click(deleteButton);

    expect(mockOnDelete).toHaveBeenCalledTimes(1);
    expect(mockOnDelete).toHaveBeenCalledWith(mockItem.id, mockContainerId);
  });

  test('delete button has proper accessibility attributes', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        showDeleteIcon={true}
        onDelete={mockOnDelete}
      />
    );

    const deleteButton = screen.getByRole('button', { name: /remove from structure/i });
    expect(deleteButton).toHaveAttribute('title', 'Remove from Structure');
    expect(deleteButton).toBeInTheDocument();
  });

  // Note: Testing hover state (opacity change) directly is difficult with React Testing Library.
  // We trust the Tailwind classes `opacity-0 group-hover:opacity-100` work as expected.
}); 