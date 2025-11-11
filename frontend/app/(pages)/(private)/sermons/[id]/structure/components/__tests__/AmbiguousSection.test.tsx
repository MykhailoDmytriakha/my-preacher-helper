import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
    it('covers header, toggle, visibility toggles, and empty states in one pass', () => {
      const { rerender } = render(<AmbiguousSection {...defaultProps} />);
      expect(screen.getByText('Unassigned')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Hide Unassigned section/i })).toBeInTheDocument();
      expect(screen.getByTestId('sortable-item-thought-1')).toBeInTheDocument();
      expect(screen.getByTestId('sortable-item-thought-2')).toBeInTheDocument();

      rerender(<AmbiguousSection {...defaultProps} isVisible={false} />);
      expect(screen.queryByTestId('sortable-item-thought-1')).not.toBeInTheDocument();

      cleanup();
      render(<AmbiguousSection {...defaultProps} items={[]} />);
      expect(screen.getByText('structure.dropToAmbiguous')).toBeInTheDocument();

      cleanup();
      render(<AmbiguousSection {...defaultProps} items={undefined as any} />);
      expect(screen.getByText('structure.dropToAmbiguous')).toBeInTheDocument();
    });
  });

  describe('visibility toggle', () => {
    it('handles click callbacks and label updates', () => {
      const mockOnToggleVisibility = jest.fn();
      const { rerender } = render(<AmbiguousSection {...defaultProps} onToggleVisibility={mockOnToggleVisibility} />);
      fireEvent.click(screen.getByRole('button', { name: /Hide Unassigned section/i }));
      expect(mockOnToggleVisibility).toHaveBeenCalledTimes(1);

      rerender(<AmbiguousSection {...defaultProps} isVisible={false} />);
      expect(screen.getByRole('button', { name: /Show Unassigned section/i })).toBeInTheDocument();
    });
  });

  describe('item interactions', () => {
    it('invokes edit/delete callbacks for each item including rapid clicks', () => {
      const mockOnEdit = jest.fn();
      const mockOnDelete = jest.fn();
      render(<AmbiguousSection {...defaultProps} onEdit={mockOnEdit} onDelete={mockOnDelete} />);

      mockItems.forEach((item) => {
        fireEvent.click(screen.getByTestId(`edit-${item.id}`));
        fireEvent.click(screen.getByTestId(`delete-${item.id}`));
      });

      expect(mockOnEdit).toHaveBeenCalledTimes(mockItems.length);
      expect(mockOnDelete).toHaveBeenCalledTimes(mockItems.length);

      const editButton = screen.getByTestId('edit-thought-1');
      fireEvent.click(editButton);
      fireEvent.click(editButton);
      fireEvent.click(editButton);
      expect(mockOnEdit).toHaveBeenCalledWith(mockItems[0]);
    });
  });

  describe('item content display', () => {
    it('renders standard, long, and special character content', () => {
      render(<AmbiguousSection {...defaultProps} />);
      expect(screen.getByText('Test thought 1')).toBeInTheDocument();

      const longContentItems: Item[] = [{ id: 'thought-long', content: 'A'.repeat(1000), requiredTags: [], customTagNames: [] }];
      render(<AmbiguousSection {...defaultProps} items={longContentItems} />);
      expect(screen.getByText('A'.repeat(1000))).toBeInTheDocument();

      const specialCharItems: Item[] = [
        { id: 'thought-special', content: 'Test with special chars: !@#$%^&*()_+-=[]{}|;:,.<>?', requiredTags: [], customTagNames: [] },
      ];
      render(<AmbiguousSection {...defaultProps} items={specialCharItems} />);
      expect(screen.getByText('Test with special chars: !@#$%^&*()_+-=[]{}|;:,.<>?')).toBeInTheDocument();

      render(
        <AmbiguousSection
          {...defaultProps}
          items={[{ id: 'thought-html', content: '<script>alert("test")</script>', requiredTags: [], customTagNames: [] }]}
        />,
      );
      expect(screen.getByText('<script>alert("test")</script>')).toBeInTheDocument();
    });
  });

  describe('empty state handling', () => {
    it('shows placeholder for empty, null, or undefined items', () => {
      [[], null, undefined].forEach((items) => {
        cleanup();
        render(<AmbiguousSection {...defaultProps} items={items as any} />);
        expect(screen.getByText('structure.dropToAmbiguous')).toBeInTheDocument();
      });
    });
  });

  describe('edge cases', () => {
    it('handles missing properties and large datasets without crashing', () => {
      const variants: Item[][] = [
        [{ content: 'Test thought', requiredTags: [], customTagNames: [] } as any],
        [{ id: 'thought-1', requiredTags: [], customTagNames: [] } as any],
        [{ id: 'thought-1', content: null, requiredTags: [], customTagNames: [] } as any],
        [{ id: 'thought-1', content: undefined, requiredTags: [], customTagNames: [] } as any],
        Array.from({ length: 1000 }, (_, i) => ({
          id: `thought-${i}`,
          content: `Test thought ${i}`,
          requiredTags: [],
          customTagNames: [],
        })),
      ];

      variants.forEach((items) => {
        expect(() => render(<AmbiguousSection {...defaultProps} items={items} />)).not.toThrow();
      });
    });
  });

  describe('accessibility', () => {
    it('exposes button labels and data attributes expected by tests', () => {
      render(<AmbiguousSection {...defaultProps} />);
      expect(screen.getByRole('button', { name: /Hide Unassigned section/i })).toBeInTheDocument();
      expect(screen.getByTestId('sortable-item-thought-1')).toBeInTheDocument();
      expect(screen.getByTestId('edit-thought-1')).toBeInTheDocument();
      expect(screen.getByTestId('delete-thought-1')).toBeInTheDocument();
    });
  });

  describe('styling and layout', () => {
    it('renders container structure and header layout once', () => {
      render(<AmbiguousSection {...defaultProps} />);
      const container = screen.getByText('Unassigned').closest('div');
      expect(container).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Hide Unassigned section/i })).toBeInTheDocument();
    });
  });

  describe('translation integration', () => {
    it('falls back to translation keys when necessary', () => {
      render(<AmbiguousSection {...defaultProps} items={[]} />);
      expect(screen.getByText('structure.dropToAmbiguous')).toBeInTheDocument();
    });
  });

  describe('interaction behavior', () => {
    it('gracefully handles rapid toggle/edit/delete interactions', () => {
      const mockOnToggleVisibility = jest.fn();
      const mockOnEdit = jest.fn();
      const mockOnDelete = jest.fn();
      render(
        <AmbiguousSection {...defaultProps} onToggleVisibility={mockOnToggleVisibility} onEdit={mockOnEdit} onDelete={mockOnDelete} />,
      );

      const toggleButton = screen.getByRole('button', { name: /Hide Unassigned section/i });
      const editButton = screen.getByTestId('edit-thought-1');
      const deleteButton = screen.getByTestId('delete-thought-1');

      [toggleButton, editButton, deleteButton].forEach((button) => {
        fireEvent.click(button);
        fireEvent.click(button);
        fireEvent.click(button);
      });

      expect(mockOnToggleVisibility).toHaveBeenCalledTimes(3);
      expect(mockOnEdit).toHaveBeenCalledTimes(3);
      expect(mockOnDelete).toHaveBeenCalledTimes(3);
    });
  });

  describe('performance considerations', () => {
    it('re-renders stably and handles large content', () => {
      const { rerender } = render(<AmbiguousSection {...defaultProps} />);
      const initialRender = screen.getByText('Unassigned');
      rerender(<AmbiguousSection {...defaultProps} />);
      expect(screen.getByText('Unassigned')).toBe(initialRender);

      const longContentItems: Item[] = [{ id: 'thought-long', content: 'A'.repeat(10000), requiredTags: [], customTagNames: [] }];
      expect(() => render(<AmbiguousSection {...defaultProps} items={longContentItems} />)).not.toThrow();
    });
  });

  describe('error boundaries', () => {
    it('does not crash when item data is missing or malformed', () => {
      const cases: Item[][] = [
        [{ id: 'thought-1' } as any],
        [{ id: null, content: undefined } as any],
      ];
      cases.forEach((items) => {
        expect(() => render(<AmbiguousSection {...defaultProps} items={items} />)).not.toThrow();
      });
    });
  });
});
