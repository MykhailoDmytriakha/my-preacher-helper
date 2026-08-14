import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';
import PreachDateModal from '@/components/calendar/PreachDateModal';
import { PreachDate } from '@/models/models';
import { persistedWrite, queuedWrite } from '@/utils/recoverableWrite';
import '@testing-library/jest-dom';

// Mock createPortal to render inline in tests
jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: React.ReactNode) => node,
}));

jest.mock('react-day-picker/dist/style.css', () => ({}));

jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { uid: 'user-1' } }),
}));

jest.mock('@/hooks/useUserSettings', () => ({
    useUserSettings: () => ({ settings: { firstDayOfWeek: 'sunday' } }),
}));

// Mock react-i18next
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const translations: { [key: string]: string } = {
                'calendar.addPreachDate': 'Add Preach Date',
                'calendar.editPreachDate': 'Edit Preach Date',
                'calendar.date': 'Date',
                'calendar.audience': 'Audience',
                'calendar.audiencePlaceholder': 'e.g. Youth, General Service, Wedding',
                'calendar.notesPlaceholder': 'Any specific feedback or things to improve...',
                'calendar.notes': 'Notes',
                'buttons.save': 'Save',
                'buttons.cancel': 'Cancel',
                'buttons.saving': 'Saving...',
                'writeRecovery.refused': 'Save refused. Nothing was saved; your text is still here.',
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
        mockOnSave.mockImplementation(() => persistedWrite(Promise.resolve()));
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

    it('keeps the exact preaching notes in the open form when refused', async () => {
        const refusal = Object.assign(new Error('Permission denied'), { code: 'permission-denied' });
        mockOnSave.mockImplementationOnce(() => persistedWrite(Promise.reject(refusal)));
        render(
            <PreachDateModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
            />
        );

        const date = screen.getByLabelText('Date');
        const church = screen.getByTestId('church-input');
        const audience = screen.getByPlaceholderText(/e.g. Youth/i);
        const notes = screen.getByPlaceholderText('Any specific feedback or things to improve...');
        fireEvent.change(date, { target: { value: '2026-11-19' } });
        fireEvent.change(church, { target: { value: 'Refused Church' } });
        fireEvent.change(audience, { target: { value: 'Exact refused audience' } });
        fireEvent.change(notes, { target: { value: 'Exact refused preaching notes' } });
        fireEvent.click(screen.getByText('Save'));
        // The message belongs to the entity's recovery descriptor — one refusal, one
        // reporter. The form's duty is what follows: stay open, keep every field.
        expect(date).toHaveValue('2026-11-19');
        expect(church).toHaveValue('Refused Church');
        expect(audience).toHaveValue('Exact refused audience');
        expect(notes).toHaveValue('Exact refused preaching notes');
        expect(mockOnSave).toHaveBeenCalledWith({
            date: '2026-11-19',
            status: undefined,
            church: { id: 'c1', name: 'Refused Church', city: 'City' },
            audience: 'Exact refused audience',
            notes: 'Exact refused preaching notes',
        });
        expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('renders a dashboard terminal refusal even when the delegated submission is still pending', async () => {
        const neverSettles = new Promise<void>(() => undefined);

        function DashboardFailureHarness() {
            const [syncState, setSyncState] = React.useState<{
                status: 'error';
                operation: 'preach-status';
                message: string;
                refused: true;
                submissionId: number;
            }>();

            return (
                <PreachDateModal
                    isOpen={true}
                    onClose={mockOnClose}
                    syncState={syncState}
                    onSave={() => {
                        setSyncState({
                            status: 'error',
                            operation: 'preach-status',
                            message: 'Save refused. Nothing was saved; your text is still here.',
                            refused: true,
                            submissionId: 42,
                        });
                        return queuedWrite('preach-date:pending', neverSettles);
                    }}
                />
            );
        }

        render(<DashboardFailureHarness />);
        fireEvent.change(screen.getByTestId('church-input'), {
            target: { value: 'Detached Refusal Church' },
        });
        fireEvent.click(screen.getByText('Save'));
        // The message belongs to the entity's recovery descriptor — one refusal, one
        // reporter. The form's duty is what follows: keep every field it was given.
        expect(screen.getByTestId('church-input')).toHaveValue('Detached Refusal Church');
        // Queued acceptance closes the modal before the dashboard's later terminal
        // refusal is rendered; recovery owns the draft after that boundary. Acceptance
        // costs one macrotask, so it must be awaited rather than assumed.
        await waitFor(() => expect(mockOnClose).toHaveBeenCalledTimes(1));
    });

    it('closes silently after an offline preach-date write is locally accepted', async () => {
        mockOnSave.mockImplementationOnce(() => queuedWrite('preach-date:queued', new Promise<void>(() => undefined)));
        render(
            <PreachDateModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
            />
        );

        fireEvent.change(screen.getByTestId('church-input'), {
            target: { value: 'Offline Church' },
        });
        fireEvent.click(screen.getByText('Save'));

        // Acceptance yields one macrotask so an already-refused write can reject first;
        // waiting for that tick is what a real editor does before closing.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(mockOnSave).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
});
