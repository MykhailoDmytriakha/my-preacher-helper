import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

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
    it('renders all main sections', () => {
      render(<ExegeticalPlanModule />);

      expect(screen.getByText('Block diagram')).toBeInTheDocument();
      expect(screen.getByText('Exegetical Plan')).toBeInTheDocument();
      expect(screen.getByText('Author\'s Intent')).toBeInTheDocument();
    });

    it('renders with default empty tree', () => {
      render(<ExegeticalPlanModule />);

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      expect(inputs).toHaveLength(1);
    });

    it('renders with provided value', () => {
      const value: ExegeticalPlanNode[] = [
        { id: '1', title: 'Point 1', children: [] },
        { id: '2', title: 'Point 2', children: [] }
      ];

      render(<ExegeticalPlanModule value={value} />);

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      expect(inputs).toHaveLength(2);
    });

    it('renders with author intent', () => {
      render(<ExegeticalPlanModule authorIntent="Initial author intent" />);

      const textarea = screen.getByPlaceholderText('Describe the author\'s intent...') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Initial author intent');
    });
  });

  describe('Tree Management', () => {
    it('allows editing node titles', () => {
      const value: ExegeticalPlanNode[] = [
        { id: '1', title: 'Original Title', children: [] }
      ];

      render(<ExegeticalPlanModule value={value} onSave={mockOnSave} />);

      const input = screen.getByPlaceholderText('Enter point title...') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Modified Title' } });

      expect(input.value).toBe('Modified Title');
    });

    it('enables save button when tree is modified', () => {
      const value: ExegeticalPlanNode[] = [
        { id: '1', title: 'Original', children: [] }
      ];

      render(<ExegeticalPlanModule value={value} onSave={mockOnSave} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      fireEvent.change(input, { target: { value: 'Modified' } });

      const saveButton = screen.getByRole('button', { name: /Save/i });
      expect(saveButton).not.toBeDisabled();
    });

    it('adds child nodes', () => {
      const value: ExegeticalPlanNode[] = [
        { id: '1', title: 'Parent', children: [] }
      ];

      render(<ExegeticalPlanModule value={value} />);

      const addChildButton = screen.getByLabelText('add child');
      fireEvent.click(addChildButton);

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      expect(inputs.length).toBeGreaterThan(1);
    });

    it('adds sibling nodes', () => {
      const value: ExegeticalPlanNode[] = [
        { id: '1', title: 'First', children: [] }
      ];

      render(<ExegeticalPlanModule value={value} />);

      const addSiblingButton = screen.getByLabelText('add sibling');
      fireEvent.click(addSiblingButton);

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      expect(inputs.length).toBe(2);
    });

    it('removes nodes', () => {
      const value: ExegeticalPlanNode[] = [
        { id: '1', title: 'First', children: [] },
        { id: '2', title: 'Second', children: [] }
      ];

      render(<ExegeticalPlanModule value={value} />);

      const deleteButtons = screen.getAllByLabelText('delete');
      fireEvent.click(deleteButtons[0]);

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      expect(inputs.length).toBe(1);
    });
  });

  describe('Save Functionality', () => {
    it('calls onSave with merged draft titles', async () => {
      const value: ExegeticalPlanNode[] = [
        { id: '1', title: 'Original', children: [] }
      ];

      render(<ExegeticalPlanModule value={value} onSave={mockOnSave} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      fireEvent.change(input, { target: { value: 'Modified' } });

      const saveButton = screen.getByRole('button', { name: /Save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ id: '1', title: 'Modified' })
          ])
        );
      });
    });

    it('disables save button when saving', () => {
      const value: ExegeticalPlanNode[] = [
        { id: '1', title: 'Point', children: [] }
      ];

      render(<ExegeticalPlanModule value={value} onSave={mockOnSave} saving={true} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      fireEvent.change(input, { target: { value: 'Modified' } });

      const saveButton = screen.getByRole('button', { name: /Saving.../i });
      expect(saveButton).toBeDisabled();
    });

    it('syncs with external value after save', async () => {
      const initialValue: ExegeticalPlanNode[] = [
        { id: '1', title: 'Initial', children: [] }
      ];

      const { rerender } = render(
        <ExegeticalPlanModule value={initialValue} onSave={mockOnSave} saving={false} />
      );

      const input = screen.getByPlaceholderText('Enter point title...') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Modified' } });

      const updatedValue: ExegeticalPlanNode[] = [
        { id: '1', title: 'Modified', children: [] }
      ];

      rerender(
        <ExegeticalPlanModule value={updatedValue} onSave={mockOnSave} saving={false} />
      );

      await waitFor(() => {
        expect(input.value).toBe('Modified');
      });
    });
  });

  describe('Author Intent', () => {
    it('updates author intent draft', () => {
      render(<ExegeticalPlanModule authorIntent="" onSaveAuthorIntent={mockOnSaveAuthorIntent} />);

      const textarea = screen.getByPlaceholderText('Describe the author\'s intent...');
      fireEvent.change(textarea, { target: { value: 'New intent' } });

      const saveButton = screen.getByTitle('Save');
      expect(saveButton).toBeInTheDocument();
    });

    it('saves author intent', async () => {
      render(<ExegeticalPlanModule authorIntent="" onSaveAuthorIntent={mockOnSaveAuthorIntent} />);

      const textarea = screen.getByPlaceholderText('Describe the author\'s intent...');
      fireEvent.change(textarea, { target: { value: 'My intent' } });

      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSaveAuthorIntent).toHaveBeenCalledWith('My intent');
      });
    });

    it('cancels author intent changes', () => {
      render(<ExegeticalPlanModule authorIntent="Original" onSaveAuthorIntent={mockOnSaveAuthorIntent} />);

      const textarea = screen.getByPlaceholderText('Describe the author\'s intent...') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'Modified' } });

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(textarea.value).toBe('');
    });

    it('syncs author intent with external prop', () => {
      const { rerender } = render(
        <ExegeticalPlanModule authorIntent="Initial" onSaveAuthorIntent={mockOnSaveAuthorIntent} />
      );

      let textarea = screen.getByPlaceholderText('Describe the author\'s intent...') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Initial');

      rerender(
        <ExegeticalPlanModule authorIntent="Updated" onSaveAuthorIntent={mockOnSaveAuthorIntent} />
      );

      textarea = screen.getByPlaceholderText('Describe the author\'s intent...') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Updated');
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
    it('sets focus state for newly added child node', async () => {
      const value: ExegeticalPlanNode[] = [
        { id: '1', title: 'Parent', children: [] }
      ];

      render(<ExegeticalPlanModule value={value} />);

      const addChildButton = screen.getByLabelText('add child');
      fireEvent.click(addChildButton);

      await waitFor(() => {
        const inputs = screen.getAllByPlaceholderText('Enter point title...');
        expect(inputs.length).toBeGreaterThan(1);
        expect(inputs[inputs.length - 1]).toHaveAttribute('autofocus');
      });
    });

    it('sets focus state for newly added sibling node', async () => {
      const value: ExegeticalPlanNode[] = [
        { id: '1', title: 'First', children: [] }
      ];

      render(<ExegeticalPlanModule value={value} />);

      const addSiblingButton = screen.getByLabelText('add sibling');
      fireEvent.click(addSiblingButton);

      await waitFor(() => {
        const inputs = screen.getAllByPlaceholderText('Enter point title...');
        expect(inputs.length).toBe(2);
        expect(inputs[inputs.length - 1]).toHaveAttribute('autofocus');
      });
    });
  });

  describe('Draft State Management', () => {
    it('maintains draft titles separate from saved tree', () => {
      const value: ExegeticalPlanNode[] = [
        { id: '1', title: 'Saved', children: [] }
      ];

      render(<ExegeticalPlanModule value={value} onSave={mockOnSave} />);

      const input = screen.getByPlaceholderText('Enter point title...') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Draft' } });

      expect(input.value).toBe('Draft');
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('cleans up draft titles when node is removed', () => {
      const value: ExegeticalPlanNode[] = [
        { id: '1', title: 'First', children: [] },
        { id: '2', title: 'Second', children: [] }
      ];

      render(<ExegeticalPlanModule value={value} onSave={mockOnSave} />);

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      fireEvent.change(inputs[0], { target: { value: 'Modified First' } });

      const deleteButtons = screen.getAllByLabelText('delete');
      fireEvent.click(deleteButtons[0]);

      const saveButton = screen.getByRole('button', { name: /Save/i });
      fireEvent.click(saveButton);

      expect(mockOnSave).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: '2', title: 'Second' })
        ])
      );
    });
  });

  describe('Edge Cases', () => {
    it('handles empty value prop', () => {
      render(<ExegeticalPlanModule value={[]} />);

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      expect(inputs).toHaveLength(1);
    });

    it('handles undefined value prop', () => {
      render(<ExegeticalPlanModule value={undefined} />);

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      expect(inputs).toHaveLength(1);
    });

    it('handles missing onSave callback', () => {
      const value: ExegeticalPlanNode[] = [
        { id: '1', title: 'Point', children: [] }
      ];

      render(<ExegeticalPlanModule value={value} />);

      const input = screen.getByPlaceholderText('Enter point title...');
      fireEvent.change(input, { target: { value: 'Modified' } });

      const saveButton = screen.getByRole('button', { name: /Save/i });
      fireEvent.click(saveButton);

      expect(() => fireEvent.click(saveButton)).not.toThrow();
    });

    it('handles missing onSaveAuthorIntent callback', () => {
      render(<ExegeticalPlanModule authorIntent="" />);

      const textarea = screen.getByPlaceholderText('Describe the author\'s intent...');
      fireEvent.change(textarea, { target: { value: 'Intent' } });

      const saveButton = screen.queryByTitle('Save');
      expect(saveButton).toBeInTheDocument();
    });

    it('handles complex nested structures', () => {
      const complexValue: ExegeticalPlanNode[] = [
        {
          id: '1',
          title: 'Level 1',
          children: [
            {
              id: '1a',
              title: 'Level 2',
              children: [
                { id: '1a1', title: 'Level 3', children: [] }
              ]
            }
          ]
        }
      ];

      render(<ExegeticalPlanModule value={complexValue} />);

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      expect(inputs).toHaveLength(3);
    });
  });

  describe('Integration', () => {
    it('complete workflow: add, edit, and save tree', async () => {
      render(<ExegeticalPlanModule onSave={mockOnSave} />);

      const inputs = screen.getAllByPlaceholderText('Enter point title...');
      fireEvent.change(inputs[0], { target: { value: 'Main Point' } });

      const addChildButton = screen.getByLabelText('add child');
      fireEvent.click(addChildButton);

      await waitFor(() => {
        const updatedInputs = screen.getAllByPlaceholderText('Enter point title...');
        expect(updatedInputs.length).toBe(2);
      });

      const allInputs = screen.getAllByPlaceholderText('Enter point title...');
      fireEvent.change(allInputs[1], { target: { value: 'Sub Point' } });

      const saveButton = screen.getByRole('button', { name: /Save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              title: 'Main Point',
              children: expect.arrayContaining([
                expect.objectContaining({ title: 'Sub Point' })
              ])
            })
          ])
        );
      });
    });

    it('complete workflow: add and save author intent', async () => {
      render(<ExegeticalPlanModule authorIntent="" onSaveAuthorIntent={mockOnSaveAuthorIntent} />);

      const textarea = screen.getByPlaceholderText('Describe the author\'s intent...');
      fireEvent.change(textarea, { target: { value: 'The author intends to...' } });

      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSaveAuthorIntent).toHaveBeenCalledWith('The author intends to...');
      });
    });
  });
});
