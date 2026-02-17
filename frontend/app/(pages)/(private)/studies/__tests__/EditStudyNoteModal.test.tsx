import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditStudyNoteModal from '../EditStudyNoteModal';
import { StudyNote } from '@/models/models';

// Mock FocusRecorderButton
// Mock FocusRecorderButton
jest.mock('@components/FocusRecorderButton', () => ({
    FocusRecorderButton: ({ onRecordingComplete }: { onRecordingComplete: (blob: Blob) => void }) => (
        <button
            data-testid="focus-recorder-mock"
            onClick={() => onRecordingComplete(new Blob(['audio'], { type: 'audio/webm' }))}
        >
            Record
        </button>
    ),
}));

// Mock useTranslation
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

const mockNote: StudyNote = {
    id: 'note-1',
    userId: 'user-1',
    title: 'Test Note',
    content: 'Test content',
    tags: ['tag1'],
    scriptureRefs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    type: 'note',
    isDraft: false,
};

describe('EditStudyNoteModal', () => {
    const defaultProps = {
        note: mockNote,
        isOpen: true,
        onClose: jest.fn(),
        onSave: jest.fn(),
        availableTags: [],
        bibleLocale: 'en' as const,
    };

    it('renders FocusRecorderButton component', async () => {
        render(<EditStudyNoteModal {...defaultProps} />);
        expect(await screen.findByTestId('focus-recorder-mock')).toBeInTheDocument();
    });

    it('handles voice recording completion', async () => {
        const mockResponse = { success: true, polishedText: 'Transcribed text' };

        (global.fetch as jest.Mock).mockResolvedValue({
            json: jest.fn().mockResolvedValue(mockResponse),
        });

        render(<EditStudyNoteModal {...defaultProps} />);

        // Find the mock button and click it to trigger onRecordingComplete
        const recorderButton = await screen.findByTestId('focus-recorder-mock');
        fireEvent.click(recorderButton);

        // Verify fetch was called
        expect(global.fetch).toHaveBeenCalledWith('/api/studies/transcribe', expect.any(Object));

        // Verify content was updated
        await waitFor(() => {
            const textarea = screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder');
            expect(textarea).toHaveValue('Test content\n\nTranscribed text');
        });
    });
});
