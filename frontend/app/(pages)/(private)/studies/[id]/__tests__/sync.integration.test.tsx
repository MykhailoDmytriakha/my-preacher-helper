import { render, screen, fireEvent, act } from '@testing-library/react';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useTags } from '@/hooks/useTags';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import StudyNoteEditorPage from '../page';
import { StudyNote } from '@/models/models';
import { persistedWrite, queuedMutation } from '@/utils/recoverableWrite';

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

// Exercise the actual freshness and durable-draft hooks together with the page.
let mockEmit: ((snapshot: unknown) => void) | undefined;
jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  doc: () => ({}),
  onSnapshot: (_ref: unknown, _options: unknown, next: (snapshot: unknown) => void) => {
    mockEmit = next;
    return jest.fn();
  },
}));
jest.mock('@/components/diagnostics/TechnicalDetailsButton', () => ({ TechnicalDetailsButton: () => null }));
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
    FocusRecorderButton: ({ onRecordingComplete }: any) => (
        <button
            title="studiesWorkspace.voiceRecord"
            onClick={() => onRecordingComplete(new Blob())}
        >
            Mic
        </button>
    ),
}));


const initialNote: StudyNote = {
  id: 'note-sync', userId: 'user-1', title: 'Original title', content: 'Original body',
  tags: [], scriptureRefs: [], type: 'note', isDraft: false, rev: { note: 1 },
  createdAt: '2026-09-06T10:00:00.000Z', updatedAt: '2026-09-06T10:00:00.000Z',
};
let mockCache: StudyNote;
const updateNote = jest.fn();
const createNote = jest.fn();
function emitNote(note: StudyNote) {
  act(() => mockEmit?.({ metadata: { fromCache: false, hasPendingWrites: false }, exists: () => true, data: () => note }));
}

