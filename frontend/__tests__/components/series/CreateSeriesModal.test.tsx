import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import CreateSeriesModal from '@/components/series/CreateSeriesModal';
import '@testing-library/jest-dom';

// Mock the createPortal function
jest.mock('react-dom', () => {
  return {
    ...jest.requireActual('react-dom'),
    createPortal: (element: React.ReactNode) => element,
  };
});

// Mock translations
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'workspaces.series.newSeries': 'New Series',
        'workspaces.series.description': 'Organize your sermon series',
        'workspaces.series.form.title': 'Series Title',
        'workspaces.series.form.titlePlaceholder': 'Enter series title',
        'workspaces.series.form.description': 'Description',
        'workspaces.series.form.descriptionPlaceholder': 'Brief description...',
        'workspaces.series.form.bookOrTopic': 'Book/Topic',
        'workspaces.series.form.bookOrTopicPlaceholder': 'e.g., Romans',
        'workspaces.series.form.color': 'Theme Color',
        'workspaces.series.form.status': 'Status',
        'workspaces.series.form.statuses.draft': 'Draft',
        'workspaces.series.form.statuses.active': 'Active',
        'workspaces.series.form.statuses.completed': 'Completed',
        'workspaces.series.form.createHint': 'Give your series a name, theme, and pick a color.',
        'workspaces.series.form.editHint': 'Update the title, theme, status, or color.',
        'workspaces.series.actions.createSeries': 'Create Series',
        'workspaces.series.actions.cancel': 'Cancel',
        'common.saving': 'Saving...'
      };
      const template = translations[key] || key;
      if (options && typeof options.count !== 'undefined') {
        if (key === 'workspaces.series.form.initialSermonsHint') {
          return `${options.count} sermon(s) will be added to this series`;
        }
        return template.replace('{{count}}', String(options.count));
      }
      return template;
    }
  })
}));

// Mock useAuth
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'test-user-id' }
  })
}));

describe('CreateSeriesModal Component', () => {
  const mockOnClose = jest.fn();
  const mockOnCreate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders with correct initial values', () => {
    render(
      <CreateSeriesModal
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    // Check modal title
    expect(screen.getByText('New Series')).toBeInTheDocument();

    // Check form fields are empty initially
    const titleInput = screen.getByPlaceholderText('Enter series title');
    const descriptionInput = screen.getByPlaceholderText('Brief description...');
    const bookTopicInput = screen.getByPlaceholderText('e.g., Romans');

    expect(titleInput).toHaveValue('');
    expect(descriptionInput).toHaveValue('');
    expect(bookTopicInput).toHaveValue('');

    // Check color picker section
    expect(screen.getByText('Theme Color')).toBeInTheDocument();

    // Check color buttons exist (8 preset + 1 custom)
    const colorButtons = document.querySelectorAll('button[title]');
    expect(colorButtons).toHaveLength(9); // 8 preset + 1 custom
  });

  test('displays preset color buttons correctly', () => {
    render(
      <CreateSeriesModal
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    const colorButtons = document.querySelectorAll('button[title]');
    const presetColors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6B7280', '#000000'];

    presetColors.forEach((color, index) => {
      expect(colorButtons[index]).toHaveAttribute('title', color);
      expect(colorButtons[index]).toHaveStyle(`background-color: ${color}`);
    });
  });

  test('custom color button shows rainbow gradient when no custom color is selected', () => {
    render(
      <CreateSeriesModal
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    const colorButtons = document.querySelectorAll('button[title]');
    const customColorButton = colorButtons[8]; // Last button is custom

    // Should show rainbow gradient background
    expect(customColorButton).toHaveStyle({
      background: 'conic-gradient(from 0deg, #FF0000 0%, #FFFF00 60deg, #00FF00 120deg, #00FFFF 180deg, #0000FF 240deg, #FF00FF 300deg, #FF0000 360deg)'
    });
  });

  test('shows plus icon on custom color button when rainbow gradient is displayed', () => {
    render(
      <CreateSeriesModal
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    // Check that plus icon is present in the custom color button
    const plusIcon = document.querySelector('button svg');
    expect(plusIcon).toBeInTheDocument();
  });

  test('clicking preset color button updates selected color', () => {
    render(
      <CreateSeriesModal
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    const colorButtons = document.querySelectorAll('button[title]');
    const greenButton = colorButtons[1]; // #10B981 (green)

    fireEvent.click(greenButton);

    // Check that the button now has selected styling
    expect(greenButton).toHaveClass('scale-110');
    expect(greenButton).toHaveClass('border-blue-600');
  });

  test('custom color button is rendered with correct attributes', () => {
    render(
      <CreateSeriesModal
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    const colorButtons = document.querySelectorAll('button[title]');
    const customColorButton = colorButtons[8];

    // Verify the button exists and has correct attributes
    expect(customColorButton).toBeInTheDocument();
    expect(customColorButton).toHaveAttribute('title', 'Custom color');
  });

  test('calls onClose when cancel button is clicked', () => {
    render(
      <CreateSeriesModal
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  test('shows initial sermon info when initialSermonIds provided', () => {
    render(
      <CreateSeriesModal
        onClose={mockOnClose}
        onCreate={mockOnCreate}
        initialSermonIds={['sermon1', 'sermon2']}
      />
    );

    expect(screen.getByText('2 sermon(s) will be added to this series')).toBeInTheDocument();
  });

  test('form submission with valid data calls onCreate', async () => {
    render(
      <CreateSeriesModal
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    // Fill in required fields
    fireEvent.change(screen.getByPlaceholderText('Enter series title'), {
      target: { value: 'Test Series' }
    });
    fireEvent.change(screen.getByPlaceholderText('e.g., Romans'), {
      target: { value: 'Genesis' }
    });

    // Submit the form
    const submitButton = screen.getByRole('button', { name: 'Create Series' });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnCreate).toHaveBeenCalledWith({
        title: 'Test Series',
        theme: 'Test Series',
        description: undefined,
        bookOrTopic: 'Genesis',
        color: '#3B82F6', // Default color
        status: 'draft',
        sermonIds: [],
        userId: 'test-user-id',
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      });
    });
  });
});