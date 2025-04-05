import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SortableItem from '@/components/SortableItem';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Item } from '@/models/models';

jest.mock('@dnd-kit/sortable', () => ({
  // This is the simple mock now
  useSortable: jest.fn().mockReturnValue({
    attributes: { role: 'button' },
    listeners: { onKeyDown: jest.fn() },
    setNodeRef: jest.fn(),
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    transition: 'transform 250ms ease-in-out',
    isDragging: false
  }),
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</> 
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

    // Get the edit button by testId instead of role+name
    const editButton = screen.getByTestId('edit-icon').closest('button');
    fireEvent.click(editButton!);

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

    // Get the edit button by testId instead of role+name
    const editButton = screen.getByTestId('edit-icon').closest('button');
    
    // Check for proper accessibility attributes
    expect(editButton).toHaveAttribute('title', 'structure.editThought');
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
        onDelete={mockOnDelete}
        showDeleteIcon={true}
      />
    );

    // Find the delete button by testId instead of role+name
    const deleteButton = screen.getByTestId('trash-icon').closest('button');
    fireEvent.click(deleteButton!);

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

    // Find the delete button by testId
    const deleteButton = screen.getByTestId('trash-icon').closest('button');
    expect(deleteButton).toHaveAttribute('title', 'structure.removeFromStructure');
    expect(deleteButton).toBeInTheDocument();
  });

  test('applies deleting styles and disables buttons when isDeleting is true', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        showDeleteIcon={true}
        onDelete={mockOnDelete}
        isDeleting={true}
      />
    );

    // Check container has expected style
    const container = screen.getByText('Test content for the item').closest('div[role="button"]');
    expect(container).toHaveClass('pointer-events-none');
    expect(container).toHaveStyle('opacity: 0.5');

    // Check buttons are disabled
    const editButton = screen.getByTestId('edit-icon').closest('button');
    expect(editButton).toBeDisabled();

    const deleteButton = screen.getByTestId('trash-icon').closest('button');
    expect(deleteButton).toBeDisabled();
  });
}); 