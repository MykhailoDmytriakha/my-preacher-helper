import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { useFlushOnLeave } from '@/hooks/useFlushOnLeave';
import { useNoteAccessGuard } from '@/hooks/useNoteAccessGuard';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useTags } from '@/hooks/useTags';

import StudyNoteFocusEditorPage from '../page';

const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
};

const mockSetAutoSaveEnabled = jest.fn();
const mockUseStudyNoteDraft = jest.fn();
let mockFlushSave = jest.fn();
let mockRetrySave = jest.fn();
let mockSaveStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
let mockSaveError: string | null = null;
let mockHasUnsavedChanges = true;
let mockExistingNote: unknown = {
    id: 'note-1',
    title: 'Current Note',
    content: 'Initial body',
    tags: ['tag1'],
    scriptureRefs: [],
    type: 'note',
    rootNode: null,
    userId: 'user-1',
    materialIds: [],
    relatedSermonIds: [],
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
};
let mockIsNew = false;
let mockIsInitialized = true;
let mockUid: string | undefined = 'user-1';
let mockInitialDraft = {
    title: 'Current Note',
    content: 'Initial body',
    tags: ['tag1'],
    scriptureRefs: [],
    type: 'note' as 'note' | 'question',
    rootNode: null,
};

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

jest.mock('sonner', () => ({
    toast: {
        success: jest.fn(),
    },
}));

jest.mock('@/hooks/useFlushOnLeave', () => ({
    useFlushOnLeave: jest.fn(),
}));

jest.mock('@/hooks/useNoteAccessGuard', () => ({
    useNoteAccessGuard: jest.fn(),
}));

jest.mock('@/hooks/useStudyNotes');
jest.mock('@/hooks/useTags');

jest.mock('@/hooks/useStudyNoteDraft', () => {
    const React = jest.requireActual<typeof import('react')>('react');

    return {
        useStudyNoteDraft: (noteId: string) => {
            mockUseStudyNoteDraft(noteId);
            const [title, setTitle] = React.useState(mockInitialDraft.title);
            const [content, setContent] = React.useState(mockInitialDraft.content);
            const [tags, setTags] = React.useState<string[]>(mockInitialDraft.tags);
            const [scriptureRefs, setScriptureRefs] = React.useState(mockInitialDraft.scriptureRefs);
            const [type, setType] = React.useState<'note' | 'question'>(mockInitialDraft.type);
            const [rootNode, setRootNode] = React.useState(mockInitialDraft.rootNode);
            const [autoSaveEnabled, setAutoSaveEnabledState] = React.useState(true);

            return {
                draft: { title, content, tags, scriptureRefs, type, rootNode },
                setters: { setTitle, setContent, setTags, setScriptureRefs, setType, setRootNode },
                autoSave: {
                    isSaving: mockSaveStatus === 'saving',
                    saveStatus: mockSaveStatus,
                    lastSaved: null,
                    saveError: mockSaveError,
                    hasUnsavedChanges: mockHasUnsavedChanges,
                    flushSave: mockFlushSave,
                    retrySave: mockRetrySave,
                    autoSaveEnabled,
                    setAutoSaveEnabled: (value: boolean) => {
                        mockSetAutoSaveEnabled(value);
                        setAutoSaveEnabledState(value);
                    },
                },
                meta: {
                    isInitialized: mockIsInitialized,
                    existingNote: mockExistingNote,
                    isNew: mockIsNew,
                    uid: mockUid,
                },
            };
        },
    };
});

jest.mock('react-textarea-autosize', () => {
    const React = jest.requireActual<typeof import('react')>('react');
    const TextareaAutosizeMock = React.forwardRef<
        HTMLTextAreaElement,
        React.TextareaHTMLAttributes<HTMLTextAreaElement>
    >(function TextareaAutosizeMock(props, ref) {
        return <textarea ref={ref} {...props} />;
    });

    return {
        __esModule: true,
        default: TextareaAutosizeMock,
    };
});

