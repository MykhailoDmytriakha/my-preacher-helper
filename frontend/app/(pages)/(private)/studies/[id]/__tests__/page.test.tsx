import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { StudyNote } from '@/models/models';

import StudyNoteViewPage from '../page';

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

jest.mock('@/hooks/useStudyNotes');
jest.mock('@/hooks/useStudyNoteShareLinks');

jest.mock('sonner', () => ({
    toast: {
        error: jest.fn(),
    },
}));

jest.mock('@components/MarkdownDisplay', () => ({
    __esModule: true,
    default: ({ content }: { content: string }) => <div data-testid="markdown-display">{content}</div>,
}));

jest.mock('@/components/studies/node/NodeTreeEditor', () => ({
    __esModule: true,
    default: ({ rootNode, readOnly }: { rootNode: unknown; readOnly?: boolean }) => (
        <div data-testid="node-tree-editor" data-readonly={readOnly ? 'true' : 'false'}>
            {JSON.stringify(rootNode)}
        </div>
    ),
}));

jest.mock('../../components/KeyboardCheatsheet', () => ({
    __esModule: true,
    default: ({ open }: { open: boolean }) => (open ? <div data-testid="keyboard-cheatsheet" /> : null),
}));

jest.mock('../../components/ShareNoteModal', () => ({
    __esModule: true,
    default: ({ isOpen, note }: { isOpen: boolean; note: StudyNote | null }) => (
        isOpen && note ? <div data-testid="share-note-modal">{note.title}</div> : null
    ),
}));

const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
};

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

const currentNodeNote: StudyNote = {
    ...createMockNote('note-1', 'Current Note'),
    content: 'Stale legacy content',
    rootNode: {
        id: 'root',
        header: 'Canonical',
        text: 'Fresh body',
    },
    updatedAt: '2024-01-02T00:00:00.000Z',
};

