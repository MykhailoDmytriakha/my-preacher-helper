import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { runScenarios } from '@test-utils/scenarioRunner';

jest.mock('@locales/i18n', () => ({}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'wizard.steps.exegeticalPlan.title': 'Exegetical Plan',
        'wizard.steps.exegeticalPlan.intro': 'An exegetical plan helps see the overall flow of what the text says.',
        'wizard.steps.exegeticalPlan.instruction.show': 'Show instruction',
        'wizard.steps.exegeticalPlan.instruction.hide': 'Hide instruction',
        'wizard.steps.exegeticalPlan.blockDiagram.title': 'Block diagram',
        'wizard.steps.exegeticalPlan.blockDiagram.description': 'From the block diagram, we will compose the exegetical plan',
        'wizard.steps.exegeticalPlan.blockDiagram.comingSoon': 'Coming Soon',
        'wizard.steps.exegeticalPlan.blockDiagram.notAvailableYet': 'This feature is currently under development',
        'wizard.steps.exegeticalPlan.builder.title': 'Exegetical Plan Builder',
        'wizard.steps.exegeticalPlan.builder.placeholder': 'Enter point title...',
        'wizard.steps.exegeticalPlan.builder.tooltips.delete': 'Delete this point',
        'wizard.steps.exegeticalPlan.builder.tooltips.addChild': 'Add a subpoint',
        'wizard.steps.exegeticalPlan.builder.tooltips.addSibling': 'Add a sibling point',
        'wizard.steps.exegeticalPlan.authorIntent.title': 'Author\'s Intent',
        'wizard.steps.exegeticalPlan.authorIntent.description': 'The original meaning the author put in',
        'wizard.steps.exegeticalPlan.authorIntent.placeholder': 'Describe the author\'s intent...',
        'buttons.save': 'Save',
        'buttons.saving': 'Saving...',
        'actions.save': 'Save',
        'actions.cancel': 'Cancel'
      };
      return translations[key] || key;
    }
  })
}));

import { ExegeticalPlanModule } from '@/components/sermon/prep/exegeticalPlan';
import type { ExegeticalPlanNode } from '@/models/models';