jest.mock('@/components/ui/RichMarkdownEditor', () => ({
    __esModule: true,
    RichMarkdownEditor: ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) => (
        <textarea
            data-testid="rich-markdown-editor"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
        />
    ),
}));

jest.mock('@/components/studies/node/NodeTreeEditor', () => ({
    __esModule: true,
    default: ({ rootNode }: { rootNode: unknown }) => (
        <div data-testid="node-tree-editor">{JSON.stringify(rootNode)}</div>
    ),
}));

jest.mock('../../../components/ConvertToNodesModal', () => ({
    __esModule: true,
    default: ({ open }: { open: boolean }) => (open ? <div data-testid="convert-to-nodes-modal" /> : null),
}));

jest.mock('../../../TagCatalogModal', () => ({
    __esModule: true,
    default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="tag-catalog-modal" /> : null),
}));

jest.mock('../../../ScriptureRefPicker', () => ({
    __esModule: true,
    default: () => <div data-testid="scripture-ref-picker" />,
}));

describe('StudyNoteFocusEditorPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFlushSave = jest.fn().mockResolvedValue(undefined);
        mockRetrySave = jest.fn().mockResolvedValue(undefined);
        mockSaveStatus = 'idle';
        mockSaveError = null;
        mockHasUnsavedChanges = true;
        mockExistingNote = {
            id: 'note-1',
            title: 'Current Note',
            content: 'Initial body',
            tags: ['tag1'],
            scriptureRefs: [],
            type: 'note',
            rootNode: null,
            userId: 'user-1',
            materialIds: [],
            relatedSermonIds: [],
            createdAt: '2026-05-22T00:00:00.000Z',
            updatedAt: '2026-05-22T00:00:00.000Z',
        };
        mockIsNew = false;
        mockIsInitialized = true;
        mockUid = 'user-1';
        mockInitialDraft = {
            title: 'Current Note',
            content: 'Initial body',
            tags: ['tag1'],
            scriptureRefs: [],
            type: 'note',
            rootNode: null,
        };

        (useRouter as jest.Mock).mockReturnValue(mockRouter);
        (useParams as jest.Mock).mockReturnValue({ id: 'note-1' });
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('tag=tag1&book=John'));
        (useStudyNotes as jest.Mock).mockReturnValue({
            notes: [],
            loading: false,
            error: null,
        });
        (useTags as jest.Mock).mockReturnValue({
            tags: { requiredTags: [], customTags: [] },
        });
    });

    it('renders title and body editors and accepts edits', () => {
        render(<StudyNoteFocusEditorPage />);

        const titleInput = screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder');
        const bodyEditor = screen.getByTestId('rich-markdown-editor');

        expect(titleInput).toHaveValue('Current Note');
        expect(bodyEditor).toHaveValue('Initial body');

        fireEvent.change(titleInput, { target: { value: 'Edited title' } });
        fireEvent.change(bodyEditor, { target: { value: 'Edited body' } });

        expect(titleInput).toHaveValue('Edited title');
        expect(bodyEditor).toHaveValue('Edited body');
    });

    it('calls flushSave when Done is clicked', async () => {
        render(<StudyNoteFocusEditorPage />);

        fireEvent.click(screen.getByRole('button', { name: 'common.done' }));

        await waitFor(() => {
            expect(mockFlushSave).toHaveBeenCalledTimes(1);
        });
    });

    it('waits for flushSave before routing to the view URL with preserved search params', async () => {
        mockFlushSave.mockImplementation(async () => {
            expect(mockRouter.push).not.toHaveBeenCalled();
        });

        render(<StudyNoteFocusEditorPage />);
        fireEvent.click(screen.getByRole('button', { name: 'common.done' }));

        await waitFor(() => {
            expect(mockRouter.push).toHaveBeenCalledWith('/studies/note-1?tag=tag1&book=John');
        });
    });

    it('uses Escape as Done', async () => {
        render(<StudyNoteFocusEditorPage />);

        fireEvent.keyDown(document, { key: 'Escape' });

        await waitFor(() => {
            expect(mockFlushSave).toHaveBeenCalledTimes(1);
            expect(mockRouter.push).toHaveBeenCalledWith('/studies/note-1?tag=tag1&book=John');
        });
    });

    it('uses Cmd+E as Done', async () => {
        render(<StudyNoteFocusEditorPage />);

        fireEvent.keyDown(document, { key: 'e', metaKey: true });

        await waitFor(() => {
            expect(mockFlushSave).toHaveBeenCalledTimes(1);
            expect(mockRouter.push).toHaveBeenCalledWith('/studies/note-1?tag=tag1&book=John');
        });
    });

    it('calls the mocked draft hook with the route note id', () => {
        render(<StudyNoteFocusEditorPage />);

        expect(mockUseStudyNoteDraft).toHaveBeenCalledWith('note-1');
    });

    it('renders an error retry pill when autosave status is error', () => {
        mockSaveStatus = 'error';
        mockSaveError = 'Error saving changes';

        render(<StudyNoteFocusEditorPage />);

        expect(screen.getByText('studiesWorkspace.saveStatus.saveFailed')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'studiesWorkspace.saveStatus.retry' })).toBeInTheDocument();
    });

    it('calls retrySave when the retry button is clicked', () => {
        mockSaveStatus = 'error';

        render(<StudyNoteFocusEditorPage />);
        fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.saveStatus.retry' }));

        expect(mockRetrySave).toHaveBeenCalledTimes(1);
    });

    it('registers flush-on-leave with the current save callback and dirty state', () => {
        render(<StudyNoteFocusEditorPage />);

        expect(useFlushOnLeave).toHaveBeenCalledWith(mockFlushSave, true);
        expect(useNoteAccessGuard).toHaveBeenCalledWith({
            noteId: 'note-1',
            isNew: false,
            notesLoading: false,
            error: null,
            existingNote: mockExistingNote,
            uid: 'user-1',
            redirectTo: '/studies',
        });
    });

    it('does not leave edit mode when Escape or Cmd+E fire from typing fields', async () => {
        render(<StudyNoteFocusEditorPage />);

        const titleInput = screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder');
        titleInput.focus();

        fireEvent.keyDown(titleInput, { key: 'Escape' });
        fireEvent.keyDown(titleInput, { key: 'e', metaKey: true });

        await waitFor(() => {
            expect(mockFlushSave).not.toHaveBeenCalled();
            expect(mockRouter.push).not.toHaveBeenCalled();
        });
    });

    it('replaces /studies/new/edit with the created note edit URL and Done routes to the created note', async () => {
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        mockExistingNote = {
            id: 'created-note',
            title: 'Created Note',
            content: '',
            tags: [],
            scriptureRefs: [],
            type: 'note',
            rootNode: null,
            userId: 'user-1',
            materialIds: [],
            relatedSermonIds: [],
            createdAt: '2026-05-22T00:00:00.000Z',
            updatedAt: '2026-05-22T00:00:00.000Z',
        };
        mockIsNew = false;

        render(<StudyNoteFocusEditorPage />);

        await waitFor(() => {
            expect(mockRouter.replace).toHaveBeenCalledWith('/studies/created-note/edit?tag=tag1&book=John');
        });

        fireEvent.click(screen.getByRole('button', { name: 'common.done' }));

        await waitFor(() => {
            expect(mockRouter.push).toHaveBeenCalledWith('/studies/created-note?tag=tag1&book=John');
        });
    });

    it('auto-focuses the title input for a new empty note', async () => {
        mockInitialDraft = {
            title: '',
            content: '',
            tags: [],
            scriptureRefs: [],
            type: 'note',
            rootNode: null,
        };
        mockExistingNote = undefined;
        mockIsNew = true;

        render(<StudyNoteFocusEditorPage />);

        await waitFor(() => {
            expect(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder')).toHaveFocus();
        });
    });
});
