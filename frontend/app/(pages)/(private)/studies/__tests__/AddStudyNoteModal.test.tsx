import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AddStudyNoteModal from '../AddStudyNoteModal';

const baseProps = {
  isOpen: true,
  availableTags: [] as string[],
  bibleLocale: 'en' as const,
};

const openAdvancedSection = async () => {
  const toggleButton = screen.getByRole('button', {
    name: (name) => typeof name === 'string' && name.includes('studiesWorkspace.manualEntry'),
  });
  await userEvent.click(toggleButton);
  await waitFor(() =>
    screen.getByText((content) => content.includes('studiesWorkspace.titleLabel'))
  );
};

describe('AddStudyNoteModal', () => {
  it('reveals manual entry fields when the toggle is clicked', async () => {
    render(
      <AddStudyNoteModal
        {...baseProps}
        onClose={jest.fn()}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    expect(
      screen.queryByText((content) => content.includes('studiesWorkspace.titleLabel'))
    ).not.toBeInTheDocument();
    await openAdvancedSection();

    expect(
      screen.getByText((content) => content.includes('studiesWorkspace.titleLabel'))
    ).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('studiesWorkspace.scriptureRefs'))
    ).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('studiesWorkspace.tags'))
    ).toBeInTheDocument();
  });

  it('hides the manual section when the toggle is clicked again', async () => {
    render(
      <AddStudyNoteModal
        {...baseProps}
        onClose={jest.fn()}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    await openAdvancedSection();
    const toggleButton = screen.getByRole('button', {
      name: (name) => typeof name === 'string' && name.includes('studiesWorkspace.manualEntry'),
    });
    await userEvent.click(toggleButton);

    await waitFor(() =>
      expect(
        screen.queryByText((content) => content.includes('studiesWorkspace.titleLabel'))
      ).not.toBeInTheDocument()
    );
  });

  it('enables the AI analyze button only after content is provided', async () => {
    render(
      <AddStudyNoteModal
        {...baseProps}
        onClose={jest.fn()}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    const analyzeButton = screen.getByRole('button', {
      name: 'studiesWorkspace.aiAnalyze.button',
    });
    expect(analyzeButton).toBeDisabled();

    const contentInput = screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder');
    fireEvent.change(contentInput, { target: { value: 'A short reflection' } });

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: 'studiesWorkspace.aiAnalyze.button',
        })
      ).toBeEnabled();
    });
  });
  it('uses responsive layout classes for the header', () => {
    render(
      <AddStudyNoteModal
        {...baseProps}
        onClose={jest.fn()}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    // Find the header title "New Note"
    const title = screen.getByText('studiesWorkspace.newNote');
    // The immediate parent of the title is the flex container for title + toggle
    const innerHeader = title.closest('div');
    expect(innerHeader).toHaveClass('flex-col');
    expect(innerHeader).toHaveClass('sm:flex-row');
  });

  it('initial modal width is max-w-2xl and height is max-h-[95vh]', () => {
    render(
      <AddStudyNoteModal
        {...baseProps}
        onClose={jest.fn()}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );
    const container = screen.getByTestId('study-note-modal-container');
    expect(container).toHaveClass('max-w-2xl');
    expect(container).toHaveClass('max-h-[95vh]');
  });

  it('updates modal width to max-w-4xl for long content', async () => {
    render(
      <AddStudyNoteModal
        {...baseProps}
        onClose={jest.fn()}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    const contentInput = screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder');
    fireEvent.change(contentInput, { target: { value: 'a'.repeat(1100) } });

    const container = screen.getByTestId('study-note-modal-container');
    await waitFor(() => expect(container).toHaveClass('max-w-4xl'));
  });

  it('updates modal width to max-w-5xl for very long content', async () => {
    render(
      <AddStudyNoteModal
        {...baseProps}
        onClose={jest.fn()}
        onSave={jest.fn().mockResolvedValue(undefined)}
      />
    );

    const contentInput = screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder');
    fireEvent.change(contentInput, { target: { value: 'a'.repeat(2100) } });

    const container = screen.getByTestId('study-note-modal-container');
    await waitFor(() => expect(container).toHaveClass('max-w-5xl'));
  });
});
