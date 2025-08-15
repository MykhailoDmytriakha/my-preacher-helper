import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@locales/i18n', () => ({}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import ExegeticalPlanStepContent from '@/components/sermon/prep/ExegeticalPlanStepContent';

describe('ExegeticalPlanStepContent', () => {
  it('renders builder and allows editing title', () => {
    render(<ExegeticalPlanStepContent value={[{ id: '1', title: 'A', children: [] }]} />);
    const input = screen.getByPlaceholderText('wizard.steps.exegeticalPlan.builder.placeholder');
    expect(input).toHaveValue('A');

    fireEvent.change(input, { target: { value: 'New Title' } });
    expect(input).toHaveValue('New Title');
  });

  it('adds a child and sibling, then deletes a node', () => {
    render(<ExegeticalPlanStepContent value={[{ id: 'root', title: 'Root', children: [] }]} />);
    // Add child to root
    const addChildBtn = screen.getByTitle('wizard.steps.exegeticalPlan.builder.tooltips.addChild');
    fireEvent.click(addChildBtn);
    // Add sibling to root (multiple buttons may exist after adding a child)
    const addSiblingBtns = screen.getAllByTitle('wizard.steps.exegeticalPlan.builder.tooltips.addSibling');
    fireEvent.click(addSiblingBtns[0]);

    // There should be multiple inputs now
    const inputs = screen.getAllByPlaceholderText('wizard.steps.exegeticalPlan.builder.placeholder');
    expect(inputs.length).toBeGreaterThanOrEqual(2);

    // Delete one node using delete button (multiple delete buttons exist)
    const deleteBtns = screen.getAllByTitle('wizard.steps.exegeticalPlan.builder.tooltips.delete');
    fireEvent.click(deleteBtns[0]);

    // Still at least one input remains
    expect(screen.getAllByPlaceholderText('wizard.steps.exegeticalPlan.builder.placeholder').length).toBeGreaterThan(0);
  });

  it('saves the tree and author intent', async () => {
    const onSave = jest.fn();
    const onSaveAuthorIntent = jest.fn();
    render(
      <ExegeticalPlanStepContent
        value={[{ id: '1', title: 'A', children: [] }]}
        onSave={onSave}
        authorIntent=""
        onSaveAuthorIntent={onSaveAuthorIntent}
      />
    );

    // First make a change to the tree to enable the save button
    const input = screen.getByPlaceholderText('wizard.steps.exegeticalPlan.builder.placeholder');
    fireEvent.change(input, { target: { value: 'Modified Title' } });

    // Now save tree (button should be enabled)
    const saveTreeBtn = screen.getByRole('button', { name: /buttons.save|actions.save/i });
    fireEvent.click(saveTreeBtn);
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    // Edit author intent
    const textarea = screen.getByPlaceholderText('wizard.steps.exegeticalPlan.authorIntent.placeholder');
    fireEvent.change(textarea, { target: { value: 'Intent' } });
    const saveIntentBtn = await screen.findByTitle(/actions.save/i);
    fireEvent.click(saveIntentBtn);
    await waitFor(() => expect(onSaveAuthorIntent).toHaveBeenCalledWith('Intent'));
  });

  it('toggles instruction visibility', () => {
    render(<ExegeticalPlanStepContent value={[{ id: '1', title: '', children: [] }]} />);
    const toggleBtn = screen.getByRole('button', { name: /wizard.steps.exegeticalPlan.instruction.show/i });
    fireEvent.click(toggleBtn);
    expect(screen.getByText('wizard.steps.exegeticalPlan.simpleStudy.title')).toBeInTheDocument();
  });

  it('disables save button when there are no unsaved changes', () => {
    render(<ExegeticalPlanStepContent value={[{ id: '1', title: 'A', children: [] }]} />);
    
    // Save button should be disabled initially (no changes)
    const saveButton = screen.getByRole('button', { name: /buttons.save/i });
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveClass('bg-gray-400', 'cursor-not-allowed');
  });

  it('enables save button when there are unsaved changes', () => {
    render(<ExegeticalPlanStepContent value={[{ id: '1', title: 'A', children: [] }]} />);
    
    // Make a change to enable the save button
    const input = screen.getByPlaceholderText('wizard.steps.exegeticalPlan.builder.placeholder');
    fireEvent.change(input, { target: { value: 'Modified Title' } });
    
    // Save button should now be enabled
    const saveButton = screen.getByRole('button', { name: /buttons.save/i });
    expect(saveButton).not.toBeDisabled();
    expect(saveButton).toHaveClass('bg-green-600', 'hover:bg-green-700');
  });
});


