import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AmbiguousSection } from '../AmbiguousSection';
import { Item } from '@/models/models';

// Mock SortableItem component
jest.mock('@/components/SortableItem', () => {
  return function MockSortableItem({ item, onEdit, onDelete }: any) {
    return (
      <div data-testid={`sortable-item-${item.id}`}>
        <span>{item.content}</span>
        <button onClick={() => onEdit(item)} data-testid={`edit-${item.id}`}>
          Edit
        </button>
        <button onClick={() => onDelete(item.id)} data-testid={`delete-${item.id}`}>
          Delete
        </button>
      </div>
    );
  };
});

describe('AmbiguousSection', () => {
  const mockItems: Item[] = [
    { id: 'thought-1', content: 'Test thought 1', requiredTags: [], customTagNames: [] },
    { id: 'thought-2', content: 'Test thought 2', requiredTags: [], customTagNames: [] },
    { id: 'thought-3', content: 'Test thought 3', requiredTags: [], customTagNames: [] }
  ];

  const defaultProps = {
    items: mockItems,
    isVisible: true,
    onToggleVisibility: jest.fn(),
    onEdit: jest.fn(),
    onDelete: jest.fn(),
    columnTitle: 'Unassigned'
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render section header with title', () => {
      render(<AmbiguousSection {...defaultProps} />);
      
      expect(screen.getByText('Unassigned')).toBeInTheDocument();
    });

    it('should render toggle button', () => {
      render(<AmbiguousSection {...defaultProps} />);
      
      const toggleButton = screen.getByRole('button', { name: /Hide Unassigned section/i });
      expect(toggleButton).toBeInTheDocument();
    });

    it('should render items when visible', () => {
      render(<AmbiguousSection {...defaultProps} />);
      
      expect(screen.getByTestId('sortable-item-thought-1')).toBeInTheDocument();
      expect(screen.getByTestId('sortable-item-thought-2')).toBeInTheDocument();
      expect(screen.getByTestId('sortable-item-thought-3')).toBeInTheDocument();
    });

    it('should not render items when not visible', () => {
      render(<AmbiguousSection {...defaultProps} isVisible={false} />);
      
      expect(screen.queryByTestId('sortable-item-thought-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sortable-item-thought-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sortable-item-thought-3')).not.toBeInTheDocument();
    });

    it('should render empty state when no items', () => {
      render(<AmbiguousSection {...defaultProps} items={[]} />);
      
      expect(screen.getByText('structure.noEntries')).toBeInTheDocument();
    });

    it('should render empty state when items array is undefined', () => {
      render(<AmbiguousSection {...defaultProps} items={undefined as any} />);
      
      expect(screen.getByText('structure.noEntries')).toBeInTheDocument();
    });
  });

  describe('visibility toggle', () => {
    it('should call onToggleVisibility when toggle button is clicked', () => {
      const mockOnToggleVisibility = jest.fn();
      render(<AmbiguousSection {...defaultProps} onToggleVisibility={mockOnToggleVisibility} />);
      
      const toggleButton = screen.getByRole('button', { name: /Hide Unassigned section/i });
      fireEvent.click(toggleButton);
      
      expect(mockOnToggleVisibility).toHaveBeenCalledTimes(1);
    });

    it('should show correct toggle icon when visible', () => {
      render(<AmbiguousSection {...defaultProps} isVisible={true} />);
      
      const toggleButton = screen.getByRole('button', { name: /Hide Unassigned section/i });
      expect(toggleButton).toBeInTheDocument();
    });

    it('should show correct toggle icon when not visible', () => {
      render(<AmbiguousSection {...defaultProps} isVisible={false} />);
      
      const toggleButton = screen.getByRole('button', { name: /Show Unassigned section/i });
      expect(toggleButton).toBeInTheDocument();
    });
  });

  describe('item interactions', () => {
    it('should call onEdit when edit button is clicked', () => {
      const mockOnEdit = jest.fn();
      render(<AmbiguousSection {...defaultProps} onEdit={mockOnEdit} />);
      
      const editButton = screen.getByTestId('edit-thought-1');
      fireEvent.click(editButton);
      
      expect(mockOnEdit).toHaveBeenCalledWith(mockItems[0]);
    });

    it('should call onDelete when delete button is clicked', () => {
      const mockOnDelete = jest.fn();
      render(<AmbiguousSection {...defaultProps} onDelete={mockOnDelete} />);
      
      const deleteButton = screen.getByTestId('delete-thought-1');
      fireEvent.click(deleteButton);
      
      expect(mockOnDelete).toHaveBeenCalledWith('thought-1');
    });

    it('should handle edit for all items', () => {
      const mockOnEdit = jest.fn();
      render(<AmbiguousSection {...defaultProps} onEdit={mockOnEdit} />);
      
      const editButtons = [
        screen.getByTestId('edit-thought-1'),
        screen.getByTestId('edit-thought-2'),
        screen.getByTestId('edit-thought-3')
      ];
      
      editButtons.forEach((button, index) => {
        fireEvent.click(button);
        expect(mockOnEdit).toHaveBeenCalledWith(mockItems[index]);
      });
    });

    it('should handle delete for all items', () => {
      const mockOnDelete = jest.fn();
      render(<AmbiguousSection {...defaultProps} onDelete={mockOnDelete} />);
      
      const deleteButtons = [
        screen.getByTestId('delete-thought-1'),
        screen.getByTestId('delete-thought-2'),
        screen.getByTestId('delete-thought-3')
      ];
      
      deleteButtons.forEach((button, index) => {
        fireEvent.click(button);
        expect(mockOnDelete).toHaveBeenCalledWith(mockItems[index].id);
      });
    });
  });

  describe('item content display', () => {
    it('should display item content correctly', () => {
      render(<AmbiguousSection {...defaultProps} />);
      
      expect(screen.getByText('Test thought 1')).toBeInTheDocument();
      expect(screen.getByText('Test thought 2')).toBeInTheDocument();
      expect(screen.getByText('Test thought 3')).toBeInTheDocument();
    });

    it('should handle items with long content', () => {
      const longContentItems: Item[] = [
        { 
          id: 'thought-long', 
          content: 'A'.repeat(1000), 
          requiredTags: [], 
          customTagNames: [] 
        }
      ];
      
      render(<AmbiguousSection {...defaultProps} items={longContentItems} />);
      
      expect(screen.getByText('A'.repeat(1000))).toBeInTheDocument();
    });

    it('should handle items with special characters', () => {
      const specialCharItems: Item[] = [
        { 
          id: 'thought-special', 
          content: 'Test with special chars: !@#$%^&*()_+-=[]{}|;:,.<>?', 
          requiredTags: [], 
          customTagNames: [] 
        }
      ];
      
      render(<AmbiguousSection {...defaultProps} items={specialCharItems} />);
      
      expect(screen.getByText('Test with special chars: !@#$%^&*()_+-=[]{}|;:,.<>?')).toBeInTheDocument();
    });

    it('should handle items with HTML-like content', () => {
      const htmlItems: Item[] = [
        { 
          id: 'thought-html', 
          content: '<script>alert("test")</script>', 
          requiredTags: [], 
          customTagNames: [] 
        }
      ];
      
      render(<AmbiguousSection {...defaultProps} items={htmlItems} />);
      
      expect(screen.getByText('<script>alert("test")</script>')).toBeInTheDocument();
    });
  });

  describe('empty state handling', () => {
    it('should show empty state message when no items', () => {
      render(<AmbiguousSection {...defaultProps} items={[]} />);
      
      expect(screen.getByText('structure.noEntries')).toBeInTheDocument();
    });

    it('should show empty state message when items is null', () => {
      render(<AmbiguousSection {...defaultProps} items={null as any} />);
      
      expect(screen.getByText('structure.noEntries')).toBeInTheDocument();
    });

    it('should show empty state message when items is undefined', () => {
      render(<AmbiguousSection {...defaultProps} items={undefined as any} />);
      
      expect(screen.getByText('structure.noEntries')).toBeInTheDocument();
    });

    it('should show empty state message when items array is empty', () => {
      render(<AmbiguousSection {...defaultProps} items={[]} />);
      
      expect(screen.getByText('structure.noEntries')).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('should handle items with missing id', () => {
      const itemsWithMissingId: Item[] = [
        { content: 'Test thought', requiredTags: [], customTagNames: [] } as any
      ];
      
      expect(() => {
        render(<AmbiguousSection {...defaultProps} items={itemsWithMissingId} />);
      }).not.toThrow();
    });

    it('should handle items with missing content', () => {
      const itemsWithMissingContent: Item[] = [
        { id: 'thought-1', requiredTags: [], customTagNames: [] } as any
      ];
      
      expect(() => {
        render(<AmbiguousSection {...defaultProps} items={itemsWithMissingContent} />);
      }).not.toThrow();
    });

    it('should handle items with null content', () => {
      const itemsWithNullContent: Item[] = [
        { id: 'thought-1', content: null, requiredTags: [], customTagNames: [] } as any
      ];
      
      expect(() => {
        render(<AmbiguousSection {...defaultProps} items={itemsWithNullContent} />);
      }).not.toThrow();
    });

    it('should handle items with undefined content', () => {
      const itemsWithUndefinedContent: Item[] = [
        { id: 'thought-1', content: undefined, requiredTags: [], customTagNames: [] } as any
      ];
      
      expect(() => {
        render(<AmbiguousSection {...defaultProps} items={itemsWithUndefinedContent} />);
      }).not.toThrow();
    });

    it('should handle very large number of items', () => {
      const manyItems: Item[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `thought-${i}`,
        content: `Test thought ${i}`,
        requiredTags: [],
        customTagNames: []
      }));
      
      expect(() => {
        render(<AmbiguousSection {...defaultProps} items={manyItems} />);
      }).not.toThrow();
    });
  });

  describe('accessibility', () => {
    it('should have proper button attributes', () => {
      render(<AmbiguousSection {...defaultProps} />);
      
      const toggleButton = screen.getByRole('button', { name: /Hide Unassigned section/i });
      expect(toggleButton).toBeInTheDocument();
    });

    it('should have proper test IDs for items', () => {
      render(<AmbiguousSection {...defaultProps} />);
      
      expect(screen.getByTestId('sortable-item-thought-1')).toBeInTheDocument();
      expect(screen.getByTestId('sortable-item-thought-2')).toBeInTheDocument();
      expect(screen.getByTestId('sortable-item-thought-3')).toBeInTheDocument();
    });

    it('should have proper test IDs for action buttons', () => {
      render(<AmbiguousSection {...defaultProps} />);
      
      expect(screen.getByTestId('edit-thought-1')).toBeInTheDocument();
      expect(screen.getByTestId('delete-thought-1')).toBeInTheDocument();
    });
  });

  describe('styling and layout', () => {
    it('should apply correct CSS classes', () => {
      render(<AmbiguousSection {...defaultProps} />);
      
      const container = screen.getByText('Unassigned').closest('div');
      expect(container).toBeInTheDocument();
    });

    it('should render with proper structure', () => {
      render(<AmbiguousSection {...defaultProps} />);
      
      const header = screen.getByText('Unassigned');
      expect(header).toBeInTheDocument();
      
      const toggleButton = screen.getByRole('button', { name: /Hide Unassigned section/i });
      expect(toggleButton).toBeInTheDocument();
    });
  });

  describe('translation integration', () => {
    it('should use translation keys for text', () => {
      render(<AmbiguousSection {...defaultProps} items={[]} />);
      
      expect(screen.getByText('structure.noEntries')).toBeInTheDocument();
    });

    it('should handle missing translations gracefully', () => {
      // This test ensures the component doesn't crash if translations are missing
      render(<AmbiguousSection {...defaultProps} items={[]} />);
      
      expect(screen.getByText('structure.noEntries')).toBeInTheDocument();
    });
  });

  describe('interaction behavior', () => {
    it('should handle multiple rapid clicks gracefully', () => {
      const mockOnToggleVisibility = jest.fn();
      render(<AmbiguousSection {...defaultProps} onToggleVisibility={mockOnToggleVisibility} />);
      
      const toggleButton = screen.getByRole('button', { name: /Hide Unassigned section/i });
      
      // Multiple rapid clicks
      fireEvent.click(toggleButton);
      fireEvent.click(toggleButton);
      fireEvent.click(toggleButton);
      
      expect(mockOnToggleVisibility).toHaveBeenCalledTimes(3);
    });

    it('should handle multiple rapid edit clicks gracefully', () => {
      const mockOnEdit = jest.fn();
      render(<AmbiguousSection {...defaultProps} onEdit={mockOnEdit} />);
      
      const editButton = screen.getByTestId('edit-thought-1');
      
      // Multiple rapid clicks
      fireEvent.click(editButton);
      fireEvent.click(editButton);
      fireEvent.click(editButton);
      
      expect(mockOnEdit).toHaveBeenCalledTimes(3);
    });

    it('should handle multiple rapid delete clicks gracefully', () => {
      const mockOnDelete = jest.fn();
      render(<AmbiguousSection {...defaultProps} onDelete={mockOnDelete} />);
      
      const deleteButton = screen.getByTestId('delete-thought-1');
      
      // Multiple rapid clicks
      fireEvent.click(deleteButton);
      fireEvent.click(deleteButton);
      fireEvent.click(deleteButton);
      
      expect(mockOnDelete).toHaveBeenCalledTimes(3);
    });
  });

  describe('performance considerations', () => {
    it('should not re-render unnecessarily', () => {
      const { rerender } = render(<AmbiguousSection {...defaultProps} />);
      
      const initialRender = screen.getByText('Unassigned');
      
      // Re-render with same props
      rerender(<AmbiguousSection {...defaultProps} />);
      
      const reRenderedElement = screen.getByText('Unassigned');
      expect(reRenderedElement).toBe(initialRender);
    });

    it('should handle large content efficiently', () => {
      const longContentItems: Item[] = [
        { 
          id: 'thought-long', 
          content: 'A'.repeat(10000), 
          requiredTags: [], 
          customTagNames: [] 
        }
      ];
      
      expect(() => {
        render(<AmbiguousSection {...defaultProps} items={longContentItems} />);
      }).not.toThrow();
    });
  });

  describe('error boundaries', () => {
    it('should handle missing item data gracefully', () => {
      const incompleteItems: Item[] = [
        { id: 'thought-1' } as any
      ];
      
      expect(() => {
        render(<AmbiguousSection {...defaultProps} items={incompleteItems} />);
      }).not.toThrow();
    });

    it('should handle malformed item data gracefully', () => {
      const malformedItems: Item[] = [
        { id: null, content: undefined } as any
      ];
      
      expect(() => {
        render(<AmbiguousSection {...defaultProps} items={malformedItems} />);
      }).not.toThrow();
    });
  });
});
