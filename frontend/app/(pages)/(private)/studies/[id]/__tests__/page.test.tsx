import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useTags } from '@/hooks/useTags';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import StudyNoteEditorPage from '../page';
import { StudyNote } from '@/models/models';

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
    useParams: jest.fn(),
    useSearchParams: jest.fn(),
}));

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: 'en' },
    }),
}));

// Mock hooks
jest.mock('@/hooks/useStudyNotes');
jest.mock('@/hooks/useTags');
jest.mock('@/hooks/useStudyNoteShareLinks');

// Mock components to avoid deep rendering issues in this test
jest.mock('@components/MarkdownDisplay', () => ({
    __esModule: true,
    default: ({ content }: { content: string }) => <div data-testid="markdown-display">{content}</div>,
}));

jest.mock('react-textarea-autosize', () => ({
    __esModule: true,
    default: (props: any) => <textarea {...props} />,
}));

jest.mock('@/components/ui/RichMarkdownEditor', () => ({
    __esModule: true,
    RichMarkdownEditor: ({
        value,
        onChange,
        placeholder,
        onOutlineBranchSelectionChange,
        outlineBranchSelection,
        onCreateSiblingBranch,
        onCreateChildBranch,
        canCreateSiblingBranch,
        canCreateChildBranch,
    }: any) => {
        const React = require('react');
        const headingMatches: Array<{ headingText: string; headingLevel: number }> = React.useMemo(() => {
            const headingMatchIterator = value.matchAll(/^[ ]{0,3}(#{1,6})[ \t]+(.+)$/gm) as IterableIterator<RegExpMatchArray>;

            return Array.from(headingMatchIterator).map((match) => ({
                headingText: match[2].trim(),
                headingLevel: match[1].length,
            }));
        }, [value]);
        const [selectedHeadingIndex, setSelectedHeadingIndex] = React.useState(0);

        React.useEffect(() => {
            setSelectedHeadingIndex((currentIndex: number) => (
                headingMatches.length === 0 ? 0 : Math.min(currentIndex, headingMatches.length - 1)
            ));
        }, [headingMatches.length]);

        React.useEffect(() => {
            if (!onOutlineBranchSelectionChange) {
                return;
            }

            if (headingMatches.length === 0) {
                onOutlineBranchSelectionChange(null);
                return;
            }

            const selectedHeading = headingMatches[selectedHeadingIndex];
            const occurrenceIndex = headingMatches
                .slice(0, selectedHeadingIndex + 1)
                .filter((heading) =>
                    heading.headingLevel === selectedHeading.headingLevel &&
                    heading.headingText === selectedHeading.headingText
                )
                .length - 1;

            onOutlineBranchSelectionChange({
                ...selectedHeading,
                occurrenceIndex,
            });
        }, [headingMatches, onOutlineBranchSelectionChange, selectedHeadingIndex]);

        return (
            <div>
                <textarea
                    data-testid="rich-markdown-editor"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                />
                {headingMatches.map((heading: { headingText: string; headingLevel: number }, index: number) => (
                    <button
                        key={`${heading.headingText}-${index}`}
                        type="button"
                        data-testid={`rich-markdown-select-heading-${index}`}
                        onClick={() => setSelectedHeadingIndex(index)}
                    >
                        Select {heading.headingText}
                    </button>
                ))}
                {onCreateSiblingBranch && (
                    <button
                        type="button"
                        data-testid="rich-markdown-create-sibling"
                        onClick={onCreateSiblingBranch}
                        disabled={!canCreateSiblingBranch}
                    >
                        Create sibling
                    </button>
                )}
                {onCreateChildBranch && (
                    <button
                        type="button"
                        data-testid="rich-markdown-create-child"
                        onClick={onCreateChildBranch}
                        disabled={!canCreateChildBranch}
                    >
                        Create child
                    </button>
                )}
                <div data-testid="rich-markdown-active-heading">
                    {outlineBranchSelection?.headingText ?? 'none'}
                </div>
            </div>
        );
    },
}));

jest.mock('@/components/FocusRecorderButton', () => ({
    __esModule: true,
    FocusRecorderButton: ({ onRecordingComplete }: any) => (
        <button
            title="studiesWorkspace.voiceRecord"
            onClick={() => onRecordingComplete(new Blob())}
        >
            Mic
        </button>
    ),
}));

const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
};

const mockParams = { id: 'note-1' };
const mockSearchParams = new URLSearchParams('tag=tag1'); // Matches all mock notes

const createMockNote = (id: string, title: string): StudyNote => ({
    id,
    title,
    content: `Content for ${title}`,
    tags: ['tag1'],
    scriptureRefs: [],
    userId: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDraft: false,
    type: 'note',
});

const mockNotes: StudyNote[] = [
    { ...createMockNote('note-0', 'Prev Note'), updatedAt: '2024-01-03T00:00:00.000Z' },
    { ...createMockNote('note-1', 'Current Note'), updatedAt: '2024-01-02T00:00:00.000Z' },
    { ...createMockNote('note-2', 'Next Note'), updatedAt: '2024-01-01T00:00:00.000Z' },
];

const structuredNote: StudyNote = {
    ...createMockNote('note-1', 'Structured Note'),
    content: [
        'Preface paragraph',
        '',
        '## Main Branch',
        'Main branch body',
        '',
        '### Child Branch',
        'Child branch body',
    ].join('\n'),
};

const cascadedStructuredNote: StudyNote = {
    ...createMockNote('note-1', 'Cascaded Structured Note'),
    content: [
        'Preface paragraph',
        '',
        '## Main Branch',
        'Main branch body',
        '',
        '### Child Branch',
        'Child branch body',
        '',
        '#### Grandchild Branch',
        'Grandchild branch body',
    ].join('\n'),
};

const movableStructuredNote: StudyNote = {
    ...createMockNote('note-1', 'Movable Structured Note'),
    content: [
        'Preface paragraph',
        '',
        '## Alpha',
        'Alpha body',
        '',
        '### Alpha child',
        'Alpha child body',
        '',
        '## Beta',
        'Beta body',
    ].join('\n'),
};

const nestedMovableStructuredNote: StudyNote = {
    ...createMockNote('note-1', 'Nested Movable Structured Note'),
    content: [
        '## Root',
        'Root body',
        '',
        '### First child',
        'First body',
        '',
        '### Second child',
        'Second body',
    ].join('\n'),
};

const introOnlyStructuredCandidateNote: StudyNote = {
    ...createMockNote('note-1', 'Intro Only Structured Candidate'),
    content: [
        'Preface paragraph',
        '',
        'More prefatory text',
    ].join('\n'),
};

describe('StudyNoteEditorPage Pagination', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue(mockRouter);
        (useParams as jest.Mock).mockReturnValue(mockParams);
        (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);

        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: mockNotes,
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        (useTags as jest.Mock).mockReturnValue({
            tags: { requiredTags: [], customTags: [] },
        });

        (useStudyNoteShareLinks as jest.Mock).mockReturnValue({
            shareLinks: [],
            loading: false,
        });
    });

    it('renders correctly and identifies prev/next notes based on search params', () => {
        render(<StudyNoteEditorPage />);

        // Check if the current note content is rendered
        expect(screen.getByText('Content for Current Note')).toBeInTheDocument();

        // The header should contain the navigation chevrons for prev and next
        // because note-1 is in the middle of our mockNotes and matches the tag 'tag1'
        const prevButton = screen.getByTitle('common.previous');
        const nextButton = screen.getByTitle('common.next');

        expect(prevButton).toBeInTheDocument();
        expect(nextButton).toBeInTheDocument();

        // Check the counter (Note 2 of 3 -> "2 / 3")
        expect(screen.getByText('2 / 3')).toBeInTheDocument();
    });

    it('navigates to the previous note when the left chevron is clicked', () => {
        render(<StudyNoteEditorPage />);

        const prevButton = screen.getByTitle('common.previous');
        fireEvent.click(prevButton);

        expect(mockRouter.push).toHaveBeenCalledWith('/studies/note-0?tag=tag1');
    });

    it('navigates to the next note when the right chevron is clicked', () => {
        render(<StudyNoteEditorPage />);

        const nextButton = screen.getByTitle('common.next');
        fireEvent.click(nextButton);

        expect(mockRouter.push).toHaveBeenCalledWith('/studies/note-2?tag=tag1');
    });

    it('responds to ArrowLeft and ArrowRight keyboard events when not editing', () => {
        render(<StudyNoteEditorPage />);

        // Trigger ArrowLeft
        fireEvent.keyDown(document, { key: 'ArrowLeft' });
        expect(mockRouter.push).toHaveBeenCalledWith('/studies/note-0?tag=tag1');

        // Trigger ArrowRight
        fireEvent.keyDown(document, { key: 'ArrowRight' });
        expect(mockRouter.push).toHaveBeenCalledWith('/studies/note-2?tag=tag1');
    });

    it('does NOT respond to keyboard navigation when in editing mode', () => {
        render(<StudyNoteEditorPage />);

        // Switch to editing mode
        const editButton = screen.getByTitle('common.edit');
        fireEvent.click(editButton);

        // Try ArrowLeft
        fireEvent.keyDown(document, { key: 'ArrowLeft' });
        expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it('renders disabled buttons when at the boundaries of a list', () => {
        // Search 'Note' matches all 3: note-0, note-1, note-2
        const searchNoteParams = new URLSearchParams('search=Note');
        (useSearchParams as jest.Mock).mockReturnValue(searchNoteParams);

        // At the start (note-0)
        (useParams as jest.Mock).mockReturnValue({ id: 'note-0' });
        const { rerender } = render(<StudyNoteEditorPage />);

        expect(screen.getByTitle('common.previous')).toBeDisabled();
        expect(screen.getByTitle('common.next')).toBeEnabled();
        expect(screen.getByText('1 / 3')).toBeInTheDocument();

        // At the end (note-2)
        (useParams as jest.Mock).mockReturnValue({ id: 'note-2' });
        rerender(<StudyNoteEditorPage />);

        expect(screen.getByTitle('common.previous')).toBeEnabled();
        expect(screen.getByTitle('common.next')).toBeDisabled();
        expect(screen.getByText('3 / 3')).toBeInTheDocument();
    });

    it('hides navigation when only one note matches the filter', () => {
        const singleNoteParams = new URLSearchParams('search=Next');
        (useSearchParams as jest.Mock).mockReturnValue(singleNoteParams);
        (useParams as jest.Mock).mockReturnValue({ id: 'note-2' });

        render(<StudyNoteEditorPage />);

        expect(screen.queryByTitle('common.previous')).not.toBeInTheDocument();
        expect(screen.queryByText('1 / 1')).not.toBeInTheDocument();
    });

    describe('Note / Question Mode Toggle', () => {
        it('toggles between Note and Question type in edit mode', () => {
            render(<StudyNoteEditorPage />);
            expect(screen.getByText('Current Note')).toBeInTheDocument();

            // Enter edit mode
            fireEvent.click(screen.getByTitle('common.edit'));

            const noteBtn = screen.getByRole('button', { name: 'studiesWorkspace.type.note' });
            const qBtn = screen.getByRole('button', { name: 'studiesWorkspace.type.question' });

            fireEvent.click(qBtn);
            expect(qBtn).toHaveClass('bg-amber-100'); // the selected class for question

            fireEvent.click(noteBtn);
            expect(noteBtn).toHaveClass('bg-gray-100'); // the selected class for note
        });

        it('displays badges for Note and Question type in read-only mode', () => {
            render(<StudyNoteEditorPage />);

            // By default, it's a note. In read-only mode, check if note badge is shown
            expect(screen.getByText('studiesWorkspace.type.note')).toHaveClass('bg-gray-50');

            // Switch to edit mode, change to question, then switch back to read-only
            fireEvent.click(screen.getByTitle('common.edit'));
            fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.type.question' }));
            fireEvent.click(screen.getByTitle('common.done')); // exit edit mode

            // Check if question badge is shown with amber text
            expect(screen.getByText('studiesWorkspace.type.question')).toHaveClass('text-amber-700');
        });
    });

    it('adds and toggles tags correctly', async () => {
        render(<StudyNoteEditorPage />);

        // Check initial tag
        expect(screen.getByText('tag1')).toBeInTheDocument();
        // Enter edit mode
        fireEvent.click(screen.getByTitle('common.edit'));

        // Toggle off tag1 (click the X button)
        const tag1Container = screen.getByText('tag1').parentElement;
        const xButton = within(tag1Container!).getByRole('button');
        fireEvent.click(xButton);
        await waitFor(() => {
            expect(screen.queryByText('tag1')).not.toBeInTheDocument();
        });

        // Add a new tag
        const tagInput = screen.getByPlaceholderText('studiesWorkspace.addTag');
        fireEvent.change(tagInput, { target: { value: 'new-tag' } });
        fireEvent.keyDown(tagInput, { key: 'Enter' });

        expect(screen.getByText('new-tag')).toBeInTheDocument();
    });

    it('triggers AI analysis and applies results', async () => {
        // Mock fetch for AI analysis
        const mockAIResponse = {
            success: true,
            data: {
                title: 'AI Title',
                tags: ['ai-tag'],
                scriptureRefs: [{ book: 'John', chapter: 3, fromVerse: 16 }]
            }
        };
        (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue(mockAIResponse)
        });

        render(<StudyNoteEditorPage />);

        // Enter edit mode
        fireEvent.click(screen.getByTitle('common.edit'));

        // Clear the title first (AI only sets title if it's empty)
        const titleInput = screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder');
        fireEvent.change(titleInput, { target: { value: '' } });

        // Trigger AI Analyze
        const aiButton = screen.getByTitle('studiesWorkspace.aiAnalyze.button');
        fireEvent.click(aiButton);

        const fullOption = await screen.findByText('studiesWorkspace.aiAnalyze.full');
        fireEvent.click(fullOption);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith('/api/studies/analyze', expect.any(Object));
        });

        // Apply results from modal
        const applyBtn = await screen.findByText('studiesWorkspace.aiAnalyze.applySelected');
        fireEvent.click(applyBtn);

        // Wait for AI results to be applied
        await waitFor(() => {
            expect(screen.getByDisplayValue('AI Title')).toBeInTheDocument();
        }, { timeout: 2000 });

        expect(screen.getByText('ai-tag')).toBeInTheDocument();
    });

    it('handles voice recording completion', async () => {
        const mockVoiceResponse = {
            success: true,
            polishedText: 'Transcribed text',
        };
        (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue(mockVoiceResponse)
        });

        render(<StudyNoteEditorPage />);

        // Enter edit mode
        fireEvent.click(screen.getByTitle('common.edit'));

        // Trigger recording completion via the mocked button
        const micButton = screen.getByTitle('studiesWorkspace.voiceRecord');
        fireEvent.click(micButton);

        // Wait for transcription to appear in content
        await waitFor(() => {
            expect(screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder')).toHaveValue('Content for Current Note\n\nTranscribed text');
        });
    });

    it('renders the structured read view and supports collapsing branches', () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [structuredNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        expect(screen.getByTestId('study-note-outline-read')).toBeInTheDocument();
        expect(screen.getByText('Preface paragraph')).toBeInTheDocument();
        expect(within(screen.getByTestId('study-note-outline-read')).getByText('Main Branch')).toBeInTheDocument();
        expect(within(screen.getByTestId('study-note-outline-read')).getByText('Child Branch')).toBeInTheDocument();
        expect(screen.getByText('Main branch body')).toBeInTheDocument();
        expect(screen.getByText('Child branch body')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('study-note-branch-toggle-1'));

        expect(screen.queryByText('Child Branch')).not.toBeInTheDocument();
        expect(screen.queryByText('Child branch body')).not.toBeInTheDocument();
    });

    it('shows the live structure preview while editing heading-based content', () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [structuredNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        fireEvent.click(screen.getByTitle('common.edit'));

        expect(screen.getByTestId('study-note-outline-preview')).toBeInTheDocument();
        expect(screen.getByTestId('study-note-outline-resizer')).toBeInTheDocument();
        expect(screen.getByText('studiesWorkspace.outlinePilot.previewTitle')).toBeInTheDocument();
        expect(within(screen.getByTestId('study-note-outline-preview')).getByText('Main Branch')).toBeInTheDocument();
        expect(within(screen.getByTestId('study-note-outline-preview')).getByText('Child Branch')).toBeInTheDocument();
    });

    it('switches between editor-only, split, and preview-only outline workspace modes', () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [structuredNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        fireEvent.click(screen.getByTitle('common.edit'));

        expect(screen.getByTestId('rich-markdown-editor')).toBeInTheDocument();
        expect(screen.getByTestId('study-note-outline-preview')).toBeInTheDocument();
        expect(screen.getByTestId('study-note-outline-resizer')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('study-note-layout-mode-preview'));

        expect(screen.queryByTestId('rich-markdown-editor')).not.toBeInTheDocument();
        expect(screen.getByTestId('study-note-outline-preview')).toBeInTheDocument();
        expect(screen.queryByTestId('study-note-outline-resizer')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('study-note-layout-mode-editor'));

        expect(screen.getByTestId('rich-markdown-editor')).toBeInTheDocument();
        expect(screen.queryByTestId('study-note-outline-preview')).not.toBeInTheDocument();
        expect(screen.queryByTestId('study-note-outline-resizer')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('study-note-layout-mode-split'));

        expect(screen.getByTestId('rich-markdown-editor')).toBeInTheDocument();
        expect(screen.getByTestId('study-note-outline-preview')).toBeInTheDocument();
        expect(screen.getByTestId('study-note-outline-resizer')).toBeInTheDocument();
    });

    it('returns from preview-only into the editor after creating a branch so the placeholder can be renamed', async () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [movableStructuredNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(screen.getByTestId('study-note-layout-mode-preview'));

        expect(screen.queryByTestId('rich-markdown-editor')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('study-note-branch-create-sibling-1'));

        await waitFor(() => {
            expect(screen.getByTestId('rich-markdown-editor')).toBeInTheDocument();
        });
    });

    it('moves a branch through the preview shell and rewrites the editor markdown', async () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [movableStructuredNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(screen.getByTestId('study-note-branch-move-down-1'));

        await waitFor(() => {
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue([
                'Preface paragraph',
                '',
                '## Beta',
                'Beta body',
                '',
                '## Alpha',
                'Alpha body',
                '',
                '### Alpha child',
                'Alpha child body',
            ].join('\n'));
        });

        const branchCards = Array.from(
            screen
                .getByTestId('study-note-outline-preview')
                .querySelectorAll<HTMLElement>('section[data-testid^="study-note-branch-"]')
        );

        expect(within(branchCards[0]).getByText('Beta')).toBeInTheDocument();
        expect(within(branchCards[1]).getByText('Alpha')).toBeInTheDocument();
    });

    it('moves a nested branch through the preview shell and preserves parent ownership', async () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [nestedMovableStructuredNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(screen.getByTestId('study-note-branch-move-up-1.2'));

        await waitFor(() => {
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue([
                '## Root',
                'Root body',
                '',
                '### Second child',
                'Second body',
                '',
                '### First child',
                'First body',
            ].join('\n'));
        });

        const branchCards = Array.from(
            screen
                .getByTestId('study-note-outline-preview')
                .querySelectorAll<HTMLElement>('section[data-testid^="study-note-branch-"]')
        );

        expect(within(branchCards[0]).getByText('Root')).toBeInTheDocument();
        expect(within(branchCards[1]).getByText('Second child')).toBeInTheDocument();
        expect(within(branchCards[2]).getByText('First child')).toBeInTheDocument();
    });

    it('creates a sibling branch through the preview shell and rewrites the editor markdown', async () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [movableStructuredNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(screen.getByTestId('study-note-branch-create-sibling-1'));

        await waitFor(() => {
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue([
                'Preface paragraph',
                '',
                '## Alpha',
                'Alpha body',
                '',
                '### Alpha child',
                'Alpha child body',
                '',
                '## studiesWorkspace.outlinePilot.newBranchTitle',
                '',
                '## Beta',
                'Beta body',
            ].join('\n'));
        });

        expect(screen.getAllByText('studiesWorkspace.outlinePilot.newBranchTitle').length).toBeGreaterThan(0);
    });

    it('creates a sibling branch from editor-native controls using the current branch selection', async () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [movableStructuredNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(screen.getByTestId('rich-markdown-create-sibling'));

        await waitFor(() => {
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue([
                'Preface paragraph',
                '',
                '## Alpha',
                'Alpha body',
                '',
                '### Alpha child',
                'Alpha child body',
                '',
                '## studiesWorkspace.outlinePilot.newBranchTitle',
                '',
                '## Beta',
                'Beta body',
            ].join('\n'));
        });
    });

    it('creates a child branch through the preview shell and keeps it under the same parent', async () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [structuredNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(screen.getByTestId('study-note-branch-create-child-1'));

        await waitFor(() => {
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue([
                'Preface paragraph',
                '',
                '## Main Branch',
                'Main branch body',
                '',
                '### Child Branch',
                'Child branch body',
                '',
                '### studiesWorkspace.outlinePilot.newBranchTitle',
            ].join('\n'));
        });

        const branchCards = Array.from(
            screen
                .getByTestId('study-note-outline-preview')
                .querySelectorAll<HTMLElement>('section[data-testid^="study-note-branch-"]')
        );

        expect(within(branchCards[0]).getByText('Main Branch')).toBeInTheDocument();
        expect(within(branchCards[1]).getByText('Child Branch')).toBeInTheDocument();
        expect(within(branchCards[2]).getByText('studiesWorkspace.outlinePilot.newBranchTitle')).toBeInTheDocument();
    });

    it('creates a child branch from editor-native controls under the current branch', async () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [structuredNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(screen.getByTestId('rich-markdown-create-child'));

        await waitFor(() => {
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue([
                'Preface paragraph',
                '',
                '## Main Branch',
                'Main branch body',
                '',
                '### Child Branch',
                'Child branch body',
                '',
                '### studiesWorkspace.outlinePilot.newBranchTitle',
            ].join('\n'));
        });
    });

    it('creates a sibling branch from editor-native controls for the currently selected non-first branch', async () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [movableStructuredNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(screen.getByTestId('rich-markdown-select-heading-2'));

        await waitFor(() => {
            expect(screen.getByTestId('rich-markdown-active-heading')).toHaveTextContent('Beta');
        });

        fireEvent.click(screen.getByTestId('rich-markdown-create-sibling'));

        await waitFor(() => {
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue([
                'Preface paragraph',
                '',
                '## Alpha',
                'Alpha body',
                '',
                '### Alpha child',
                'Alpha child body',
                '',
                '## Beta',
                'Beta body',
                '',
                '## studiesWorkspace.outlinePilot.newBranchTitle',
            ].join('\n'));
        });
    });

    it('creates the first root branch from editor-native controls when the note has no headings yet', async () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [introOnlyStructuredCandidateNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        fireEvent.click(screen.getByTitle('common.edit'));

        expect(screen.getByTestId('rich-markdown-create-sibling')).toBeEnabled();
        expect(screen.getByTestId('rich-markdown-create-child')).toBeDisabled();

        fireEvent.click(screen.getByTestId('rich-markdown-create-sibling'));

        await waitFor(() => {
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue([
                'Preface paragraph',
                '',
                'More prefatory text',
                '',
                '## studiesWorkspace.outlinePilot.newBranchTitle',
            ].join('\n'));
        });
    });

    it('promotes a branch with descendants through the preview shell and preserves cascade wiring', async () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [cascadedStructuredNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(screen.getByTestId('study-note-branch-promote-1.1'));

        await waitFor(() => {
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue([
                'Preface paragraph',
                '',
                '## Main Branch',
                'Main branch body',
                '',
                '## Child Branch',
                'Child branch body',
                '',
                '### Grandchild Branch',
                'Grandchild branch body',
            ].join('\n'));
        });
    });

    it('demotes a branch through the preview shell and keeps it visible by unfolding the previous sibling', async () => {
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [movableStructuredNote],
            loading: false,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);

        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(screen.getByTestId('study-note-branch-toggle-1'));

        expect(screen.queryByText('Alpha child')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('study-note-branch-demote-2'));

        await waitFor(() => {
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue([
                'Preface paragraph',
                '',
                '## Alpha',
                'Alpha body',
                '',
                '### Alpha child',
                'Alpha child body',
                '',
                '### Beta',
                'Beta body',
            ].join('\n'));
        });

        expect(screen.getByText('Alpha child')).toBeInTheDocument();
        expect(screen.getByText('Beta')).toBeInTheDocument();
    });

    it('navigates back using the back button', () => {
        render(<StudyNoteEditorPage />);

        const backButton = screen.getByTitle('common.back');
        fireEvent.click(backButton);

        expect(mockRouter.push).toHaveBeenCalledWith('/studies?tag=tag1');
    });

    describe('Missing Coverage Tests', () => {
        it('handles new note creation on input', async () => {
            jest.useFakeTimers();
            const mockCreateNote = jest.fn().mockResolvedValue({ id: 'new-note-id' });
            (useStudyNotes as jest.Mock).mockReturnValue({
                uid: 'user-1',
                notes: mockNotes,
                loading: false,
                createNote: mockCreateNote,
                updateNote: jest.fn(),
                deleteNote: jest.fn(),
            });
            (useParams as jest.Mock).mockReturnValue({ id: 'new' });

            render(<StudyNoteEditorPage />);

            const titleInput = screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder');
            fireEvent.change(titleInput, { target: { value: 'New Note' } });

            jest.advanceTimersByTime(2000);

            await waitFor(() => {
                expect(mockCreateNote).toHaveBeenCalled();
            });

            jest.useRealTimers();
        });

        it('shows error if new note creation fails', async () => {
            jest.useFakeTimers();
            const mockCreateNote = jest.fn().mockRejectedValue(new Error('fail'));
            (useStudyNotes as jest.Mock).mockReturnValue({
                uid: 'user-1',
                notes: mockNotes,
                loading: false,
                createNote: mockCreateNote,
                updateNote: jest.fn(),
                deleteNote: jest.fn(),
            });
            (useParams as jest.Mock).mockReturnValue({ id: 'new' });

            render(<StudyNoteEditorPage />);

            const titleInput = screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder');
            fireEvent.change(titleInput, { target: { value: 'New Note' } });

            jest.advanceTimersByTime(2000);

            await waitFor(() => {
                expect(mockCreateNote).toHaveBeenCalled();
            });

            jest.useRealTimers();
        });

        it('handles delete note click correctly', async () => {
            const mockDeleteNote = jest.fn().mockResolvedValue(undefined);
            (useStudyNotes as jest.Mock).mockReturnValue({
                uid: 'user-1',
                notes: mockNotes,
                loading: false,
                createNote: jest.fn(),
                updateNote: jest.fn(),
                deleteNote: mockDeleteNote,
            });
            window.confirm = jest.fn(() => true);
            (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue([{ noteId: 'note-1', id: 'link-1' }])
            });

            render(<StudyNoteEditorPage />);

            // Open ⋯ menu first, then click Delete
            const moreButton = screen.getByTitle('common.more');
            fireEvent.click(moreButton);
            const deleteButton = screen.getByText('common.delete');
            fireEvent.click(deleteButton);

            await waitFor(() => {
                expect(mockDeleteNote).toHaveBeenCalledWith('note-1');
                expect(mockRouter.push).toHaveBeenCalledWith('/studies');
            });
        });

        it('handles AI analysis validation error (empty content)', async () => {
            render(<StudyNoteEditorPage />);
            fireEvent.click(screen.getByTitle('common.edit'));
            const contentInput = screen.getByTestId('rich-markdown-editor');
            fireEvent.change(contentInput, { target: { value: '   ' } });
            fireEvent.click(screen.getByTitle('studiesWorkspace.aiAnalyze.button'));
            expect(screen.getByTitle('studiesWorkspace.aiAnalyze.button')).toBeDisabled();
            // Button click is just a no-op that shows a toast.
        });

        it('handles AI analysis API failure response', async () => {
            render(<StudyNoteEditorPage />);
            fireEvent.click(screen.getByTitle('common.edit'));
            const contentInput = screen.getByTestId('rich-markdown-editor');
            fireEvent.change(contentInput, { target: { value: 'Something' } });
            (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ success: false, error: 'AI Error' })
            });
            fireEvent.click(screen.getByTitle('studiesWorkspace.aiAnalyze.button'));
            const fullOption = await screen.findByText('studiesWorkspace.aiAnalyze.full');
            fireEvent.click(fullOption);
            await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        });

        it('handles AI analysis network exception', async () => {
            render(<StudyNoteEditorPage />);
            fireEvent.click(screen.getByTitle('common.edit'));
            const contentInput = screen.getByTestId('rich-markdown-editor');
            fireEvent.change(contentInput, { target: { value: 'Something' } });
            (global.fetch as jest.Mock) = jest.fn().mockRejectedValue(new Error('Network error'));
            fireEvent.click(screen.getByTitle('studiesWorkspace.aiAnalyze.button'));
            const fullOption = await screen.findByText('studiesWorkspace.aiAnalyze.full');
            fireEvent.click(fullOption);
            await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        });

        it('triggers auto-save when content changes', async () => {
            jest.useFakeTimers();
            const mockUpdateNote = jest.fn().mockResolvedValue(true);
            (useStudyNotes as jest.Mock).mockReturnValue({
                uid: 'user-1',
                notes: mockNotes,
                loading: false,
                createNote: jest.fn(),
                updateNote: mockUpdateNote,
                deleteNote: jest.fn(),
            });

            render(<StudyNoteEditorPage />);
            fireEvent.click(screen.getByTitle('common.edit'));

            const contentInput = screen.getByTestId('rich-markdown-editor');
            fireEvent.change(contentInput, { target: { value: 'Changed auto save content' } });

            jest.advanceTimersByTime(2000);

            await waitFor(() => {
                expect(mockUpdateNote).toHaveBeenCalled();
            });
            jest.useRealTimers();
        });

        it('handles auto-save error', async () => {
            jest.useFakeTimers();
            const mockUpdateNote = jest.fn().mockRejectedValue(new Error('save failed'));
            (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: mockNotes, loading: false, createNote: jest.fn(), updateNote: mockUpdateNote, deleteNote: jest.fn() });

            render(<StudyNoteEditorPage />);
            fireEvent.click(screen.getByTitle('common.edit'));

            const contentInput = screen.getByTestId('rich-markdown-editor');
            fireEvent.change(contentInput, { target: { value: 'Changed for error' } });

            jest.advanceTimersByTime(2000);

            await waitFor(() => {
                expect(mockUpdateNote).toHaveBeenCalled();
            });
            jest.useRealTimers();
        });
    });
});
