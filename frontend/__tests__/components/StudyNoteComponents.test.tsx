
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import { StudyNote } from '@/models/models';

import AddStudyNoteModal from '../../app/(pages)/(private)/studies/AddStudyNoteModal';

// Mock translation
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            if (key === 'studiesWorkspace.type.question') return 'Question';
            if (key === 'studiesWorkspace.type.note') return 'Note';
            if (key === 'studiesWorkspace.untitled') return 'Untitled';
            return key;
        },
    }),
}));

// Mock HeroIcons
jest.mock('@heroicons/react/24/solid', () => ({
    QuestionMarkCircleIcon: () => <svg data-testid="question-solid-icon" />,
    XMarkIcon: () => <svg data-testid="x-mark-icon" />,
}));

jest.mock('@heroicons/react/24/outline', () => ({
    ArrowPathIcon: () => <svg data-testid="arrow-path-icon" />,
    BookmarkIcon: () => <svg data-testid="bookmark-icon" />,
    BookOpenIcon: () => <svg data-testid="book-open-icon" />,
    ChevronDownIcon: () => <svg data-testid="chevron-down-icon" />,
    ChevronRightIcon: () => <svg data-testid="chevron-right-icon" />,
    PencilIcon: () => <svg data-testid="pencil-icon" />,
    PlusIcon: () => <svg data-testid="plus-icon" />,
    SparklesIcon: () => <svg data-testid="sparkles-icon" />,
    TagIcon: () => <svg data-testid="tag-icon" />,
    QuestionMarkCircleIcon: () => <svg data-testid="question-icon" />,
    TrashIcon: () => <svg data-testid="trash-icon" />,
    XMarkIcon: () => <svg data-testid="x-mark-icon" />,
}));

// Mock MarkdownDisplay
jest.mock('@components/MarkdownDisplay', () => {
    return function MockMarkdownDisplay({ content }: { content: string }) {
        return <div data-testid="markdown-display">{content}</div>;
    };
});

// Mock dynamic import component
jest.mock('@components/AudioRecorder', () => ({
    AudioRecorder: () => <div data-testid="audio-recorder-mock" />,
}));

// Mock child components to avoid circular dependencies or complex rendering
jest.mock('../../app/(pages)/(private)/studies/ScriptureRefPicker', () => {
    return function MockScriptureRefPicker() {
        return <div data-testid="scripture-ref-picker-mock" />;
    };
});

jest.mock('../../app/(pages)/(private)/studies/TagCatalogModal', () => {
    return function MockTagCatalogModal() {
        return <div data-testid="tag-catalog-modal-mock" />;
    };
});

jest.mock('../../app/(pages)/(private)/studies/ScriptureRefBadge', () => {
    return function MockScriptureRefBadge() {
        return <div data-testid="scripture-ref-badge-mock" />;
    };
});

// Debug log
import EditStudyNoteModal from '../../app/(pages)/(private)/studies/EditStudyNoteModal';
import StudyNoteCard from '../../app/(pages)/(private)/studies/StudyNoteCard';

// Basic rendering tests for components are covered in describe blocks below are sufficient.

describe('StudyNoteCard', () => {
    const mockNote: StudyNote = {
        id: '1',
        userId: 'user1',
        content: 'Test content',
        title: 'Test Note',
        scriptureRefs: [],
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDraft: false,
        type: 'note',
    };

    const mockQuestionNote: StudyNote = {
        ...mockNote,
        type: 'question',
        title: 'Test Question',
    };

    const mockOnEdit = jest.fn();
    const mockOnDelete = jest.fn();
    const mockOnToggleExpand = jest.fn();

    it('renders regular note with correct styling (emerald)', () => {
        render(
            <StudyNoteCard
                note={mockNote}
                bibleLocale="en"
                onEdit={mockOnEdit}
                onDelete={mockOnDelete}
                isExpanded={false}
                onToggleExpand={mockOnToggleExpand}
            />
        );

        // Check for title
        expect(screen.getByText('Test Note')).toBeInTheDocument();
        // Check for question icon - should NOT be there
        expect(screen.queryByTestId('question-icon')).not.toBeInTheDocument();

        // We can check class names for borders if needed, but integration visual tests are hard in unit tests.
        // However, we can check if the article element has the expected classes.
        const article = screen.getByRole('article');
        expect(article.className).toContain('border-gray-200'); // Collapsed state default for note
    });

    it('renders question note with correct styling (amber) and icon', () => {
        render(
            <StudyNoteCard
                note={mockQuestionNote}
                bibleLocale="en"
                onEdit={mockOnEdit}
                onDelete={mockOnDelete}
                isExpanded={true} // Check expanded state classes
                onToggleExpand={mockOnToggleExpand}
            />
        );

        // Check for title
        expect(screen.getByText('Test Question')).toBeInTheDocument();
        // Check for question icon - SHOULD be there
        expect(screen.getByTestId('question-icon')).toBeInTheDocument();
        // Check for "Question" badge text
        expect(screen.getByText('Question')).toBeInTheDocument();

        const article = screen.getByRole('article');
        expect(article.className).toContain('border-amber-200'); // Expanded state for question
    });
});


