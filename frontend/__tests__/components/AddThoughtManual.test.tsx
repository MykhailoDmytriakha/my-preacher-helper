import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AddThoughtManual from '@components/AddThoughtManual';
import { createManualThought } from '@services/thought.service';
import { toast } from 'sonner';
import { Thought } from '@/models/models';

// --- Mocks --- //

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key, // Simple mock
  }),
}));

// Mock the thought service
jest.mock('@services/thought.service', () => ({
  createManualThought: jest.fn(),
}));

// Helper to render with required props
const mockOnNewThought = jest.fn();
const sermonId = 'test-sermon-id';
const renderComponent = () => {
  // Ensure onClose prop is NOT passed
  render(<AddThoughtManual sermonId={sermonId} onNewThought={mockOnNewThought} />); 
};

// --- Test Suite --- //

describe('AddThoughtManual', () => {
  const mockSavedThought: Thought = {
    id: 't-new',
    text: 'This is a new manual thought',
    tags: [],
    date: new Date().toISOString(),
    keyFragments: [],
    outlinePointId: undefined
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure createManualThought mock is reset and resolves successfully by default
    (createManualThought as jest.Mock).mockResolvedValue(mockSavedThought);
    // Mock toast functions directly here, as module mock might interfere
    toast.success = jest.fn(); 
    toast.error = jest.fn();
  });

  it('renders the initial add button', () => {
    renderComponent();
    expect(screen.getByRole('button', { name: /manualThought.addManual/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the modal when the add button is clicked', async () => {
    const user = userEvent.setup();
    renderComponent();
    const addButton = screen.getByRole('button', { name: /manualThought.addManual/i });
    await user.click(addButton);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /manualThought.addManual/i })).toBeInTheDocument();
  });

  it('closes the modal when the cancel button is clicked', async () => {
    const user = userEvent.setup();
    renderComponent();
    await user.click(screen.getByRole('button', { name: /manualThought.addManual/i })); // Open modal
    const cancelButton = screen.getByRole('button', { name: /buttons.cancel/i });
    await user.click(cancelButton);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes the modal when the overlay is clicked', async () => {
    const user = userEvent.setup();
    renderComponent();
    await user.click(screen.getByRole('button', { name: /manualThought.addManual/i })); // Open modal
    // Click the overlay (usually the parent div of the modal content)
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });


  it('allows text input and calls createManualThought on submit', async () => {
    const user = userEvent.setup();
    renderComponent();
    
    // Open the modal
    const addButton = screen.getByRole('button', { name: /manualThought.addManual/i });
    await user.click(addButton);

    // Find and fill the textarea
    const textarea = screen.getByPlaceholderText(/manualThought.placeholder/i);
    const thoughtText = 'This is a new manual thought'; // Use the same text as mockSavedThought
    await user.type(textarea, thoughtText);

    const saveButton = screen.getByRole('button', { name: /buttons.save/i });
    await user.click(saveButton);

    // Wait for the button to become disabled (async check)
    await waitFor(() => {
      expect(saveButton).toBeDisabled();
    });

    // Check service call
    await waitFor(() => {
      expect(createManualThought).toHaveBeenCalledTimes(1);
      expect(createManualThought).toHaveBeenCalledWith(sermonId, expect.objectContaining({ text: thoughtText })); 
    });

    // Check callback 
    await waitFor(() => {
        expect(mockOnNewThought).toHaveBeenCalledTimes(1);
        expect(mockOnNewThought).toHaveBeenCalledWith(mockSavedThought);
    });
     // Check success toast 
     await waitFor(() => {
       expect(toast.success).toHaveBeenCalledTimes(1); // Check call count
       expect(toast.success).toHaveBeenCalledWith('manualThought.addedSuccess');
     });

    // Ensure modal is closed
    await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('handles error during thought creation and shows alert', async () => {
    // Setup error mock for createManualThought
    // Use the actual error key used in the component
    const expectedErrorMessageKey = 'errors.addThoughtError'; 
    (createManualThought as jest.Mock).mockRejectedValue(new Error('Failed to save'));

    const user = userEvent.setup();
    renderComponent();
    
    // Open the modal
    const addButton = screen.getByRole('button', { name: /manualThought.addManual/i });
    await user.click(addButton);

    // Find and fill the textarea
    const textarea = screen.getByPlaceholderText(/manualThought.placeholder/i);
    const thoughtText = 'This thought will fail.';
    await user.type(textarea, thoughtText);

    const saveButtonOnError = screen.getByRole('button', { name: /buttons.save/i });
    await user.click(saveButtonOnError);

    // Now wait for the full async operation and error handling
    await waitFor(() => {
      // Check service call
      expect(createManualThought).toHaveBeenCalledTimes(1);
      expect(createManualThought).toHaveBeenCalledWith(sermonId, expect.objectContaining({ text: thoughtText })); 
    });

    // Check error toast
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1); // Check call count
      // Expect the correct error message key
      expect(toast.error).toHaveBeenCalledWith(expectedErrorMessageKey); 
    });

    // Check modal remains open and button is re-enabled
    expect(mockOnNewThought).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not submit if text area is empty', async () => {
    const user = userEvent.setup();
    renderComponent();
    await user.click(screen.getByRole('button', { name: /manualThought.addManual/i })); // Open modal

    const saveButton = screen.getByRole('button', { name: /buttons.save/i });
    expect(saveButton).toBeDisabled(); // Should be disabled initially

    const textarea = screen.getByPlaceholderText(/manualThought.placeholder/i);
    await user.type(textarea, '   '); // Enter only whitespace
    expect(saveButton).toBeDisabled(); // Should still be disabled

    await user.click(saveButton);
    expect(createManualThought).not.toHaveBeenCalled();
    expect(mockOnNewThought).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // Modal should remain open
  });
});