import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useTags } from '@/hooks/useTags';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import RouteLoading from '../loading';
import StudyNoteEditorPage from '../page';
import { StudyNote } from '@/models/models';
import { persistedWrite } from '@/utils/recoverableWrite';
import { draftKey, readDraft } from '@/utils/durableDraft';
import { Toaster, toast } from 'sonner';
import enTranslations from '@locales/en/translation.json';

let mockAiFeedbackText: string | undefined;

const mockRecordingRows = new Map<string, unknown>();
const mockAuthState: { user: { uid: string } | null; loading: boolean } = { user: { uid: 'user-1' }, loading: false };
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => mockAuthState }));
jest.mock('idb-keyval', () => ({
  createStore: jest.fn(() => ({})),
  get: jest.fn(async (id: string) => mockRecordingRows.get(id)),
  entries: jest.fn(async () => Array.from(mockRecordingRows.entries())),
  update: jest.fn(async (id: string, transform: (row: unknown) => unknown) => { mockRecordingRows.set(id, transform(mockRecordingRows.get(id))); }),
}));
beforeEach(() => {
  mockAiFeedbackText = undefined;
  mockAuthState.user = { uid: 'user-1' };
  mockAuthState.loading = false;
  mockRecordingRows.clear();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
});

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
    useParams: jest.fn(),
    useSearchParams: jest.fn(),
}));

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key === 'studiesWorkspace.aiAnalyze.success' && mockAiFeedbackText
            ? mockAiFeedbackText : key,
        i18n: { language: 'en' },
    }),
}));

// Mock hooks
// This suite covers pagination and editing, not live sync. The real hook opens a
// Firestore listener, which the global SDK mock here cannot serve; freshness has
// its own dedicated tests.
jest.mock('@/hooks/useDocumentFreshness', () => ({
  useDocumentFreshness: () => ({
    state: 'fresh',
    remote: null,
    remotelyDeleted: false,
    markSynced: jest.fn(),
  }),
}));
// The page decides its layout in JS, not in CSS, so the breakpoint bands are testable.
// `mock` prefix is required: jest hoists the factory above this declaration.
const mockViewport = { wide: true, roomy: true };
jest.mock('@/hooks/useWideViewport', () => ({
    useWideViewport: () => mockViewport.wide,
    useRoomyHeader: () => mockViewport.roomy,
}));
jest.mock('@/hooks/useStudyNotes');
jest.mock('@/hooks/useTags');
jest.mock('@/hooks/useStudyNoteShareLinks');
// The page asks this to decide whether the collapsed rail shows its "a sermon uses
// this note" dot. It reaches React Query, which this suite does not stand up.
jest.mock('@/hooks/useSermonNoteLinks', () => ({
  useSermonsBuiltOnNote: () => ({ sermons: [] }),
}));

jest.mock('@/services/firebaseAuth.service', () => ({
    auth: {
        currentUser: {
            getIdToken: jest.fn().mockResolvedValue('firebase-token'),
        },
    },
}));

// Mock components to avoid deep rendering issues in this test
jest.mock('@components/MarkdownDisplay', () => ({
    __esModule: true,
    default: ({ content }: { content: string }) => <div data-testid="markdown-display">{content}</div>,
}));

jest.mock('react-textarea-autosize', () => ({
    __esModule: true,
    default: (props: any) => <textarea {...props} />,
}));

/**
 * The "sermons built on this note" block reads the sermon cache, which this suite provides no
 * QueryClient for. Stubbed like the editor above, and it ECHOES the note id it was handed, so
 * the wiring stays visible here while its own rendering is proven in its component test.
 */
jest.mock('../../components/SermonsBuiltOnNote', () => ({
    __esModule: true,
    default: ({ noteId }: { noteId?: string }) => (
        <div data-testid="sermons-built-on-note-stub">{noteId ?? ''}</div>
    ),
}));

jest.mock('@/components/ui/RichMarkdownEditor', () => ({
    __esModule: true,
    RichMarkdownEditor: ({ value, onChange, placeholder }: any) => (
        <textarea
            data-testid="rich-markdown-editor"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
        />
    ),
}));

