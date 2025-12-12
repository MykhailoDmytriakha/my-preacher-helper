import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import AddSermonModal from '@/components/AddSermonModal';
import { createSermon } from '@/services/sermon.service';

import { TestProviders } from '../../test-utils/test-providers';
import '@testing-library/jest-dom';

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

jest.mock('@/services/firebaseAuth.service', () => ({
  auth: {
    currentUser: {
      uid: 'test-user-id'
    }
  }
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
          'addSermon.save': 'Save',
          'addSermon.cancel': 'Cancel',
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
  });
  
  test('handles authentication errors gracefully', async () => {
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
}); 
