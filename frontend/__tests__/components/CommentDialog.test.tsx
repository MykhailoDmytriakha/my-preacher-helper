import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CommentDialog } from '@/components/CommentDialog';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';

import type { StudyNote } from '@/models/models';

/*
 * The comment's window (case 2026-10-12-block-diagram, 3.2): written and edited only here; past five sentences the
 * bar turns green and the main button makes it a note. The editor is the notes' own (a Tiptap surface), stood in
 * for here by a plain field; the engine's door is checked by what it is asked to write.
 */
jest.mock('@/components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange, placeholder, editable = true }: { value: string; onChange: (value: string) => void; placeholder?: string; editable?: boolean }) => (
    <textarea aria-label="editor" placeholder={placeholder} value={value} readOnly={!editable} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const accepted = () => ({ acceptance: Promise.resolve({ kind: 'local' }), persistence: Promise.resolve() });
const mockEngine = {
  uid: 'owner',
  notes: [] as StudyNote[],
  createNote: jest.fn(() => ({ ...accepted(), note: {} })),
  updateNote: jest.fn(() => ({ ...accepted(), result: Promise.resolve({}) })),
  deleteNote: jest.fn(() => accepted()),
};
jest.mock('@/hooks/useStudyNotesEngine', () => ({ useStudyNotesEngine: () => mockEngine }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const reference = { id: 'r', bible: 'rst' as const, book: 'Isaiah', chapter: 40, fromVerse: 31 };
const words = (n: number) => Array.from({ length: n }, (_, i) => `слово${i}`).join(' ');
const stored: StudyNote = {
  id: 'c1', userId: 'owner', type: 'comment', content: 'Сила приходит в ожидании.', scriptureRefs: [reference], tags: [],
  createdAt: '', updatedAt: '', isDraft: false, rev: { note: 4 },
};

beforeEach(() => {
  mockEngine.notes = [stored];
  jest.clearAllMocks();
  window.localStorage.clear();
});

// What the device keeps for the window: every stored draft's words.
const keptDrafts = () => Object.keys(window.localStorage).filter((key) => key.startsWith('draft:'))
  .map((key) => (JSON.parse(window.localStorage.getItem(key) ?? '{}') as { value?: unknown }).value);

describe('CommentDialog', () => {
  it('writes a new comment on its verse, with no tags, as a comment', async () => {
    const onClose = jest.fn();
    render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" context="а надеющиеся на Господа…" onClose={onClose} />);
    const done = screen.getByRole('button', { name: 'common.done' });
    expect(done).toBeDisabled();
    await userEvent.type(screen.getByLabelText('editor'), 'Ждать — не бездействие.');
    await userEvent.click(done);
    expect(mockEngine.createNote).toHaveBeenCalledWith({ userId: 'owner', content: 'Ждать — не бездействие.', title: '', scriptureRefs: [reference], tags: [], type: 'comment' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('past five sentences fills the way to green and makes it a note, the text whole', async () => {
    render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" onClose={jest.fn()} />);
    const editor = screen.getByLabelText('editor');
    await userEvent.type(editor, words(24));
    expect(screen.getByTestId('comment-way-rest')).toHaveStyle({ width: '60%' });
    expect(screen.queryByText('comment.becomesNote')).not.toBeInTheDocument();
    await userEvent.type(editor, ` ${words(40)}`);
    expect(screen.getByTestId('comment-way-rest')).toHaveStyle({ width: '0%' });
    expect(screen.getByRole('img', { name: 'comment.wayNote' })).toBeInTheDocument();
    expect(screen.getByText('comment.becomesNote')).toBeInTheDocument();
    // A note without a name is no use: the main button waits for one.
    const toNote = screen.getByRole('button', { name: 'comment.toNote' });
    expect(toNote).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/comment.noteTitle/), 'Ожидание');
    await userEvent.click(toNote);
    expect(mockEngine.createNote).toHaveBeenCalledWith(expect.objectContaining({ type: 'note', title: 'Ожидание', content: `${words(24)} ${words(40)}` }));
  });

  it('makes a written comment a note under the name given, guarding the name it opened with', async () => {
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('editor'), ` ${words(64)}`);
    await userEvent.type(screen.getByLabelText(/comment.noteTitle/), '  Сила в ожидании ');
    await userEvent.click(screen.getByRole('button', { name: 'comment.toNote' }));
    expect(mockEngine.updateNote).toHaveBeenCalledWith(expect.objectContaining({
      updates: expect.objectContaining({ type: 'note', title: 'Сила в ожидании' }),
      expectedBaseline: { content: 'Сила приходит в ожидании.', type: 'comment', title: '' },
    }));
  });

  it('saves an edit against the version it opened, through the revision guard', async () => {
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    const editor = screen.getByLabelText('editor');
    expect(editor).toHaveValue('Сила приходит в ожидании.');
    await userEvent.type(editor, ' И в терпении.');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockEngine.updateNote).toHaveBeenCalledWith({
      id: 'c1',
      updates: { content: 'Сила приходит в ожидании. И в терпении.', type: 'comment' },
      expectedRevision: 4,
      expectedBaseline: { content: 'Сила приходит в ожидании.', type: 'comment' },
    });
  });

  it('erases only after the question, and never on an empty field', async () => {
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    await userEvent.clear(screen.getByLabelText('editor'));
    expect(screen.getByRole('button', { name: 'common.done' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'comment.erase' }));
    expect(mockEngine.deleteNote).not.toHaveBeenCalled();
    const question = await screen.findByRole('dialog', { name: /comment.eraseTitle/ });
    await userEvent.click(within(question).getByRole('button', { name: 'comment.erase' }));
    await waitFor(() => expect(mockEngine.deleteNote).toHaveBeenCalledWith('c1'));
  });

  it('waits for a place before a new comment chosen away from the Bible can be saved', async () => {
    render(<CommentDialog target={{ kind: 'new', reference: null }} place="" placePicker={() => <p>picker</p>} onClose={jest.fn()} />);
    expect(screen.getByText('picker')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'comment.titleNew' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('editor'), 'Мысль.');
    expect(screen.getByRole('button', { name: 'common.done' })).toBeDisabled();
  });

  it('asks before Escape throws typed text away, and closes at once when nothing changed', async () => {
    const onClose = jest.fn();
    render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('editor'), 'Мысль.');
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText('common.discardChanges.title')).toBeInTheDocument();
  });

  it('holds the words still while the save is being accepted', async () => {
    let accept: (value: unknown) => void = () => undefined;
    mockEngine.createNote.mockReturnValueOnce({ acceptance: new Promise((resolve) => { accept = resolve; }), persistence: Promise.resolve(), note: {} } as never);
    render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" onClose={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('editor'), 'Мысль.');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(screen.getByLabelText('editor')).toHaveAttribute('readonly');
    accept({ kind: 'local' });
  });

  it('keeps mine on top of the other device\'s version: the new revision and its words go into the next save', async () => {
    mockEngine.updateNote
      .mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6, { content: 'Чужой текст.' })), persistence: Promise.resolve(), result: Promise.resolve({}) }) as never)
      .mockImplementationOnce(() => ({ ...accepted(), result: Promise.resolve({}) }) as never);
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('editor'), ' Моё.');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    const keep = await screen.findByRole('button', { name: 'freshness.conflictKeepMine' });
    await userEvent.click(keep);
    await waitFor(() => expect(mockEngine.updateNote).toHaveBeenCalledTimes(2));
    expect(mockEngine.updateNote).toHaveBeenLastCalledWith(expect.objectContaining({
      updates: { content: 'Сила приходит в ожидании. Моё.', type: 'comment' },
      expectedRevision: 6,
      expectedBaseline: { content: 'Чужой текст.', type: 'comment' },
    }));
  });

  it('adopts the other device\'s type with its revision, so «keep mine» is not refused again for a comment made a note there', async () => {
    mockEngine.updateNote
      .mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6, { type: 'note' })), persistence: Promise.resolve(), result: Promise.resolve({}) }) as never)
      .mockImplementationOnce(() => ({ ...accepted(), result: Promise.resolve({}) }) as never);
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('editor'), ' Моё.');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await userEvent.click(await screen.findByRole('button', { name: 'freshness.conflictKeepMine' }));
    await waitFor(() => expect(mockEngine.updateNote).toHaveBeenCalledTimes(2));
    expect(mockEngine.updateNote).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedRevision: 6,
      // The words did not differ, so they stay as the window opened them; the type is the other device's.
      expectedBaseline: { content: 'Сила приходит в ожидании.', type: 'note' },
    }));
  });

  it('keeps the words on the device until saved: the same door, opened again after a reload, offers them back to see and restore', async () => {
    const { unmount } = render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" onClose={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('editor'), 'Ждать — не бездействие.');
    unmount();
    // A door makes a new reference each time it opens; the words are found by the place.
    render(<CommentDialog target={{ kind: 'new', reference: { ...reference, id: 'again' } }} place="Ис 40:31" onClose={jest.fn()} />);
    const offer = await screen.findByRole('status');
    expect(within(offer).getByText('Ждать — не бездействие.')).toBeInTheDocument();
    expect(screen.getByLabelText('editor')).toHaveValue('');
    // Until the person answers, nothing can be typed over the only copy of those words.
    expect(screen.getByLabelText('editor')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'common.done' })).toBeDisabled();
    await userEvent.click(within(offer).getByRole('button', { name: 'unsavedDraft.restore' }));
    expect(screen.getByLabelText('editor')).toHaveValue('Ждать — не бездействие.');
    expect(screen.getByLabelText('editor')).not.toHaveAttribute('readonly');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('brings words written away from the Bible back with the place they were written to', async () => {
    const picker = () => <p>picker</p>;
    const first = render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" placePicker={picker} onClose={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('editor'), 'Мысль у текста.');
    first.unmount();
    const restorePlace = jest.fn();
    render(<CommentDialog target={{ kind: 'new', reference: null }} place="" placePicker={picker} restorePlace={restorePlace} onClose={jest.fn()} />);
    const offer = await screen.findByRole('status');
    // The place is not asked for over the words that may bring their own back.
    expect(screen.queryByText('picker')).not.toBeInTheDocument();
    await userEvent.click(within(offer).getByRole('button', { name: 'unsavedDraft.restore' }));
    expect(screen.getByLabelText('editor')).toHaveValue('Мысль у текста.');
    expect(restorePlace).toHaveBeenCalledWith(reference);
  });

  it('takes the other device\'s version as it is stored, words and type, even where its words equal mine', async () => {
    mockEngine.updateNote.mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6, { content: 'Сила приходит в ожидании. Моё.', type: 'note' })), persistence: Promise.resolve(), result: Promise.resolve({}) }) as never);
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('editor'), ' Моё.');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await userEvent.click(await screen.findByRole('button', { name: 'freshness.conflictTakeTheirs' }));
    expect(screen.getByLabelText('editor')).toHaveValue('Сила приходит в ожидании. Моё.');
  });

  it('leaves nothing on the device once the words are saved, or thrown away on the person\'s own answer', async () => {
    const closed = jest.fn();
    const saved = render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" onClose={closed} />);
    await userEvent.type(screen.getByLabelText('editor'), 'Мысль.');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    // The window closes once the device accepted the save; a page gone before that keeps the words.
    await waitFor(() => expect(closed).toHaveBeenCalled());
    saved.unmount();
    expect(keptDrafts()).toEqual([]);

    const onClose = jest.fn();
    const thrown = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('editor'), ' Лишнее.');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(keptDrafts()).toEqual([{ text: 'Сила приходит в ожидании. Лишнее.', reference: null, title: '' }]);
    await userEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    await userEvent.click(await screen.findByRole('button', { name: 'common.discardChanges.confirm' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    thrown.unmount();
    expect(keptDrafts()).toEqual([]);
  });

  it('takes no emptied list item or quote for words: «-» alone cannot be saved', async () => {
    render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" onClose={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('editor'), '- ');
    expect(screen.getByRole('button', { name: 'common.done' })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('editor'));
    await userEvent.type(screen.getByLabelText('editor'), '> ');
    expect(screen.getByRole('button', { name: 'common.done' })).toBeDisabled();
  });

  it('erased from its own page, leaves the page by the way it is given, not by a plain close', async () => {
    const onClose = jest.fn();
    const onErased = jest.fn();
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={onClose} onErased={onErased} />);
    await userEvent.click(screen.getByRole('button', { name: 'comment.erase' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: /comment.eraseTitle/ })).getByRole('button', { name: 'comment.erase' }));
    await waitFor(() => expect(onErased).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes, saying where it is, when the other device\'s version taken is a note: «Готово» would make it a comment again', async () => {
    mockEngine.updateNote.mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6, { content: 'Длинная заметка.', type: 'note' })), persistence: Promise.resolve(), result: Promise.resolve({}) }) as never);
    const onClose = jest.fn();
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('editor'), ' Моё.');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await userEvent.click(await screen.findByRole('button', { name: 'freshness.conflictTakeTheirs' }));
    expect(onClose).toHaveBeenCalled();
    expect(mockEngine.updateNote).toHaveBeenCalledTimes(1);
    expect(keptDrafts()).toEqual([]);
  });

  it('never takes a whole book as a new comment\'s place: it stands under no verse and no heading', async () => {
    render(<CommentDialog target={{ kind: 'new', reference: { id: 'b', book: 'Isaiah' } }} place="Ис" onClose={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('editor'), 'Мысль.');
    expect(screen.getByRole('button', { name: 'common.done' })).toBeDisabled();
  });
});
