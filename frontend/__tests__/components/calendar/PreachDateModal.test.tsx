import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import PreachDateModal from '@/components/calendar/PreachDateModal';
import { PreachDate } from '@/models/models';
import '@testing-library/jest-dom';

// Mock react-i18next
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const translations: { [key: string]: string } = {
                'calendar.addPreachDate': 'Add Preach Date',
                'calendar.editPreachDate': 'Edit Preach Date',
                'calendar.date': 'Date',
                'calendar.audience': 'Audience',
                'calendar.notes': 'Notes',
                'buttons.save': 'Save',
                'buttons.cancel': 'Cancel',
                'buttons.saving': 'Saving...',
            };
            return translations[key] || key;
        },
    }),
}));

// Mock ChurchAutocomplete
jest.mock('@/components/calendar/ChurchAutocomplete', () => {
    return function MockChurchAutocomplete({ onChange, initialValue }: any) {
        return (
            <div data-testid="church-autocomplete">
                <input
                    data-testid="church-input"
                    defaultValue={initialValue?.name || ''}
                    onChange={(e) => onChange({ id: 'c1', name: e.target.value, city: 'City' })}
                />
            </div>
        );
    };
});

describe('PreachDateModal', () => {
    const mockOnClose = jest.fn();
    const mockOnSave = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders with "Add" title when no initialData is provided', () => {
        render(
            <PreachDateModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
            />
        );

        expect(screen.getByText('Add Preach Date')).toBeInTheDocument();
        expect(screen.getByLabelText('Date')).toBeInTheDocument();
    });

    it('renders with "Edit" title and initial values when initialData is provided', () => {
        const initialData: PreachDate = {
            id: 'd1',
            date: '2023-10-27',
            church: { id: 'c1', name: 'Zion', city: 'Kyiv' },
            audience: 'Youth',
            notes: 'Good',
            createdAt: '...'
        };

        render(
            <PreachDateModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
                initialData={initialData}
            />
        );

        expect(screen.getByText('Edit Preach Date')).toBeInTheDocument();
        expect(screen.getByDisplayValue('2023-10-27')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Youth')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Good')).toBeInTheDocument();
    });

    it('calls onSave with form data on submit', async () => {
        mockOnSave.mockResolvedValue(undefined);
        render(
            <PreachDateModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
            />
        );

        // Fill church name (required for save button to be enabled)
        const churchInput = screen.getByTestId('church-input');
        fireEvent.change(churchInput, { target: { value: 'New Church' } });

        // Change audience
        const audienceInput = screen.getByPlaceholderText(/e.g. Youth/i);
        fireEvent.change(audienceInput, { target: { value: 'Adults' } });

        const saveButton = screen.getByText('Save');
        await act(async () => {
            fireEvent.click(saveButton);
        });

        expect(mockOnSave).toHaveBeenCalledWith(expect.objectContaining({
            church: { id: 'c1', name: 'New Church', city: 'City' },
            audience: 'Adults'
        }));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('calls onClose when cancel button is clicked', () => {
        render(
            <PreachDateModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
            />
        );

        fireEvent.click(screen.getByText('Cancel'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('disables save button if church name is empty', () => {
        render(
            <PreachDateModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
            />
        );

        const saveButton = screen.getByText('Save');
        expect(saveButton).toBeDisabled();
    });
});