describe('StudyNoteViewPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue(mockRouter);
        (useParams as jest.Mock).mockReturnValue({ id: 'note-1' });
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('tag=tag1'));

        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: mockNotes,
            loading: false,
            error: null,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        (useStudyNoteShareLinks as jest.Mock).mockReturnValue({
            shareLinks: [],
            loading: false,
            createShareLink: jest.fn(),
            deleteShareLink: jest.fn(),
        });
    });

    it('renders read-only title, body, tags, and pagination from filtered notes', async () => {
        render(<StudyNoteViewPage />);

        expect(await screen.findByText('Current Note')).toBeInTheDocument();
        expect(screen.getByTestId('markdown-display')).toHaveTextContent('Content for Current Note');
        expect(screen.getByText('tag1')).toBeInTheDocument();
        expect(screen.queryByPlaceholderText('studiesWorkspace.titlePlaceholder')).not.toBeInTheDocument();
        expect(screen.queryByTestId('rich-markdown-editor')).not.toBeInTheDocument();

        expect(screen.getByTitle('common.previous')).toBeInTheDocument();
        expect(screen.getByTitle('common.next')).toBeInTheDocument();
        expect(screen.getByText('2 / 3')).toBeInTheDocument();
    });

    it('navigates to previous and next notes with preserved search params', async () => {
        render(<StudyNoteViewPage />);
        await screen.findByText('Current Note');

        fireEvent.click(screen.getByTitle('common.previous'));
        fireEvent.click(screen.getByTitle('common.next'));

        expect(mockRouter.push).toHaveBeenCalledWith('/studies/note-0?tag=tag1');
        expect(mockRouter.push).toHaveBeenCalledWith('/studies/note-2?tag=tag1');
    });

    it('supports keyboard arrow navigation in read-only mode', async () => {
        render(<StudyNoteViewPage />);
        await screen.findByText('Current Note');

        fireEvent.keyDown(document, { key: 'ArrowLeft' });
        fireEvent.keyDown(document, { key: 'ArrowRight' });

        expect(mockRouter.push).toHaveBeenCalledWith('/studies/note-0?tag=tag1');
        expect(mockRouter.push).toHaveBeenCalledWith('/studies/note-2?tag=tag1');
    });

    it('shows disabled pagination buttons at list boundaries', async () => {
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('search=Note'));
        (useParams as jest.Mock).mockReturnValue({ id: 'note-0' });
        const { rerender } = render(<StudyNoteViewPage />);

        expect(await screen.findByText('Content for Prev Note')).toBeInTheDocument();
        expect(screen.getByTitle('common.previous')).toBeDisabled();
        expect(screen.getByTitle('common.next')).toBeEnabled();
        expect(screen.getByText('1 / 3')).toBeInTheDocument();

        (useParams as jest.Mock).mockReturnValue({ id: 'note-2' });
        rerender(<StudyNoteViewPage />);

        expect(await screen.findByText('Content for Next Note')).toBeInTheDocument();
        expect(screen.getByTitle('common.previous')).toBeEnabled();
        expect(screen.getByTitle('common.next')).toBeDisabled();
        expect(screen.getByText('3 / 3')).toBeInTheDocument();
    });

    it('hides pagination when only one note matches the filter', async () => {
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('search=Next'));
        (useParams as jest.Mock).mockReturnValue({ id: 'note-2' });

        render(<StudyNoteViewPage />);

        expect(await screen.findByText('Content for Next Note')).toBeInTheDocument();
        expect(screen.queryByTitle('common.previous')).not.toBeInTheDocument();
        expect(screen.queryByText('1 / 1')).not.toBeInTheDocument();
    });

    it('opens the edit route from the edit button and Cmd+E with preserved search params', async () => {
        render(<StudyNoteViewPage />);
        await screen.findByText('Current Note');

        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.keyDown(document, { key: 'e', metaKey: true });

        expect(mockRouter.push).toHaveBeenCalledWith('/studies/note-1/edit?tag=tag1');
        expect(mockRouter.push).toHaveBeenCalledTimes(2);
    });

    it('navigates back to the list with preserved search params', async () => {
        render(<StudyNoteViewPage />);
        await screen.findByText('Current Note');

        fireEvent.click(screen.getByTitle('common.back'));

        expect(mockRouter.push).toHaveBeenCalledWith('/studies?tag=tag1');
    });

    it('copies formatted markdown for a legacy note', async () => {
        const mockWriteText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText: mockWriteText },
        });
        Object.defineProperty(window, 'isSecureContext', {
            writable: true,
            value: true,
        });

        render(<StudyNoteViewPage />);
        await screen.findByText('Current Note');

        fireEvent.click(screen.getByRole('button', { name: 'common.copy' }));

        await waitFor(() => {
            expect(mockWriteText).toHaveBeenCalledWith('# Current Note\n\nContent for Current Note');
        });
    });

    it('renders node notes with read-only NodeTreeEditor and copies derived node markdown', async () => {
        const mockWriteText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText: mockWriteText },
        });
        Object.defineProperty(window, 'isSecureContext', {
            writable: true,
            value: true,
        });
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: [mockNotes[0], currentNodeNote, mockNotes[2]],
            loading: false,
            error: null,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteViewPage />);
        await screen.findByText('Current Note');

        expect(screen.getByTestId('node-tree-editor')).toHaveAttribute('data-readonly', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'common.copy' }));

        await waitFor(() => {
            expect(mockWriteText).toHaveBeenCalledWith('# Current Note\n\n# Canonical\n\nFresh body');
        });
    });

    it('deletes a note from the more menu and returns to the study list', async () => {
        const mockDeleteNote = jest.fn().mockResolvedValue(undefined);
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: mockNotes,
            loading: false,
            error: null,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: mockDeleteNote,
        });
        window.confirm = jest.fn(() => true);
        (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue([{ noteId: 'note-1', id: 'link-1' }]),
        });

        render(<StudyNoteViewPage />);
        await screen.findByText('Current Note');

        fireEvent.click(screen.getByTitle('common.more'));
        fireEvent.click(screen.getByText('common.delete'));

        await waitFor(() => {
            expect(mockDeleteNote).toHaveBeenCalledWith('note-1');
            expect(mockRouter.push).toHaveBeenCalledWith('/studies');
        });
    });

    it('opens the existing share-link modal from the read-only header', async () => {
        render(<StudyNoteViewPage />);
        await screen.findByText('Current Note');

        fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.shareLinks.shareButton' }));

        expect(screen.getByTestId('share-note-modal')).toHaveTextContent('Current Note');
    });

    it('redirects invalid note ids back to the studies list after the access guard delay', async () => {
        jest.useFakeTimers();
        (useParams as jest.Mock).mockReturnValue({ id: 'missing-note' });
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: mockNotes,
            loading: false,
            error: null,
            createNote: jest.fn(),
            updateNote: jest.fn(),
            deleteNote: jest.fn(),
        });

        render(<StudyNoteViewPage />);

        expect(toast.error).not.toHaveBeenCalled();
        expect(mockRouter.push).not.toHaveBeenCalledWith('/studies');

        act(() => {
            jest.advanceTimersByTime(500);
        });

        expect(toast.error).toHaveBeenCalledWith('studiesWorkspace.noteNotFound');
        expect(mockRouter.push).toHaveBeenCalledWith('/studies');
        jest.useRealTimers();
    });
});