jest.mock('@/components/FocusRecorderButton', () => ({
    __esModule: true,
    FocusRecorderButton: ({ onRecordingComplete, onRecordingStateChange }: any) => (
        <>
        <button aria-label="Start dictation capture" onClick={() => onRecordingStateChange?.(true)}>Start capture</button>
        <button
            title="studiesWorkspace.voiceRecord"
            onClick={() => { onRecordingStateChange?.(false); onRecordingComplete(new Blob(['completed speech'], { type: 'audio/webm' })); }}
        >
            Mic
        </button>
        </>
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

const acceptedNoteDelivery = () => new Map(mockNotes.map(note => [note.id, { pending: false, needsAttention: false }]));

describe('StudyNoteEditorPage Pagination', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue(mockRouter);
        (useParams as jest.Mock).mockReturnValue(mockParams);
        (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);

        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: mockNotes, noteDelivery: acceptedNoteDelivery(),
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
            deleteShareLink: jest.fn(),
        });
    });

    it('waits for the owner collection before exposing a new note editor', async () => {
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
        const collection = { uid: undefined, notes: [], loading: true, createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() };
        (useStudyNotes as jest.Mock).mockReturnValue(collection);
        const view = render(<StudyNoteEditorPage />);
        expect(screen.queryByTestId('rich-markdown-editor')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'common.back' })).toBeEnabled();
        expect(screen.getByTestId('note-detail-skeleton')).toBeInTheDocument();
        expect(view.container.querySelector('.animate-spin')).toBeNull();
        expect(view.container.querySelector('[data-page-loading]')).not.toBeNull();
        (useStudyNotes as jest.Mock).mockReturnValue({ ...collection, uid: 'user-1', loading: false });
        view.rerender(<StudyNoteEditorPage />);
        expect(await screen.findByTestId('rich-markdown-editor')).toBeVisible();
        expect(view.container.querySelector('[data-page-loading]')).toBeNull();
    });

    it('keeps an already opened note readable while the collection checks again', () => {
        const view = render(<StudyNoteEditorPage />);
        expect(screen.getByText('Current Note')).toBeVisible();
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: mockNotes,
            noteDelivery: acceptedNoteDelivery(), loading: true, createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() });
        view.rerender(<StudyNoteEditorPage />);
        expect(screen.getByText('Current Note')).toBeVisible();
        expect(screen.queryByTestId('note-detail-skeleton')).not.toBeInTheDocument();
        expect(view.container.querySelector('[data-page-loading]')).toBeNull();
    });

    it('keeps confirmed absence visible even during another collection check', () => {
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: true,
            notePresence: () => ({ kind: 'absent', source: 'server', snapshot: { resource: { collection: 'studyNotes', id: 'note-1' }, value: null, metadata: null } }),
            refetch: jest.fn(), createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() });
        render(<StudyNoteEditorPage />);
        expect(screen.getByText('recordAvailability.notFound')).toBeVisible();
        expect(screen.queryByTestId('note-detail-skeleton')).not.toBeInTheDocument();
    });

    it('names a server-confirmed missing note and offers a route back', async () => {
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false,
            notePresence: () => ({ kind: 'absent', source: 'server', snapshot: { resource: { collection: 'studyNotes', id: 'note-1' }, value: null, metadata: null } }),
            refetch: jest.fn(), createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() });
        render(<StudyNoteEditorPage />);
        expect(await screen.findByText('recordAvailability.notFound')).toBeVisible();
        expect(screen.getByRole('button', { name: 'common.back' })).toBeEnabled();
    });

    it.each([false, true])('keeps a prior missing-note draft visible while its read is waiting: metadataOnly=%s', async metadataOnly => {
        localStorage.clear();
        const kept = { title: metadataOnly ? '' : 'Kept missing title', content: metadataOnly ? '' : 'Kept missing words', tags: ['kept-missing-tag'],
            scriptureRefs: [{ id: 'kept-reference', book: 'John', chapter: 3, fromVerse: 16, bible: 'kjv' }], type: 'note' };
        const key = draftKey('user-1', 'note-1', 'note');
        localStorage.setItem(key, JSON.stringify({ value: kept, savedAt: Date.now() - 1000 }));
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: true,
            notePresence: () => ({ kind: 'unknown', source: null, snapshot: null }),
            refetch: jest.fn(), createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() });
        const view = render(<StudyNoteEditorPage />);
        try {
            expect(await screen.findByText('kept-missing-tag')).toBeVisible();
            expect(view.container.querySelector('[data-page-loading]')).toBeNull();
            expect(screen.getByText(/3:16/)).toBeVisible();
            if (!metadataOnly) {
                expect(screen.getByText('Kept missing title')).toBeVisible();
                expect(screen.getByText('Kept missing words')).toBeVisible();
            }
            expect(screen.queryByText('recordAvailability.notFound')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'common.back' })).toBeEnabled();
            view.unmount();
            expect(readDraft(key)?.value).toEqual(kept);
        } finally { view.unmount(); localStorage.clear(); }
    });

    it.each([['Only A', 'Only B'], ['Same words', 'Same words']])(
        'keeps independent precreate drafts %s and %s after sequential editor departures',
        (first, second) => {
            jest.useFakeTimers();
            localStorage.clear();
            const createNote = jest.fn();
            (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
            (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
            (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false,
                createNote, updateNote: jest.fn(), deleteNote: jest.fn() });
            const copies = () => Object.keys(localStorage)
                .filter(key => key.startsWith('draft:v1:user-1:') && key.endsWith(':note'))
                .map(key => ({ key, record: readDraft<{ content: string }>(key) }));
            try {
                for (const content of [first, second]) {
                    const view = render(<StudyNoteEditorPage />);
                    fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: content } });
                    view.unmount();
                }
                const saved = copies();
                expect(saved).toHaveLength(2);
                expect(saved.map(copy => copy.record?.value.content).sort()).toEqual([first, second].sort());
                expect(new Set(saved.map(copy => copy.record?.creationTargetId)).size).toBe(2);
                expect(createNote).not.toHaveBeenCalled();
            } finally { localStorage.clear(); jest.clearAllTimers(); jest.useRealTimers(); }
        },
    );

    it.each([true, false])('keeps new words independent from a missing-source deleted bookmark with canonical metadata initially %s', initiallyKnown => {
        jest.useFakeTimers(); localStorage.clear();
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('draft=new~deleted-note&draftOwner=user-1'));
        const createNote = jest.fn();
        const collection = { uid: 'user-1', notes: [], loading: false, confirmedCreationIds: new Set(initiallyKnown ? ['deleted-note'] : []), createNote, updateNote: jest.fn(), deleteNote: jest.fn() };
        (useStudyNotes as jest.Mock).mockReturnValue(collection);
        const view = render(<StudyNoteEditorPage />);
        try {
            fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'New independent words' } });
            act(() => { jest.advanceTimersByTime(400); });
            collection.confirmedCreationIds = new Set(['deleted-note']);
            view.rerender(<StudyNoteEditorPage />);
            view.unmount();
            const copies = Object.keys(localStorage).filter(key => key.startsWith('draft:v1:user-1:') && key.endsWith(':note')).map(key => readDraft<{ content: string }>(key));
            expect(copies).toHaveLength(1);
            expect(copies[0]?.value.content).toBe('New independent words');
            expect(copies[0]?.creationTargetId).not.toBe('deleted-note');
            expect(createNote).not.toHaveBeenCalled();
        } finally { view.unmount(); localStorage.clear(); jest.clearAllTimers(); jest.useRealTimers(); }
    });

    it('keeps the current opening when its reserved address is reflected into the URL before backup persistence', () => {
        jest.useFakeTimers(); localStorage.clear();
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false, createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() });
        const view = render(<StudyNoteEditorPage />);
        try {
            const address = new URL(window.location.href).searchParams;
            expect(address.get('draft')).toMatch(/^new~/);
            fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Words before backup' } });
            expect(Object.keys(localStorage).some(key => key.startsWith('draft:v1:user-1:'))).toBe(false);
            (useSearchParams as jest.Mock).mockReturnValue(address);
            view.rerender(<StudyNoteEditorPage />);
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Words before backup');
            view.unmount();
            const copy = readDraft<{ content: string }>(draftKey('user-1', address.get('draft')!, 'note'));
            expect(copy?.value.content).toBe('Words before backup');
        } finally { view.unmount(); localStorage.clear(); jest.clearAllTimers(); jest.useRealTimers(); }
    });

    it('a blank new visit does not replace or offer another unfinished note', () => {
        jest.useFakeTimers(); localStorage.clear();
        const kept = { title: '', content: 'Kept A', tags: [], scriptureRefs: [], type: 'note' };
        const key = draftKey('user-1', 'new~A', 'note');
        localStorage.setItem(key, JSON.stringify({ value: kept, savedAt: 1, creationTargetId: 'A' }));
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false, createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() });
        const view = render(<StudyNoteEditorPage />);
        try {
            act(() => { jest.advanceTimersByTime(400); });
            expect(screen.queryByRole('button', { name: 'unsavedDraft.restore' })).not.toBeInTheDocument();
            expect(readDraft(key)?.value).toEqual(kept);
            view.unmount();
            expect(Object.keys(localStorage).filter(key => key.startsWith('draft:v1:user-1:'))).toEqual([key]);
        } finally { view.unmount(); localStorage.clear(); jest.clearAllTimers(); jest.useRealTimers(); }
    });

    it('resumes the chosen new note with all fields and its original creation identity', async () => {
        jest.useFakeTimers(); localStorage.clear();
        const kept = { title: 'Chosen title', content: 'Chosen words', tags: ['chosen-tag'], scriptureRefs: [], type: 'question', dictationSourceIds: ['dictated-A'], recordingSourceIds: ['recorded-A'] };
        const key = draftKey('user-1', 'new~A', 'note');
        localStorage.setItem(key, JSON.stringify({ value: kept, savedAt: 1, creationTargetId: 'A' }));
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('draft=new~A'));
        const createNote = jest.fn(() => ({ acceptance: Promise.resolve({ kind: 'queued', receipt: 'A' }), persistence: new Promise<void>(() => undefined), note: { id: 'A' } }));
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false, createNote, updateNote: jest.fn(), deleteNote: jest.fn() });
        const view = render(<StudyNoteEditorPage />);
        try {
            act(() => { jest.advanceTimersByTime(400); });
            expect(readDraft(key)?.value).toEqual(kept);
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('');
            fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Chosen words');
            expect(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder')).toHaveValue('Chosen title');
            await act(async () => { jest.advanceTimersByTime(1600); });
            expect(createNote).toHaveBeenCalledTimes(1);
            expect(createNote).toHaveBeenCalledWith(expect.objectContaining(kept), { id: 'A', captureScope: expect.stringMatching(/^draft-capture:v1:/) });
        } finally { view.unmount(); localStorage.clear(); jest.clearAllTimers(); jest.useRealTimers(); }
    });

    it('changing only the selected draft resets the editor and leaves each backup at its own address', () => {
        jest.useFakeTimers(); localStorage.clear();
        const value = (content: string) => ({ title: '', content, tags: [], scriptureRefs: [], type: 'note' });
        for (const id of ['A', 'B']) localStorage.setItem(draftKey('user-1', `new~${id}`, 'note'), JSON.stringify({ value: value(`Only ${id}`), savedAt: 1, creationTargetId: id }));
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('draft=new~A'));
        const createNote = jest.fn();
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false, createNote, updateNote: jest.fn(), deleteNote: jest.fn() });
        const view = render(<StudyNoteEditorPage />);
        try {
            fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
            fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Later A' } });
            (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('draft=new~B'));
            view.rerender(<StudyNoteEditorPage />);
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('');
            act(() => { jest.advanceTimersByTime(400); });
            expect(readDraft(draftKey('user-1', 'new~A', 'note'))?.value).toEqual(value('Later A'));
            expect(readDraft(draftKey('user-1', 'new~B', 'note'))?.value).toEqual(value('Only B'));
            fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Only B');
            expect(createNote).not.toHaveBeenCalled();
        } finally { view.unmount(); localStorage.clear(); jest.clearAllTimers(); jest.useRealTimers(); }
    });

    it('a surviving resume source opens its already represented note without creating it again', () => {
        jest.useFakeTimers(); localStorage.clear();
        const note = createMockNote('A', 'Already captured');
        localStorage.setItem(draftKey('user-1', 'new~A', 'note'), JSON.stringify({ value: { title: '', content: 'Already captured', tags: [], scriptureRefs: [], type: 'note' }, savedAt: 1, creationTargetId: 'A' }));
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('draft=new~A&draftOwner=user-1'));
        const createNote = jest.fn();
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [note], loading: false, createNote, updateNote: jest.fn(), deleteNote: jest.fn(), noteDelivery: new Map([['A', { pending: true, needsAttention: false }]]) });
        const view = render(<StudyNoteEditorPage />);
        try {
            expect(screen.getByText(note.content)).toBeInTheDocument();
            act(() => { jest.advanceTimersByTime(2000); });
            expect(createNote).not.toHaveBeenCalled();
            expect(screen.queryByText('common.saved')).not.toBeInTheDocument();
        } finally { view.unmount(); localStorage.clear(); jest.clearAllTimers(); jest.useRealTimers(); }
    });

    it.each([undefined, 'legacy-target'])('resumes the legacy new copy with target %s without blanking it before Restore', async target => {
        jest.useFakeTimers(); localStorage.clear();
        const kept = { title: '', content: 'Legacy words', tags: [], scriptureRefs: [], type: 'note' };
        const key = draftKey('user-1', 'new', 'note');
        localStorage.setItem(key, JSON.stringify({ value: kept, savedAt: 1, ...(target ? { creationTargetId: target } : {}) }));
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('draft=new'));
        const createNote = jest.fn((_input, options: { id: string }) => ({ ...persistedWrite(Promise.resolve()), note: { id: options.id } }));
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false, createNote, updateNote: jest.fn(), deleteNote: jest.fn() });
        const view = render(<StudyNoteEditorPage />);
        try {
            act(() => { jest.advanceTimersByTime(400); });
            expect(readDraft(key)?.value).toEqual(kept);
            fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Legacy words');
            await act(async () => { jest.advanceTimersByTime(1600); });
            expect(createNote).toHaveBeenCalledTimes(1);
            expect(createNote.mock.calls[0][1].id).toEqual(target ?? expect.any(String));
            expect(readDraft(key)).toBeNull();
        } finally { view.unmount(); localStorage.clear(); jest.clearAllTimers(); jest.useRealTimers(); }
    });

    it('does not reserve another accounts resource identity from its resume URL', () => {
        jest.useFakeTimers(); localStorage.clear();
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('draft=new~foreign-target&draftOwner=another-owner'));
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false, createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() });
        const view = render(<StudyNoteEditorPage />);
        try {
            fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'My independent words' } });
            view.unmount();
            const copies = Object.keys(localStorage).filter(key => key.startsWith('draft:v1:user-1:') && key.endsWith(':note')).map(key => readDraft(key));
            expect(copies).toHaveLength(1);
            expect(copies[0]?.creationTargetId).not.toBe('foreign-target');
        } finally { view.unmount(); localStorage.clear(); jest.clearAllTimers(); jest.useRealTimers(); }
    });

    it('keeps the active words when native creation clears the query before route params change', async () => {
        jest.useFakeTimers(); localStorage.clear();
        localStorage.setItem(draftKey('user-1', 'new~A', 'note'), JSON.stringify({ value: { title: '', content: 'Before creation', tags: [], scriptureRefs: [], type: 'note' }, savedAt: 1, creationTargetId: 'A' }));
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('draft=new~A&draftOwner=user-1'));
        const createNote = jest.fn(() => ({ acceptance: Promise.resolve({ kind: 'queued', receipt: 'A' }), persistence: new Promise<void>(() => undefined), note: { id: 'A' } }));
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false, createNote, updateNote: jest.fn(), deleteNote: jest.fn() });
        const view = render(<StudyNoteEditorPage />);
        try {
            fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
            fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Words during creation' } });
            await act(async () => { jest.advanceTimersByTime(1600); });
            expect(createNote).toHaveBeenCalledTimes(1);
            expect(window.location.pathname).toBe('/studies/A');
            // Native Next history changes search params while keeping the existing route tree.
            (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
            view.rerender(<StudyNoteEditorPage />);
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Words during creation');
            expect(createNote).toHaveBeenCalledTimes(1);
            expect(window.location.pathname).toBe('/studies/A');
        } finally { view.unmount(); localStorage.clear(); jest.clearAllTimers(); jest.useRealTimers(); }
    });

    it('reopens the selected draft for the same guest owner resolved by the note reader', () => {
        jest.useFakeTimers(); localStorage.clear(); mockAuthState.user = { uid: 'guest-owner' };
        const kept = { title: '', content: 'Guest unfinished words', tags: [], scriptureRefs: [], type: 'note' };
        const key = draftKey('guest-owner', 'new~guest-note', 'note');
        localStorage.setItem(key, JSON.stringify({ value: kept, savedAt: 1, creationTargetId: 'guest-note' }));
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('draft=new~guest-note&draftOwner=guest-owner'));
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'guest-owner', notes: [], loading: false, createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() });
        const view = render(<StudyNoteEditorPage />);
        try {
            expect(screen.getByRole('button', { name: 'unsavedDraft.restore' })).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Guest unfinished words');
            expect(readDraft(key)?.value).toEqual(kept);
        } finally { view.unmount(); localStorage.clear(); jest.clearAllTimers(); jest.useRealTimers(); }
    });

    it.each([
        ['tags', 'tags'], ['tags', 'scriptureRefs'],
        ['scriptureRefs', 'tags'], ['scriptureRefs', 'scriptureRefs'],
    ] as const)('keeps both proposals when %s starts first and %s finishes first', async (start, first) => {
        const finish: Record<string, (value: unknown) => void> = {};
        (global.fetch as jest.Mock) = jest.fn((_url, init) => new Promise(resolve => {
            const target = JSON.parse(init.body).analysisType;
            finish[target] = resolve;
        }));
        render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('common.edit'));
        const refs = screen.getByTitle('studiesWorkspace.aiAnalyze.findRefs');
        const tags = screen.getByTitle('studiesWorkspace.aiAnalyze.generateTags');
        const buttons = { scriptureRefs: refs, tags };
        const other = start === 'tags' ? 'scriptureRefs' : 'tags';
        fireEvent.click(buttons[start]);
        await waitFor(() => expect(finish[start]).toBeDefined());
        expect(buttons[other]).toBeEnabled();
        fireEvent.click(buttons[other]);
        await waitFor(() => expect(finish[other]).toBeDefined());
        expect(refs).toHaveAttribute('aria-busy', 'true');
        expect(tags).toHaveAttribute('aria-busy', 'true');

        const results = {
            tags: { tags: ['parallel-tag'] },
            scriptureRefs: { scriptureRefs: [{ id: 'parallel-ref', book: 'John', chapter: 3, fromVerse: 16 }] },
        };
        const resolve = async (target: keyof typeof results) => {
            await act(async () => finish[target]({ ok: true, json: async () => ({ success: true, data: results[target] }) }));
        };
        const second = first === 'tags' ? 'scriptureRefs' : 'tags';
        await resolve(first);
        const apply = await screen.findByText('studiesWorkspace.aiAnalyze.applySelected');
        const firstResult = first === 'tags' ? 'parallel-tag' : 'John 3:16';
        expect(screen.getByText(firstResult)).toBeInTheDocument();
        expect(second === 'tags' ? tags : refs).toHaveAttribute('aria-busy', 'true');
        await resolve(second);
        expect(screen.getByText(firstResult)).toBeInTheDocument();
        fireEvent.click(apply);
        const nextApply = await screen.findByText('studiesWorkspace.aiAnalyze.applySelected');
        fireEvent.click(nextApply);
        expect(screen.queryByText('studiesWorkspace.aiAnalyze.applySelected')).not.toBeInTheDocument();
        expect(screen.getByText('parallel-tag')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'John 3:16' })).toBeInTheDocument();
    });

    it('blocks overlapping menu actions while an independent request survives a failure', async () => {
        const requests: Record<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }> = {};
        (global.fetch as jest.Mock) = jest.fn((_url, init) => new Promise((resolve, reject) => {
            requests[JSON.parse(init.body).analysisType] = { resolve, reject };
        }));
        render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('common.edit'));
        const refs = screen.getByTitle('studiesWorkspace.aiAnalyze.findRefs');
        fireEvent.click(refs);
        fireEvent.click(refs);
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.aiAnalyze.button' }));
        expect(screen.getByText('studiesWorkspace.aiAnalyze.full')).toBeDisabled();
        expect(screen.getByText('studiesWorkspace.aiAnalyze.findRefs')).toBeDisabled();
        expect(screen.getByText('studiesWorkspace.aiAnalyze.generateTitle')).toBeEnabled();
        fireEvent.click(screen.getByText('studiesWorkspace.aiAnalyze.generateTags'));
        await waitFor(() => expect(requests.tags).toBeDefined());
        await act(async () => requests.scriptureRefs.reject(new Error('Reference analysis failed')));
        expect(refs).toHaveAttribute('aria-busy', 'false');
        expect(screen.getByRole('button', { name: 'studiesWorkspace.aiAnalyze.button' })).toHaveAttribute('aria-busy', 'true');
        await act(async () => requests.tags.resolve({ ok: true, json: async () => ({
            success: true, data: { tags: ['surviving-tag'], title: 'Unrequested title' },
        }) }));
        expect(screen.queryByText('Unrequested title')).not.toBeInTheDocument();
        fireEvent.click(await screen.findByText('studiesWorkspace.aiAnalyze.applySelected'));
        expect(screen.getByText('surviving-tag')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Current Note')).toBeInTheDocument();
    });

    // BUG-20261021-note-opens-with-spinner: a spinning green arrow read as "refreshing" while a note opened.
    it('shows the note\'s silhouette, not a spinner, while the notes come and while the route loads', () => {
        (useParams as jest.Mock).mockReturnValue({ id: 'silhouette-loading-note' });
        window.history.replaceState(null, '', '/studies/silhouette-loading-note');
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: true, createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() });
        const { container, unmount } = render(<StudyNoteEditorPage />);
        expect(screen.getByTestId('note-detail-skeleton')).toHaveAttribute('aria-busy', 'true');
        expect(container.querySelector('.animate-spin')).toBeNull();
        unmount();

        const route = render(<RouteLoading />);
        expect(screen.getByTestId('note-detail-skeleton')).toBeInTheDocument();
        expect(route.container.querySelector('.animate-spin')).toBeNull();
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

        // The reverse side of the sermon↔note link must be MOUNTED with THIS note's id.
        // Asserting it here is what stops the block being deleted from the page while its own
        // component test keeps passing.
        expect(screen.getByTestId('sermons-built-on-note-stub')).toHaveTextContent('note-1');
    });

    it.each(['pending', 'needs-attention', 'unknown'] as const)('does not call a restored %s row Saved from its timestamp', async delivery => {
        const queued = { ...mockNotes[1], content: 'Words retained locally before reload' };
        const updateNote = jest.fn();
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [queued], loading: false,
            noteDelivery: delivery === 'unknown' ? new Map() : new Map([[queued.id, { pending: true, needsAttention: delivery === 'needs-attention' }]]),
            createNote: jest.fn(), updateNote, deleteNote: jest.fn() });
        render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('common.edit'));
        expect(screen.getByTestId('rich-markdown-editor')).toHaveValue(queued.content);
        expect(screen.queryByText('common.saved')).not.toBeInTheDocument();
        expect(updateNote).not.toHaveBeenCalled();
    });

    it('shows Saved after the restored row has no outstanding request without resubmitting its words', async () => {
        let pending = true;
        const queued = { ...mockNotes[1], content: 'Restored queued words' };
        const updateNote = jest.fn();
        (useStudyNotes as jest.Mock).mockImplementation(() => ({ uid: 'user-1', notes: [queued], loading: false,
            noteDelivery: new Map([[queued.id, { pending, needsAttention: false }]]),
            createNote: jest.fn(), updateNote, deleteNote: jest.fn() }));
        const view = render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('common.edit'));
        expect(screen.queryByText('common.saved')).not.toBeInTheDocument();
        pending = false;
        view.rerender(<StudyNoteEditorPage />);
        await waitFor(() => expect(screen.getByText('common.saved')).toBeInTheDocument());
        expect(screen.getByTestId('rich-markdown-editor')).toHaveValue(queued.content);
        expect(updateNote).not.toHaveBeenCalled();
    });

    it('keeps an accepted current note Saved while a different note waits', async () => {
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: mockNotes, loading: false,
            noteDelivery: new Map(mockNotes.map(note => [note.id, { pending: note.id === 'note-2', needsAttention: false }])),
            createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() });
        render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('common.edit'));
        expect(screen.getByText('common.saved')).toBeInTheDocument();
    });

    it('does not let an early local persisted callback claim delivery while the row still waits', async () => {
        jest.useFakeTimers();
        let pending = false;
        let projectedNotes = mockNotes;
        const updateNote = jest.fn(({ updates }: { updates: Partial<StudyNote> }) => {
            pending = true;
            projectedNotes = projectedNotes.map(note => note.id === 'note-1' ? { ...note, ...updates } : note);
            return { acceptance: Promise.resolve({ kind: 'persisted' }), persistence: Promise.resolve(),
                result: Promise.resolve({ id: 'note-1', revision: 2 }) };
        });
        (useStudyNotes as jest.Mock).mockImplementation(() => ({ uid: 'user-1', notes: projectedNotes, loading: false,
            noteDelivery: new Map(projectedNotes.map(note => [note.id, { pending: note.id === 'note-1' && pending, needsAttention: false }])),
            createNote: jest.fn(), updateNote, deleteNote: jest.fn() }));
        try {
            render(<StudyNoteEditorPage />);
            fireEvent.click(screen.getByTitle('common.edit'));
            fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Waiting for a real acknowledgement' } });
            await act(async () => { await jest.advanceTimersByTimeAsync(1600); });
            expect(updateNote).toHaveBeenCalledTimes(1);
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Waiting for a real acknowledgement');
            expect(screen.queryByText('common.saved')).not.toBeInTheDocument();
        } finally { jest.clearAllTimers(); jest.useRealTimers(); }
    });

    it('drops the "saved" tick as soon as the text differs from what the server has', async () => {
        /**
         * Found in the browser, not by a test: the green "Saved" stayed up while newer
         * keystrokes sat unsent. "Saved" is a claim about THIS text, not a memory that a
         * save happened at some point — and an app that says it while the server has
         * something else is making exactly the claim this migration exists to stop.
         */
        render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('common.edit'));

        await waitFor(() => expect(screen.getByText('common.saved')).toBeInTheDocument());

        const editor = screen.getByTestId('rich-markdown-editor');
        fireEvent.change(editor, { target: { value: 'Текст, которого ещё нет на сервере' } });

        await waitFor(() => expect(screen.queryByText('common.saved')).not.toBeInTheDocument());
    });

    it('brings the tick back once the save lands, instead of hiding it forever', async () => {
        jest.useFakeTimers();
        // The first cut of the fix compared against a REF, which never re-renders: the tick
        // went out on the first keystroke and never returned, even after the server had the
        // text. Saying nothing is not better than saying it wrong.
        const updateNote = jest.fn().mockReturnValue({
            acceptance: Promise.resolve({ kind: 'persisted' }),
            persistence: Promise.resolve(),
            result: Promise.resolve({ id: 'note-2', revision: 2 }),
        });
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1',
            notes: mockNotes, noteDelivery: acceptedNoteDelivery(),
            loading: false,
            createNote: jest.fn(),
            updateNote,
            deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('common.edit'));

        fireEvent.change(screen.getByTestId('rich-markdown-editor'), {
            target: { value: 'Текст, который сервер принял' },
        });
        expect(screen.queryByText('common.saved')).not.toBeInTheDocument();

        // Exercise the real 1.5 s debounce without making every build sleep for it.
        await act(async () => {
            await jest.advanceTimersByTimeAsync(1500);
        });
        expect(updateNote).toHaveBeenCalled();
        expect(screen.getByText('common.saved')).toBeInTheDocument();
        jest.useRealTimers();
    });

    it('does not offer pre-dictation words again after a new note adopts its created address', async () => {
        jest.useFakeTimers();
        window.localStorage.clear();
        const id = 'adopt-current-words';
        const original = { title: 'Unfinished thought', content: 'Earlier typed words', tags: [], scriptureRefs: [], type: 'note' };
        localStorage.setItem(draftKey('user-1', `new~${id}`, 'note'), JSON.stringify({ value: original, savedAt: 1, creationTargetId: id }));
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams(`draft=new~${id}&draftOwner=user-1`));
        window.history.replaceState(null, '', `/studies/new?draft=new~${id}&draftOwner=user-1`);
        let finish!: () => void;
        const persistence = new Promise<void>(resolve => { finish = resolve; });
        const createNote = jest.fn((note: Partial<StudyNote>) => ({ acceptance: Promise.resolve({ kind: 'queued', receipt: id }), persistence, note: { ...note, id } }));
        const delivery = new Map([[id, { pending: true, needsAttention: false }]]);
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], noteDelivery: delivery, loading: false, createNote, updateNote: jest.fn(), deleteNote: jest.fn() });
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, polishedText: 'New dictated sentence' }) });
        const view = render(<StudyNoteEditorPage />);
        try {
            fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
            fireEvent.click(screen.getByTitle('studiesWorkspace.voiceRecord'));
            for (let step = 0; step < 20 && !createNote.mock.calls.length; step += 1) {
                await act(async () => { await jest.advanceTimersByTimeAsync(10); });
            }
            const expected = 'Earlier typed words\n\nNew dictated sentence';
            expect(createNote).toHaveBeenCalledTimes(1);
            expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ content: expected }), { id, captureScope: expect.stringMatching(/^draft-capture:v1:/) });
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue(expected);
            await act(async () => { delivery.set(id, { pending: false, needsAttention: false }); finish(); await persistence; await jest.advanceTimersByTimeAsync(900); });
            expect(screen.getByText('common.saved')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'unsavedDraft.restore' })).not.toBeInTheDocument();
            expect(readDraft(draftKey('user-1', id, 'note'))).toBeNull();
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue(expected);
        } finally { view.unmount(); window.localStorage.clear(); jest.useRealTimers(); }
    });

    it('saves dictated text at once, not after the typing pause', async () => {
        // Seen on screen means on its way: the preacher may lock the phone the moment the text
        // appears, and a locked iPhone freezes the device storage (BUG-20261006-hidden-tab-holds-last-edit).
        jest.useFakeTimers();
        (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true, polishedText: 'Надиктованная мысль' }),
        });
        const updateNote = jest.fn().mockReturnValue({
            acceptance: Promise.resolve({ kind: 'persisted' }),
            persistence: Promise.resolve(),
            result: Promise.resolve({ id: 'note-2', revision: 2 }),
        });
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1', notes: mockNotes, noteDelivery: acceptedNoteDelivery(), loading: false, createNote: jest.fn(), updateNote, deleteNote: jest.fn(),
        });

        render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(screen.getAllByTitle('studiesWorkspace.voiceRecord')[0]);
        // The recording is kept on the device before it is transcribed; wait for the text to land.
        const editorText = () => (screen.getByTestId('rich-markdown-editor') as HTMLTextAreaElement).value;
        for (let step = 0; step < 100 && !editorText().includes('Надиктованная мысль'); step += 1) {
            await act(async () => { await jest.advanceTimersByTimeAsync(10); });
        }
        expect(editorText()).toContain('Надиктованная мысль');
        // From the moment it is on screen: well inside the 1.5 s typing pause.
        await act(async () => { await jest.advanceTimersByTimeAsync(100); });

        expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({
            updates: expect.objectContaining({ content: expect.stringContaining('Надиктованная мысль') }),
        }));
        jest.useRealTimers();
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

            // By default, it's a note. In read-only mode, check if note badge is shown.
            // The badge is a chip, so the plate is on the chip, not on the label inside it.
            const noteChip = screen.getByText('studiesWorkspace.type.note').closest('span.rounded-full');
            expect(noteChip?.className).toMatch(/bg-gray-\d+/);

            // Switch to edit mode, change to question, then switch back to read-only
            fireEvent.click(screen.getByTitle('common.edit'));
            fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.type.question' }));
            fireEvent.click(screen.getByTitle('common.done')); // exit edit mode

            // Check if question badge is shown in amber
            const questionChip = screen.getByText('studiesWorkspace.type.question').closest('span.rounded-full');
            expect(questionChip?.className).toMatch(/text-amber-\d+/);
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

    it('announces suggestions ready for review and preserves the note until explicit application', async () => {
        mockAiFeedbackText = enTranslations.studiesWorkspace.aiAnalyze.success;
        const originalMatchMedia = window.matchMedia;
        window.matchMedia = jest.fn().mockImplementation((media: string) => ({
            media, matches: false, onchange: null,
            addEventListener: jest.fn(), removeEventListener: jest.fn(),
            addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
        }));
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, data: { title: 'Suggested title', tags: ['suggested-tag'] } }),
        });
        const view = render(<><Toaster /><StudyNoteEditorPage /></>);
        try {
            fireEvent.click(screen.getByTitle('common.edit'));
            const title = screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder');
            const editor = screen.getByTestId('rich-markdown-editor');
            const originalContent = (editor as HTMLTextAreaElement).value;
            const analyze = async () => {
                fireEvent.click(screen.getByTitle('studiesWorkspace.aiAnalyze.button'));
                fireEvent.click(await screen.findByText('studiesWorkspace.aiAnalyze.full'));
                return screen.findByRole('button', { name: 'studiesWorkspace.aiAnalyze.applySelected' });
            };

            await analyze();
            expect(await screen.findByText(mockAiFeedbackText)).toHaveTextContent('Suggestions are ready to review.');
            expect(title).toHaveValue('Current Note');
            expect(editor).toHaveValue(originalContent);
            fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
            await waitFor(() => expect(screen.queryByRole('button', { name: 'studiesWorkspace.aiAnalyze.applySelected' })).not.toBeInTheDocument());
            expect(title).toHaveValue('Current Note');
            expect(editor).toHaveValue(originalContent);
            expect(screen.queryByText('suggested-tag')).not.toBeInTheDocument();

            fireEvent.click(await analyze());
            await waitFor(() => expect(title).toHaveValue('Suggested title'));
            expect(screen.getByText('suggested-tag')).toBeInTheDocument();
            expect(editor).toHaveValue(originalContent);
        } finally {
            act(() => toast.dismiss());
            view.unmount();
            window.matchMedia = originalMatchMedia;
        }
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
        });

        expect(screen.getByText('ai-tag')).toBeInTheDocument();
    });


    it('offers a linked legacy recording only in its own unfinished note after another editor opens', async () => {
        localStorage.clear();
        const sourceId = 'only-first-note-audio';
        const blob = new Blob(['first note voice'], { type: 'audio/webm' });
        mockRecordingRows.set(sourceId, { id: sourceId, ownerId: 'user-1', context: 'study', contextId: 'new',
            blob, mimeType: blob.type, sizeBytes: blob.size, createdAt: 1, transcript: 'First note words' });
        localStorage.setItem(draftKey('user-1', 'new~first-audio-note', 'note'), JSON.stringify({ savedAt: 1, creationTargetId: 'first-audio-note',
            value: { title: '', content: '', tags: [], scriptureRefs: [], type: 'note', recordingSourceIds: [sourceId] } }));
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new?draft=new~first-audio-note&draftOwner=user-1');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams(window.location.search));
        const createNote = jest.fn();
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false, createNote, updateNote: jest.fn(), deleteNote: jest.fn() });
        global.fetch = jest.fn();
        const first = render(<StudyNoteEditorPage />);
        try {
            expect(await screen.findByRole('button', { name: 'audio.draft.resend' })).toBeVisible();
            expect(screen.queryByRole('button', { name: 'unsavedDraft.restore' })).not.toBeInTheDocument();
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('');
        } finally { first.unmount(); }
        window.history.replaceState(null, '', '/studies/new');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
        const second = render(<StudyNoteEditorPage />);
        try {
            await act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); });
            expect(screen.queryByRole('button', { name: 'audio.draft.resend' })).not.toBeInTheDocument();
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('');
            expect((mockRecordingRows.get(sourceId) as { blob: Blob }).blob).toBe(blob);
            expect(createNote).not.toHaveBeenCalled();
            expect(global.fetch).not.toHaveBeenCalled();
        } finally { second.unmount(); localStorage.clear(); }
    });

    it('keeps a raw-only question draft explicit so restoring preserves its chosen type', async () => {
        localStorage.clear();
        localStorage.setItem(draftKey('user-1', 'new~audio-question', 'note'), JSON.stringify({ savedAt: 1, creationTargetId: 'audio-question',
            value: { title: '', content: '', tags: [], scriptureRefs: [], type: 'question', recordingSourceIds: ['question-source'] } }));
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new?draft=new~audio-question&draftOwner=user-1');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams(window.location.search));
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false, createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() });
        const view = render(<StudyNoteEditorPage />);
        try {
            expect(await screen.findByRole('button', { name: 'unsavedDraft.restore' })).toBeVisible();
            fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
            fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Question words' } });
            view.unmount();
            const saved = readDraft<{ type: string; content: string }>(draftKey('user-1', 'new~audio-question', 'note'));
            expect(saved?.value.type).toBe('question');
            expect(saved?.value.content).toBe('Question words');
        } finally { view.unmount(); localStorage.clear(); }
    });

    it('parks fresh new-note audio at its reserved note identity before any create', async () => {
        localStorage.clear();
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
        const createNote = jest.fn();
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false, createNote, updateNote: jest.fn(), deleteNote: jest.fn() });
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable', json: async () => ({ error: 'QA refusal', retryable: false }) });
        const view = render(<StudyNoteEditorPage />);
        try {
            const reserved = new URLSearchParams(window.location.search).get('draft')!.slice(4);
            fireEvent.click(screen.getByTitle('studiesWorkspace.voiceRecord'));
            await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
            const source = Array.from(mockRecordingRows.values()).find((row: any) => row?.blob) as { contextId: string };
            expect(source.contextId).toBe(reserved);
            expect(createNote).not.toHaveBeenCalled();
        } finally { view.unmount(); localStorage.clear(); }
    });

    it('defers new-note creation until its completed recording has a durable source', async () => {
        window.localStorage.clear();
        const createNote = jest.fn((_note: Partial<StudyNote>, options?: { id: string }) => ({ acceptance: Promise.resolve({ kind: 'queued', receipt: 'parked-note' }), persistence: new Promise<void>(() => undefined), note: { id: options?.id ?? 'parked-note' } as StudyNote }));
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false, createNote, updateNote: jest.fn(), deleteNote: jest.fn() });
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable', json: async () => ({ error: 'QA refusal', retryable: false }) });
        let finishPark!: () => void; const parked = new Promise<void>(resolve => { finishPark = resolve; });
        const idb = await import('idb-keyval');
        jest.mocked(idb.update).mockImplementationOnce(async (id, change) => { await parked; mockRecordingRows.set(String(id), change(mockRecordingRows.get(String(id)))); });
        const view = render(<StudyNoteEditorPage />);
        try {
            fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder'), { target: { value: 'Title while audio is being preserved' } });
            fireEvent.click(screen.getByTitle('studiesWorkspace.voiceRecord'));
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 1900)); });
            expect(createNote).not.toHaveBeenCalled();
            jest.mocked(idb.update).mockRejectedValueOnce(new Error('Carry refused after park'));
            await act(async () => { finishPark(); await parked; });
            await waitFor(() => expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ recordingSourceIds: [expect.any(String)] }), { id: expect.any(String), captureScope: expect.stringMatching(/^draft-capture:v1:/) }), { timeout: 4000 });
            const reserved = createNote.mock.calls[0][1]!.id;
            expect(readDraft(draftKey('user-1', reserved, 'note'))?.creationTargetId).toBe(reserved);
            expect(await screen.findByRole('button', { name: 'audio.draft.resend' })).toBeVisible();
        } finally { await act(async () => { finishPark(); await parked; }); view.unmount(); window.localStorage.clear(); }
    });

    it('keeps the new-note destination while its microphone capture is active', async () => {
        window.localStorage.clear();
        const createNote = jest.fn((_note: Partial<StudyNote>, options?: { id: string }) => ({ acceptance: Promise.resolve({ kind: 'queued', receipt: 'active-note' }), persistence: new Promise<void>(() => undefined), note: { id: options?.id ?? 'active-note' } as StudyNote }));
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false, createNote, updateNote: jest.fn(), deleteNote: jest.fn() });
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable', json: async () => ({ error: 'QA refusal', retryable: false }) });
        const view = render(<StudyNoteEditorPage />);
        try {
            fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder'), { target: { value: 'Title during capture' } });
            fireEvent.click(screen.getByRole('button', { name: 'Start dictation capture' }));
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 1900)); });
            expect(createNote).not.toHaveBeenCalled();
            fireEvent.click(screen.getByTitle('studiesWorkspace.voiceRecord'));
            await waitFor(() => expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ recordingSourceIds: [expect.any(String)] }), { id: expect.any(String), captureScope: expect.stringMatching(/^draft-capture:v1:/) }), { timeout: 4000 });
        } finally { view.unmount(); window.localStorage.clear(); }
    });

    it('carries an unrecognized recording link separately from inserted-text receipts when the raw move fails', async () => {
        window.localStorage.clear();
        const createNote = jest.fn((_note: Partial<StudyNote>, options?: { id: string }) => ({ acceptance: Promise.resolve({ kind: 'queued', receipt: 'new-raw-note' }), persistence: new Promise<void>(() => undefined), note: { id: options?.id ?? 'created-raw-note' } as StudyNote }));
        (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [], loading: false, createNote, updateNote: jest.fn(() => ({ acceptance: Promise.resolve({ kind: 'queued', receipt: 'raw-words' }), persistence: new Promise<void>(() => undefined), result: new Promise(() => undefined) })), deleteNote: jest.fn() });
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable', json: async () => ({ error: 'QA transcription refused', retryable: false }) });
        const view = render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('studiesWorkspace.voiceRecord'));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        const source = Array.from(mockRecordingRows.values()).find((row: any) => row?.blob) as { id: string };
        expect(source).toBeDefined();
        const idb = await import('idb-keyval'); jest.mocked(idb.update).mockRejectedValueOnce(new Error('Raw move refused'));
        fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder'), { target: { value: 'Typed after failed dictation' } });
        await waitFor(() => expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ recordingSourceIds: [source.id] }), { id: expect.any(String), captureScope: expect.stringMatching(/^draft-capture:v1:/) }), { timeout: 4000 });
        expect(createNote.mock.calls[0][0]).not.toHaveProperty('dictationSourceIds');
        await waitFor(() => expect(screen.getByRole('button', { name: 'audio.draft.resend' })).toBeVisible());
        expect((mockRecordingRows.get(source.id) as { contextId: string }).contextId).toBe(createNote.mock.calls[0][1]!.id);
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, polishedText: 'Recovered unrecognized words' }) });
        fireEvent.click(screen.getByRole('button', { name: 'audio.draft.resend' }));
        await waitFor(() => expect(screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder')).toHaveValue('Recovered unrecognized words'));
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(createNote).toHaveBeenCalledTimes(1);
        view.unmount(); window.localStorage.clear();
    });

    it('does not append a cached recording whose source is already part of the restored note', async () => {
        const note = Object.assign({ ...mockNotes[1], content: 'Already dictated words' }, { dictationSourceIds: ['source-restored'] });
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [note], confirmedDictationSources: new Map([['note-1', ['source-restored']]]), loading: false,
            createNote: jest.fn(), updateNote: jest.fn(() => persistedWrite(Promise.resolve())), deleteNote: jest.fn() });
        const blob = new Blob(['original voice'], { type: 'audio/webm' });
        mockRecordingRows.set('source-restored', { id: 'source-restored', ownerId: 'user-1', context: 'study', contextId: 'note-1',
            blob, mimeType: blob.type, sizeBytes: blob.size, createdAt: 1, transcript: 'Already dictated words' });
        global.fetch = jest.fn() as jest.Mock;
        render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('common.edit'));
        await waitFor(() => expect((mockRecordingRows.get('source-restored') as { discarded?: boolean }).discarded).toBe(true));
        expect(screen.queryByRole('button', { name: 'audio.draft.resend' })).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder')).toHaveValue('Already dictated words');
        expect(global.fetch).not.toHaveBeenCalled();
    });


    it('keeps cached audio when its transcript identity is only projected by a pending note', async () => {
        const note = Object.assign({ ...mockNotes[1], content: 'Already dictated words' }, { dictationSourceIds: ['source-restored'] });
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: [note], noteDelivery: new Map([['note-1', { pending: true, needsAttention: false }]]), confirmedDictationSources: new Map(), loading: false,
            createNote: jest.fn(), updateNote: jest.fn(() => persistedWrite(Promise.resolve())), deleteNote: jest.fn() });
        const blob = new Blob(['original voice'], { type: 'audio/webm' });
        mockRecordingRows.set('source-restored', { id: 'source-restored', ownerId: 'user-1', context: 'study', contextId: 'note-1',
            blob, mimeType: blob.type, sizeBytes: blob.size, createdAt: 1, transcript: 'Already dictated words' });
        global.fetch = jest.fn() as jest.Mock;
        render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('common.edit'));
        const resend = await screen.findByRole('button', { name: 'audio.draft.resend' });
        await act(async () => { fireEvent.click(resend); for (let i = 0; i < 150; i++) await Promise.resolve(); });
        expect((mockRecordingRows.get('source-restored') as { blob?: Blob }).blob).toBe(blob);
        // Applied sources are hidden from the retry list; their raw audio must still remain durable.
        expect(screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder')).toHaveValue('Already dictated words');
        expect(global.fetch).not.toHaveBeenCalled();
    });


    it.each(['existing', 'create'])('hands the exact %s note backup to its canonical request without recreating it on departure', async kind => {
        jest.useFakeTimers(); localStorage.clear();
        const first = 'Words owned by the canonical request';
        const later = 'Later words not submitted yet';
        let id = 'note-1';
        let resolveCapture!: (receipt: { requestId: string; kind: 'submitted'; persistence: Promise<never> }) => void;
        const capture = new Promise<{ requestId: string; kind: 'submitted'; persistence: Promise<never> }>(resolve => { resolveCapture = resolve; });
        const persistence = new Promise<never>(() => undefined);
        const submission = {
            capture,
            acceptance: capture.then(receipt => ({ kind: 'queued' as const, receipt: receipt.requestId })),
            persistence: capture.then(receipt => receipt.persistence).then(() => undefined),
        };
        let invocations = 0;
        const nextSubmission = () => ++invocations === 1 ? submission : {
            capture: new Promise<never>(() => undefined), acceptance: new Promise<never>(() => undefined), persistence,
        };
        const updateNote = jest.fn(() => ({ ...nextSubmission(), result: persistence }));
        const createNote = jest.fn((_note: Partial<StudyNote>, options?: { id: string }) => {
            id = options!.id;
            return { ...nextSubmission(), note: { id } as StudyNote };
        });
        if (kind === 'create') {
            (useParams as jest.Mock).mockReturnValue({ id: 'new' });
            (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
            window.history.replaceState(null, '', '/studies/new');
        }
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: kind === 'existing' ? mockNotes : [],
            noteDelivery: acceptedNoteDelivery(), loading: false, createNote, updateNote, deleteNote: jest.fn() });
        const view = render(<StudyNoteEditorPage />);
        try {
            if (kind === 'existing') fireEvent.click(screen.getByTitle('common.edit'));
            fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: first } });
            await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
            expect(kind === 'existing' ? updateNote : createNote).toHaveBeenCalledTimes(1);
            const key = draftKey('user-1', id, 'note');
            expect(readDraft<{ content: string }>(key)?.value.content).toBe(first);
            await act(async () => { resolveCapture({ requestId: 'canonical-note-request', kind: 'submitted', persistence }); });
            expect(screen.queryByText('common.saved')).not.toBeInTheDocument();
            expect(readDraft(key)).toBeNull();
            act(() => { window.dispatchEvent(new Event('pagehide')); jest.advanceTimersByTime(350); });
            expect(readDraft(key)).toBeNull();
            fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: later } });
            act(() => { jest.advanceTimersByTime(350); });
            expect(readDraft<{ content: string }>(key)?.value.content).toBe(later);
            view.unmount();
            await act(async () => { await Promise.resolve(); });
            expect(readDraft<{ content: string }>(key)?.value.content).toBe(later);
        } finally { view.unmount(); localStorage.clear(); jest.clearAllTimers(); jest.useRealTimers(); }
    });

    it('retires a restored legacy draft after saving content without dropping existing recording receipts', async () => {
        jest.useFakeTimers();
        window.localStorage.clear();
        let stored = { ...mockNotes[1], dictationSourceIds: ['old-dictation'], recordingSourceIds: ['old-recording'] };
        const key = 'draft:v1:user-1:note-1:note';
        window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now() - 60000, value: {
            title: stored.title, content: 'Recovered older words', tags: stored.tags,
            scriptureRefs: stored.scriptureRefs, type: stored.type,
        } }));
        const updateNote = jest.fn(({ updates }: { updates: Partial<StudyNote> }) => {
            stored = { ...stored, ...updates };
            return persistedWrite(Promise.resolve({ id: stored.id, revision: 5 }));
        });
        (useStudyNotes as jest.Mock).mockImplementation(() => ({ uid: 'user-1', notes: [stored], noteDelivery: new Map([[stored.id, { pending: false, needsAttention: false }]]), loading: false,
            createNote: jest.fn(), updateNote, deleteNote: jest.fn() }));
        const view = render(<StudyNoteEditorPage />);
        try {
            fireEvent.click(screen.getByTitle('common.edit'));
            fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
            expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Recovered older words');
            await act(async () => { await jest.advanceTimersByTimeAsync(2500); });
            expect(updateNote).toHaveBeenCalledTimes(1);
            expect(stored.content).toBe('Recovered older words');
            expect(stored.dictationSourceIds).toEqual(['old-dictation']);
            expect(stored.recordingSourceIds).toEqual(['old-recording']);
            expect(updateNote.mock.calls[0][0].updates).not.toHaveProperty('dictationSourceIds');
            expect(updateNote.mock.calls[0][0].updates).not.toHaveProperty('recordingSourceIds');
            expect(screen.getByText('common.saved')).toBeInTheDocument();
            expect(window.localStorage.getItem(key)).toBeNull();
        } finally {
            view.unmount(); window.localStorage.clear(); jest.useRealTimers();
        }
    });

    it('restores the typed draft and then its cached voice after a refused save without appending twice', async () => {
        window.localStorage.clear();
        const updateNote = jest.fn((_args: { updates: Partial<StudyNote> }) => persistedWrite(Promise.reject(new Error('Local note write refused'))));
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: mockNotes, noteDelivery: acceptedNoteDelivery(), loading: false,
            createNote: jest.fn(), updateNote, deleteNote: jest.fn() });
        global.fetch = jest.fn().mockResolvedValue({ ok: true,
            json: async () => ({ success: true, polishedText: 'One durable voice fragment' }) });
        const first = render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(screen.getByTitle('studiesWorkspace.voiceRecord'));
        const expected = 'Content for Current Note\n\nOne durable voice fragment';
        await waitFor(() => expect(screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder')).toHaveValue(expected));
        await waitFor(() => expect(updateNote).toHaveBeenCalled());
        expect(updateNote.mock.calls[0][0].updates.dictationSourceIds).toEqual([expect.any(String)]);
        first.unmount();
        const restored = render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(await screen.findByRole('button', { name: 'unsavedDraft.restore' }));
        await waitFor(() => expect(screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder')).toHaveValue(expected));
        fireEvent.click(await screen.findByRole('button', { name: 'audio.draft.resend' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'audio.draft.resend' })).not.toBeInTheDocument());
        expect(screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder')).toHaveValue(expected);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        restored.unmount(); window.localStorage.clear();
    });

    it('keeps two different takes with identical words as two deliberate fragments', async () => {
        window.localStorage.clear();
        const updateNote = jest.fn(() => ({ acceptance: Promise.resolve({ kind: 'queued', receipt: 'voice-save' }),
            persistence: new Promise<void>(() => undefined), result: new Promise(() => undefined) }));
        (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: mockNotes, noteDelivery: acceptedNoteDelivery(), loading: false,
            createNote: jest.fn(), updateNote, deleteNote: jest.fn() });
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, polishedText: 'Same words' }) });
        const view = render(<StudyNoteEditorPage />);
        fireEvent.click(screen.getByTitle('common.edit'));
        fireEvent.click(screen.getByTitle('studiesWorkspace.voiceRecord'));
        await waitFor(() => expect(screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder')).toHaveValue('Content for Current Note\n\nSame words'));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByTitle('studiesWorkspace.voiceRecord'));
        await waitFor(() => expect(screen.getByPlaceholderText('studiesWorkspace.contentPlaceholder')).toHaveValue('Content for Current Note\n\nSame words\n\nSame words'));
        expect(global.fetch).toHaveBeenCalledTimes(2);
        view.unmount(); window.localStorage.clear();
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

    it('navigates back using the back button', () => {
        render(<StudyNoteEditorPage />);

        const backButton = screen.getByTitle('common.back');
        fireEvent.click(backButton);

        expect(mockRouter.push).toHaveBeenCalledWith('/studies?tag=tag1');
    });

    it('renders a copy button in read-only mode and copies formatted note content', async () => {
        const mockWriteText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText: mockWriteText },
        });
        Object.defineProperty(window, 'isSecureContext', {
            writable: true,
            value: true,
        });

        render(<StudyNoteEditorPage />);

        const copyButton = screen.getByRole('button', { name: 'common.copy' });
        fireEvent.click(copyButton);

        await waitFor(() => {
            expect(mockWriteText).toHaveBeenCalledWith('# Current Note\n\nContent for Current Note');
        });
    });

    describe('Missing Coverage Tests', () => {
        it('handles new note creation on input', async () => {
            jest.useFakeTimers();
            const mockCreateNote = jest.fn(() => ({
                ...persistedWrite(Promise.resolve()),
                note: { id: 'new-note-id' },
            }));
            (useStudyNotes as jest.Mock).mockReturnValue({
                uid: 'user-1',
                notes: mockNotes, noteDelivery: acceptedNoteDelivery(),
                loading: false,
                createNote: mockCreateNote,
                updateNote: jest.fn(),
                deleteNote: jest.fn(),
            });
            (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');

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
            try {
                const refusal = Object.assign(new Error('Missing or insufficient permissions.'), {
                    code: 'permission-denied',
                    name: 'FirebaseError',
                });
                const mockCreateNote = jest.fn(() => ({
                    ...persistedWrite(Promise.reject(refusal)),
                    note: { id: 'new-note-id' },
                }));
                (useStudyNotes as jest.Mock).mockReturnValue({
                    uid: 'user-1',
                    notes: mockNotes, noteDelivery: acceptedNoteDelivery(),
                    loading: false,
                    createNote: mockCreateNote,
                    updateNote: jest.fn(),
                    deleteNote: jest.fn(),
                });
                (useParams as jest.Mock).mockReturnValue({ id: 'new' });
        window.history.replaceState(null, '', '/studies/new');

                render(<StudyNoteEditorPage />);

                const titleInput = screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder');
                fireEvent.change(titleInput, { target: { value: 'New Note' } });

                jest.advanceTimersByTime(2000);

                await waitFor(() => {
                    expect(mockCreateNote).toHaveBeenCalled();
                });
                // The person sees that the save did not go through, and the typed title stays.
                expect(await screen.findByText('common.saveError')).toBeInTheDocument();
                expect(titleInput).toHaveValue('New Note');
            } finally {
                jest.useRealTimers();
            }
        });

        it('handles delete note click correctly', async () => {
            const mockDeleteNote = jest.fn(() => persistedWrite(Promise.resolve()));
            const mockDeleteShareLink = jest.fn(() => persistedWrite(Promise.resolve()));
            (useStudyNotes as jest.Mock).mockReturnValue({
                uid: 'user-1',
                notes: mockNotes, noteDelivery: acceptedNoteDelivery(),
                loading: false,
                createNote: jest.fn(),
                updateNote: jest.fn(),
                deleteNote: mockDeleteNote,
            });
            (useStudyNoteShareLinks as jest.Mock).mockReturnValue({
                shareLinks: [{ noteId: 'note-1', id: 'link-1' }],
                loading: false,
                deleteShareLink: mockDeleteShareLink,
            });
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

            // The app asks in its own window; nothing is removed before the answer.
            const question = await screen.findByRole('dialog', { name: 'studiesWorkspace.deleteConfirm' });
            expect(mockDeleteNote).not.toHaveBeenCalled();
            fireEvent.click(within(question).getByRole('button', { name: 'common.delete' }));

            await waitFor(() => {
                expect(mockDeleteNote).toHaveBeenCalledWith('note-1');
                expect(mockDeleteShareLink).not.toHaveBeenCalled();
                // replace, not push: the note we are leaving has just been deleted, so it
                // must not stay one Back away — BUG-20260905.
                expect(mockRouter.replace).toHaveBeenCalledWith('/studies');
            });
        });

        it('handles AI analysis validation error (empty content)', async () => {
            render(<StudyNoteEditorPage />);
            fireEvent.click(screen.getByTitle('common.edit'));
            const contentInput = screen.getByTestId('rich-markdown-editor');
            fireEvent.change(contentInput, { target: { value: '   ' } });
            fireEvent.click(screen.getByTitle('studiesWorkspace.aiAnalyze.button'));
            expect(screen.getByTitle('studiesWorkspace.aiAnalyze.button')).toBeDisabled();
            // Whitespace-only content leaves nothing to analyze, so the button stays off.
        });

        it('handles AI analysis API failure response', async () => {
            const toastError = jest.spyOn(toast, 'error').mockImplementation(() => 'toast');
            try {
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
                await waitFor(() => expect(toastError).toHaveBeenCalledWith('studiesWorkspace.aiAnalyze.error'));
            } finally {
                toastError.mockRestore();
            }
        });

        it('handles AI analysis network exception', async () => {
            const toastError = jest.spyOn(toast, 'error').mockImplementation(() => 'toast');
            try {
                render(<StudyNoteEditorPage />);
                fireEvent.click(screen.getByTitle('common.edit'));
                const contentInput = screen.getByTestId('rich-markdown-editor');
                fireEvent.change(contentInput, { target: { value: 'Something' } });
                (global.fetch as jest.Mock) = jest.fn().mockRejectedValue(new Error('Network error'));
                fireEvent.click(screen.getByTitle('studiesWorkspace.aiAnalyze.button'));
                const fullOption = await screen.findByText('studiesWorkspace.aiAnalyze.full');
                fireEvent.click(fullOption);
                await waitFor(() => expect(toastError).toHaveBeenCalledWith('studiesWorkspace.aiAnalyze.error'));
            } finally {
                toastError.mockRestore();
            }
        });

        it('triggers auto-save when content changes', async () => {
            jest.useFakeTimers();
            const mockUpdateNote = jest.fn(() => {
                const result = Promise.resolve({ ...mockNotes[1], revision: 1 });
                return { ...persistedWrite(result), result };
            });
            (useStudyNotes as jest.Mock).mockReturnValue({
                uid: 'user-1',
                notes: mockNotes, noteDelivery: acceptedNoteDelivery(),
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
            try {
                const refusal = Object.assign(new Error('Missing or insufficient permissions.'), {
                    code: 'permission-denied',
                    name: 'FirebaseError',
                });
                const mockUpdateNote = jest.fn(() => {
                    const result = Promise.reject(refusal);
                    return { ...persistedWrite(result), result };
                });
                (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes: mockNotes, noteDelivery: acceptedNoteDelivery(), loading: false, createNote: jest.fn(), updateNote: mockUpdateNote, deleteNote: jest.fn() });

                render(<StudyNoteEditorPage />);
                fireEvent.click(screen.getByTitle('common.edit'));

                const contentInput = screen.getByTestId('rich-markdown-editor');
                fireEvent.change(contentInput, { target: { value: 'Changed for error' } });

                jest.advanceTimersByTime(2000);

                await waitFor(() => {
                    expect(mockUpdateNote).toHaveBeenCalled();
                });
                expect(await screen.findByText('common.saveError')).toBeInTheDocument();
            } finally {
                jest.useRealTimers();
            }
        });
    });
});

