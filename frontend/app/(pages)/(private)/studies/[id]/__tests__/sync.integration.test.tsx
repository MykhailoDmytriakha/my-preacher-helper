import { render, screen, fireEvent, act, within } from '@testing-library/react';
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
  // The hook defers a refusal while its own write is unacknowledged; without this
  // export the deferral would throw instead of waiting.
  waitForPendingWrites: () => new Promise<void>(() => {}),
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

  // The offline shell keeps this page mounted without a sign-in guard, so the account can
  // change under it (open: BUG-20261003-account-change-under-open-note). A write still waiting
  // then is dropped, not stored: storing it would replace the newer, only draft of another
  // editor of this note.
  it('keeps the newer only draft of a closed editor when an older editor loses its owner with a write waiting', () => {
    let uid: string | undefined = 'user-1';
    (useStudyNotes as jest.Mock).mockImplementation(() => ({
      uid, notes: [mockCache], loading: false, createNote, updateNote, deleteNote: jest.fn(),
    }));
    const edit = (view: ReturnType<typeof render>, text: string) => {
      const page = within(view.container);
      fireEvent.click(page.getByRole('button', { name: 'common.edit' }));
      fireEvent.change(page.getByTestId('rich-markdown-editor'), { target: { value: text } });
    };
    const older = render(<StudyNoteEditorPage />);
    edit(older, 'older unsaved text');
    act(() => jest.advanceTimersByTime(100));
    const newer = render(<StudyNoteEditorPage />);
    edit(newer, 'newer unsaved text, its only copy');
    act(() => jest.advanceTimersByTime(51));
    newer.unmount();
    uid = undefined;
    older.rerender(<StudyNoteEditorPage />);
    older.unmount();
    act(() => jest.advanceTimersByTime(2000));

    const draft = JSON.parse(window.localStorage.getItem('draft:v1:user-1:note-sync:note')!);
    expect(draft.value.content).toBe('newer unsaved text, its only copy');
    expect(updateNote).not.toHaveBeenCalled();
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
    expect(screen.queryByText('unsavedDraft.title')).not.toBeInTheDocument();
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

});

