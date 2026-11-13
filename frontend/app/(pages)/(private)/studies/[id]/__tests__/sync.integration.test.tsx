import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useTags } from '@/hooks/useTags';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import StudyNoteEditorPage from '../page';
import { StudyNote } from '@/models/models';
import { findNoteDraftCopies } from '@/utils/newNoteDrafts';
import { findDraftCopies, draftKey } from '@/utils/durableDraft';
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
// Match the authenticated opening to this suite's current mocked owner.
jest.mock('@/hooks/useResolvedUid', () => ({
  useResolvedUid: () => ({ uid: require('@/hooks/useStudyNotes').useStudyNotes().uid, isAuthLoading: false }),
}));
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

function enterNoteEditing(expectedValue: string) {
  const current = screen.queryByTestId('rich-markdown-editor') as HTMLTextAreaElement | null;
  if (current) {
    expect(current).toHaveValue(expectedValue);
    return current;
  }
  const editButton = screen.getByRole('button', { name: 'common.edit' });
  expect(editButton).toBeEnabled();
  fireEvent.click(editButton);
  const editor = screen.getByTestId('rich-markdown-editor') as HTMLTextAreaElement;
  expect(editor).toHaveValue(expectedValue);
  return editor;
}
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
      uid: 'user-1', notes: [mockCache], noteDelivery: new Map([[mockCache.id, { pending: false, needsAttention: false }]]), loading: false, createNote, updateNote, deleteNote: jest.fn(),
    }));
    (useTags as jest.Mock).mockReturnValue({ tags: { requiredTags: [], customTags: [] } });
    (useStudyNoteShareLinks as jest.Mock).mockReturnValue({ shareLinks: [], deleteShareLink: jest.fn() });
  });
  afterEach(() => jest.useRealTimers());

  // The departing owner cannot overwrite another opening's unfinished words.
  it('keeps both independent openings when the older editor loses its owner with a write waiting', () => {
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

    expect(findNoteDraftCopies('user-1', 'note-sync', 'note').map(copy => copy.value.content).sort()).toEqual([
      'newer unsaved text, its only copy',
      'older unsaved text',
    ]);
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
    expect(findNoteDraftCopies('user-1', 'note-sync', 'note').map(copy => copy.value.content)).toEqual(['Later B']);
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
    expect(findNoteDraftCopies('user-1', 'created-sync', 'note').map(copy => copy.value.content)).toEqual(['Later B']);
    await act(async () => { finish(); await persistence; });
    expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Later B');
    expect(screen.queryByText('common.saved')).not.toBeInTheDocument();
    expect(screen.queryByText('unsavedDraft.title')).not.toBeInTheDocument();
    expect(findNoteDraftCopies('user-1', 'created-sync', 'note').map(copy => copy.value.content)).toEqual(['Later B']);
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
    expect(findNoteDraftCopies('user-1', 'note-sync', 'note').map(copy => copy.value.content)).toEqual(['Retained A']);
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
    expect(findNoteDraftCopies('user-1', 'created-sync', 'note').map(copy => copy.value.content)).toEqual(['Queued create A']);
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
    const key = draftKey('user-1', 'note-sync', 'note');
    const offered = { title: 'Original title', content: 'Unsaved from before', tags: [], scriptureRefs: [], type: 'note' };
    const rawOffer = () => window.localStorage.getItem(key);
    beforeEach(() => window.localStorage.setItem(key, JSON.stringify({ value: offered, savedAt: Date.now() })));

    it('keeps the words on offer when the person starts writing without answering', () => {
      render(<StudyNoteEditorPage />);
      expect(screen.getByText('unsavedDraft.title')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
      // Whatever way in is still open is used, as a person would.
      const editor = screen.queryByTestId('rich-markdown-editor');
      if (editor) fireEvent.change(editor, { target: { value: 'Typed over the offer' } });
      act(() => { jest.advanceTimersByTime(300); window.dispatchEvent(new Event('pagehide')); });

      expect(JSON.parse(rawOffer()!).value.content).toBe('Unsaved from before');
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
      enterNoteEditing('Unsaved from before');
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
      // The old shared slot is evidence, not this mounted writer's physical address.
      expect(JSON.parse(rawOffer()!).value.content).toBe('Original body');
      expect(findDraftCopies<{ content: string }>('user-1', 'note-sync', 'note')
        .filter(copy => copy.key !== key).map(copy => copy.value.content)).toContain('Original body, and more');
    });

    it('holds a new note, which opens straight into writing, until the words left in it last time are answered', () => {
      (useParams as jest.Mock).mockReturnValue({ id: 'new' });
      const docId = 'new~pending-note';
      const newKey = draftKey('user-1', docId, 'note');
      const offeredNew = { ...offered, title: '', content: 'Half a new note' };
      window.localStorage.setItem(newKey, JSON.stringify({ value: offeredNew, savedAt: Date.now(), creationTargetId: 'pending-note' }));
      (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams(`draft=${docId}&draftOwner=user-1`));
      render(<StudyNoteEditorPage />);
      expect(screen.getByText('unsavedDraft.title')).toBeInTheDocument();
      expect(screen.queryByTestId('rich-markdown-editor')).toBeNull();
      act(() => { jest.advanceTimersByTime(300); window.dispatchEvent(new Event('pagehide')); });
      expect(JSON.parse(window.localStorage.getItem(newKey)!).value.content).toBe('Half a new note');

      fireEvent.click(screen.getByText('unsavedDraft.restore'));
      enterNoteEditing('Half a new note');
      expect(window.localStorage.getItem(newKey)).not.toBeNull();
    });

    it('opens for writing once the words are let go, with the saved note in it', async () => {
      render(<StudyNoteEditorPage />);
      fireEvent.click(screen.getByText('unsavedDraft.discard'));
      expect(screen.getByRole('dialog', { name: 'common.discardText.title' })).toBeInTheDocument();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.discardText.confirm' })); });
      expect(screen.getByRole('button', { name: 'common.edit' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
      expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Original body');
      expect(window.localStorage.getItem(key)).toBeNull();
    });
  });

  it.each([
    ['stored', 'title'], ['local', 'title'], ['stored', 'type'], ['local', 'type'],
  ] as const)('keeps an independent restored paragraph when choosing the %s %s', async (side, field) => {
    const mine = field === 'title' ? 'Phone title' : 'question';
    const stored = field === 'title' ? 'Computer title' : 'note';
    const paragraph = 'New paragraph from the phone';
    mockCache = { ...initialNote, [field]: stored, rev: { note: 2 } };
    const key = draftKey('user-1', initialNote.id, 'note', 'phone');
    window.localStorage.setItem(key, JSON.stringify({ savedAt: 1, value: {
      title: initialNote.title, type: 'note', [field]: mine, content: paragraph, tags: [], scriptureRefs: [],
      origin: { fields: { [field]: initialNote[field], content: initialNote.content },
        [field]: { seen: { [field]: initialNote[field], generation: 'generation', revision: 1 }, time: null } },
    } }));
    const refusal = Object.assign(new Error('stale'), { isStaleWrite: true, aggregate: 'note', expectedRevision: 1, actualRevision: 2,
      serverValues: { [field]: stored, content: initialNote.content }, conflictingFields: [field] });
    const refused = Promise.reject(refusal);
    refused.catch(() => undefined);
    const pending = new Promise<never>(() => undefined);
    updateNote.mockReturnValueOnce({ ...persistedWrite(refused), result: refused })
      .mockReturnValue({ ...persistedWrite(pending), result: pending });
    render(<StudyNoteEditorPage />);
    fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
    enterNoteEditing(paragraph);
    await act(async () => { await jest.advanceTimersByTimeAsync(1600); });
    expect(screen.getByText('freshness.conflictTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: side === 'stored' ? 'dataSync.useStoredVersion' : 'dataSync.useLocalVersion' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(1600); });

    expect(screen.getByTestId('rich-markdown-editor')).toHaveValue(paragraph);
    if (field === 'title') expect(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder')).toHaveValue(side === 'stored' ? stored : mine);
    expect(updateNote).toHaveBeenCalledTimes(2);
    expect(updateNote).toHaveBeenLastCalledWith(expect.objectContaining({
      updates: { content: paragraph, ...(side === 'local' && { [field]: mine }) },
      expectedBaseline: expect.objectContaining({ [field]: stored, content: initialNote.content }),
    }));
  });

  it('can take the saved title and keep the local body when both recovered fields need a decision', async () => {
    const mine = { title: 'Offline title', content: 'Offline body' };
    const saved = { title: 'Computer title', content: 'Computer body' };
    mockCache = { ...initialNote, ...saved, rev: { note: 2 } };
    window.localStorage.setItem(draftKey('user-1', initialNote.id, 'note', 'phone'), JSON.stringify({ savedAt: 1, value: {
      ...mine, type: 'note', tags: [], scriptureRefs: [],
      origin: { fields: { title: initialNote.title, content: initialNote.content } },
    } }));
    const refuse = (conflictingFields: string[]) => {
      const result = Promise.reject(Object.assign(new Error('stale'), { isStaleWrite: true, aggregate: 'note',
        expectedRevision: 1, actualRevision: 2, serverValues: saved, conflictingFields }));
      result.catch(() => undefined);
      return { ...persistedWrite(result), result };
    };
    const pending = new Promise<never>(() => undefined);
    updateNote.mockReturnValueOnce(refuse(['title', 'content'])).mockReturnValueOnce(refuse(['content']))
      .mockReturnValue({ ...persistedWrite(pending), result: pending });
    render(<StudyNoteEditorPage />);
    fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
    enterNoteEditing(mine.content);
    await act(async () => { await jest.advanceTimersByTimeAsync(1600); });
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.useStoredVersion' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(1600); });
    expect(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder')).toHaveValue(saved.title);
    expect(screen.getByText(saved.content)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.useLocalVersion' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(1600); });
    expect(updateNote).toHaveBeenCalledTimes(3);
    expect(updateNote).toHaveBeenLastCalledWith(expect.objectContaining({
      updates: { content: mine.content }, expectedBaseline: expect.objectContaining(saved),
    }));
    expect(screen.getByTestId('rich-markdown-editor')).toHaveValue(mine.content);
  });

  it('compares an older copy without opening values before sending any differing fields', async () => {
    const local = { title: 'Old draft title', content: 'Old draft paragraph' };
    const saved = { title: 'Saved title', content: 'Saved paragraph' };
    mockCache = { ...initialNote, ...saved, rev: { note: 2 } };
    (useStudyNotes as jest.Mock).mockImplementation(() => ({
      uid: 'user-1', notes: [mockCache], loading: false, updateNote, createNote, deleteNote: jest.fn(),
      notePresence: () => ({ kind: 'present', source: 'server', snapshot: {
        resource: { collection: 'studyNotes', id: initialNote.id }, value: mockCache,
        metadata: { protocol: 1, generation: 'generation', revision: 2, deleted: false },
      } }),
    }));
    window.localStorage.setItem(draftKey('user-1', initialNote.id, 'note'), JSON.stringify({ savedAt: 1, value: {
      ...local, type: 'note', tags: [], scriptureRefs: [],
    } }));
    const pending = new Promise<never>(() => undefined);
    updateNote.mockReturnValue({ ...persistedWrite(pending), result: pending });
    render(<StudyNoteEditorPage />);
    fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
    enterNoteEditing(local.content);
    await act(async () => { await jest.advanceTimersByTimeAsync(1600); });
    expect(updateNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.useStoredVersion' }));
    expect(screen.getByText(saved.content)).toBeInTheDocument();
    expect(updateNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.useLocalVersion' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(1600); });
    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({
      updates: { content: local.content }, expectedGeneration: 'generation',
    }));
  });

  it('keeps the unreviewed fields of an older draft from autosaving after a reload', async () => {
    const saved = { title: 'Saved title', content: 'Saved paragraph' };
    const local = { title: 'Old title', content: 'Old paragraph' };
    mockCache = { ...initialNote, ...saved, rev: { note: 2 } };
    (useStudyNotes as jest.Mock).mockImplementation(() => ({
      uid: 'user-1', notes: [mockCache], loading: false, updateNote, createNote, deleteNote: jest.fn(),
      notePresence: () => ({ kind: 'present', source: 'server', snapshot: {
        resource: { collection: 'studyNotes', id: initialNote.id }, value: mockCache,
        metadata: { protocol: 1, generation: 'generation', revision: 2, deleted: false },
      } }),
    }));
    window.localStorage.setItem(draftKey('user-1', initialNote.id, 'note'), JSON.stringify({ savedAt: 1, value: {
      ...local, type: 'note', tags: [], scriptureRefs: [],
    } }));
    const opening = render(<StudyNoteEditorPage />);
    fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.useStoredVersion' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(300); });
    expect(findNoteDraftCopies('user-1', initialNote.id, 'note')[0].value).toEqual(expect.objectContaining({
      title: saved.title, content: local.content, targetGeneration: 'generation', reviewLegacyFields: true,
    }));
    opening.unmount();

    render(<StudyNoteEditorPage />);
    fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
    enterNoteEditing(local.content);
    await act(async () => { await jest.advanceTimersByTimeAsync(1600); });
    expect(screen.getByText(saved.content)).toBeInTheDocument();
    expect(updateNote).not.toHaveBeenCalled();
  });

  it('keeps a recovered draft separate when the note has been replaced while a choice is open', async () => {
    const local = 'Offline title';
    const title = 'Current title';
    const paragraph = 'Independent paragraph';
    let generation = 'original-generation';
    mockCache = { ...initialNote, title, rev: { note: 2 } };
    (useStudyNotes as jest.Mock).mockImplementation(() => ({
      uid: 'user-1', notes: [mockCache], loading: false, updateNote, createNote, deleteNote: jest.fn(),
      notePresence: () => ({ kind: 'present', source: 'server', snapshot: {
        resource: { collection: 'studyNotes', id: initialNote.id }, value: mockCache,
        metadata: { protocol: 1, generation, revision: 2, deleted: false },
      } }),
    }));
    window.localStorage.setItem(draftKey('user-1', initialNote.id, 'note', 'phone'), JSON.stringify({ savedAt: 1, value: {
      title: local, content: paragraph, type: 'note', tags: [], scriptureRefs: [],
      origin: { fields: { title: initialNote.title, content: initialNote.content },
        title: { seen: { title: initialNote.title, generation, revision: 1 }, time: null } },
    } }));
    const result = Promise.reject(Object.assign(new Error('stale'), { isStaleWrite: true, aggregate: 'note',
      expectedRevision: 1, actualRevision: 2, serverValues: { title }, conflictingFields: ['title'], generation }));
    result.catch(() => undefined);
    updateNote.mockReturnValueOnce({ ...persistedWrite(result), result });
    const view = render(<StudyNoteEditorPage />);
    fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
    enterNoteEditing(paragraph);
    await act(async () => { await jest.advanceTimersByTimeAsync(1600); });
    const answer = screen.getByRole('button', { name: 'dataSync.useLocalVersion' });
    generation = 'replacement-generation';
    view.rerender(<StudyNoteEditorPage />);
    fireEvent.click(answer);
    await act(async () => { await jest.advanceTimersByTimeAsync(1600); });
    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('rich-markdown-editor')).toHaveValue(paragraph);
    expect(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder')).toHaveValue(local);
  });

  it('compares a newer title again before applying an answer to the previous one', async () => {
    const mine = 'Phone title';
    const stored = 'Computer title';
    const paragraph = 'Independent paragraph';
    mockCache = { ...initialNote, title: stored, rev: { note: 2 } };
    window.localStorage.setItem(draftKey('user-1', initialNote.id, 'note', 'phone'), JSON.stringify({ savedAt: 1, value: {
      title: mine, content: paragraph, type: 'note', tags: [], scriptureRefs: [],
      origin: { fields: { title: initialNote.title, content: initialNote.content },
        title: { seen: { title: initialNote.title, generation: 'generation', revision: 1 }, time: null } },
    } }));
    const refuse = (title: string, actualRevision: number) => {
      const result = Promise.reject(Object.assign(new Error('stale'), { isStaleWrite: true, aggregate: 'note',
        expectedRevision: 1, actualRevision, serverValues: { title }, conflictingFields: ['title'] }));
      result.catch(() => undefined);
      return { ...persistedWrite(result), result };
    };
    const later = 'Newer computer title';
    updateNote.mockReturnValueOnce(refuse(stored, 2)).mockReturnValueOnce(refuse(later, 3));
    const view = render(<StudyNoteEditorPage />);
    fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
    enterNoteEditing(paragraph);
    await act(async () => { await jest.advanceTimersByTimeAsync(1600); });
    mockCache = { ...mockCache, title: later, rev: { note: 3 } };
    view.rerender(<StudyNoteEditorPage />);
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.useStoredVersion' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(1600); });

    expect(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder')).toHaveValue(mine);
    expect(screen.getByText(later)).toBeInTheDocument();
    expect(screen.getByTestId('rich-markdown-editor')).toHaveValue(paragraph);
    expect(updateNote).toHaveBeenLastCalledWith(expect.objectContaining({ expectedBaseline: expect.objectContaining({ title: initialNote.title }) }));
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
    expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Typed on the laptop');
    expect(screen.getByRole('dialog', { name: 'common.discardText.title' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.discardText.keep' }));
    expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Typed on the laptop');
    expect(screen.getByText('freshness.conflictTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByText('freshness.conflictTakeTheirs'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.discardText.confirm' }));
    });
    expect(screen.getByTestId('rich-markdown-editor')).toHaveValue('Written on the phone');
  });
  it.each(['stored row', 'local words'])('keeps the current text when %s changes under an open discard question', async (changed) => {
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
    expect(screen.getByRole('dialog', { name: 'common.discardText.title' })).toBeInTheDocument();
    if (changed === 'stored row') {
      mockCache = { ...mockCache, content: 'Later stored words', rev: { note: 3 } };
      view.rerender(<StudyNoteEditorPage />);
    } else {
      fireEvent.change(screen.getByTestId('rich-markdown-editor'), { target: { value: 'Later local words' } });
    }
    const savesBeforeYes = updateNote.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.discardText.confirm' }));
    });
    expect(screen.getByTestId('rich-markdown-editor')).toHaveValue(changed === 'stored row' ? 'Typed on the laptop' : 'Later local words');
    expect(screen.getByText('freshness.conflictTitle')).toBeInTheDocument();
    expect(updateNote).toHaveBeenCalledTimes(savesBeforeYes);
  });

});