/**
 * Three viewport bands, three different places the note's outline and properties live.
 * The band in the middle is the one that broke: the properties moved into the sheet
 * below `lg`, but the button that opens the sheet only existed below `sm`, so between
 * 640 and 1023px they were mounted with nothing able to reach them.
 */
describe('StudyNoteEditorPage — where the outline and properties are reachable from', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue(mockRouter);
        (useParams as jest.Mock).mockReturnValue(mockParams);
        (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);
        (useStudyNotes as jest.Mock).mockReturnValue({
            uid: 'user-1', notes: mockNotes, noteDelivery: acceptedNoteDelivery(), loading: false,
            createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn(),
        });
        (useTags as jest.Mock).mockReturnValue({ tags: { requiredTags: [], customTags: [] } });
        (useStudyNoteShareLinks as jest.Mock).mockReturnValue({
            shareLinks: [], loading: false, deleteShareLink: jest.fn(),
        });
    });

    afterEach(() => {
        mockViewport.wide = true;
        mockViewport.roomy = true;
    });

    it('tablet width without a side panel can still open the sheet', () => {
        mockViewport.wide = false;
        mockViewport.roomy = true;

        render(<StudyNoteEditorPage />);

        const opener = screen.getByRole('button', { name: 'notePanel.outline' });
        expect(opener).toHaveAttribute('aria-haspopup', 'dialog');
        expect(screen.getByRole('dialog', { hidden: true })).toBeInTheDocument();
    });

    it('phone width opens the sheet from the sticky title line', () => {
        mockViewport.wide = false;
        mockViewport.roomy = false;

        render(<StudyNoteEditorPage />);

        const beacons = screen
            .getAllByRole('button', { hidden: true })
            .filter((b) => b.getAttribute('aria-haspopup') === 'dialog');
        expect(beacons.length).toBeGreaterThan(0);
    });

    it('a wide screen has the panel and never mounts the sheet at all', () => {
        mockViewport.wide = true;
        mockViewport.roomy = true;

        render(<StudyNoteEditorPage />);

        expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument();
    });
});