describe('note editor sync integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    mockCache = initialNote;
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), replace: jest.fn() });
    (useParams as jest.Mock).mockReturnValue({ id: initialNote.id });
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
    (useStudyNotes as jest.Mock).mockImplementation(() => ({
      uid: 'user-1', notes: [mockCache], loading: false, createNote, updateNote, deleteNote: jest.fn(),
    }));
    (useTags as jest.Mock).mockReturnValue({ tags: { requiredTags: [], customTags: [] } });
    (useStudyNoteShareLinks as jest.Mock).mockReturnValue({ shareLinks: [], deleteShareLink: jest.fn() });
  });
  afterEach(() => jest.useRealTimers());

  it('does not hide a real remote edit when the query cache refreshes ahead of the editor', () => {
    const view = render(<StudyNoteEditorPage />);
    emitNote(initialNote);
    mockCache = { ...initialNote, content: 'Remote body', rev: { note: 2 } };
    view.rerender(<StudyNoteEditorPage />);
    emitNote(mockCache);
    expect(screen.getByText('Original body')).toBeInTheDocument();
    expect(screen.getByText('freshness.title')).toBeInTheDocument();
  });

  it('clears an own-write echo after acceptance without losing later typing', async () => {
    let finish!: () => void;
    const saved = { ...initialNote, content: 'Own A', rev: { note: 2 }, revision: 2 };
    const persistence = new Promise<void>(resolve => { finish = resolve; });
    updateNote.mockReturnValue({ ...persistedWrite(persistence), result: persistence.then(() => saved) });
    render(<StudyNoteEditorPage />);
    emitNote(initialNote);
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Own A' } });
    await act(async () => jest.advanceTimersByTime(1500));
    emitNote(saved);
    fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Later B' } });
    await act(async () => { finish(); await persistence; });
    expect(screen.queryByText('freshness.title')).not.toBeInTheDocument();
    expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Later B');
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(JSON.parse(window.localStorage.getItem('draft:v1:user-1:note-sync:note')!).value.content).toBe('Later B');
    expect(screen.queryByText('common.saved')).not.toBeInTheDocument();
  });

  it('does not discard recovery on cache-only open, but retires it on matching server proof', () => {
    window.localStorage.setItem('draft:v1:user-1:note-sync:note', JSON.stringify({
      savedAt: Date.now(), value: { title: initialNote.title, content: initialNote.content, tags: [], scriptureRefs: [], type: 'note' },
    }));
    render(<StudyNoteEditorPage />);
    expect(window.localStorage.getItem('draft:v1:user-1:note-sync:note')).not.toBeNull();
    emitNote(initialNote);
    expect(window.localStorage.getItem('draft:v1:user-1:note-sync:note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Next edit' } });
    expect(screen.queryByText('unsavedDraft.title')).not.toBeInTheDocument();
  });

  it('keeps typing after create submission unsaved until that exact text reaches the server', async () => {
    (useParams as jest.Mock).mockReturnValue({ id: 'new' });
    let finish!: () => void;
    const persistence = new Promise<void>(resolve => { finish = resolve; });
    createNote.mockImplementation(note => ({ ...persistedWrite(persistence), note: { ...initialNote, ...note, id: 'created-sync' } }));
    render(<StudyNoteEditorPage />);
    fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Create A' } });
    await act(async () => jest.advanceTimersByTime(1500));
    expect(createNote).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Later B' } });
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(JSON.parse(window.localStorage.getItem('draft:v1:user-1:created-sync:note')!).value.content).toBe('Later B');
    await act(async () => { finish(); await persistence; });
    expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Later B');
    expect(screen.queryByText('common.saved')).not.toBeInTheDocument();
    expect(screen.queryByText('unsavedDraft.title')).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('draft:v1:user-1:created-sync:note')!).value.content).toBe('Later B');
  });

  it('does not acknowledge an older retained snapshot after a newer save', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    updateNote.mockReturnValue({ ...persistedWrite(pending), result: pending.then(() => ({ ...initialNote, content: 'Saved B', revision: 2 })) });
    render(<StudyNoteEditorPage />);
    emitNote(initialNote);
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Saved B' } });
    await act(async () => jest.advanceTimersByTime(1500));
    emitNote({ ...initialNote, content: 'Retained A' });
    await act(async () => { finish(); await pending; });
    fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Retained A' } });
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(JSON.parse(window.localStorage.getItem('draft:v1:user-1:note-sync:note')!).value.content).toBe('Retained A');
    expect(screen.queryByText('common.saved')).not.toBeInTheDocument();
  });

  it('does not enqueue an unchanged update after a queued create', async () => {
    (useParams as jest.Mock).mockReturnValue({ id: 'new' });
    createNote.mockImplementation(note => ({ ...queuedMutation('create-q', new Promise(() => undefined)), note: { ...initialNote, ...note, id: 'created-sync' } }));
    updateNote.mockClear();
    render(<StudyNoteEditorPage />);
    fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Queued create A' } });
    await act(async () => jest.advanceTimersByTime(1600));
    await act(async () => jest.advanceTimersByTime(1600));
    await act(async () => jest.advanceTimersByTime(1600));
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(updateNote).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(JSON.parse(window.localStorage.getItem('draft:v1:user-1:created-sync:note')!).value.content).toBe('Queued create A');
  });

  it('adopts remote content once and never re-stores it as an unsaved draft', () => {
    render(<StudyNoteEditorPage />);
    emitNote(initialNote);
    const remote = { ...initialNote, content: 'Remote body', rev: { note: 2 } };
    emitNote(remote);
    fireEvent.click(screen.getByText('freshness.refreshAction'));
    emitNote(remote);
    act(() => { jest.advanceTimersByTime(300); window.dispatchEvent(new Event('pagehide')); });
    expect(screen.queryByText('freshness.title')).not.toBeInTheDocument();
    expect(screen.getByText('Remote body')).toBeInTheDocument();
    expect(window.localStorage.getItem('draft:v1:user-1:note-sync:note')).toBeNull();
  });
});
