import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@locales/i18n', () => ({}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'wizard.steps.exegeticalPlan.builder.placeholder': 'Enter point title...',
        'wizard.steps.exegeticalPlan.builder.tooltips.delete': 'Delete this point',
        'wizard.steps.exegeticalPlan.builder.tooltips.addChild': 'Add a subpoint',
        'wizard.steps.exegeticalPlan.builder.tooltips.addSibling': 'Add a sibling point'
      };
      return translations[key] || key;
    }
  })
}));

import TreeNode from '@/components/sermon/prep/exegeticalPlan/TreeNode';
import type { ExegeticalPlanNode } from '@/models/models';

describe('TreeNode', () => {
  const mockOnTitleChange = jest.fn();
  const mockOnFocus = jest.fn();
  const mockOnBlur = jest.fn();
  const mockOnRemove = jest.fn();
  const mockOnAddChild = jest.fn();
  const mockOnAddSibling = jest.fn();

  const baseNode: ExegeticalPlanNode = {
    id: 'node-1',
    title: 'Test Node',
    children: []
  };

  const defaultProps = {
    node: baseNode,
    depth: 0,
    index: 0,
    draftTitles: {},
    focusedId: null,
    onTitleChange: mockOnTitleChange,
    onFocus: mockOnFocus,
    onBlur: mockOnBlur,
    onRemove: mockOnRemove,
    onAddChild: mockOnAddChild,
    onAddSibling: mockOnAddSibling,
    expand: {}
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders with node title', () => {
      render(<TreeNode {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter point title...') as HTMLInputElement;
      expect(input.value).toBe('Test Node');
    });

    it('renders with draft title when available', () => {
      const draftTitles = { 'node-1': 'Draft Title' };
      render(<TreeNode {...defaultProps} draftTitles={draftTitles} />);

      const input = screen.getByPlaceholderText('Enter point title...') as HTMLInputElement;
      expect(input.value).toBe('Draft Title');
    });

    it('renders marker for root level nodes (depth 0)', () => {
      render(<TreeNode {...defaultProps} depth={0} index={0} />);
      expect(screen.getByText('1.')).toBeInTheDocument();
    });

    it('renders alphabetic marker for depth 1 nodes', () => {
      render(<TreeNode {...defaultProps} depth={1} index={0} />);
      expect(screen.getByText('a.')).toBeInTheDocument();

      render(<TreeNode {...defaultProps} depth={1} index={1} />);
      expect(screen.getByText('b.')).toBeInTheDocument();
    });

    it('renders dash marker for depth 2 nodes', () => {
      render(<TreeNode {...defaultProps} depth={2} index={0} />);
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('renders no marker for depth 3+ nodes', () => {
      const { container } = render(<TreeNode {...defaultProps} depth={3} index={0} />);
      
      const markers = container.querySelectorAll('.pointer-events-none');
      expect(markers.length).toBe(0);
    });

    it('renders action buttons', () => {
      render(<TreeNode {...defaultProps} />);

      expect(screen.getByLabelText('delete')).toBeInTheDocument();
      expect(screen.getByLabelText('add child')).toBeInTheDocument();
      expect(screen.getByLabelText('add sibling')).toBeInTheDocument();
    });
  });

  describe('User Interactions - Input', () => {
    it('calls onTitleChange when input value changes', () => {
      render(<TreeNode {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      fireEvent.change(input, { target: { value: 'New Title' } });

      expect(mockOnTitleChange).toHaveBeenCalledWith('node-1', 'New Title');
    });

    it('calls onFocus when input is focused', () => {
      render(<TreeNode {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      fireEvent.focus(input);

      expect(mockOnFocus).toHaveBeenCalledWith('node-1');
    });

    it('calls onBlur when input loses focus', () => {
      render(<TreeNode {...defaultProps} focusedId="node-1" />);

      const input = screen.getByPlaceholderText('Enter point title...');
      fireEvent.blur(input);

      expect(mockOnBlur).toHaveBeenCalledWith('node-1');
    });

    it('does not call onBlur when node is not focused', () => {
      render(<TreeNode {...defaultProps} focusedId="other-node" />);

      const input = screen.getByPlaceholderText('Enter point title...');
      fireEvent.blur(input);

      expect(mockOnBlur).not.toHaveBeenCalled();
    });
  });

  describe('User Interactions - Keyboard Shortcuts', () => {
    it('calls onAddSibling when Enter is pressed', () => {
      render(<TreeNode {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockOnAddSibling).toHaveBeenCalledWith('node-1');
    });

    it('calls onAddChild when Cmd+Enter is pressed', () => {
      render(<TreeNode {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

      expect(mockOnAddChild).toHaveBeenCalledWith('node-1');
    });

    it('calls onAddChild when Ctrl+Enter is pressed', () => {
      render(<TreeNode {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });

      expect(mockOnAddChild).toHaveBeenCalledWith('node-1');
    });

    it('prevents default behavior on Enter key', () => {
      render(<TreeNode {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      const preventDefaultSpy = jest.spyOn(event, 'preventDefault');
      
      input.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('User Interactions - Buttons', () => {
    it('calls onRemove when delete button is clicked', () => {
      render(<TreeNode {...defaultProps} />);

      const deleteButton = screen.getByLabelText('delete');
      fireEvent.click(deleteButton);

      expect(mockOnRemove).toHaveBeenCalledWith('node-1');
    });

    it('calls onAddChild when add child button is clicked', () => {
      render(<TreeNode {...defaultProps} />);

      const addChildButton = screen.getByLabelText('add child');
      fireEvent.click(addChildButton);

      expect(mockOnAddChild).toHaveBeenCalledWith('node-1');
    });

    it('calls onAddSibling when add sibling button is clicked', () => {
      render(<TreeNode {...defaultProps} />);

      const addSiblingButton = screen.getByLabelText('add sibling');
      fireEvent.click(addSiblingButton);

      expect(mockOnAddSibling).toHaveBeenCalledWith('node-1');
    });
  });

  describe('Children Rendering', () => {
    const testCases = [
      {
        name: 'renders child nodes when expanded',
        expand: { 'parent': true },
        expectedInputs: 3
      },
      {
        name: 'does not render children when collapsed',
        expand: { 'parent': false },
        expectedInputs: 1
      },
      {
        name: 'renders children by default when expand state not provided',
        expand: {},
        expectedInputs: 3
      }
    ];

    testCases.forEach(({ name, expand, expectedInputs }) => {
      it(name, () => {
        const nodeWithChildren: ExegeticalPlanNode = {
          id: 'parent',
          title: 'Parent',
          children: [
            { id: 'child-1', title: 'Child 1', children: [] },
            { id: 'child-2', title: 'Child 2', children: [] }
          ]
        };

        const draftTitles = { 'parent': 'Parent', 'child-1': 'Child 1', 'child-2': 'Child 2' };

        render(
          <TreeNode
            {...defaultProps}
            node={nodeWithChildren}
            expand={expand}
            draftTitles={draftTitles}
          />
        );

        const inputs = screen.getAllByPlaceholderText('Enter point title...');
        expect(inputs).toHaveLength(expectedInputs);
      });
    });
  });

  describe('Focus Management', () => {
    it('auto-focuses input when focusedId matches node id', () => {
      render(<TreeNode {...defaultProps} focusedId="node-1" />);

      const input = screen.getByPlaceholderText('Enter point title...');
      expect(input).toHaveFocus();
    });

    it('does not auto-focus when focusedId does not match', () => {
      render(<TreeNode {...defaultProps} focusedId="other-node" />);

      const input = screen.getByPlaceholderText('Enter point title...');
      expect(input).not.toHaveFocus();
    });

    it('applies focused styling when node is focused', () => {
      render(<TreeNode {...defaultProps} focusedId="node-1" />);

      const input = screen.getByPlaceholderText('Enter point title...');
      expect(input).toHaveClass('border-blue-500', 'dark:border-blue-400');
    });

    it('applies default styling when node is not focused', () => {
      render(<TreeNode {...defaultProps} focusedId={null} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      expect(input).toHaveClass('border-gray-200', 'dark:border-gray-700');
    });
  });

  describe('Accessibility', () => {
    it('has proper aria-label for delete button', () => {
      render(<TreeNode {...defaultProps} />);

      const deleteButton = screen.getByLabelText('delete');
      expect(deleteButton).toHaveAttribute('aria-label', 'delete');
    });

    it('has proper title attributes for buttons', () => {
      render(<TreeNode {...defaultProps} />);

      const deleteButton = screen.getByLabelText('delete');
      const addChildButton = screen.getByLabelText('add child');
      const addSiblingButton = screen.getByLabelText('add sibling');

      expect(deleteButton).toHaveAttribute('title', 'Delete this point');
      expect(addChildButton).toHaveAttribute('title', 'Add a subpoint (⌘+Enter)');
      expect(addSiblingButton).toHaveAttribute('title', 'Add a sibling point (Enter)');
    });

    it('has proper placeholder text', () => {
      render(<TreeNode {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      expect(input).toBeInTheDocument();
    });
  });

  describe('Styling and Layout', () => {
    it('applies correct indentation for nested nodes', () => {
      const { container } = render(<TreeNode {...defaultProps} depth={1} />);

      const nodeContainer = container.firstChild as HTMLElement;
      expect(nodeContainer).toHaveStyle({ marginLeft: '20px' });
    });

    it('has no left margin for root nodes', () => {
      const { container } = render(<TreeNode {...defaultProps} depth={0} />);

      const nodeContainer = container.firstChild as HTMLElement;
      expect(nodeContainer).toHaveStyle({ marginLeft: '0' });
    });

    it('applies proper padding to input with marker', () => {
      render(<TreeNode {...defaultProps} depth={0} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      expect(input).toHaveClass('pl-8');
    });

    it('applies proper padding to input without marker', () => {
      render(<TreeNode {...defaultProps} depth={3} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      expect(input).toHaveClass('pl-2.5');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty title gracefully', () => {
      const emptyNode: ExegeticalPlanNode = {
        id: 'empty',
        title: '',
        children: []
      };

      render(<TreeNode {...defaultProps} node={emptyNode} />);

      const input = screen.getByPlaceholderText('Enter point title...') as HTMLInputElement;
      expect(input.value).toBe('');
    });

    it('handles large index numbers for markers', () => {
      render(<TreeNode {...defaultProps} depth={0} index={99} />);
      expect(screen.getByText('100.')).toBeInTheDocument();
    });

    it('cycles through alphabet for depth 1 with large indices', () => {
      render(<TreeNode {...defaultProps} depth={1} index={26} />);
      expect(screen.getByText('a.')).toBeInTheDocument();
    });

    it('handles deeply nested structures', () => {
      const deepNode: ExegeticalPlanNode = {
        id: 'deep-parent',
        title: 'Deep Parent',
        children: [
          {
            id: 'deep-child',
            title: 'Deep Child',
            children: [
              { id: 'deep-grandchild', title: 'Deep Grandchild', children: [] }
            ]
          }
        ]
      };

      const expand = { 'deep-parent': true, 'deep-child': true };
      const draftTitles = {
        'deep-parent': 'Deep Parent',
        'deep-child': 'Deep Child',
        'deep-grandchild': 'Deep Grandchild'
      };

      render(
        <TreeNode
          {...defaultProps}
          node={deepNode}
          expand={expand}
          draftTitles={draftTitles}
        />
      );

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      expect(inputs).toHaveLength(3);
    });
  });
});