describe('note editor on the engine', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    mockCache = initialNote;
    updateNote.mockReset();
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), replace: jest.fn() });
    (useParams as jest.Mock).mockReturnValue({ id: initialNote.id });
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
    (useStudyNotes as jest.Mock).mockImplementation(() => ({
      uid: 'user-1', notes: [mockCache], loading: false, createNote, updateNote, deleteNote: jest.fn(),
    }));
    (useTags as jest.Mock).mockReturnValue({ tags: { requiredTags: [], customTags: [] } });
    (useStudyNoteShareLinks as jest.Mock).mockReturnValue({ shareLinks: [], deleteShareLink: jest.fn() });
  });
  afterEach(() => { jest.useRealTimers(); });

  it('follows the engine row while the editor is clean, with no banner and no draft left behind', () => {
    const view = render(<StudyNoteEditorPage />);
    mockCache = { ...initialNote, content: 'Written on the phone', rev: { note: 2 } };
    view.rerender(<StudyNoteEditorPage />);
    expect(screen.getByText('Written on the phone')).toBeInTheDocument();
    expect(screen.queryByText('freshness.title')).not.toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(300); window.dispatchEvent(new Event('pagehide')); });
    expect(window.localStorage.getItem('draft:v1:user-1:note-sync:note')).toBeNull();
  });

  it('keeps words being typed when the row changes underneath', () => {
    const view = render(<StudyNoteEditorPage />);
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Typed on the laptop' } });
    mockCache = { ...initialNote, content: 'Written on the phone', rev: { note: 2 } };
    view.rerender(<StudyNoteEditorPage />);
    expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Typed on the laptop');
  });

  /*
   * BUG-20261028-typing-over-draft-offer: text left unsaved last time is offered back, and the offer is a question
   * answered before anything is written over it. Typing past it used to store the new words in the offered text's
   * slot 250 ms later: the offer still showed the old words, and a reload had nothing left to bring back.
   */
  describe('while unsaved text from last time waits for an answer', () => {
    const key = 'draft:v1:user-1:note-sync:note';
    const offered = { title: 'Original title', content: 'Unsaved from before', tags: [], scriptureRefs: [], type: 'note' };
    const stored = () => JSON.parse(window.localStorage.getItem(key)!).value;
    beforeEach(() => window.localStorage.setItem(key, JSON.stringify({ value: offered, savedAt: Date.now() })));

    it('keeps the words on offer when the person starts writing without answering', () => {
      render(<StudyNoteEditorPage />);
      expect(screen.getByText('unsavedDraft.title')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
      // Whatever way in is still open is used, as a person would.
      const editor = screen.queryByTestId('rich-markdown-editor');
      if (editor) fireEvent.change(editor, { target: { value: 'Typed over the offer' } });
      act(() => { jest.advanceTimersByTime(300); window.dispatchEvent(new Event('pagehide')); });

      expect(stored().content).toBe('Unsaved from before');
      expect(screen.getByText('unsavedDraft.title')).toBeInTheDocument();
      expect(screen.queryByTestId('rich-markdown-editor')).toBeNull();
      expect(screen.getByRole('button', { name: 'common.edit' })).toBeDisabled();
      // Its answers write the title, places, tags and text; it lives in editing, which stays shut.
      expect(screen.queryByRole('button', { name: 'studiesWorkspace.aiAnalyze.button' })).toBeNull();
    });

    it('shows the words on offer, so the answer is not given blind', () => {
      render(<StudyNoteEditorPage />);
      expect(within(screen.getByRole('status')).getByText('Unsaved from before')).toBeInTheDocument();
    });

    it('opens for writing once the words are brought back, with those words in it', () => {
      render(<StudyNoteEditorPage />);
      fireEvent.click(screen.getByText('unsavedDraft.restore'));
      fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
      expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Unsaved from before');
    });

    // Words equal to the note's are no question. Compared with the words being typed, they used to turn into an offer on
    // the first keystroke and shut the editor under the person (Codex review, 2026-10-29).
    it('takes a draft equal to the note as settled: typing opens no offer and keeps the editor', () => {
      window.localStorage.setItem(key, JSON.stringify({ value: { ...offered, content: 'Original body' }, savedAt: Date.now() }));
      render(<StudyNoteEditorPage />);
      expect(screen.queryByText('unsavedDraft.title')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
      fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Original body, and more' } });
      act(() => { jest.advanceTimersByTime(300); });

      expect(screen.queryByText('unsavedDraft.title')).toBeNull();
      expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Original body, and more');
      expect(stored().content).toBe('Original body, and more');
    });

    it('holds a new note, which opens straight into writing, until the words left in it last time are answered', () => {
      (useParams as jest.Mock).mockReturnValue({ id: 'new' });
      const newKey = 'draft:v1:user-1:new:note';
      window.localStorage.setItem(newKey, JSON.stringify({ value: { ...offered, title: '', content: 'Half a new note' }, savedAt: Date.now() }));
      render(<StudyNoteEditorPage />);
      expect(screen.getByText('unsavedDraft.title')).toBeInTheDocument();
      expect(screen.queryByTestId('rich-markdown-editor')).toBeNull();
      act(() => { jest.advanceTimersByTime(300); window.dispatchEvent(new Event('pagehide')); });
      expect(JSON.parse(window.localStorage.getItem(newKey)!).value.content).toBe('Half a new note');

      fireEvent.click(screen.getByText('unsavedDraft.restore'));
      expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Half a new note');
    });

    it('opens for writing once the words are let go, with the saved note in it', () => {
      render(<StudyNoteEditorPage />);
      fireEvent.click(screen.getByText('unsavedDraft.discard'));
      fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
      expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Original body');
      expect(window.localStorage.getItem(key)).toBeNull();
    });
  });

  it('offers the row when a save is refused, and "take theirs" shows it', async () => {
    const refusal = Object.assign(new Error('stale'), { isStaleWrite: true, aggregate: 'note', expectedRevision: 1, actualRevision: 2 });
    const refused = Promise.reject(refusal);
    refused.catch(() => undefined);
    updateNote.mockReturnValue({ ...persistedWrite(refused), result: refused });
    const view = render(<StudyNoteEditorPage />);
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Typed on the laptop' } });
    mockCache = { ...initialNote, content: 'Written on the phone', rev: { note: 2 } };
    view.rerender(<StudyNoteEditorPage />);
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(screen.getByText('freshness.conflictTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('freshness.conflictTakeTheirs'));
    expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Written on the phone');
  });
});
