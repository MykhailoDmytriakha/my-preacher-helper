import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import AddSermonModal from '@/components/AddSermonModal';
import { auth } from '@/services/firebaseAuth.service';
import { addPreachDate } from '@/services/preachDates.service';
import { createSermon } from '@/services/sermon.service';

import { TestProviders } from '../../test-utils/test-providers';
import '@testing-library/jest-dom';

const mockUseAuth = jest.fn<{ user: { uid: string } | null }, []>(() => ({ user: { uid: 'test-user-id' } }));
const mockUseSeries = jest.fn((_userId: string | null) => ({ series: [] }));

// Mock dependencies
jest.mock('@/services/sermon.service', () => ({
  createSermon: jest.fn().mockResolvedValue({
    id: 'mocked-sermon-id',
    title: 'Mocked Sermon',
    verse: 'Mocked Verse',
    date: '2023-05-01T12:00:00Z',
    thoughts: [],
    userId: 'test-user-id'
  })
}));

jest.mock('@/services/preachDates.service', () => ({
  addPreachDate: jest.fn().mockResolvedValue({
    id: 'pd-1',
    date: '2026-04-10',
    status: 'planned',
    church: { id: 'church-unspecified', name: 'Church not specified', city: '' },
    createdAt: '2026-01-01T00:00:00.000Z'
  })
}));

jest.mock('@/services/firebaseAuth.service', () => ({
  auth: {
    currentUser: {
      uid: 'test-user-id'
    }
  }
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/hooks/useSeries', () => ({
  useSeries: (userId: string | null) => mockUseSeries(userId),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: jest.fn()
  })
}));

// Mock translations
jest.mock('react-i18next', () => ({
  useTranslation: () => {
    return {
      t: (key: string) => {
        const translations: Record<string, string> = {
          'addSermon.newSermon': 'New Sermon',
          'addSermon.titleLabel': 'Title',
          'addSermon.titlePlaceholder': 'Enter sermon title',
          'addSermon.titleExample': 'Example: Love that transforms',
          'addSermon.verseLabel': 'Scripture Reference',
          'addSermon.versePlaceholder': 'Enter scripture reference',
          'addSermon.verseExample': 'Example: John 3:16-17',
          'addSermon.plannedDateLabel': 'Planned preaching date (optional)',
          'addSermon.plannedDateHint': 'You can add church details later in Calendar',
          'addSermon.save': 'Save',
          'addSermon.cancel': 'Cancel',
          'calendar.unspecifiedChurch': 'Church not specified',
        };
        return translations[key] || key;
      }
    };
  },
}));

