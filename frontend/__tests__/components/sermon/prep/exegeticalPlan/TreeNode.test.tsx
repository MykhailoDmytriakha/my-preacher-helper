import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
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
  const mockOnPromote = jest.fn();
  const mockOnDemote = jest.fn();

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
    onPromote: mockOnPromote,
    onDemote: mockOnDemote,
    expand: {}
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('covers titles, markers, and action buttons in one flow', () => {
      render(<TreeNode {...defaultProps} />);
      let input = screen.getByPlaceholderText('Enter point title...') as HTMLInputElement;
      expect(input.value).toBe('Test Node');
      expect(screen.getByLabelText('delete')).toBeInTheDocument();
      expect(screen.getByLabelText('add child')).toBeInTheDocument();
      expect(screen.getByLabelText('add sibling')).toBeInTheDocument();

      const draftTitles = { 'node-1': 'Draft Title' };
      cleanup();
      render(<TreeNode {...defaultProps} draftTitles={draftTitles} />);
      input = screen.getByPlaceholderText('Enter point title...') as HTMLInputElement;
      expect(input.value).toBe('Draft Title');

      cleanup();
      render(<TreeNode {...defaultProps} depth={0} index={0} />);
      expect(screen.getByText('1.')).toBeInTheDocument();

      cleanup();
      render(<TreeNode {...defaultProps} depth={1} index={0} />);
      expect(screen.getByText('a.')).toBeInTheDocument();
      cleanup();
      render(<TreeNode {...defaultProps} depth={1} index={1} />);
      expect(screen.getByText('b.')).toBeInTheDocument();

      cleanup();
      render(<TreeNode {...defaultProps} depth={2} index={0} />);
      expect(screen.getByText('—')).toBeInTheDocument();

      const { container } = render(<TreeNode {...defaultProps} depth={3} index={0} />);
      expect(container.querySelectorAll('.pointer-events-none')).toHaveLength(0);
    });
  });

  describe('User Interactions - Input', () => {
    it('covers typing, focus, and blur combinations', () => {
      render(<TreeNode {...defaultProps} />);
      const input = screen.getByPlaceholderText('Enter point title...');
      fireEvent.change(input, { target: { value: 'New Title' } });
      expect(mockOnTitleChange).toHaveBeenCalledWith('node-1', 'New Title');

      fireEvent.focus(input);
      expect(mockOnFocus).toHaveBeenCalledWith('node-1');

      cleanup();
      render(<TreeNode {...defaultProps} focusedId="node-1" />);
      fireEvent.blur(screen.getByPlaceholderText('Enter point title...'));
      expect(mockOnBlur).toHaveBeenCalledWith('node-1');

      jest.clearAllMocks();
      cleanup();
      render(<TreeNode {...defaultProps} focusedId="other-node" />);
      fireEvent.blur(screen.getByPlaceholderText('Enter point title...'));
      expect(mockOnBlur).not.toHaveBeenCalled();
    });
  });

  describe('User Interactions - Keyboard Shortcuts', () => {
    it('supports sibling/child shortcuts and prevents default behavior', () => {
      render(<TreeNode {...defaultProps} />);
      const input = screen.getByPlaceholderText('Enter point title...');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(mockOnAddSibling).toHaveBeenCalledWith('node-1');

      jest.clearAllMocks();
      fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
      expect(mockOnAddChild).toHaveBeenCalledTimes(2);

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      const preventDefaultSpy = jest.spyOn(event, 'preventDefault');
      input.dispatchEvent(event);
      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('User Interactions - Buttons', () => {
    it('invokes callbacks for toolbar buttons', () => {
      render(<TreeNode {...defaultProps} />);
      fireEvent.click(screen.getByLabelText('delete'));
      expect(mockOnRemove).toHaveBeenCalledWith('node-1');

      fireEvent.click(screen.getByLabelText('add child'));
      expect(mockOnAddChild).toHaveBeenCalledWith('node-1');

      fireEvent.click(screen.getByLabelText('add sibling'));
      expect(mockOnAddSibling).toHaveBeenCalledWith('node-1');
    });
  });

  describe('Children Rendering', () => {
    it('responds to expand props when rendering children', () => {
      const nodeWithChildren: ExegeticalPlanNode = {
        id: 'parent',
        title: 'Parent',
        children: [
          { id: 'child-1', title: 'Child 1', children: [] },
          { id: 'child-2', title: 'Child 2', children: [] },
        ],
      };
      const draftTitles = { parent: 'Parent', 'child-1': 'Child 1', 'child-2': 'Child 2' };

      render(<TreeNode {...defaultProps} node={nodeWithChildren} expand={{ parent: true }} draftTitles={draftTitles} />);
      expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(3);

      cleanup();
      render(<TreeNode {...defaultProps} node={nodeWithChildren} expand={{ parent: false }} draftTitles={draftTitles} />);
      expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(1);

      cleanup();
      render(<TreeNode {...defaultProps} node={nodeWithChildren} expand={{}} draftTitles={draftTitles} />);
      expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(3);
    });
  });

  describe('Focus Management', () => {
    it('updates focus and styling based on focusedId', () => {
      render(<TreeNode {...defaultProps} focusedId="node-1" />);
      let input = screen.getByPlaceholderText('Enter point title...');
      expect(input).toHaveFocus();
      expect(input).toHaveClass('border-blue-500', 'dark:border-blue-400');

      cleanup();
      render(<TreeNode {...defaultProps} focusedId="other-node" />);
      input = screen.getByPlaceholderText('Enter point title...');
      expect(input).not.toHaveFocus();
      expect(input).toHaveClass('border-gray-200', 'dark:border-gray-700');
    });
  });

  describe('Accessibility', () => {
    it('exposes aria labels, titles, and placeholders', () => {
      render(<TreeNode {...defaultProps} />);
      const deleteButton = screen.getByLabelText('delete');
      expect(deleteButton).toHaveAttribute('aria-label', 'delete');
      expect(deleteButton).toHaveAttribute('title', 'Delete this point');
      expect(screen.getByLabelText('add child')).toHaveAttribute('title', 'Add a subpoint (⌘+Enter)');
      expect(screen.getByLabelText('add sibling')).toHaveAttribute('title', 'Add a sibling point (Enter)');
      expect(screen.getByPlaceholderText('Enter point title...')).toBeInTheDocument();
    });
  });

  describe('Styling and Layout', () => {
    it('adjusts indentation and padding according to depth', () => {
      let view = render(<TreeNode {...defaultProps} depth={1} />);
      let nodeContainer = view.container.firstChild as HTMLElement;
      expect(nodeContainer).toHaveStyle({ marginLeft: '20px' });
      expect(screen.getByPlaceholderText('Enter point title...')).toHaveClass('pl-8');

      cleanup();
      view = render(<TreeNode {...defaultProps} depth={0} />);
      nodeContainer = view.container.firstChild as HTMLElement;
      expect(nodeContainer).toHaveStyle({ marginLeft: '0' });

      cleanup();
      render(<TreeNode {...defaultProps} depth={3} />);
      expect(screen.getByPlaceholderText('Enter point title...')).toHaveClass('pl-2.5');
    });
  });

  describe('Edge Cases', () => {
    it('covers empty titles, large indices, and deeply nested structures', () => {
      const emptyNode: ExegeticalPlanNode = { id: 'empty', title: '', children: [] };
      render(<TreeNode {...defaultProps} node={emptyNode} />);
      expect((screen.getByPlaceholderText('Enter point title...') as HTMLInputElement).value).toBe('');

      cleanup();
      render(<TreeNode {...defaultProps} depth={0} index={99} />);
      expect(screen.getByText('100.')).toBeInTheDocument();

      cleanup();
      render(<TreeNode {...defaultProps} depth={1} index={26} />);
      expect(screen.getByText('a.')).toBeInTheDocument();

      const deepNode: ExegeticalPlanNode = {
        id: 'deep-parent',
        title: 'Deep Parent',
        children: [
          {
            id: 'deep-child',
            title: 'Deep Child',
            children: [{ id: 'deep-grandchild', title: 'Deep Grandchild', children: [] }],
          },
        ],
      };
      cleanup();
      const expand = { 'deep-parent': true, 'deep-child': true };
      const draftTitles = {
        'deep-parent': 'Deep Parent',
        'deep-child': 'Deep Child',
        'deep-grandchild': 'Deep Grandchild',
      };
      render(<TreeNode {...defaultProps} node={deepNode} expand={expand} draftTitles={draftTitles} />);
      expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(3);
    });
  });
});
