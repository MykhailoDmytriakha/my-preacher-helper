import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

jest.mock('@locales/i18n', () => ({}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'wizard.steps.exegeticalPlan.authorIntent.title': 'Author\'s Intent',
        'wizard.steps.exegeticalPlan.authorIntent.description': 'The original meaning the author put in when writing these verses',
        'wizard.steps.exegeticalPlan.authorIntent.placeholder': 'Describe the author\'s intent for this passage...',
        'actions.cancel': 'Cancel',
        'actions.save': 'Save',
        'buttons.saving': 'Saving...'
      };
      return translations[key] || key;
    }
  })
}));

import AuthorIntentSection from '@/components/sermon/prep/exegeticalPlan/AuthorIntentSection';

describe('AuthorIntentSection', () => {
  const mockOnChange = jest.fn();
  const mockOnSave = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders with all required elements', () => {
      render(
        <AuthorIntentSection
          value=""
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={false}
          hasChanges={false}
        />
      );

      expect(screen.getByText('Author\'s Intent')).toBeInTheDocument();
      expect(screen.getByText('The original meaning the author put in when writing these verses')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Describe the author\'s intent for this passage...')).toBeInTheDocument();
    });

    it('displays the value in textarea', () => {
      render(
        <AuthorIntentSection
          value="This is the author's intent"
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={false}
          hasChanges={false}
        />
      );

      const textarea = screen.getByPlaceholderText('Describe the author\'s intent for this passage...') as HTMLTextAreaElement;
      expect(textarea.value).toBe('This is the author\'s intent');
    });

    it('shows save and cancel buttons when hasChanges is true', () => {
      render(
        <AuthorIntentSection
          value="Modified text"
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={false}
          hasChanges={true}
        />
      );

      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    it('hides save and cancel buttons when hasChanges is false', () => {
      render(
        <AuthorIntentSection
          value=""
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={false}
          hasChanges={false}
        />
      );

      expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
      expect(screen.queryByText('Save')).not.toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('calls onChange when textarea value changes', () => {
      render(
        <AuthorIntentSection
          value=""
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={false}
          hasChanges={false}
        />
      );

      const textarea = screen.getByPlaceholderText('Describe the author\'s intent for this passage...');
      fireEvent.change(textarea, { target: { value: 'New intent' } });

      expect(mockOnChange).toHaveBeenCalledWith('New intent');
    });

    it('calls onSave when save button is clicked', async () => {
      render(
        <AuthorIntentSection
          value="Intent to save"
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={false}
          hasChanges={true}
        />
      );

      const saveButton = screen.getByText('Save');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalled();
      });
    });

    it('calls onChange with empty string when cancel button is clicked', () => {
      render(
        <AuthorIntentSection
          value="Intent to cancel"
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={false}
          hasChanges={true}
        />
      );

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(mockOnChange).toHaveBeenCalledWith('');
    });
  });

  describe('Loading States', () => {
    it('shows "Saving..." text when isSaving is true', () => {
      render(
        <AuthorIntentSection
          value="Saving content"
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={true}
          hasChanges={true}
        />
      );

      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    it('disables save button when isSaving is true', () => {
      render(
        <AuthorIntentSection
          value="Saving content"
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={true}
          hasChanges={true}
        />
      );

      const saveButton = screen.getByText('Saving...');
      expect(saveButton).toBeDisabled();
    });

    it('does not call onSave when button is clicked during saving', () => {
      render(
        <AuthorIntentSection
          value="Content"
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={true}
          hasChanges={true}
        />
      );

      const saveButton = screen.getByText('Saving...');
      fireEvent.click(saveButton);

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('does not call onSave when hasChanges is false', () => {
      render(
        <AuthorIntentSection
          value="Content"
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={false}
          hasChanges={false}
        />
      );

      expect(screen.queryByText('Save')).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has proper textarea attributes', () => {
      render(
        <AuthorIntentSection
          value=""
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={false}
          hasChanges={false}
        />
      );

      const textarea = screen.getByPlaceholderText('Describe the author\'s intent for this passage...');
      expect(textarea).toHaveAttribute('rows', '3');
      expect(textarea).toHaveClass('resize-none');
    });

    it('save button has proper title attribute', () => {
      render(
        <AuthorIntentSection
          value="Content"
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={false}
          hasChanges={true}
        />
      );

      const saveButton = screen.getByText('Save');
      expect(saveButton).toHaveAttribute('title', 'Save');
    });
  });

  describe('Edge Cases', () => {
    it('handles multiline text correctly', () => {
      const multilineText = 'Line 1\nLine 2\nLine 3';
      render(
        <AuthorIntentSection
          value={multilineText}
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={false}
          hasChanges={false}
        />
      );

      const textarea = screen.getByPlaceholderText('Describe the author\'s intent for this passage...') as HTMLTextAreaElement;
      expect(textarea.value).toBe(multilineText);
    });

    it('handles very long text', () => {
      const longText = 'A'.repeat(1000);
      render(
        <AuthorIntentSection
          value={longText}
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={false}
          hasChanges={false}
        />
      );

      const textarea = screen.getByPlaceholderText('Describe the author\'s intent for this passage...') as HTMLTextAreaElement;
      expect(textarea.value).toBe(longText);
    });

    it('handles special characters in text', () => {
      const specialText = '<script>alert("xss")</script>';
      render(
        <AuthorIntentSection
          value={specialText}
          onChange={mockOnChange}
          onSave={mockOnSave}
          isSaving={false}
          hasChanges={false}
        />
      );

      const textarea = screen.getByPlaceholderText('Describe the author\'s intent for this passage...') as HTMLTextAreaElement;
      expect(textarea.value).toBe(specialText);
    });
  });
});
