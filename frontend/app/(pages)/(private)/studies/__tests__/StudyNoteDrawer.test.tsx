'use client';

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StudyNoteDrawer from '../StudyNoteDrawer';
import { StudyNote } from '@/models/models';

// Mock createPortal to render drawer inline for testing
jest.mock('react-dom', () => ({
    ...jest.requireActual('react-dom'),
    createPortal: (node: React.ReactNode) => node,
}));

const createTestNote = (overrides: Partial<StudyNote> = {}): StudyNote => {
    const timestamp = new Date(Date.now()).toISOString();
    return {
        id: 'note-1',
        userId: 'user-1',
        content: 'Test note content',
        title: 'Test Note Title',
        scriptureRefs: [],
        tags: ['test'],
        createdAt: timestamp,
        updatedAt: timestamp,
        isDraft: false,
        type: 'note',
        ...overrides,
    };
};

describe('StudyNoteDrawer', () => {
    const defaultProps = {
        isOpen: true,
        onClose: jest.fn(),
        onSave: jest.fn(),
        availableTags: ['tag1', 'tag2'],
        bibleLocale: 'en' as const,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // Clear localStorage
        localStorage.clear();
    });

    it('renders drawer when isOpen is true and note is provided', () => {
        const note = createTestNote();

        render(<StudyNoteDrawer {...defaultProps} note={note} />);

        expect(screen.getByText('studiesWorkspace.editNote')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Test Note Title')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Test note content')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
        const note = createTestNote();

        render(<StudyNoteDrawer {...defaultProps} note={note} isOpen={false} />);

        expect(screen.queryByText('studiesWorkspace.editNote')).not.toBeInTheDocument();
    });

    it('does not render when note is null', () => {
        render(<StudyNoteDrawer {...defaultProps} note={null} />);

        expect(screen.queryByText('studiesWorkspace.editNote')).not.toBeInTheDocument();
    });

    it('shows size toggle buttons with correct labels', () => {
        const note = createTestNote();

        render(<StudyNoteDrawer {...defaultProps} note={note} />);

        expect(screen.getByRole('button', { name: '30%' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '50%' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '100%' })).toBeInTheDocument();
    });

    it('shows Note/Question type toggle in header', () => {
        const note = createTestNote();

        render(<StudyNoteDrawer {...defaultProps} note={note} />);

        expect(screen.getByRole('button', { name: 'studiesWorkspace.type.note' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'studiesWorkspace.type.question' })).toBeInTheDocument();
    });

    it('toggles note type when Question button is clicked', async () => {
        const note = createTestNote({ type: 'note' });

        render(<StudyNoteDrawer {...defaultProps} note={note} />);

        const questionButton = screen.getByRole('button', { name: 'studiesWorkspace.type.question' });
        await userEvent.click(questionButton);

        // Question button should now have active state (amber colors)
        expect(questionButton).toHaveClass('bg-amber-100');
    });

    it('calls onClose when close button is clicked', async () => {
        const note = createTestNote();
        const onClose = jest.fn();

        render(<StudyNoteDrawer {...defaultProps} note={note} onClose={onClose} />);

        // Find the X button (close)
        const closeButtons = screen.getAllByRole('button');
        const closeButton = closeButtons.find(btn => btn.querySelector('svg.h-5.w-5'));

        if (closeButton) {
            await userEvent.click(closeButton);
            expect(onClose).toHaveBeenCalled();
        }
    });

    it('calls onClose when Escape key is pressed', async () => {
        const note = createTestNote();
        const onClose = jest.fn();

        render(<StudyNoteDrawer {...defaultProps} note={note} onClose={onClose} />);

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when backdrop is clicked', async () => {
        const note = createTestNote();
        const onClose = jest.fn();

        render(<StudyNoteDrawer {...defaultProps} note={note} onClose={onClose} />);

        // Click the backdrop (the first fixed element with bg-black/30)
        const backdrop = document.querySelector('.bg-black\\/30');
        if (backdrop) {
            await userEvent.click(backdrop);
            expect(onClose).toHaveBeenCalled();
        }
    });

    it('allows editing title', async () => {
        const note = createTestNote({ title: 'Original Title' });

        render(<StudyNoteDrawer {...defaultProps} note={note} />);

        const titleInput = screen.getByDisplayValue('Original Title');
        await userEvent.clear(titleInput);
        await userEvent.type(titleInput, 'New Title');

        expect(screen.getByDisplayValue('New Title')).toBeInTheDocument();
    });

    it('allows editing content', async () => {
        const note = createTestNote({ content: 'Original content' });

        render(<StudyNoteDrawer {...defaultProps} note={note} />);

        const contentTextarea = screen.getByDisplayValue('Original content');
        await userEvent.clear(contentTextarea);
        await userEvent.type(contentTextarea, 'New content');

        expect(screen.getByDisplayValue('New content')).toBeInTheDocument();
    });

    it('calls onSave with updated data when save button is clicked', async () => {
        const note = createTestNote({ title: 'Test', content: 'Content', tags: ['tag1'] });
        const onSave = jest.fn().mockResolvedValue(undefined);
        const onClose = jest.fn();

        render(<StudyNoteDrawer {...defaultProps} note={note} onSave={onSave} onClose={onClose} />);

        // Click save button (updateNote)
        const saveButton = screen.getByRole('button', { name: 'studiesWorkspace.updateNote' });
        await userEvent.click(saveButton);

        await waitFor(() => {
            expect(onSave).toHaveBeenCalledWith(note.id, expect.objectContaining({
                title: 'Test',
                content: 'Content',
                type: 'note',
            }));
        });
    });

    it('disables save button when content is empty', () => {
        const note = createTestNote({ content: '' });

        render(<StudyNoteDrawer {...defaultProps} note={note} />);

        const saveButton = screen.getByRole('button', { name: 'studiesWorkspace.updateNote' });
        expect(saveButton).toBeDisabled();
    });

    it('persists size preference in localStorage', async () => {
        const note = createTestNote();

        render(<StudyNoteDrawer {...defaultProps} note={note} />);

        const fullscreenButton = screen.getByRole('button', { name: '100%' });
        await userEvent.click(fullscreenButton);

        expect(localStorage.getItem('studyNoteDrawer:size')).toBe('fullscreen');
    });

    it('loads size preference from localStorage', () => {
        localStorage.setItem('studyNoteDrawer:size', 'narrow');
        const note = createTestNote();

        render(<StudyNoteDrawer {...defaultProps} note={note} />);

        const narrowButton = screen.getByRole('button', { name: '30%' });
        // The narrow button should have active styling
        expect(narrowButton).toHaveClass('bg-white');
    });

    it('shows AI analyze button', () => {
        const note = createTestNote();

        render(<StudyNoteDrawer {...defaultProps} note={note} />);

        expect(screen.getByRole('button', { name: /studiesWorkspace.aiAnalyze.reanalyze/i })).toBeInTheDocument();
    });

    it('shows cancel button that calls onClose', async () => {
        const note = createTestNote();
        const onClose = jest.fn();

        render(<StudyNoteDrawer {...defaultProps} note={note} onClose={onClose} />);

        const cancelButton = screen.getByRole('button', { name: 'common.cancel' });
        await userEvent.click(cancelButton);

        expect(onClose).toHaveBeenCalled();
    });
});
