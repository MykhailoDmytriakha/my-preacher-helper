import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import { runScenarios } from '@test-utils/scenarioRunner';

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
    it('covers empty states via scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'renders header and empty message',
            run: () => {
              render(<TreeBuilder {...defaultProps} />);
              expect(screen.getByText('Exegetical Plan Builder')).toBeInTheDocument();
              expect(screen.getByText('No points yet. Start by adding a main point.')).toBeInTheDocument();
            }
          },
          {
            name: 'shows add main point button',
            run: () => {
              render(<TreeBuilder {...defaultProps} />);
              const button = screen.getByText('Add main point');
              expect(button).toHaveAttribute('title', 'Add the first main point');
            }
          },
          {
            name: 'hides save button without nodes',
            run: () => {
              render(<TreeBuilder {...defaultProps} />);
              expect(screen.queryByText('Save')).not.toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Rendering - With Nodes', () => {
    const treeWithNodes: ExegeticalPlanNode[] = [
      { id: 'node-1', title: 'Point 1', children: [] },
      { id: 'node-2', title: 'Point 2', children: [] }
    ];

    it('covers populated tree rendering', async () => {
      await runScenarios(
        [
          {
            name: 'renders multiple top-level nodes',
            run: () => {
              render(
                <TreeBuilder
                  {...defaultProps}
                  tree={treeWithNodes}
                  draftTitles={{ 'node-1': 'Point 1', 'node-2': 'Point 2' }}
                />
              );
              expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(2);
            }
          },
          {
            name: 'shows save button when nodes exist',
            run: () => {
              render(<TreeBuilder {...defaultProps} tree={treeWithNodes} />);
              expect(screen.getByText('Save')).toBeInTheDocument();
            }
          },
          {
            name: 'renders nested children when expanded',
            run: () => {
              const nestedTree: ExegeticalPlanNode[] = [
                { id: 'parent', title: 'Parent', children: [{ id: 'child-1', title: 'Child 1', children: [] }] }
              ];
              render(
                <TreeBuilder
                  {...defaultProps}
                  tree={nestedTree}
                  expand={{ parent: true }}
                  draftTitles={{ parent: 'Parent', 'child-1': 'Child 1' }}
                />
              );
              expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(2);
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Save Button States', () => {
    const treeWithNodes: ExegeticalPlanNode[] = [
      { id: 'node-1', title: 'Point 1', children: [] }
    ];

    it('summarizes save button behavior', async () => {
      await runScenarios(
        [
          {
            name: 'disabled when no changes',
            run: () => {
              render(<TreeBuilder {...defaultProps} tree={treeWithNodes} hasUnsavedChanges={false} />);
              const button = screen.getByText('Save');
              expect(button).toBeDisabled();
              expect(button).toHaveClass('cursor-not-allowed');
            }
          },
          {
            name: 'enabled when changes exist',
            run: () => {
              render(<TreeBuilder {...defaultProps} tree={treeWithNodes} hasUnsavedChanges={true} />);
              const button = screen.getByText('Save');
              expect(button).toBeEnabled();
              expect(button).toHaveClass('bg-blue-600');
            }
          },
          {
            name: 'shows saving indicators',
            run: () => {
              render(
                <TreeBuilder
                  {...defaultProps}
                  tree={treeWithNodes}
                  hasUnsavedChanges={true}
                  saving={true}
                />
              );
              const button = screen.getByText('Saving...');
              expect(button).toBeDisabled();
            }
          },
          {
            name: 'applies disabled/enabled color tokens',
            run: () => {
              render(<TreeBuilder {...defaultProps} tree={treeWithNodes} hasUnsavedChanges={false} />);
              expect(screen.getByText('Save')).toHaveClass('bg-gray-100');
              cleanup();
              render(<TreeBuilder {...defaultProps} tree={treeWithNodes} hasUnsavedChanges={true} />);
              expect(screen.getByText('Save')).toHaveClass('text-white');
            }
          }
        ],
        {
          afterEachScenario: () => {
            cleanup();
            jest.clearAllMocks();
          }
        }
      );
    });
  });

  describe('User Interactions', () => {
    it('captures primary user flows', async () => {
      jest.clearAllMocks();
      await runScenarios(
        [
          {
            name: 'adds main point from empty state',
            run: () => {
              render(<TreeBuilder {...defaultProps} />);
              fireEvent.click(screen.getByText('Add main point'));
              expect(mockOnAddMainPoint).toHaveBeenCalled();
            }
          },
          {
            name: 'triggers save when enabled',
            run: () => {
              const tree: ExegeticalPlanNode[] = [{ id: 'node-1', title: 'Point 1', children: [] }];
              render(<TreeBuilder {...defaultProps} tree={tree} hasUnsavedChanges={true} />);
              fireEvent.click(screen.getByText('Save'));
              expect(mockOnSave).toHaveBeenCalled();
            }
          },
          {
            name: 'prevents save when disabled',
            run: () => {
              const tree: ExegeticalPlanNode[] = [{ id: 'node-1', title: 'Point 1', children: [] }];
              render(<TreeBuilder {...defaultProps} tree={tree} hasUnsavedChanges={false} />);
              const saveButton = screen.getByText('Save');
              expect(saveButton).toBeDisabled();
              expect(saveButton).toHaveClass('cursor-not-allowed');
            }
          },
          {
            name: 'passes focus and draft props downstream',
            run: () => {
              const tree: ExegeticalPlanNode[] = [{ id: 'node-1', title: 'Point 1', children: [] }];
              render(
                <TreeBuilder
                  {...defaultProps}
                  tree={tree}
                  draftTitles={{ 'node-1': 'Draft Title' }}
                  focusedId="node-1"
                />
              );
              const input = screen.getByPlaceholderText('Enter point title...') as HTMLInputElement;
              expect(input.value).toBe('Draft Title');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Visual Indicators', () => {
    it('validates connector rendering via scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'shows connectors between siblings',
            run: () => {
              const treeWithNodes: ExegeticalPlanNode[] = [
                { id: 'node-1', title: 'Point 1', children: [] },
                { id: 'node-2', title: 'Point 2', children: [] }
              ];
              const { container } = render(<TreeBuilder {...defaultProps} tree={treeWithNodes} />);
              expect(container.querySelectorAll('.bg-blue-400.dark\\:bg-blue-500').length).toBeGreaterThan(0);
            }
          },
          {
            name: 'omits connector for final sibling',
            run: () => {
              const treeWithNodes: ExegeticalPlanNode[] = [{ id: 'node-1', title: 'Point 1', children: [] }];
              const { container } = render(<TreeBuilder {...defaultProps} tree={treeWithNodes} />);
              const allDivs = container.querySelectorAll('div.relative > div');
              const lastNodeDiv = allDivs[allDivs.length - 1];
              const verticalLine = lastNodeDiv?.querySelector('.absolute.left-0.top-10.bottom-\\[-4px\\]');
              expect(verticalLine).toBeFalsy();
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Edge Cases', () => {
    it('covers atypical tree data', async () => {
      await runScenarios(
        [
          {
            name: 'null tree handled gracefully',
            run: () => {
              render(<TreeBuilder {...defaultProps} tree={null as any} />);
              expect(screen.getByText('No points yet. Start by adding a main point.')).toBeInTheDocument();
            }
          },
          {
            name: 'undefined tree handled gracefully',
            run: () => {
              render(<TreeBuilder {...defaultProps} tree={undefined as any} />);
              expect(screen.getByText('No points yet. Start by adding a main point.')).toBeInTheDocument();
            }
          },
          {
            name: 'large flat tree renders all nodes',
            run: () => {
              const largeTree: ExegeticalPlanNode[] = Array.from({ length: 20 }, (_, i) => ({
                id: `node-${i}`,
                title: `Point ${i}`,
                children: []
              }));
              const draftTitles = Object.fromEntries(largeTree.map((node) => [node.id, node.title]));
              render(<TreeBuilder {...defaultProps} tree={largeTree} draftTitles={draftTitles} />);
              expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(20);
            }
          },
          {
            name: 'deep nested tree respects expand map',
            run: () => {
              const deepTree: ExegeticalPlanNode[] = [
                {
                  id: 'level-1',
                  title: 'Level 1',
                  children: [
                    {
                      id: 'level-2',
                      title: 'Level 2',
                      children: [{ id: 'level-3', title: 'Level 3', children: [] }]
                    }
                  ]
                }
              ];
              render(
                <TreeBuilder
                  {...defaultProps}
                  tree={deepTree}
                  expand={{ 'level-1': true, 'level-2': true }}
                  draftTitles={{ 'level-1': 'Level 1', 'level-2': 'Level 2', 'level-3': 'Level 3' }}
                />
              );
              expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(3);
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Accessibility', () => {
    it('meets simple accessibility expectations', async () => {
      await runScenarios(
        [
          {
            name: 'heading rendered as h5',
            run: () => {
              render(<TreeBuilder {...defaultProps} />);
              expect(screen.getByText('Exegetical Plan Builder').closest('h5')).toBeInTheDocument();
            }
          },
          {
            name: 'save button uses button element',
            run: () => {
              const tree: ExegeticalPlanNode[] = [{ id: 'node-1', title: 'Point 1', children: [] }];
              render(<TreeBuilder {...defaultProps} tree={tree} />);
              expect(screen.getByText('Save').tagName).toBe('BUTTON');
            }
          },
          {
            name: 'add main point button provides tooltip',
            run: () => {
              render(<TreeBuilder {...defaultProps} />);
              expect(screen.getByText('Add main point')).toHaveAttribute('title', 'Add the first main point');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });
});