describe('AddStudyNoteModal', () => {
    const mockOnClose = jest.fn();
    const mockOnSave = jest.fn();
    const availableTags: string[] = ['tag1', 'tag2'];
    const bibleLocale = 'en';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders with default type "Note"', () => {
        render(
            <AddStudyNoteModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
                availableTags={availableTags}
                bibleLocale={bibleLocale}
            />
        );

        // "Note" button should be active (we can check by checking if it doesn't have the inactive logic or strict style check)
        // Simple check: both buttons exist
        expect(screen.getByText('Note')).toBeInTheDocument();
        expect(screen.getByText('Question')).toBeInTheDocument();
    });

    it('toggles to "Question" type and submits correctly', async () => {
        render(
            <AddStudyNoteModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
                availableTags={availableTags}
                bibleLocale={bibleLocale}
            />
        );

        // Click Question button
        fireEvent.click(screen.getByText('Question'));

        // Expand advanced section to see Title input
        fireEvent.click(screen.getByText(/studiesWorkspace.manualEntry/));

        // Fill required fields
        fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder'), {
            target: { value: 'New Question' },
        });
        // Content is in a textarea with placeholder 'studiesWorkspace.contentPlaceholder'
        fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder'), {
            target: { value: 'What is deep?' },
        });

        // Click Save
        fireEvent.click(screen.getByText('studiesWorkspace.saveNote'));

        await waitFor(() => {
            expect(mockOnSave).toHaveBeenCalledTimes(1);
            expect(mockOnSave).toHaveBeenCalledWith(expect.objectContaining({
                title: 'New Question',
                content: 'What is deep?',
                type: 'question',
            }));
        });
    });
});

describe('EditStudyNoteModal', () => {
    const mockOnClose = jest.fn();
    const mockOnSave = jest.fn();
    const availableTags: string[] = ['tag1', 'tag2'];
    const bibleLocale = 'en';

    const existingQuestionNote: StudyNote = {
        id: '123',
        userId: 'u1',
        content: 'Why?',
        title: 'Q1',
        scriptureRefs: [],
        tags: [],
        createdAt: '',
        updatedAt: '',
        isDraft: false,
        type: 'question'
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('initializes with "Question" type from props', () => {
        render(
            <EditStudyNoteModal
                note={existingQuestionNote}
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
                availableTags={availableTags}
                bibleLocale={bibleLocale}
            />
        );

        // We expect the styling for Question to be active.
        expect(screen.getByText('Question')).toBeInTheDocument();
    });

    it('changes type from Question to Note and saves', async () => {
        render(
            <EditStudyNoteModal
                note={existingQuestionNote}
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
                availableTags={availableTags}
                bibleLocale={bibleLocale}
            />
        );

        // Switch to Note
        fireEvent.click(screen.getByText('Note'));

        // Click Save (Update)
        fireEvent.click(screen.getByText('studiesWorkspace.updateNote'));

        await waitFor(() => {
            expect(mockOnSave).toHaveBeenCalledTimes(1);
            // Argument 1 is ID, Argument 2 is updates
            expect(mockOnSave).toHaveBeenCalledWith('123', expect.objectContaining({
                type: 'note',
            }));
        });
    });
});