describe('AddSermonModal Component', () => {
  const mockOnNewSermonCreated = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { uid: 'test-user-id' } });
    mockUseSeries.mockReturnValue({ series: [] });
    (auth as any).currentUser = { uid: 'test-user-id' };
  });
  
  test('renders add button but not modal initially', () => {
    render(
      <TestProviders>
        <AddSermonModal onNewSermonCreated={mockOnNewSermonCreated} />
      </TestProviders>
    );

    // Button should be visible
    expect(screen.getByText('New Sermon')).toBeInTheDocument();

    // Modal should not be visible initially
    expect(screen.queryByRole('heading', { name: 'New Sermon' })).not.toBeInTheDocument();
  });
  
  test('opens modal when add button is clicked', () => {
    render(
      <TestProviders>
        <AddSermonModal onNewSermonCreated={mockOnNewSermonCreated} />
      </TestProviders>
    );

    // Click the button to open modal
    fireEvent.click(screen.getByText('New Sermon'));

    // Modal should now be visible
    expect(screen.getByRole('heading', { name: 'New Sermon' })).toBeInTheDocument();
  });
  
  test('closes modal when cancel button is clicked', () => {
    render(
      <TestProviders>
        <AddSermonModal onNewSermonCreated={mockOnNewSermonCreated} />
      </TestProviders>
    );

    // Open the modal
    fireEvent.click(screen.getByText('New Sermon'));
    expect(screen.getByRole('heading', { name: 'New Sermon' })).toBeInTheDocument();

    // Click cancel
    fireEvent.click(screen.getByText('Cancel'));

    // Modal should be closed
    expect(screen.queryByRole('heading', { name: 'New Sermon' })).not.toBeInTheDocument();
  });

  test('calls onClose when provided and cancel is clicked', () => {
    const onClose = jest.fn();

    render(
      <TestProviders>
        <AddSermonModal onClose={onClose} />
      </TestProviders>
    );

    fireEvent.click(screen.getByText('New Sermon'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(onClose).toHaveBeenCalled();
  });

  test('calls onCancel when provided', () => {
    const onCancel = jest.fn();
    const onClose = jest.fn();

    render(
      <TestProviders>
        <AddSermonModal onCancel={onCancel} onClose={onClose} />
      </TestProviders>
    );

    // Open the modal
    fireEvent.click(screen.getByText('New Sermon'));
    expect(screen.getByRole('heading', { name: 'New Sermon' })).toBeInTheDocument();

    // Click cancel
    fireEvent.click(screen.getByText('Cancel'));

    expect(onCancel).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Modal remains open because parent controls close when onCancel is used
    expect(screen.getByRole('heading', { name: 'New Sermon' })).toBeInTheDocument();
  });

  test('renders modal when isOpen is true and trigger button is hidden', () => {
    render(
      <TestProviders>
        <AddSermonModal isOpen={true} showTriggerButton={false} />
      </TestProviders>
    );

    expect(screen.queryByRole('button', { name: 'New Sermon' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New Sermon' })).toBeInTheDocument();
  });
  
  test('calls createSermon with correct data when form is submitted', async () => {
    render(
      <TestProviders>
        <AddSermonModal />
      </TestProviders>
    );

    // Click add button to open modal
    fireEvent.click(screen.getByText('New Sermon'));
    
    // Fill in form fields
    fireEvent.change(screen.getByPlaceholderText('Enter sermon title'), {
      target: { value: 'Test Sermon Title' }
    });
    
    fireEvent.change(screen.getByPlaceholderText('Enter scripture reference'), {
      target: { value: 'Test 1:1-2' }
    });
    
    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    
    // Check that createSermon was called with correct data
    await waitFor(() => {
      expect(createSermon).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Sermon Title',
          verse: 'Test 1:1-2',
          userId: 'test-user-id',
          thoughts: [],
          date: expect.any(String),
        })
      );
    });
    expect(addPreachDate).not.toHaveBeenCalled();
  });

  test('creates planned preach date when optional planned date is filled', async () => {
    render(
      <TestProviders>
        <AddSermonModal allowPlannedDate />
      </TestProviders>
    );

    fireEvent.click(screen.getByText('New Sermon'));

    fireEvent.change(screen.getByPlaceholderText('Enter sermon title'), {
      target: { value: 'Planned Sermon Title' }
    });

    fireEvent.change(screen.getByPlaceholderText('Enter scripture reference'), {
      target: { value: 'Matt 5:1-2' }
    });

    fireEvent.change(screen.getByLabelText('Planned preaching date (optional)'), {
      target: { value: '2026-04-10' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createSermon).toHaveBeenCalled();
      expect(addPreachDate).toHaveBeenCalledWith(
        'mocked-sermon-id',
        expect.objectContaining({
          date: '2026-04-10',
          status: 'planned',
          church: expect.objectContaining({
            id: 'church-unspecified',
            name: 'Church not specified'
          })
        })
      );
    });
  });

  test('calls onNewSermonCreated when provided', async () => {
    const onNewSermonCreated = jest.fn();
    render(
      <TestProviders>
        <AddSermonModal onNewSermonCreated={onNewSermonCreated} />
      </TestProviders>
    );

    fireEvent.click(screen.getByText('New Sermon'));
    fireEvent.change(screen.getByPlaceholderText('Enter sermon title'), {
      target: { value: 'Test Sermon Title' }
    });
    fireEvent.change(screen.getByPlaceholderText('Enter scripture reference'), {
      target: { value: 'Test 1:1-2' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onNewSermonCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'mocked-sermon-id' })
      );
    });
  });

  test('handles authentication errors gracefully', async () => {
    (auth as any).currentUser = null;
    // Mock console.error
    jest.spyOn(console, 'error').mockImplementation();

    // Mock an authentication error
    (createSermon as jest.Mock).mockImplementationOnce(() => {
      console.error("User is not authenticated");
      throw new Error("User is not authenticated");
    });

    render(
      <TestProviders>
        <AddSermonModal />
      </TestProviders>
    );
    
    // Click add button to open modal
    fireEvent.click(screen.getByText('New Sermon'));
    
    // Fill in form fields
    fireEvent.change(screen.getByPlaceholderText('Enter sermon title'), {
      target: { value: 'Test Sermon Title' }
    });
    
    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // Wait for the error to be shown
    await waitFor(() => {
      expect(screen.findByText('Error creating sermon')).resolves.toBeInTheDocument();
    });

    // Restore mocks
    (console.error as jest.Mock).mockRestore();
  });

  test('uses null user id for series when user is missing', () => {
    mockUseAuth.mockReturnValue({ user: null });

    render(
      <TestProviders>
        <AddSermonModal />
      </TestProviders>
    );

    expect(mockUseSeries).toHaveBeenCalledWith(null);
  });

  test('handles API errors gracefully', async () => {
    // Mock console.error
    jest.spyOn(console, 'error').mockImplementation();

    // Mock an API error
    const apiError = new Error('Server error');
    (createSermon as jest.Mock).mockRejectedValueOnce(apiError);

    render(
      <TestProviders>
        <AddSermonModal />
      </TestProviders>
    );
    
    // Click add button to open modal
    fireEvent.click(screen.getByText('New Sermon'));
    
    // Fill in form fields
    fireEvent.change(screen.getByPlaceholderText('Enter sermon title'), {
      target: { value: 'Test Sermon Title' }
    });
    
    fireEvent.change(screen.getByPlaceholderText('Enter scripture reference'), {
      target: { value: 'Test 1:1-2' }
    });
    
    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    
    // Wait for the error to be shown
    await waitFor(() => {
      expect(screen.findByText('Error creating sermon')).resolves.toBeInTheDocument();
    });

    // Restore mocks
    (console.error as jest.Mock).mockRestore();
  });

  test('delegates create flow to onCreateRequest when provided', async () => {
    const onCreateRequest = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();

    render(
      <TestProviders>
        <AddSermonModal
          onCreateRequest={onCreateRequest}
          onClose={onClose}
          allowPlannedDate
        />
      </TestProviders>
    );

    fireEvent.click(screen.getByText('New Sermon'));

    fireEvent.change(screen.getByPlaceholderText('Enter sermon title'), {
      target: { value: 'Delegated Sermon' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter scripture reference'), {
      target: { value: 'Luke 4:18' },
    });
    fireEvent.change(screen.getByLabelText('Planned preaching date (optional)'), {
      target: { value: '2026-05-10' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onCreateRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Delegated Sermon',
          verse: 'Luke 4:18',
          plannedDate: '2026-05-10',
        })
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    expect(createSermon).not.toHaveBeenCalled();
  });

  test('logs optimistic create errors but still resets and closes modal', async () => {
    const onCreateRequest = jest.fn().mockRejectedValue(new Error('optimistic-fail'));
    const onClose = jest.fn();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    render(
      <TestProviders>
        <AddSermonModal
          onCreateRequest={onCreateRequest}
          onClose={onClose}
        />
      </TestProviders>
    );

    fireEvent.click(screen.getByText('New Sermon'));
    fireEvent.change(screen.getByPlaceholderText('Enter sermon title'), {
      target: { value: 'Failed Delegated Sermon' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter scripture reference'), {
      target: { value: 'Acts 1:8' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onCreateRequest).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error creating sermon (optimistic request):',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});