describe('ExegeticalPlanModule', () => {
  const mockOnChange = jest.fn();
  const mockOnSave = jest.fn();
  const mockOnSaveAuthorIntent = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initial Rendering', () => {
    it('covers base rendering cases with scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'shows major sections',
            run: () => {
              render(<ExegeticalPlanModule />);
              expect(screen.getByText('Block diagram')).toBeInTheDocument();
              expect(screen.getByText('Exegetical Plan')).toBeInTheDocument();
            }
          },
          {
            name: 'starts with single empty node',
            run: () => {
              render(<ExegeticalPlanModule />);
              expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(1);
            }
          },
          {
            name: 'renders provided tree nodes',
            run: () => {
              const value: ExegeticalPlanNode[] = [
                { id: '1', title: 'Point 1', children: [] },
                { id: '2', title: 'Point 2', children: [] }
              ];
              render(<ExegeticalPlanModule value={value} />);
              expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(2);
            }
          },
          {
            name: 'pre-fills author intent textarea',
            run: () => {
              render(<ExegeticalPlanModule authorIntent="Initial author intent" />);
              const textarea = screen.getByPlaceholderText('Describe the author\'s intent...') as HTMLTextAreaElement;
              expect(textarea.value).toBe('Initial author intent');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Tree Management', () => {
    it('covers tree operations through scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'edits node titles and enables save',
            run: () => {
              const value: ExegeticalPlanNode[] = [{ id: '1', title: 'Original', children: [] }];
              render(<ExegeticalPlanModule value={value} onSave={mockOnSave} />);
              const input = screen.getByPlaceholderText('Enter point title...') as HTMLInputElement;
              fireEvent.change(input, { target: { value: 'Modified' } });
              expect(input.value).toBe('Modified');
              expect(screen.getByRole('button', { name: /Save/i })).not.toBeDisabled();
            }
          },
          {
            name: 'adds child nodes',
            run: () => {
              const value: ExegeticalPlanNode[] = [{ id: '1', title: 'Parent', children: [] }];
              render(<ExegeticalPlanModule value={value} />);
              fireEvent.click(screen.getByLabelText('add child'));
              expect(screen.getAllByPlaceholderText('Enter point title...').length).toBeGreaterThan(1);
            }
          },
          {
            name: 'adds sibling nodes',
            run: () => {
              const value: ExegeticalPlanNode[] = [{ id: '1', title: 'First', children: [] }];
              render(<ExegeticalPlanModule value={value} />);
              fireEvent.click(screen.getByLabelText('add sibling'));
              expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(2);
            }
          },
          {
            name: 'removes nodes',
            run: () => {
              const value: ExegeticalPlanNode[] = [
                { id: '1', title: 'First', children: [] },
                { id: '2', title: 'Second', children: [] }
              ];
              render(<ExegeticalPlanModule value={value} />);
              fireEvent.click(screen.getAllByLabelText('delete')[0]);
              expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(1);
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Save Functionality', () => {
    it('handles save workflow scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'calls onSave with updated tree',
            run: async () => {
              const value: ExegeticalPlanNode[] = [{ id: '1', title: 'Original', children: [] }];
              render(<ExegeticalPlanModule value={value} onSave={mockOnSave} />);
              fireEvent.change(screen.getByPlaceholderText('Enter point title...'), { target: { value: 'Modified' } });
              fireEvent.click(screen.getByRole('button', { name: /Save/i }));
              await waitFor(() =>
                expect(mockOnSave).toHaveBeenCalledWith(
                  expect.arrayContaining([expect.objectContaining({ id: '1', title: 'Modified' })])
                )
              );
            }
          },
          {
            name: 'disables controls while saving',
            run: () => {
              const value: ExegeticalPlanNode[] = [{ id: '1', title: 'Point', children: [] }];
              render(<ExegeticalPlanModule value={value} onSave={mockOnSave} saving={true} />);
              fireEvent.change(screen.getByPlaceholderText('Enter point title...'), { target: { value: 'Modified' } });
              expect(screen.getByRole('button', { name: /Saving.../i })).toBeDisabled();
            }
          },
          {
            name: 'resyncs draft when new value arrives',
            run: async () => {
              const initialValue: ExegeticalPlanNode[] = [{ id: '1', title: 'Initial', children: [] }];
              const { rerender } = render(
                <ExegeticalPlanModule value={initialValue} onSave={mockOnSave} saving={false} />
              );
              const input = screen.getByPlaceholderText('Enter point title...') as HTMLInputElement;
              fireEvent.change(input, { target: { value: 'Modified' } });
              rerender(
                <ExegeticalPlanModule
                  value={[{ id: '1', title: 'Modified', children: [] }]}
                  onSave={mockOnSave}
                  saving={false}
                />
              );
              await waitFor(() => expect(input.value).toBe('Modified'));
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Author Intent', () => {
    it('handles author intent editing scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'shows save button when draft changes',
            run: () => {
              render(<ExegeticalPlanModule authorIntent="" onSaveAuthorIntent={mockOnSaveAuthorIntent} />);
              fireEvent.change(screen.getByPlaceholderText('Describe the author\'s intent...'), {
                target: { value: 'New intent' }
              });
              expect(screen.getByTitle('Save')).toBeInTheDocument();
            }
          },
          {
            name: 'persists intent via save action',
            run: async () => {
              render(<ExegeticalPlanModule authorIntent="" onSaveAuthorIntent={mockOnSaveAuthorIntent} />);
              fireEvent.change(screen.getByPlaceholderText('Describe the author\'s intent...'), {
                target: { value: 'My intent' }
              });
              fireEvent.click(screen.getByTitle('Save'));
              await waitFor(() => expect(mockOnSaveAuthorIntent).toHaveBeenCalledWith('My intent'));
            }
          },
          {
            name: 'cancels draft edits',
            run: () => {
              render(<ExegeticalPlanModule authorIntent="Original" onSaveAuthorIntent={mockOnSaveAuthorIntent} />);
              const textarea = screen.getByPlaceholderText('Describe the author\'s intent...') as HTMLTextAreaElement;
              fireEvent.change(textarea, { target: { value: 'Modified' } });
              fireEvent.click(screen.getByText('Cancel'));
              expect(textarea.value).toBe('');
            }
          },
          {
            name: 'syncs textarea when external prop updates',
            run: () => {
              const { rerender } = render(
                <ExegeticalPlanModule authorIntent="Initial" onSaveAuthorIntent={mockOnSaveAuthorIntent} />
              );
              rerender(
                <ExegeticalPlanModule authorIntent="Updated" onSaveAuthorIntent={mockOnSaveAuthorIntent} />
              );
              expect(
                screen.getByPlaceholderText('Describe the author\'s intent...') as HTMLTextAreaElement
              ).toHaveValue('Updated');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Instruction Section', () => {
    it('toggles instruction visibility', () => {
      render(<ExegeticalPlanModule />);

      expect(screen.queryByText('Simple study of the text structure')).not.toBeInTheDocument();

      const toggleButton = screen.getByText('Show instruction');
      fireEvent.click(toggleButton);

      expect(screen.getByText('wizard.steps.exegeticalPlan.simpleStudy.title')).toBeInTheDocument();

      const hideButton = screen.getByText('Hide instruction');
      fireEvent.click(hideButton);

      expect(screen.queryByText('wizard.steps.exegeticalPlan.simpleStudy.title')).not.toBeInTheDocument();
    });
  });

  describe('Focus Management', () => {
    it('focuses new nodes consistently', async () => {
      await runScenarios(
        [
          {
            name: 'child nodes receive focus',
            run: async () => {
              const value: ExegeticalPlanNode[] = [{ id: '1', title: 'Parent', children: [] }];
              render(<ExegeticalPlanModule value={value} />);
              fireEvent.click(screen.getByLabelText('add child'));
              await waitFor(() => {
                const inputs = screen.getAllByPlaceholderText('Enter point title...');
                expect(inputs.at(-1)).toHaveAttribute('autofocus');
              });
            }
          },
          {
            name: 'sibling nodes receive focus',
            run: async () => {
              const value: ExegeticalPlanNode[] = [{ id: '1', title: 'First', children: [] }];
              render(<ExegeticalPlanModule value={value} />);
              fireEvent.click(screen.getByLabelText('add sibling'));
              await waitFor(() => {
                const inputs = screen.getAllByPlaceholderText('Enter point title...');
                expect(inputs).toHaveLength(2);
                expect(inputs.at(-1)).toHaveAttribute('autofocus');
              });
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Draft State Management', () => {
    it('keeps draft state isolated and cleaned up', async () => {
      await runScenarios(
        [
          {
            name: 'draft edits do not trigger save immediately',
            run: () => {
              const value: ExegeticalPlanNode[] = [{ id: '1', title: 'Saved', children: [] }];
              render(<ExegeticalPlanModule value={value} onSave={mockOnSave} />);
              const input = screen.getByPlaceholderText('Enter point title...') as HTMLInputElement;
              fireEvent.change(input, { target: { value: 'Draft' } });
              expect(mockOnSave).not.toHaveBeenCalled();
            }
          },
          {
            name: 'removing node cleans up its draft value',
            run: () => {
              const value: ExegeticalPlanNode[] = [
                { id: '1', title: 'First', children: [] },
                { id: '2', title: 'Second', children: [] }
              ];
              render(<ExegeticalPlanModule value={value} onSave={mockOnSave} />);
              fireEvent.change(screen.getAllByPlaceholderText('Enter point title...')[0], {
                target: { value: 'Modified First' }
              });
              fireEvent.click(screen.getAllByLabelText('delete')[0]);
              fireEvent.click(screen.getByRole('button', { name: /Save/i }));
              expect(mockOnSave).toHaveBeenCalledWith(
                expect.arrayContaining([expect.objectContaining({ id: '2', title: 'Second' })])
              );
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Edge Cases', () => {
    it('handles miscellaneous edge scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'supports empty array values',
            run: () => {
              render(<ExegeticalPlanModule value={[]} />);
              expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(1);
            }
          },
          {
            name: 'supports undefined value prop',
            run: () => {
              render(<ExegeticalPlanModule value={undefined} />);
              expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(1);
            }
          },
          {
            name: 'safely handles missing onSave',
            run: () => {
              const value: ExegeticalPlanNode[] = [{ id: '1', title: 'Point', children: [] }];
              render(<ExegeticalPlanModule value={value} />);
              fireEvent.change(screen.getByPlaceholderText('Enter point title...'), { target: { value: 'Modified' } });
              expect(() => fireEvent.click(screen.getByRole('button', { name: /Save/i }))).not.toThrow();
            }
          },
          {
            name: 'handles missing onSaveAuthorIntent callback',
            run: () => {
              render(<ExegeticalPlanModule authorIntent="" />);
              fireEvent.change(screen.getByPlaceholderText('Describe the author\'s intent...'), {
                target: { value: 'Intent' }
              });
              expect(screen.queryByTitle('Save')).toBeInTheDocument();
            }
          },
          {
            name: 'renders deep nested structures',
            run: () => {
              const complexValue: ExegeticalPlanNode[] = [
                {
                  id: '1',
                  title: 'Level 1',
                  children: [
                    {
                      id: '1a',
                      title: 'Level 2',
                      children: [{ id: '1a1', title: 'Level 3', children: [] }]
                    }
                  ]
                }
              ];
              render(<ExegeticalPlanModule value={complexValue} />);
              expect(screen.getAllByPlaceholderText('Enter point title...')).toHaveLength(3);
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Integration', () => {
    it('covers complete workflows succinctly', async () => {
      await runScenarios(
        [
          {
            name: 'builds tree and saves structure',
            run: async () => {
              render(<ExegeticalPlanModule onSave={mockOnSave} />);
              fireEvent.change(screen.getAllByPlaceholderText('Enter point title...')[0], {
                target: { value: 'Main Point' }
              });
              fireEvent.click(screen.getByLabelText('add child'));
              await waitFor(() => screen.getAllByPlaceholderText('Enter point title...').length === 2);
              fireEvent.change(screen.getAllByPlaceholderText('Enter point title...')[1], {
                target: { value: 'Sub Point' }
              });
              fireEvent.click(screen.getByRole('button', { name: /Save/i }));
              await waitFor(() =>
                expect(mockOnSave).toHaveBeenCalledWith(
                  expect.arrayContaining([
                    expect.objectContaining({
                      title: 'Main Point',
                      children: expect.arrayContaining([expect.objectContaining({ title: 'Sub Point' })])
                    })
                  ])
                )
              );
            }
          },
          {
            name: 'edits author intent and saves',
            run: async () => {
              render(<ExegeticalPlanModule authorIntent="" onSaveAuthorIntent={mockOnSaveAuthorIntent} />);
              fireEvent.change(screen.getByPlaceholderText('Describe the author\'s intent...'), {
                target: { value: 'The author intends to...' }
              });
              fireEvent.click(screen.getByTitle('Save'));
              await waitFor(() =>
                expect(mockOnSaveAuthorIntent).toHaveBeenCalledWith('The author intends to...')
              );
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });
});
