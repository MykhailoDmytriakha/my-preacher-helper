import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

jest.mock('@locales/i18n', () => ({}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import MainIdeaStepContent from '@/components/sermon/prep/MainIdeaStepContent';

describe('MainIdeaStepContent', () => {
  const mockOnSaveContextIdea = jest.fn();
  const mockOnSaveTextIdea = jest.fn();
  const mockOnSaveArgumentation = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders sections using translation keys', () => {
    render(<MainIdeaStepContent />);
    expect(screen.getByText('wizard.steps.mainIdea.note.title')).toBeInTheDocument();
    expect(screen.getByText('wizard.steps.mainIdea.contextIdea.title')).toBeInTheDocument();
    expect(screen.getByText('wizard.steps.mainIdea.textIdea.title')).toBeInTheDocument();
    expect(screen.getByText('wizard.steps.mainIdea.argumentation.title')).toBeInTheDocument();
  });

  it('renders input fields when save handlers are provided', () => {
    render(
      <MainIdeaStepContent
        onSaveContextIdea={mockOnSaveContextIdea}
        onSaveTextIdea={mockOnSaveTextIdea}
        onSaveArgumentation={mockOnSaveArgumentation}
      />
    );

    expect(screen.getByPlaceholderText('wizard.steps.mainIdea.contextIdea.placeholder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('wizard.steps.mainIdea.textIdea.placeholder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('wizard.steps.mainIdea.argumentation.placeholder')).toBeInTheDocument();
  });

  it('does not render input fields when save handlers are not provided', () => {
    render(<MainIdeaStepContent />);

    expect(screen.queryByPlaceholderText('wizard.steps.mainIdea.contextIdea.placeholder')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('wizard.steps.mainIdea.textIdea.placeholder')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('wizard.steps.mainIdea.argumentation.placeholder')).not.toBeInTheDocument();
  });

  it('initializes with provided initial values', () => {
    render(
      <MainIdeaStepContent
        initialContextIdea="Initial context"
        initialTextIdea="Initial text idea"
        initialArgumentation="Initial argumentation"
        onSaveContextIdea={mockOnSaveContextIdea}
        onSaveTextIdea={mockOnSaveTextIdea}
        onSaveArgumentation={mockOnSaveArgumentation}
      />
    );

    expect(screen.getByDisplayValue('Initial context')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Initial text idea')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Initial argumentation')).toBeInTheDocument();
  });

  it('shows save/cancel buttons only when there are changes', () => {
    render(
      <MainIdeaStepContent
        onSaveContextIdea={mockOnSaveContextIdea}
        onSaveTextIdea={mockOnSaveTextIdea}
        onSaveArgumentation={mockOnSaveArgumentation}
      />
    );

    // Initially no buttons should be visible
    expect(screen.queryByTitle('actions.save')).not.toBeInTheDocument();
    expect(screen.queryByTitle('actions.cancel')).not.toBeInTheDocument();

    // Type in context field
    const contextField = screen.getByPlaceholderText('wizard.steps.mainIdea.contextIdea.placeholder');
    fireEvent.change(contextField, { target: { value: 'New context' } });

    // Save/cancel buttons should now be visible for context
    expect(screen.getAllByTitle('actions.save')[0]).toBeInTheDocument();
    expect(screen.getAllByTitle('actions.cancel')[0]).toBeInTheDocument();
  });

  it('calls save handler when save button is clicked', async () => {
    mockOnSaveContextIdea.mockResolvedValue(undefined);

    render(
      <MainIdeaStepContent
        onSaveContextIdea={mockOnSaveContextIdea}
        onSaveTextIdea={mockOnSaveTextIdea}
        onSaveArgumentation={mockOnSaveArgumentation}
      />
    );

    const contextField = screen.getByPlaceholderText('wizard.steps.mainIdea.contextIdea.placeholder');
    fireEvent.change(contextField, { target: { value: 'New context' } });

    const saveButton = screen.getAllByTitle('actions.save')[0];
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockOnSaveContextIdea).toHaveBeenCalledWith('New context');
    });
  });

  it('resets field value when cancel button is clicked', () => {
    render(
      <MainIdeaStepContent
        initialContextIdea="Initial context"
        onSaveContextIdea={mockOnSaveContextIdea}
        onSaveTextIdea={mockOnSaveTextIdea}
        onSaveArgumentation={mockOnSaveArgumentation}
      />
    );

    const contextField = screen.getByPlaceholderText('wizard.steps.mainIdea.contextIdea.placeholder');
    fireEvent.change(contextField, { target: { value: 'Modified context' } });

    const cancelButton = screen.getAllByTitle('actions.cancel')[0];
    fireEvent.click(cancelButton);

    // Field should be reset to initial value
    expect(screen.getByDisplayValue('Initial context')).toBeInTheDocument();
  });

  it('handles multiple fields independently', () => {
    render(
      <MainIdeaStepContent
        onSaveContextIdea={mockOnSaveContextIdea}
        onSaveTextIdea={mockOnSaveTextIdea}
        onSaveArgumentation={mockOnSaveArgumentation}
      />
    );

    const contextField = screen.getByPlaceholderText('wizard.steps.mainIdea.contextIdea.placeholder');
    const textField = screen.getByPlaceholderText('wizard.steps.mainIdea.textIdea.placeholder');
    const argumentationField = screen.getByPlaceholderText('wizard.steps.mainIdea.argumentation.placeholder');

    // Modify context field
    fireEvent.change(contextField, { target: { value: 'Context change' } });
    expect(screen.getAllByTitle('actions.save')[0]).toBeInTheDocument();

    // Modify text field
    fireEvent.change(textField, { target: { value: 'Text change' } });
    expect(screen.getAllByTitle('actions.save')).toHaveLength(2);

    // Modify argumentation field
    fireEvent.change(argumentationField, { target: { value: 'Argumentation change' } });
    expect(screen.getAllByTitle('actions.save')).toHaveLength(3);
  });

  it('shows loading state during save operation', async () => {
    let resolveSave: () => void;
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    mockOnSaveContextIdea.mockReturnValue(savePromise);

    render(
      <MainIdeaStepContent
        onSaveContextIdea={mockOnSaveContextIdea}
        onSaveTextIdea={mockOnSaveTextIdea}
        onSaveArgumentation={mockOnSaveArgumentation}
      />
    );

    const contextField = screen.getByPlaceholderText('wizard.steps.mainIdea.contextIdea.placeholder');
    fireEvent.change(contextField, { target: { value: 'New context' } });

    const saveButton = screen.getAllByTitle('actions.save')[0];
    fireEvent.click(saveButton);

    // Button should be disabled during save
    expect(saveButton).toBeDisabled();

    // Resolve the save promise
    resolveSave!();
    await waitFor(() => {
      expect(saveButton).toBeEnabled();
    });
  });

  it('handles empty initial values correctly', () => {
    render(
      <MainIdeaStepContent
        initialContextIdea=""
        initialTextIdea=""
        initialArgumentation=""
        onSaveContextIdea={mockOnSaveContextIdea}
        onSaveTextIdea={mockOnSaveTextIdea}
        onSaveArgumentation={mockOnSaveArgumentation}
      />
    );

    const contextField = screen.getByPlaceholderText('wizard.steps.mainIdea.contextIdea.placeholder');
    const textField = screen.getByPlaceholderText('wizard.steps.mainIdea.textIdea.placeholder');
    const argumentationField = screen.getByPlaceholderText('wizard.steps.mainIdea.argumentation.placeholder');

    expect(contextField).toHaveValue('');
    expect(textField).toHaveValue('');
    expect(argumentationField).toHaveValue('');
  });

  it('updates draft state when typing', () => {
    render(
      <MainIdeaStepContent
        onSaveContextIdea={mockOnSaveContextIdea}
        onSaveTextIdea={mockOnSaveTextIdea}
        onSaveArgumentation={mockOnSaveArgumentation}
      />
    );

    const contextField = screen.getByPlaceholderText('wizard.steps.mainIdea.contextIdea.placeholder');
    fireEvent.change(contextField, { target: { value: 'Typing test' } });

    expect(contextField).toHaveValue('Typing test');
  });

  it('shows note section inside text main idea section', () => {
    render(<MainIdeaStepContent />);
    
    // Find the text idea section by looking for its title and then finding the parent container
    const textIdeaTitle = screen.getByText('wizard.steps.mainIdea.textIdea.title');
    const textIdeaSection = textIdeaTitle.closest('div')?.parentElement;
    const noteTitle = screen.getByText('wizard.steps.mainIdea.note.title');
    
    // The note should be somewhere within the text idea section's parent container
    expect(textIdeaSection).toContainElement(noteTitle);
  });
});


