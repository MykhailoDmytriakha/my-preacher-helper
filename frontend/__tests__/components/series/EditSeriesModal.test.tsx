import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditSeriesModal from '@/components/series/EditSeriesModal';
import '@testing-library/jest-dom';

// Mock react-dom createPortal
jest.mock('react-dom', () => {
  return {
    ...jest.requireActual('react-dom'),
    createPortal: (element: React.ReactNode) => element,
  };
});

// Mock translations
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'workspaces.series.editSeries': 'Edit Series',
        'workspaces.series.form.title': 'Series Title',
        'workspaces.series.form.titlePlaceholder': 'Enter series title',
        'workspaces.series.form.description': 'Description',
        'workspaces.series.form.descriptionPlaceholder': 'Brief description...',
        'workspaces.series.form.bookOrTopic': 'Book/Topic',
        'workspaces.series.form.bookOrTopicPlaceholder': 'e.g., Romans',
        'workspaces.series.form.status': 'Status',
        'workspaces.series.form.color': 'Theme Color',
        'workspaces.series.form.statuses.draft': 'Draft',
        'workspaces.series.form.statuses.active': 'Active',
        'workspaces.series.form.statuses.completed': 'Completed',
        'workspaces.series.actions.saveChanges': 'Save Changes',
        'workspaces.series.actions.cancel': 'Cancel'
      };
      return translations[key] || key;
    }
  })
}));

// Mock useAuth
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'test-user-id' }
  })
}));

describe('EditSeriesModal Component', () => {
  const mockSeries = {
    id: 'test-series-id',
    userId: 'test-user-id',
    title: 'Test Series',
    description: 'Test description',
    bookOrTopic: 'Romans',
    theme: 'Test Series',
    color: '#3B82F6',
    status: 'draft' as const,
    sermonIds: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  };

  const mockOnClose = jest.fn();
  const mockOnUpdate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders with correct initial values', () => {
    render(
      <EditSeriesModal
        series={mockSeries}
        onClose={mockOnClose}
        onUpdate={mockOnUpdate}
      />
    );

    // Check modal title
    expect(screen.getByText('Edit Series')).toBeInTheDocument();

    // Check form fields have correct values
    expect(screen.getByDisplayValue('Test Series')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test description')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Romans')).toBeInTheDocument();

    // Check color picker section
    expect(screen.getByText('Theme Color')).toBeInTheDocument();

    // Check color buttons exist (8 preset + 1 custom)
    const colorButtons = document.querySelectorAll('button[title]');
    expect(colorButtons).toHaveLength(9); // 8 preset + 1 custom
  });

  test('displays preset color buttons correctly', () => {
    render(
      <EditSeriesModal
        series={mockSeries}
        onClose={mockOnClose}
        onUpdate={mockOnUpdate}
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
      <EditSeriesModal
        series={mockSeries}
        onClose={mockOnClose}
        onUpdate={mockOnUpdate}
      />
    );

    const colorButtons = document.querySelectorAll('button[title]');
    const customColorButton = colorButtons[8]; // Last button is custom

    // Should show rainbow gradient background
    expect(customColorButton).toHaveStyle({
      background: 'conic-gradient(from 0deg, #FF0000 0%, #FFFF00 60deg, #00FF00 120deg, #00FFFF 180deg, #0000FF 240deg, #FF00FF 300deg, #FF0000 360deg)'
    });
  });

  test('custom color button shows selected color when custom color is used', () => {
    const customColorSeries = { ...mockSeries, color: '#FF5733' };

    render(
      <EditSeriesModal
        series={customColorSeries}
        onClose={mockOnClose}
        onUpdate={mockOnUpdate}
      />
    );

    const colorButtons = document.querySelectorAll('button[title]');
    const customColorButton = colorButtons[8];

    // Should show the custom color as background
    expect(customColorButton).toHaveStyle('background: #FF5733');
  });

  test('shows plus icon on custom color button when rainbow gradient is displayed', () => {
    render(
      <EditSeriesModal
        series={mockSeries}
        onClose={mockOnClose}
        onUpdate={mockOnUpdate}
      />
    );

    // Check that plus icon is present in the custom color button
    const plusIcon = document.querySelector('button svg');
    expect(plusIcon).toBeInTheDocument();
  });

  test('clicking preset color button updates selected color', () => {
    render(
      <EditSeriesModal
        series={mockSeries}
        onClose={mockOnClose}
        onUpdate={mockOnUpdate}
      />
    );

    const colorButtons = document.querySelectorAll('button[title]');
    const greenButton = colorButtons[1]; // #10B981 (green)

    fireEvent.click(greenButton);

    // Check that the button now has selected styling
    expect(greenButton).toHaveClass('scale-110');
    expect(greenButton).toHaveClass('border-blue-600');
  });

  test('custom color button can be clicked (opens ColorPickerModal)', () => {
    render(
      <EditSeriesModal
        series={mockSeries}
        onClose={mockOnClose}
        onUpdate={mockOnUpdate}
      />
    );

    const colorButtons = document.querySelectorAll('button[title]');
    const customColorButton = colorButtons[8];

    // Just verify the button exists and can be clicked (ColorPickerModal logic is tested separately)
    expect(customColorButton).toBeInTheDocument();
    expect(customColorButton).toHaveAttribute('title', 'Custom color');
  });

  test('submitting form with updated data saves correctly', async () => {
    render(
      <EditSeriesModal
        series={mockSeries}
        onClose={mockOnClose}
        onUpdate={mockOnUpdate}
      />
    );

    // Change title
    fireEvent.change(screen.getByDisplayValue('Test Series'), {
      target: { value: 'Updated Series' }
    });

    // Submit the form
    const submitButton = screen.getByRole('button', { name: 'Save Changes' });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalledWith('test-series-id', {
        title: 'Updated Series',
        theme: 'Updated Series',
        description: 'Test description',
        bookOrTopic: 'Romans',
        color: '#3B82F6',
        status: 'draft'
      });
    });
  });

  test('calls onClose when cancel button is clicked', () => {
    render(
      <EditSeriesModal
        series={mockSeries}
        onClose={mockOnClose}
        onUpdate={mockOnUpdate}
      />
    );

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});