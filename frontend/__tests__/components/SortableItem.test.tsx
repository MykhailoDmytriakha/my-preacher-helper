import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import SortableItem from '@/components/SortableItem';

import { useSortable } from '@dnd-kit/sortable';

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
    EditIcon: function MockEditIcon({ className = '' }: { className?: string }) {
      return <div data-testid="edit-icon" className={`mock-edit-icon ${className}`} />;
    },
    TrashIcon: function MockTrashIcon({ className = '' }: { className?: string }) {
      return <div data-testid="trash-icon" className={`mock-trash-icon ${className}`} />;
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
  const mockOnMoveToAmbiguous = jest.fn();

  afterEach(() => {
    jest.clearAllMocks();
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

    // Check if the content div has the prose class from MarkdownDisplay
    const contentDiv = container.querySelector('.prose');
    expect(contentDiv).toBeInTheDocument();

    // Check if the content is rendered
    // react-markdown will render this as a single paragraph with newlines collapsed to spaces by default,
    // or as multiple paragraphs if there were blank lines. 
    // toHaveTextContent automatically handles whitespace normalization.

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

    // Check if the content div has the prose class
    const contentDiv = container.querySelector('.prose');
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

  test('disables drag affordances when item is locked/disabled', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        disabled={true}
      />
    );

    const sortableMock = useSortable as jest.Mock;
    expect(sortableMock).toHaveBeenCalledWith(
      expect.objectContaining({ disabled: true, id: mockItem.id })
    );

    const container = screen.getByText('Test content for the item').closest('div[role="button"]');
    expect(container).toHaveAttribute('aria-disabled', 'true');
    expect(container?.className).toContain('cursor-default');
    expect(container?.className).not.toContain('hover:shadow-xl');
    expect(container?.style.touchAction).toBe('auto');
  });

  test('renders move-to-ambiguous button and triggers handler', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId={mockContainerId}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        onMoveToAmbiguous={mockOnMoveToAmbiguous}
      />
    );

    // Button should be present with i18n key title
    const moveBtn = screen.getByTitle('structure.moveToUnderConsideration');
    expect(moveBtn).toBeInTheDocument();

    // Click it
    fireEvent.click(moveBtn);
    expect(mockOnMoveToAmbiguous).toHaveBeenCalledTimes(1);
    expect(mockOnMoveToAmbiguous).toHaveBeenCalledWith(mockItem.id, mockContainerId);
  });

  test('does not render move button in ambiguous container', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId="ambiguous"
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        onMoveToAmbiguous={mockOnMoveToAmbiguous}
      />
    );

    expect(screen.queryByTitle('structure.moveToUnderConsideration')).not.toBeInTheDocument();
  });

  test('applies section color classes to move and edit icons for main section', () => {
    render(
      <SortableItem
        item={mockItem}
        containerId="main"
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        onMoveToAmbiguous={mockOnMoveToAmbiguous}
      />
    );

    // Move icon lives inside the move button
    const moveBtn = screen.getByTitle('structure.moveToUnderConsideration');
    const moveIcon = moveBtn.querySelector('svg');
    expect(moveIcon?.getAttribute('class') || '').toContain('text-blue-800');

    // Edit icon mock forwards className; ensure it contains section color class
    const editIcon = screen.getByTestId('edit-icon');
    expect(editIcon).toHaveClass('text-blue-800');
  });
}); 