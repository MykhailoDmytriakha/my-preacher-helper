import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import EditSermonModal from '@/components/EditSermonModal';
import { Sermon } from '@/models/models';
import { addPreachDate, deletePreachDate, updatePreachDate } from '@/services/preachDates.service';
import { updateSermon } from '@/services/sermon.service';
import '@testing-library/jest-dom';

const mockUseOnlineStatus = jest.fn(() => true);

// Mock dependencies
jest.mock('@/services/sermon.service', () => ({
  updateSermon: jest.fn()
}));

jest.mock('@/services/preachDates.service', () => ({
  addPreachDate: jest.fn(),
  updatePreachDate: jest.fn(),
  deletePreachDate: jest.fn(),
}));

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockUseOnlineStatus(),
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
          'editSermon.plannedDateLabel': 'Planned preaching date (optional)',
          'editSermon.clearPlannedDate': 'Clear',
          'editSermon.plannedDateHint': 'Leave empty if you do not want a planned date',
          'editSermon.updateError': 'Failed to update sermon',
          'buttons.cancel': 'Cancel',
          'buttons.save': 'Save',
          'buttons.saving': 'Saving',
          'calendar.unspecifiedChurch': 'Church not specified',
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

  const mockSermonWithPlannedDate: Sermon = {
    ...mockSermon,
    preachDates: [
      {
        id: 'pd-existing',
        date: '2099-04-10',
        status: 'planned',
        church: { id: 'church-unspecified', name: 'Church not specified', city: '' },
        createdAt: '2099-01-01T00:00:00.000Z'
      }
    ]
  };

  const mockSermonWithPlannedDateInPayload: Sermon = {
    ...mockSermonWithPlannedDate,
    title: 'Updated Sermon Title',
    verse: 'Romans 8:28',
  };

  const mockProps = {
    sermon: mockSermon,
    onClose: jest.fn(),
    onUpdate: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOnlineStatus.mockReturnValue(true);
    (updateSermon as jest.Mock).mockResolvedValue(mockUpdatedSermon);
    (addPreachDate as jest.Mock).mockResolvedValue({
      id: 'pd-added',
      date: '2026-04-10',
      status: 'planned',
      church: { id: 'church-unspecified', name: 'Church not specified', city: '' },
      createdAt: '2026-01-01T00:00:00.000Z'
    });
    (updatePreachDate as jest.Mock).mockResolvedValue({
      id: 'pd-updated',
      date: '2026-04-11',
      status: 'planned',
      church: { id: 'church-unspecified', name: 'Church not specified', city: '' },
      createdAt: '2026-01-01T00:00:00.000Z'
    });
    (deletePreachDate as jest.Mock).mockResolvedValue(undefined);
    
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
    expect(screen.getByLabelText('Planned preaching date (optional)')).toHaveValue('');
    
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
    expect(screen.getByText('Save')).toBeEnabled();
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

  test('creates planned date when user sets planned date and saves', async () => {
    render(<EditSermonModal {...mockProps} />);

    fireEvent.change(screen.getByLabelText('Planned preaching date (optional)'), {
      target: { value: '2026-04-10' }
    });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(updateSermon).toHaveBeenCalled();
      expect(addPreachDate).toHaveBeenCalledWith(
        'test-sermon-id',
        expect.objectContaining({
          date: '2026-04-10',
          status: 'planned'
        })
      );
      expect(updatePreachDate).not.toHaveBeenCalled();
      expect(deletePreachDate).not.toHaveBeenCalled();
      expect(mockProps.onUpdate).toHaveBeenCalled();
      expect(mockProps.onClose).toHaveBeenCalled();
    });
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
      expect(screen.getByText('Cancel')).toBeEnabled();
    });
  });

  test('clears existing planned date and deletes it on save', async () => {
    render(
      <EditSermonModal
        sermon={mockSermonWithPlannedDate}
        onClose={mockProps.onClose}
        onUpdate={mockProps.onUpdate}
      />
    );

    const dateInput = screen.getByLabelText('Planned preaching date (optional)');
    expect(dateInput).toHaveValue('2099-04-10');

    fireEvent.click(screen.getByText('Clear'));
    expect(dateInput).toHaveValue('');

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(updateSermon).toHaveBeenCalled();
      expect(deletePreachDate).toHaveBeenCalledWith('test-sermon-id', 'pd-existing');
      expect(addPreachDate).not.toHaveBeenCalled();
      expect(updatePreachDate).not.toHaveBeenCalled();
      expect(mockProps.onUpdate).toHaveBeenCalled();
      expect(mockProps.onClose).toHaveBeenCalled();
    });
  });

  test('updates existing planned date and preserves preach date identity in merged sermon', async () => {
    (updateSermon as jest.Mock).mockResolvedValueOnce({
      ...mockSermonWithPlannedDateInPayload,
      preachDates: [
        {
          id: 'pd-existing',
          date: '2099-04-10',
          status: 'planned',
          church: { id: 'church-unspecified', name: 'Church not specified', city: '' },
          createdAt: '2099-01-01T00:00:00.000Z'
        }
      ]
    });
    (updatePreachDate as jest.Mock).mockResolvedValueOnce({
      id: 'pd-existing',
      date: '2099-04-20',
      status: 'planned',
      church: { id: 'church-unspecified', name: 'Church not specified', city: '' },
      createdAt: '2099-01-01T00:00:00.000Z'
    });

    render(
      <EditSermonModal
        sermon={mockSermonWithPlannedDate}
        onClose={mockProps.onClose}
        onUpdate={mockProps.onUpdate}
      />
    );

    fireEvent.change(screen.getByLabelText('Planned preaching date (optional)'), {
      target: { value: '2099-04-20' }
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(updatePreachDate).toHaveBeenCalledWith('test-sermon-id', 'pd-existing', {
        date: '2099-04-20',
        status: 'planned'
      });
      expect(addPreachDate).not.toHaveBeenCalled();
      expect(deletePreachDate).not.toHaveBeenCalled();
      expect(mockProps.onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          preachDates: [
            expect.objectContaining({
              id: 'pd-existing',
              date: '2099-04-20',
              createdAt: '2099-01-01T00:00:00.000Z'
            })
          ]
        })
      );
    });
  });

  test('delegates save to onSaveRequest when provided', async () => {
    const onSaveRequest = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const onUpdate = jest.fn();

    render(
      <EditSermonModal
        sermon={mockSermon}
        onClose={onClose}
        onUpdate={onUpdate}
        onSaveRequest={onSaveRequest}
      />
    );

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Delegated Save Title' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSaveRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          sermon: mockSermon,
          title: 'Delegated Save Title',
          verse: mockSermon.verse,
          plannedDate: '',
          initialPlannedDate: '',
        })
      );
    });

    expect(updateSermon).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test('logs delegated save errors and exits submitting state', async () => {
    const onSaveRequest = jest.fn().mockRejectedValue(new Error('delegated-save-failed'));
    const onClose = jest.fn();
    const onUpdate = jest.fn();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    render(
      <EditSermonModal
        sermon={mockSermon}
        onClose={onClose}
        onUpdate={onUpdate}
        onSaveRequest={onSaveRequest}
      />
    );

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Delegated Error Title' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(onSaveRequest).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Save')).toBeEnabled();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error scheduling optimistic sermon update:',
      expect.any(Error)
    );
    expect(onUpdate).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
