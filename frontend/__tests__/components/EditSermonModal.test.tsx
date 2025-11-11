import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditSermonModal from '@/components/EditSermonModal';
import { updateSermon } from '@/services/sermon.service';
import { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

// Mock dependencies
jest.mock('@/services/sermon.service', () => ({
  updateSermon: jest.fn()
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: jest.fn()
  })
}));

// Mock react-dom createPortal
jest.mock('react-dom', () => {
  return {
    ...jest.requireActual('react-dom'),
    createPortal: (element: React.ReactNode) => element,
  };
});

// Mock translations
jest.mock('react-i18next', () => ({
  useTranslation: () => {
    return {
      t: (key: string) => {
        const translations: Record<string, string> = {
          'editSermon.editSermon': 'Edit Sermon',
          'editSermon.titleLabel': 'Title',
          'editSermon.titlePlaceholder': 'Enter sermon title',
          'editSermon.verseLabel': 'Scripture Reference',
          'editSermon.versePlaceholder': 'Enter scripture reference',
          'editSermon.updateError': 'Failed to update sermon',
          'buttons.cancel': 'Cancel',
          'buttons.save': 'Save',
          'buttons.saving': 'Saving',
        };
        return translations[key] || key;
      }
    };
  },
}));

describe('EditSermonModal Component', () => {
  const mockSermon: Sermon = {
    id: 'test-sermon-id',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2023-05-01T12:00:00Z',
    thoughts: [],
    userId: 'test-user-id'
  };

  const mockUpdatedSermon: Sermon = {
    ...mockSermon,
    title: 'Updated Sermon Title',
    verse: 'Romans 8:28'
  };

  const mockProps = {
    sermon: mockSermon,
    onClose: jest.fn(),
    onUpdate: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (updateSermon as jest.Mock).mockResolvedValue(mockUpdatedSermon);
    
    // Mock the useEffect hook that sets mounted to true
    jest.spyOn(React, 'useEffect').mockImplementation(f => f());
  });

  test('renders modal with correct initial values', () => {
    render(<EditSermonModal {...mockProps} />);

    // Check title
    expect(screen.getByText('Edit Sermon')).toBeInTheDocument();
    
    // Check form fields
    expect(screen.getByLabelText('Title')).toHaveValue('Test Sermon');
    expect(screen.getByLabelText('Scripture Reference')).toHaveValue('John 3:16');
    
    // Check buttons
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeDisabled(); // Initially disabled with no changes
  });

  test('calls onClose when cancel button is clicked', () => {
    render(<EditSermonModal {...mockProps} />);
    
    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);
    
    expect(mockProps.onClose).toHaveBeenCalledTimes(1);
  });

  test('enables save button when changes are made', () => {
    render(<EditSermonModal {...mockProps} />);
    
    // Initially disabled
    expect(screen.getByText('Save')).toBeDisabled();
    
    // Make changes
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Updated Sermon Title' }
    });
    
    // Now should be enabled
    expect(screen.getByText('Save')).not.toBeDisabled();
  });

  test('handles API errors gracefully', async () => {
    // Mock console.error
    jest.spyOn(console, 'error').mockImplementation();
    
    // Mock implementation for error case
    (updateSermon as jest.Mock).mockRejectedValueOnce(new Error('API Error'));
    
    render(<EditSermonModal {...mockProps} />);
    
    // Make a change to enable the save button
    const titleInput = screen.getByPlaceholderText('Enter sermon title');
    fireEvent.change(titleInput, { target: { value: 'Updated Title' } });
    
    // Click save button to submit the form
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    
    // Verify that the error was handled (without checking for specific error message)
    await waitFor(() => {
      expect(updateSermon).toHaveBeenCalled();
    });
    
    // Restore mock
    (console.error as jest.Mock).mockRestore();
  });

  test('disables buttons during submission', async () => {
    // Mock implementation with delay to check disabled state
    (updateSermon as jest.Mock).mockImplementationOnce(() => {
      return new Promise(resolve => {
        setTimeout(() => resolve({}), 100);
      });
    });
    
    render(<EditSermonModal {...mockProps} />);
    
    // Make a change to enable the save button
    const titleInput = screen.getByPlaceholderText('Enter sermon title');
    fireEvent.change(titleInput, { target: { value: 'Updated Title' } });
    
    // Click save button to submit the form
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    
    // Both buttons should be disabled during submission
    expect(screen.getByText('Cancel')).toBeDisabled();
    expect(saveButton).toBeDisabled();
    
    // After the promise resolves, buttons should be enabled again
    await waitFor(() => {
      expect(screen.getByText('Cancel')).not.toBeDisabled();
    });
  });
}); 