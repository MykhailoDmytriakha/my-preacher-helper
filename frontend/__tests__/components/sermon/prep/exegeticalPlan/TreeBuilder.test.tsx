import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@locales/i18n', () => ({}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'wizard.steps.exegeticalPlan.builder.title': 'Exegetical Plan Builder',
        'wizard.steps.exegeticalPlan.builder.addMainPoint': 'Add main point',
        'wizard.steps.exegeticalPlan.builder.empty': 'No points yet. Start by adding a main point.',
        'wizard.steps.exegeticalPlan.builder.tooltips.addMain': 'Add the first main point',
        'wizard.steps.exegeticalPlan.builder.placeholder': 'Enter point title...',
        'wizard.steps.exegeticalPlan.builder.tooltips.delete': 'Delete this point',
        'wizard.steps.exegeticalPlan.builder.tooltips.addChild': 'Add a subpoint',
        'wizard.steps.exegeticalPlan.builder.tooltips.addSibling': 'Add a sibling point',
        'buttons.save': 'Save',
        'buttons.saving': 'Saving...'
      };
      return translations[key] || key;
    }
  })
}));

import TreeBuilder from '@/components/sermon/prep/exegeticalPlan/TreeBuilder';
import type { ExegeticalPlanNode } from '@/models/models';

