import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CommentDialog } from '@/components/CommentDialog';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';

import type { StudyNote } from '@/models/models';
import type React from 'react';

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
// A book's text, every verse saying where it is: «Isaiah 41:2».
const mockBookText = (book: string) => ({ id: book, chapters: Array.from({ length: 150 }, (_, c) => Array.from({ length: 40 }, (_, v) => `${book} ${c + 1}:${v + 1}`)) });
jest.mock('@/components/bible/useBookTexts', () => ({ useBookTexts: (books: string[]) => new Map(books.map((book) => [book, mockBookText(book)])) }));
// The reader's window of books fetches a book chosen there; its search line is not under test here.
jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), fetchBookText: jest.fn(() => new Promise(() => undefined)) }));
jest.mock('@/components/bible/search/BibleSearch', () => ({ BibleSearch: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

const reference = { id: 'r', bible: 'rst' as const, book: 'Isaiah', chapter: 40, fromVerse: 31 };
const words = (n: number) => Array.from({ length: n }, (_, i) => `слово${i}`).join(' ');
const stored: StudyNote = {
  id: 'c1', userId: 'owner', type: 'comment', content: 'Сила приходит в ожидании.', scriptureRefs: [reference], tags: [],
  createdAt: '', updatedAt: '', isDraft: false, rev: { note: 4 },
};

beforeEach(() => {
  mockEngine.notes = [stored];
  jest.clearAllMocks();
  // A test that fails midway leaves its one-time answers queued; the next test must not get them.
  mockEngine.createNote.mockReset().mockImplementation(() => ({ ...accepted(), note: {} }));
  mockEngine.updateNote.mockReset().mockImplementation(() => ({ ...accepted(), result: Promise.resolve({}) }));
  mockEngine.deleteNote.mockReset().mockImplementation(() => accepted());
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

  it('saves an edit against the version it opened, through the revision guard, writing only what changed', async () => {
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    const editor = screen.getByLabelText('editor');
    expect(editor).toHaveValue('Сила приходит в ожидании.');
    await userEvent.type(editor, ' И в терпении.');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockEngine.updateNote).toHaveBeenCalledWith({
      id: 'c1',
      updates: { content: 'Сила приходит в ожидании. И в терпении.' },
      expectedRevision: 4,
      expectedBaseline: { content: 'Сила приходит в ожидании.' },
    });
  });

  it('writes nothing for «Готово» when nothing changed, and closes', async () => {
    const onClose = jest.fn();
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockEngine.updateNote).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
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
      updates: { content: 'Сила приходит в ожидании. Моё.' },
      expectedRevision: 6,
      expectedBaseline: { content: 'Чужой текст.' },
    }));
  });

  it('keeps mine on top of a comment made a note there: my words go with its revision, its being a note stays', async () => {
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
      // Only what this window changed goes out: the words; the type was not changed here, so the note stays a note.
      updates: { content: 'Сила приходит в ожидании. Моё.' },
      expectedBaseline: { content: 'Сила приходит в ожидании.' },
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

  describe('moving it to another place', () => {
    const row = (label: string) => within(screen.getByTestId('comment-place-list')).getByText(label).closest('button') as HTMLElement;
    const openPlaces = () => userEvent.click(screen.getByRole('button', { name: 'comment.move' }));

    it('moves a written comment to a verse across the chapter edge, saving the new place against the list it opened with', async () => {
      const onClose = jest.fn();
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" context="а надеющиеся на Господа…" bible="rst" onClose={onClose} />);
      await openPlaces();
      expect(screen.getByRole('button', { name: 'comment.move' })).toHaveAttribute('aria-expanded', 'true');
      // Five up and five down, the place itself marked where it stands.
      expect(within(row('40:31')).getByText('comment.placeHere')).toBeInTheDocument();
      expect(row('40:26')).toBeInTheDocument();
      expect(within(row('41:5')).getByText('Isaiah 41:5')).toBeInTheDocument();
      await userEvent.click(row('41:2'));
      expect(screen.queryByTestId('comment-place-list')).not.toBeInTheDocument();
      expect(screen.getByTestId('comment-moved')).toHaveTextContent('comment.movedFrom');
      // The words under the title follow the place.
      expect(screen.getByText('Isaiah 41:2')).toBeInTheDocument();
      expect(screen.queryByText('а надеющиеся на Господа…')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      // Only the place goes out: words edited meanwhile on another device are not written over, nor do they refuse the move.
      expect(mockEngine.updateNote).toHaveBeenCalledWith({
        id: 'c1',
        updates: { scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Isaiah', chapter: 41, fromVerse: 2 }] },
        expectedRevision: 4,
        expectedBaseline: { scriptureRefs: [reference] },
      });
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('puts it back: «Вернуть» leaves it where it stood, and «Готово» then has nothing to write', async () => {
      const onClose = jest.fn();
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" bible="rst" onClose={onClose} />);
      await openPlaces();
      await userEvent.click(row('40:29'));
      await userEvent.click(screen.getByRole('button', { name: 'comment.moveBack' }));
      expect(screen.queryByTestId('comment-moved')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      expect(mockEngine.updateNote).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('says where another comment already stands, a verse by a verse comment only', async () => {
      const there = { ...stored, id: 'c2', scriptureRefs: [{ ...reference, id: 'r2', fromVerse: 29 }] };
      const onChapter = { ...stored, id: 'c3', scriptureRefs: [{ id: 'r3', bible: 'rst' as const, book: 'Isaiah', chapter: 40 }] };
      mockEngine.notes = [stored, there, onChapter];
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" bible="rst" onClose={jest.fn()} />);
      await openPlaces();
      expect(within(row('40:29')).getByText('comment.placeTaken')).toBeInTheDocument();
      expect(within(row('40:28')).queryByText('comment.placeTaken')).not.toBeInTheDocument();
    });

    it('asks before Escape throws a place chosen away', async () => {
      const onClose = jest.fn();
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" bible="rst" onClose={onClose} />);
      await openPlaces();
      await userEvent.click(row('40:30'));
      await userEvent.keyboard('{Escape}');
      expect(onClose).not.toHaveBeenCalled();
      expect(await screen.findByText('common.discardChanges.title')).toBeInTheDocument();
    });

    it('keeps the place it was moving to on the device, and brings it back with the words', async () => {
      const first = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" bible="rst" onClose={jest.fn()} />);
      await openPlaces();
      await userEvent.click(row('41:1'));
      first.unmount();
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" bible="rst" onClose={jest.fn()} />);
      const offer = await screen.findByRole('status');
      await userEvent.click(within(offer).getByRole('button', { name: 'unsavedDraft.restore' }));
      expect(screen.getByTestId('comment-moved')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      expect(mockEngine.updateNote).toHaveBeenCalledWith(expect.objectContaining({
        updates: expect.objectContaining({ scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Isaiah', chapter: 41, fromVerse: 1 }] }),
      }));
    });

    it('moves a comment on a whole chapter among the chapters, as a chapter', async () => {
      mockEngine.notes = [{ ...stored, scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Isaiah', chapter: 40 }] }];
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40" bible="rst" onClose={jest.fn()} />);
      await openPlaces();
      expect(screen.getByText('comment.moveToChapter')).toBeInTheDocument();
      // A chapter's row says how it begins.
      await userEvent.click(within(screen.getByTestId('comment-place-list')).getByText('Isaiah 43:1').closest('button') as HTMLElement);
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      expect(mockEngine.updateNote).toHaveBeenCalledWith(expect.objectContaining({
        updates: expect.objectContaining({ scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Isaiah', chapter: 43 }] }),
      }));
    });

    it('chooses a place far away in the reader\'s own window: book, chapter, verse, a press a step', async () => {
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" bible="rst" onClose={jest.fn()} />);
      await openPlaces();
      await userEvent.click(screen.getByRole('button', { name: 'comment.moveElsewhere' }));
      const window = await screen.findByRole('dialog', { name: 'comment.moveElsewhereLabel' });
      // Choosing, not opening: no hold and no word of one.
      expect(within(window).queryByText('bible.holdBookHint')).not.toBeInTheDocument();
      await userEvent.click(within(window).getByRole('button', { name: 'Romans' }));
      await userEvent.click(screen.getAllByRole('button', { name: 'bible.chapter' })[7]);
      await userEvent.click(screen.getAllByRole('button', { name: 'bible.verseNumber' })[27]);
      expect(screen.queryByRole('dialog', { name: /bible.choose/ })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      expect(mockEngine.updateNote).toHaveBeenCalledWith(expect.objectContaining({
        updates: expect.objectContaining({ scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Romans', chapter: 8, fromVerse: 28 }] }),
      }));
    });

    it('takes the other device\'s place with its version, and keeps mine on top of its list', async () => {
      const theirs = [{ ...reference, fromVerse: 30 }];
      mockEngine.updateNote
        .mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6, { content: 'Сила приходит в ожидании.', type: 'comment', scriptureRefs: theirs })), persistence: Promise.resolve(), result: Promise.resolve({}) }) as never)
        .mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 6, 7, { content: 'Сила приходит в ожидании.', type: 'comment', scriptureRefs: theirs })), persistence: Promise.resolve(), result: Promise.resolve({}) }) as never)
        .mockImplementationOnce(() => ({ ...accepted(), result: Promise.resolve({}) }) as never);
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" bible="rst" onClose={jest.fn()} />);
      await openPlaces();
      await userEvent.click(row('41:2'));
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      await userEvent.click(await screen.findByRole('button', { name: 'freshness.conflictKeepMine' }));
      await waitFor(() => expect(mockEngine.updateNote).toHaveBeenCalledTimes(2));
      expect(mockEngine.updateNote).toHaveBeenLastCalledWith(expect.objectContaining({
        updates: expect.objectContaining({ scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Isaiah', chapter: 41, fromVerse: 2 }] }),
        expectedRevision: 6,
        expectedBaseline: expect.objectContaining({ scriptureRefs: theirs }),
      }));
      await userEvent.click(await screen.findByRole('button', { name: 'freshness.conflictTakeTheirs' }));
      expect(screen.queryByTestId('comment-moved')).not.toBeInTheDocument();
    });

    it('moves a new comment from the reader before it is written: it is saved where it was moved', async () => {
      render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" bible="rst" onClose={jest.fn()} />);
      await openPlaces();
      await userEvent.click(row('40:30'));
      await userEvent.type(screen.getByLabelText('editor'), 'Мысль.');
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      expect(mockEngine.createNote).toHaveBeenCalledWith(expect.objectContaining({ scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Isaiah', chapter: 40, fromVerse: 30 }] }));
    });

    // Codex review, 2026-10-28: the five below.
    it('moves a comment in the Bible it was written in, saying so, where the screen reads another', async () => {
      // Synodal Psalm 114 is King James 116:1–9: read there, it is neither a whole chapter nor itself.
      mockEngine.notes = [{ ...stored, scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Psalms', chapter: 114 }] }];
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ps 116" bible="kjv" onClose={jest.fn()} />);
      await openPlaces();
      expect(screen.getByText(/comment\.moveToChapter/)).toHaveTextContent('bible.writtenIn');
      expect(within(screen.getByTestId('comment-place-list')).getByText('Psalms 114:1').closest('button')).toHaveAttribute('aria-current', 'true');
      await userEvent.click(within(screen.getByTestId('comment-place-list')).getByText('Psalms 117:1').closest('button') as HTMLElement);
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      expect(mockEngine.updateNote).toHaveBeenCalledWith(expect.objectContaining({
        updates: { scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Psalms', chapter: 117 }] },
      }));
    });

    it('brings back a move kept on the device as it was chosen, whatever Bible the window is opened in', async () => {
      // Synodal Psalm 50:12 is King James 51:10.
      mockEngine.notes = [{ ...stored, scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 10 }] }];
      const first = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Пс 50:10" bible="rst" onClose={jest.fn()} />);
      await openPlaces();
      await userEvent.click(row('50:12'));
      first.unmount();
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ps 51:8" bible="kjv" onClose={jest.fn()} />);
      await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'unsavedDraft.restore' }));
      // The words of the place as chosen, in the comment's own Bible.
      expect(screen.getByText('Psalms 50:12')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      expect(mockEngine.updateNote).toHaveBeenCalledWith(expect.objectContaining({
        updates: { scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12 }] },
      }));
    });

    it('names the other device\'s place once its version is taken, with that place\'s words', async () => {
      const theirs = [{ ...reference, book: 'Romans', chapter: 8, fromVerse: 28 }];
      mockEngine.updateNote.mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6, { scriptureRefs: theirs })), persistence: Promise.resolve(), result: Promise.resolve({}) }) as never);
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" context="а надеющиеся на Господа…" bible="rst" placeOf={(ref) => `${ref.book} ${ref.chapter}:${ref.fromVerse}`} onClose={jest.fn()} />);
      await openPlaces();
      await userEvent.click(row('41:2'));
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      await userEvent.click(await screen.findByRole('button', { name: 'freshness.conflictTakeTheirs' }));
      expect(screen.getByText('Romans 8:28')).toBeInTheDocument();
      expect(screen.queryByText('а надеющиеся на Господа…')).not.toBeInTheDocument();
      // Moved again from there, it says where it was: the other device's place, not the one the window opened at.
      await openPlaces();
      await userEvent.click(row('8:29'));
      expect(screen.getByTestId('comment-moved')).toHaveTextContent('comment.movedFrom');
    });

    it('chooses a book of one chapter whole for a comment on a chapter, with no verse to pick', async () => {
      mockEngine.notes = [{ ...stored, scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Isaiah', chapter: 40 }] }];
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40" bible="rst" onClose={jest.fn()} />);
      await openPlaces();
      await userEvent.click(screen.getByRole('button', { name: 'comment.moveElsewhereChapter' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'comment.moveElsewhereLabel' })).getByRole('button', { name: 'Jude' }));
      expect(screen.queryByRole('button', { name: 'bible.verseNumber' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      expect(mockEngine.updateNote).toHaveBeenCalledWith(expect.objectContaining({
        updates: { scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Jude', chapter: 1 }] },
      }));
    });

    // Codex review r2, 2026-10-28.
    it('brings back a move between two chapters another Bible joins, and saves it: Synodal 114 → 115, read in the King James', async () => {
      // Synodal Psalms 114 and 115 are both King James 116.
      mockEngine.notes = [{ ...stored, scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Psalms', chapter: 114 }] }];
      const first = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Пс 114" bible="rst" onClose={jest.fn()} />);
      await openPlaces();
      await userEvent.click(within(screen.getByTestId('comment-place-list')).getByText('Psalms 115:1').closest('button') as HTMLElement);
      first.unmount();
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ps 116" bible="kjv" onClose={jest.fn()} />);
      await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'unsavedDraft.restore' }));
      expect(screen.getByTestId('comment-moved')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      expect(mockEngine.updateNote).toHaveBeenCalledWith(expect.objectContaining({
        updates: { scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Psalms', chapter: 115 }] },
      }));
    });

    it('moves one chapter as one chapter, though another Bible reads it as two: Synodal Psalm 9 is King James 9–10', async () => {
      mockEngine.notes = [{ ...stored, scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Psalms', chapter: 9 }] }];
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ps 9–10" bible="kjv" onClose={jest.fn()} />);
      await openPlaces();
      await userEvent.click(within(screen.getByTestId('comment-place-list')).getByText('Psalms 11:1').closest('button') as HTMLElement);
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      expect(mockEngine.updateNote).toHaveBeenCalledWith(expect.objectContaining({
        updates: { scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Psalms', chapter: 11 }] },
      }));
    });

    it('sees a comment made a note on the other device when its version is taken, though the refusal names only the words', async () => {
      mockEngine.updateNote.mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6, { content: 'Длинная заметка.' })), persistence: Promise.resolve(), result: Promise.resolve({}) }) as never);
      const onClose = jest.fn();
      const { rerender } = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={onClose} />);
      await userEvent.type(screen.getByLabelText('editor'), ' Моё.');
      // Meanwhile the list holds what the other device made of it.
      mockEngine.notes = [{ ...stored, type: 'note', title: 'Ожидание', content: 'Длинная заметка.', rev: { note: 6 } }];
      rerender(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={onClose} />);
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      await userEvent.click(await screen.findByRole('button', { name: 'freshness.conflictTakeTheirs' }));
      expect(onClose).toHaveBeenCalled();
    });

    it('shuts the list of places while a save is accepted: a place chosen then would not be the one saved', async () => {
      mockEngine.updateNote.mockReturnValueOnce({ acceptance: new Promise(() => undefined), persistence: Promise.resolve(), result: Promise.resolve({}) } as never);
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" bible="rst" onClose={jest.fn()} />);
      await openPlaces();
      await userEvent.click(row('41:2'));
      await openPlaces();
      expect(screen.getByTestId('comment-place-list')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      expect(screen.queryByTestId('comment-place-list')).not.toBeInTheDocument();
    });

    // Codex review r3, 2026-10-28.
    it('repeats only the move on «keep mine»: words left untouched here do not go out over the words written there', async () => {
      const theirs = [{ ...reference, fromVerse: 30 }];
      mockEngine.updateNote
        .mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6, { scriptureRefs: theirs })), persistence: Promise.resolve(), result: Promise.resolve({}) }) as never)
        .mockImplementationOnce(() => ({ ...accepted(), result: Promise.resolve({}) }) as never);
      const { rerender } = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" bible="rst" onClose={jest.fn()} />);
      await openPlaces();
      await userEvent.click(row('41:2'));
      // The other device changed the place and the words.
      mockEngine.notes = [{ ...stored, content: 'Слова с другого устройства.', scriptureRefs: theirs, rev: { note: 6 } }];
      rerender(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" bible="rst" onClose={jest.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      await userEvent.click(await screen.findByRole('button', { name: 'freshness.conflictKeepMine' }));
      await waitFor(() => expect(mockEngine.updateNote).toHaveBeenCalledTimes(2));
      expect(mockEngine.updateNote).toHaveBeenLastCalledWith(expect.objectContaining({
        updates: { scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Isaiah', chapter: 41, fromVerse: 2 }] },
        expectedBaseline: { scriptureRefs: theirs },
      }));
    });

    it('sees the note the comment became there when its version is taken, though the list caught up only after the refusal', async () => {
      mockEngine.updateNote.mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6, { content: 'Длинная заметка.' })), persistence: Promise.resolve(), result: Promise.resolve({}) }) as never);
      const onClose = jest.fn();
      const { rerender } = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={onClose} />);
      await userEvent.type(screen.getByLabelText('editor'), ' Моё.');
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      await screen.findByRole('button', { name: 'freshness.conflictTakeTheirs' });
      mockEngine.notes = [{ ...stored, type: 'note', title: 'Ожидание', content: 'Длинная заметка.', rev: { note: 6 } }];
      rerender(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={onClose} />);
      await userEvent.click(screen.getByRole('button', { name: 'freshness.conflictTakeTheirs' }));
      expect(onClose).toHaveBeenCalled();
    });

    it('keeps a new comment\'s own place still while its save is accepted (Studies)', async () => {
      mockEngine.createNote.mockReturnValueOnce({ acceptance: new Promise(() => undefined), persistence: Promise.resolve(), note: {} } as never);
      render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" placePicker={() => <p>picker</p>} onClose={jest.fn()} />);
      await userEvent.type(screen.getByLabelText('editor'), 'Мысль.');
      expect(screen.getByText('picker')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      expect(screen.queryByText('picker')).not.toBeInTheDocument();
    });

    // Codex review r4, 2026-10-28.
    it('names its own place by the screen\'s way of naming, every piece, from the moment it opens', async () => {
      mockEngine.notes = [{ ...stored, scriptureRefs: [{ id: 'r', bible: 'kjv', book: 'Romans', chapter: 16 }] }];
      const placeOf = jest.fn((ref: { book: string; chapter?: number }) => `named ${ref.book} ${ref.chapter}`);
      render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Рим 14:24–26" bible="rst" placeOf={placeOf} onClose={jest.fn()} />);
      await screen.findByRole('heading', { name: 'comment.title' });
      // The title is asked of the screen's way of naming, with the comment's own reference — not the first piece the screen gave.
      expect(placeOf).toHaveBeenCalledWith(expect.objectContaining({ bible: 'kjv', book: 'Romans', chapter: 16 }));
    });

    it('closes, saying where it is, when the version taken is a note stored without a type', async () => {
      mockEngine.updateNote.mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6, { content: 'Длинная заметка.' })), persistence: Promise.resolve(), result: Promise.resolve({}) }) as never);
      const onClose = jest.fn();
      const { rerender } = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={onClose} />);
      await userEvent.type(screen.getByLabelText('editor'), ' Моё.');
      await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
      await screen.findByRole('button', { name: 'freshness.conflictTakeTheirs' });
      mockEngine.notes = [{ ...stored, type: undefined, content: 'Длинная заметка.', rev: { note: 6 } }];
      rerender(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={onClose} />);
      await userEvent.click(screen.getByRole('button', { name: 'freshness.conflictTakeTheirs' }));
      expect(onClose).toHaveBeenCalled();
    });

    it('offers no move where the window chooses its own place (Studies), nor for a whole book', () => {
      render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" placePicker={() => <p>picker</p>} onClose={jest.fn()} />);
      expect(screen.queryByRole('button', { name: 'comment.move' })).not.toBeInTheDocument();
    });
  });
});
