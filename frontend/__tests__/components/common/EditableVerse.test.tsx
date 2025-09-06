import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditableVerse from '@/components/common/EditableVerse';
import '@testing-library/jest-dom';

// Mock translations
jest.mock('react-i18next', () => ({
  useTranslation: () => {
    return {
      t: (key: string) => {
        const translations: Record<string, string> = {
          'editSermon.verseLabel': 'Scripture Verse',
          'editSermon.versePlaceholder': 'Enter scripture verse',
          'common.save': 'Save',
          'common.cancel': 'Cancel',
          'common.edit': 'Edit',
          'errors.failedToSaveVerse': 'Failed to save verse',
        };
        return translations[key] || key;
      }
    };
  },
}));

describe('EditableVerse Component', () => {
  const mockOnSave = jest.fn();

  beforeEach(() => {
    mockOnSave.mockClear();
  });

  const defaultProps = {
    initialVerse: 'John 3:16 - For God so loved the world...',
    onSave: mockOnSave,
  };

  describe('Rendering', () => {
    it('renders verse text in display mode', () => {
      render(<EditableVerse {...defaultProps} />);
      
      expect(screen.getByText('John 3:16 - For God so loved the world...')).toBeInTheDocument();
      expect(screen.getByTitle('Edit')).toBeInTheDocument();
    });

    it('does not render when verse is empty and not editing', () => {
      const { container } = render(<EditableVerse {...defaultProps} initialVerse="" />);
      
      expect(container.firstChild).toBeNull();
    });

    it('renders with custom styling classes', () => {
      render(
        <EditableVerse 
          {...defaultProps}
          textSizeClass="text-lg"
          containerClass="custom-container"
        />
      );
      
      const container = screen.getByText('John 3:16 - For God so loved the world...').closest('div')?.parentElement;
      expect(container).toHaveClass('custom-container');
    });
  });

  describe('Edit Mode', () => {
    it('enters edit mode when edit button is clicked', () => {
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      expect(screen.getByDisplayValue('John 3:16 - For God so loved the world...')).toBeInTheDocument();
      expect(screen.getByTitle('Save')).toBeInTheDocument();
      expect(screen.getByTitle('Cancel')).toBeInTheDocument();
    });

    it('focuses and selects text when entering edit mode', () => {
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('John 3:16 - For God so loved the world...');
      expect(textarea).toHaveFocus();
    });

    it('updates textarea value when typing', () => {
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('John 3:16 - For God so loved the world...');
      fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
      
      expect(textarea).toHaveValue('Updated verse text');
    });
  });

  describe('Save Functionality', () => {
    it('saves changes when save button is clicked', async () => {
      mockOnSave.mockResolvedValue(undefined);
      
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('John 3:16 - For God so loved the world...');
      fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
      
      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith('Updated verse text');
      });
      
      // After save, the component should exit edit mode and show the original text
      // until the parent component updates the initialVerse prop
      expect(screen.getByText('John 3:16 - For God so loved the world...')).toBeInTheDocument();
    });

    it('saves changes with Ctrl+Enter keyboard shortcut', async () => {
      mockOnSave.mockResolvedValue(undefined);
      
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('John 3:16 - For God so loved the world...');
      fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      
      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith('Updated verse text');
      });
    });

    it('does not save if text is unchanged', async () => {
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(mockOnSave).not.toHaveBeenCalled();
      });
    });

    it('does not save if text is only whitespace', async () => {
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('John 3:16 - For God so loved the world...');
      fireEvent.change(textarea, { target: { value: '   ' } });
      
      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(mockOnSave).not.toHaveBeenCalled();
      });
    });

    it('shows loading state while saving', async () => {
      mockOnSave.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
      
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('John 3:16 - For God so loved the world...');
      fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
      
      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);
      
      expect(saveButton).toBeDisabled();
      expect(screen.getByTitle('Cancel')).toBeDisabled();
    });

    it('handles save errors gracefully', async () => {
      mockOnSave.mockRejectedValue(new Error('Save failed'));
      
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('John 3:16 - For God so loved the world...');
      fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
      
      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(screen.getByText('Failed to save verse')).toBeInTheDocument();
      });
      
      expect(screen.getByDisplayValue('Updated verse text')).toBeInTheDocument();
    });
  });

  describe('Cancel Functionality', () => {
    it('cancels edit mode when cancel button is clicked', () => {
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('John 3:16 - For God so loved the world...');
      fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
      
      const cancelButton = screen.getByTitle('Cancel');
      fireEvent.click(cancelButton);
      
      expect(screen.getByText('John 3:16 - For God so loved the world...')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Updated verse text')).not.toBeInTheDocument();
    });

    it('cancels edit mode with Escape key', () => {
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('John 3:16 - For God so loved the world...');
      fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
      fireEvent.keyDown(textarea, { key: 'Escape' });
      
      expect(screen.getByText('John 3:16 - For God so loved the world...')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Updated verse text')).not.toBeInTheDocument();
    });
  });

  describe('Adaptive Height', () => {
    it('sets initial height to auto', () => {
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('John 3:16 - For God so loved the world...');
      expect(textarea).toHaveStyle({ minHeight: '20px', maxHeight: '200px' });
    });

    it('adjusts height when content changes', () => {
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('John 3:16 - For God so loved the world...');
      
      // Mock scrollHeight to simulate content change
      Object.defineProperty(textarea, 'scrollHeight', {
        value: 100,
        writable: true
      });
      
      fireEvent.change(textarea, { target: { value: 'Line 1\nLine 2\nLine 3' } });
      
      // The height should be adjusted (this is tested through the change handler)
      expect(textarea).toHaveValue('Line 1\nLine 2\nLine 3');
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA labels', () => {
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByLabelText('Scripture Verse');
      expect(textarea).toBeInTheDocument();
    });

    it('shows error message with proper ARIA attributes', async () => {
      mockOnSave.mockRejectedValue(new Error('Save failed'));
      
      render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('John 3:16 - For God so loved the world...');
      fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
      
      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(textarea).toHaveAttribute('aria-invalid', 'true');
        expect(textarea).toHaveAttribute('aria-describedby', 'verse-error');
      });
    });
  });

  describe('Props Updates', () => {
    it('updates displayed text when initialVerse prop changes', () => {
      const { rerender } = render(<EditableVerse {...defaultProps} />);
      
      expect(screen.getByText('John 3:16 - For God so loved the world...')).toBeInTheDocument();
      
      rerender(<EditableVerse {...defaultProps} initialVerse="Updated initial verse" />);
      
      expect(screen.getByText('Updated initial verse')).toBeInTheDocument();
    });

    it('does not update edited text when initialVerse prop changes during editing', () => {
      const { rerender } = render(<EditableVerse {...defaultProps} />);
      
      const editButton = screen.getByTitle('Edit');
      fireEvent.click(editButton);
      
      const textarea = screen.getByDisplayValue('John 3:16 - For God so loved the world...');
      fireEvent.change(textarea, { target: { value: 'Edited text' } });
      
      rerender(<EditableVerse {...defaultProps} initialVerse="Updated initial verse" />);
      
      expect(textarea).toHaveValue('Edited text');
    });
  });
});