describe('TreeBuilder', () => {
  const mockOnTitleChange = jest.fn();
  const mockOnFocus = jest.fn();
  const mockOnBlur = jest.fn();
  const mockOnRemove = jest.fn();
  const mockOnAddChild = jest.fn();
  const mockOnAddSibling = jest.fn();
  const mockOnAddMainPoint = jest.fn();
  const mockOnSave = jest.fn();

  const defaultProps = {
    tree: [] as ExegeticalPlanNode[],
    draftTitles: {},
    focusedId: null,
    expand: {},
    hasUnsavedChanges: false,
    saving: false,
    onTitleChange: mockOnTitleChange,
    onFocus: mockOnFocus,
    onBlur: mockOnBlur,
    onRemove: mockOnRemove,
    onAddChild: mockOnAddChild,
    onAddSibling: mockOnAddSibling,
    onAddMainPoint: mockOnAddMainPoint,
    onSave: mockOnSave
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering - Empty State', () => {
    it('renders title', () => {
      render(<TreeBuilder {...defaultProps} />);

      expect(screen.getByText('Exegetical Plan Builder')).toBeInTheDocument();
    });

    it('shows empty state message when tree is empty', () => {
      render(<TreeBuilder {...defaultProps} />);

      expect(screen.getByText('No points yet. Start by adding a main point.')).toBeInTheDocument();
    });

    it('shows add main point button in empty state', () => {
      render(<TreeBuilder {...defaultProps} />);

      const button = screen.getByText('Add main point');
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('title', 'Add the first main point');
    });

    it('does not show save button when tree is empty', () => {
      render(<TreeBuilder {...defaultProps} />);

      expect(screen.queryByText('Save')).not.toBeInTheDocument();
    });
  });

  describe('Rendering - With Nodes', () => {
    const treeWithNodes: ExegeticalPlanNode[] = [
      { id: 'node-1', title: 'Point 1', children: [] },
      { id: 'node-2', title: 'Point 2', children: [] }
    ];

    it('renders tree nodes', () => {
      render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
          draftTitles={{ 'node-1': 'Point 1', 'node-2': 'Point 2' }}
        />
      );

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      expect(inputs).toHaveLength(2);
    });

    it('shows save button when tree has nodes', () => {
      render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
        />
      );

      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    it('renders nested nodes', () => {
      const nestedTree: ExegeticalPlanNode[] = [
        {
          id: 'parent',
          title: 'Parent',
          children: [
            { id: 'child-1', title: 'Child 1', children: [] }
          ]
        }
      ];

      render(
        <TreeBuilder
          {...defaultProps}
          tree={nestedTree}
          expand={{ 'parent': true }}
          draftTitles={{ 'parent': 'Parent', 'child-1': 'Child 1' }}
        />
      );

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      expect(inputs).toHaveLength(2);
    });
  });

  describe('Save Button States', () => {
    const treeWithNodes: ExegeticalPlanNode[] = [
      { id: 'node-1', title: 'Point 1', children: [] }
    ];

    it('disables save button when no unsaved changes', () => {
      render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
          hasUnsavedChanges={false}
        />
      );

      const saveButton = screen.getByText('Save');
      expect(saveButton).toBeDisabled();
      expect(saveButton).toHaveClass('cursor-not-allowed');
    });

    it('enables save button when there are unsaved changes', () => {
      render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
          hasUnsavedChanges={true}
        />
      );

      const saveButton = screen.getByText('Save');
      expect(saveButton).not.toBeDisabled();
      expect(saveButton).toHaveClass('bg-blue-600', 'hover:bg-blue-700');
    });

    it('shows "Saving..." when saving is in progress', () => {
      render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
          hasUnsavedChanges={true}
          saving={true}
        />
      );

      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    it('disables save button while saving', () => {
      render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
          hasUnsavedChanges={true}
          saving={true}
        />
      );

      const saveButton = screen.getByText('Saving...');
      expect(saveButton).toBeDisabled();
    });

    it('applies disabled styles when no changes', () => {
      render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
          hasUnsavedChanges={false}
        />
      );

      const saveButton = screen.getByText('Save');
      expect(saveButton).toHaveClass('bg-gray-100', 'dark:bg-gray-800');
      expect(saveButton).toHaveClass('text-gray-400', 'dark:text-gray-500');
    });

    it('applies enabled styles when there are changes', () => {
      render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
          hasUnsavedChanges={true}
        />
      );

      const saveButton = screen.getByText('Save');
      expect(saveButton).toHaveClass('bg-blue-600', 'hover:bg-blue-700');
      expect(saveButton).toHaveClass('text-white');
    });
  });

  describe('User Interactions', () => {
    it('calls onAddMainPoint when add button is clicked in empty state', () => {
      render(<TreeBuilder {...defaultProps} />);

      const addButton = screen.getByText('Add main point');
      fireEvent.click(addButton);

      expect(mockOnAddMainPoint).toHaveBeenCalledTimes(1);
    });

    it('calls onSave when save button is clicked', () => {
      const treeWithNodes: ExegeticalPlanNode[] = [
        { id: 'node-1', title: 'Point 1', children: [] }
      ];

      render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
          hasUnsavedChanges={true}
        />
      );

      const saveButton = screen.getByText('Save');
      fireEvent.click(saveButton);

      expect(mockOnSave).toHaveBeenCalledTimes(1);
    });

    it('does not call onSave when button is disabled', () => {
      const treeWithNodes: ExegeticalPlanNode[] = [
        { id: 'node-1', title: 'Point 1', children: [] }
      ];

      render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
          hasUnsavedChanges={false}
        />
      );

      const saveButton = screen.getByText('Save');
      fireEvent.click(saveButton);

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('passes all props to TreeNode components', () => {
      const treeWithNodes: ExegeticalPlanNode[] = [
        { id: 'node-1', title: 'Point 1', children: [] }
      ];

      render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
          draftTitles={{ 'node-1': 'Draft Title' }}
          focusedId="node-1"
        />
      );

      const input = screen.getByPlaceholderText('Enter point title...') as HTMLInputElement;
      expect(input.value).toBe('Draft Title');
      expect(input).toHaveFocus();
    });
  });

  describe('Visual Indicators', () => {
    it('renders connecting lines between root siblings', () => {
      const treeWithNodes: ExegeticalPlanNode[] = [
        { id: 'node-1', title: 'Point 1', children: [] },
        { id: 'node-2', title: 'Point 2', children: [] }
      ];

      const { container } = render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
        />
      );

      const verticalLines = container.querySelectorAll('.bg-blue-400.dark\\:bg-blue-500');
      expect(verticalLines.length).toBeGreaterThan(0);
    });

    it('does not render connecting line after last sibling', () => {
      const treeWithNodes: ExegeticalPlanNode[] = [
        { id: 'node-1', title: 'Point 1', children: [] }
      ];

      const { container } = render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
        />
      );

      const allDivs = container.querySelectorAll('div.relative > div');
      const lastNodeDiv = allDivs[allDivs.length - 1];
      const verticalLine = lastNodeDiv?.querySelector('.absolute.left-0.top-10.bottom-\\[-4px\\]');
      
      expect(verticalLine).toBeFalsy();
    });
  });

  describe('Edge Cases', () => {
    it('handles null tree gracefully', () => {
      render(
        <TreeBuilder
          {...defaultProps}
          tree={null as any}
        />
      );

      expect(screen.getByText('No points yet. Start by adding a main point.')).toBeInTheDocument();
    });

    it('handles undefined tree gracefully', () => {
      render(
        <TreeBuilder
          {...defaultProps}
          tree={undefined as any}
        />
      );

      expect(screen.getByText('No points yet. Start by adding a main point.')).toBeInTheDocument();
    });

    it('handles large number of nodes', () => {
      const largeTree: ExegeticalPlanNode[] = Array.from({ length: 20 }, (_, i) => ({
        id: `node-${i}`,
        title: `Point ${i}`,
        children: []
      }));

      const draftTitles = largeTree.reduce((acc, node) => ({
        ...acc,
        [node.id]: node.title
      }), {});

      render(
        <TreeBuilder
          {...defaultProps}
          tree={largeTree}
          draftTitles={draftTitles}
        />
      );

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      expect(inputs).toHaveLength(20);
    });

    it('handles deeply nested tree structure', () => {
      const deepTree: ExegeticalPlanNode[] = [
        {
          id: 'level-1',
          title: 'Level 1',
          children: [
            {
              id: 'level-2',
              title: 'Level 2',
              children: [
                {
                  id: 'level-3',
                  title: 'Level 3',
                  children: []
                }
              ]
            }
          ]
        }
      ];

      const expand = { 'level-1': true, 'level-2': true };
      const draftTitles = {
        'level-1': 'Level 1',
        'level-2': 'Level 2',
        'level-3': 'Level 3'
      };

      render(
        <TreeBuilder
          {...defaultProps}
          tree={deepTree}
          expand={expand}
          draftTitles={draftTitles}
        />
      );

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      expect(inputs).toHaveLength(3);
    });
  });

  describe('Accessibility', () => {
    it('has proper heading structure', () => {
      render(<TreeBuilder {...defaultProps} />);

      const heading = screen.getByText('Exegetical Plan Builder').closest('h5');
      expect(heading).toBeInTheDocument();
    });

    it('save button is rendered as button element', () => {
      const treeWithNodes: ExegeticalPlanNode[] = [
        { id: 'node-1', title: 'Point 1', children: [] }
      ];

      render(
        <TreeBuilder
          {...defaultProps}
          tree={treeWithNodes}
        />
      );

      const saveButton = screen.getByText('Save');
      expect(saveButton.tagName).toBe('BUTTON');
    });

    it('add main point button has proper attributes', () => {
      render(<TreeBuilder {...defaultProps} />);

      const addButton = screen.getByText('Add main point');
      expect(addButton).toHaveAttribute('title', 'Add the first main point');
    });
  });
});
