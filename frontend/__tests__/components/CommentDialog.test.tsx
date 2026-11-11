import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CommentDialog, CommentWayBar } from '@/components/CommentDialog';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { draftKey, saveDraft } from '@/utils/durableDraft';
import { readDraftAddress } from '@/utils/draftAddress';
import { commentDraftReference } from '@/utils/commentDrafts';

import type { ScriptureReference, StudyNote } from '@/models/models';
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

let mockInterpolateCommentTitle = false;
let mockPlacementLanguage: 'en' | 'ru' | undefined;
jest.mock('@locales/useTranslation', () => {
  const actual = jest.requireActual('@locales/useTranslation');
  const english = require('../../locales/en/translation.json');
  const russian = require('../../locales/ru/translation.json');
  return {
    ...actual,
    useTranslation: () => {
      const result = actual.useTranslation();
      return {
        ...result,
        t: (key: string, options?: { place?: string; title?: string }) => {
          if (mockInterpolateCommentTitle && key === 'comment.title') {
            return english.comment.title.replace('{{place}}', options?.place ?? '');
          }
          if (mockPlacementLanguage && key === 'comment.pick.cross') {
            const catalog = mockPlacementLanguage === 'ru' ? russian : english;
            return catalog.comment.pick.cross.replace('{{title}}', options?.title ?? '');
          }
          return result.t(key, options);
        },
      };
    },
  };
});

const accepted = () => ({ acceptance: Promise.resolve({ kind: 'local' }), persistence: Promise.resolve() });
const mockEngine = {
  uid: 'owner',
  commentCollectionReady: true,
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
  mockInterpolateCommentTitle = false;
  mockPlacementLanguage = undefined;
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
  it('keeps the opening place while adopting the recovered reference identity', () => {
    const opening = { ...reference, id: 'current-opening' };
    const recovered = { ...reference, id: 'retained-reference', fromVerse: 30 };
    expect(commentDraftReference({ kind: 'new', reference: opening }, { openingId: opening.id, reference: recovered }))
      .toEqual({ ...opening, id: recovered.id });
  });

  it.each([true, false])('offers a pre-upgrade verse copy and retires its exact words after an immediate restored save: title present=%s', async (hasTitle) => {
    const legacyKey = draftKey('owner', 'new:rst:Isaiah:40:31', 'comment');
    saveDraft(legacyKey, { text: 'Legacy retained words.', reference, ...(hasTitle ? { title: '' } : {}) });
    const close = jest.fn();
    render(<CommentDialog target={{ kind: 'new', reference: { ...reference, id: 'fresh-door' } }} place="Isa 40:31" onClose={close} />);
    const offer = await screen.findByRole('status');
    expect(within(offer).getByText('Legacy retained words.')).toBeInTheDocument();
    await userEvent.click(within(offer).getByRole('button', { name: 'unsavedDraft.restore' }));
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(mockEngine.createNote).toHaveBeenCalledWith(expect.objectContaining({ content: 'Legacy retained words.', scriptureRefs: [reference] }));
    expect(keptDrafts()).toEqual([]);
  });

  it('does not offer another verse hidden behind an old ambiguous key', () => {
    const key = draftKey('owner', 'new:rst:Isaiah:40:31', 'comment');
    saveDraft(key, { text: 'Words from a different verse.', reference: { ...reference, fromVerse: 30 }, title: '' });
    render(<CommentDialog target={{ kind: 'new', reference }} place="Isa 40:31" onClose={jest.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('editor')).toHaveValue('');
    expect(window.localStorage.getItem(key)).not.toBeNull();
  });

  it('does not offer a different owner\'s pre-upgrade verse copy', () => {
    const key = draftKey('owner-extra', 'new:rst:Isaiah:40:31', 'comment');
    saveDraft(key, { text: 'Other account words.', reference, title: '' });
    render(<CommentDialog target={{ kind: 'new', reference }} place="Isa 40:31" onClose={jest.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('editor')).toHaveValue('');
    expect(window.localStorage.getItem(key)).not.toBeNull();
  });

  it('keeps the earlier independent copy when only the latest recovery is discarded', async () => {
    const documentId = 'new:rst:Isaiah:40:31';
    const first = draftKey('owner', documentId, 'comment', 'first-opening');
    const second = draftKey('owner', documentId, 'comment', 'second-opening');
    const now = jest.spyOn(Date, 'now').mockReturnValueOnce(10).mockReturnValueOnce(20);
    saveDraft(first, { text: 'First independent words.', reference, title: '' });
    saveDraft(second, { text: 'Second independent words.', reference, title: '' });
    now.mockRestore();
    render(<CommentDialog target={{ kind: 'new', reference }} place="Isa 40:31" onClose={jest.fn()} />);
    const offer = await screen.findByRole('status');
    expect(within(offer).getByText('Second independent words.')).toBeInTheDocument();
    await userEvent.click(within(offer).getByRole('button', { name: 'unsavedDraft.discard' }));
    expect(window.localStorage.getItem(second)).toBeNull();
    expect(window.localStorage.getItem(first)).not.toBeNull();
    expect(within(await screen.findByRole('status')).getByText('First independent words.')).toBeInTheDocument();
  });

  it('keeps a preceding opening intact while a new opening has not answered its recovery offer', async () => {
    const first = render(<CommentDialog target={{ kind: 'new', reference }} place="Isa 40:31" onClose={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('editor'), 'Unfinished first opening.');
    first.unmount();
    const before = Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]));
    const second = render(<CommentDialog target={{ kind: 'new', reference: { ...reference, id: 'second-door' } }} place="Isa 40:31" onClose={jest.fn()} />);
    await screen.findByRole('status');
    expect(screen.getByLabelText('editor')).toHaveAttribute('readonly');
    second.unmount();
    expect(Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))).toEqual(before);
  });

  it('does not let a second equal retained copy become a recovery question after typing', async () => {
    const first = draftKey('owner', 'c1', 'comment', 'first-opening');
    const second = draftKey('owner', 'c1', 'comment', 'second-opening');
    const sameAsShown = { text: stored.content, reference: null, title: '' };
    saveDraft(first, sameAsShown);
    saveDraft(second, sameAsShown);

    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    const editor = screen.getByLabelText('editor');
    expect(editor).toHaveValue(stored.content);
    await userEvent.type(editor, ' X');

    expect(editor).not.toHaveAttribute('readonly');
    expect(editor).toHaveValue(`${stored.content} X`);
    await waitFor(() => {
      const currentKey = Object.keys(window.localStorage).find(key => key.startsWith('draft:') && key !== first && key !== second
        && (JSON.parse(window.localStorage.getItem(key) ?? '{}') as { value?: { text?: string } }).value?.text === `${stored.content} X`);
      expect(currentKey).toBeDefined();
    });
  });

  it('keeps an unselected equal physical source after saving the explicitly restored comment', async () => {
    const other = draftKey('owner', 'c1', 'comment', 'equal-other');
    const selected = draftKey('owner', 'c1', 'comment', 'equal-selected');
    const value = { text: 'Restored equal words.', reference: null, title: '' };
    localStorage.setItem(other, JSON.stringify({ value, savedAt: 10 }));
    localStorage.setItem(selected, JSON.stringify({ value, savedAt: 20 }));
    const otherRaw = localStorage.getItem(other);
    const close = jest.fn();
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Isa 40:31" onClose={close} />);
    const offer = await screen.findByRole('status');
    await userEvent.click(within(offer).getByRole('button', { name: 'unsavedDraft.restore' }));
    expect(screen.getByLabelText('editor')).toHaveValue(value.text);
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(mockEngine.updateNote).toHaveBeenCalled();
    expect(localStorage.getItem(selected)).toBeNull();
    expect(localStorage.getItem(other)).toBe(otherRaw);
  });

  it('allows editing the chosen comment while another retained copy remains intact', async () => {
    const other = draftKey('owner', 'c1', 'comment', 'other-opening');
    const selected = draftKey('owner', 'c1', 'comment', 'selected-opening');
    saveDraft(other, { text: 'Other retained words.', reference: null, title: '' });
    saveDraft(selected, { text: 'Chosen retained words.', reference: null, title: '' });
    localStorage.setItem(other, JSON.stringify({ ...JSON.parse(localStorage.getItem(other)!), savedAt: 10 }));
    localStorage.setItem(selected, JSON.stringify({ ...JSON.parse(localStorage.getItem(selected)!), savedAt: 20 }));
    const otherRaw = localStorage.getItem(other);
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Isa 40:31" onClose={jest.fn()} />);
    const offer = await screen.findByRole('status');
    await userEvent.click(within(offer).getByRole('button', { name: 'unsavedDraft.restore' }));
    const editor = screen.getByLabelText('editor');
    expect(editor).toHaveValue('Chosen retained words.');
    expect(editor).not.toHaveAttribute('readonly');
    await userEvent.type(editor, ' X');
    expect(editor).toHaveValue('Chosen retained words. X');
    expect(localStorage.getItem(other)).toBe(otherRaw);
  });

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

  // Visual pass 2026-11-07: a paragraph written on the verse at the top got its heading under the header — the reader brings
  // what was saved into sight, by the id the window hands it; one that grew into a note leaves the reader and is not shown.
  it('hands the reader the id of what it saved — new or written — and none for a note', async () => {
    const onSaved = jest.fn();
    mockEngine.createNote.mockImplementationOnce(() => ({ ...accepted(), note: { id: 'new-1' } }));
    const { unmount } = render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" onClose={jest.fn()} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText('editor'), 'Ждать — не бездействие.');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new-1'));
    unmount();
    onSaved.mockClear();
    const edited = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText('editor'), ' И в терпении.');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('c1'));
    edited.unmount();
    onSaved.mockClear();
    const closed = jest.fn();
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={closed} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText('editor'), ` ${words(64)}`);
    await userEvent.type(screen.getByLabelText(/comment.noteTitle/), 'Сила в ожидании');
    await userEvent.click(screen.getByRole('button', { name: 'comment.toNote' }));
    // Closed after the save was taken: by then a reveal would have been asked for.
    await waitFor(() => expect(closed).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
  });

  // Visual pass 2026-11-07: the window titled «Абзац» began its way with «Комментарий» — one thing, one name in the window.
  it('starts the way to a note with what is being written: a comment, or a paragraph', () => {
    const { rerender } = render(<CommentWayBar text="Жёны и мужья" />);
    expect(screen.getByTestId('comment-way')).toHaveTextContent(/^studiesWorkspace\.type\.comment/);
    rerender(<CommentWayBar text="Жёны и мужья" paragraph />);
    expect(screen.getByTestId('comment-way')).toHaveTextContent(/^comment\.kind\.paragraph/);
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

  // Codex review of the visual pass, 2026-11-07: the kind is the person's as the words are. A comment never given a kind,
  // made a paragraph here and a comment on another device: «keep mine» goes with what the other device stored as its baseline
  // (else refused again on every press), and «take theirs» shows their kind in the switch and writes nothing of this one.
  it('carries the comment\'s kind through a conflict: keep mine goes against their kind, take theirs takes it', async () => {
    const refused = () => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6, { paragraph: false })), persistence: Promise.resolve(), result: Promise.resolve({}) }) as never;
    mockEngine.updateNote.mockImplementationOnce(refused).mockImplementationOnce(() => ({ ...accepted(), result: Promise.resolve({}) }) as never);
    const { unmount } = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} paragraphChoice={{ initial: false }} />);
    await userEvent.click(screen.getByRole('button', { name: 'comment.kind.paragraph' }));
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockEngine.updateNote).toHaveBeenLastCalledWith(expect.objectContaining({ updates: { paragraph: true }, expectedBaseline: { paragraph: undefined, scriptureRefs: [reference] } }));
    await userEvent.click(await screen.findByRole('button', { name: 'freshness.conflictKeepMine' }));
    await waitFor(() => expect(mockEngine.updateNote).toHaveBeenCalledTimes(2));
    expect(mockEngine.updateNote).toHaveBeenLastCalledWith(expect.objectContaining({ updates: { paragraph: true }, expectedRevision: 6, expectedBaseline: { paragraph: false, scriptureRefs: [reference] } }));
    unmount();

    mockEngine.updateNote.mockReset().mockImplementationOnce(refused).mockImplementation(() => ({ ...accepted(), result: Promise.resolve({}) }) as never);
    const onClose = jest.fn();
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={onClose} paragraphChoice={{ initial: false }} />);
    await userEvent.click(screen.getByRole('button', { name: 'comment.kind.paragraph' }));
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await userEvent.click(await screen.findByRole('button', { name: 'freshness.conflictTakeTheirs' }));
    expect(screen.getByRole('button', { name: 'comment.kind.comment' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockEngine.updateNote).toHaveBeenCalledTimes(1);
  });

  const paragraphRange = { ...reference, fromVerse: 30, toVerse: 31 };
  it.each([
    ['legacy verse to range', reference, paragraphRange, null, true],
    ['legacy range to verse', paragraphRange, reference, null, false],
    ['explicit comment on a range', reference, paragraphRange, false, false],
    ['explicit paragraph on one verse', paragraphRange, reference, true, true],
  ] as const)('takes the accepted kind for %s without writing it back', async (_label, opening, acceptedPlace, paragraph, expected) => {
    mockEngine.notes = [{ ...stored, scriptureRefs: [opening] }];
    mockEngine.updateNote.mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6,
      { content: 'Accepted words.', type: 'comment', scriptureRefs: [acceptedPlace], paragraph })),
    persistence: Promise.resolve(), result: Promise.resolve({}) }) as never);
    const onClose = jest.fn();
    const inferFromReference = jest.fn((place: ScriptureReference) => (place.toVerse ?? 0) > (place.fromVerse ?? 0));
    const choice = { initial: opening === paragraphRange, inferFromReference };
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={onClose} paragraphChoice={choice} />);
    await userEvent.type(screen.getByLabelText('editor'), ' Local.');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await userEvent.click(await screen.findByRole('button', { name: 'freshness.conflictTakeTheirs' }));
    expect(screen.getByLabelText('editor')).toHaveValue('Accepted words.');
    expect(screen.getByRole('button', { name: expected ? 'comment.kind.paragraph' : 'comment.kind.comment' })).toHaveAttribute('aria-pressed', 'true');
    if (paragraph === null) expect(inferFromReference).toHaveBeenCalledWith(acceptedPlace);
    else expect(inferFromReference).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockEngine.updateNote).toHaveBeenCalledTimes(1);
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

  it('restores the chosen kind and words of a new comment after reload', async () => {
    const { unmount } = render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" onClose={jest.fn()} paragraphChoice={{ initial: false }} />);
    await userEvent.click(screen.getByRole('button', { name: 'comment.kind.paragraph' }));
    await userEvent.type(screen.getByLabelText('editor'), 'Ожидание');
    unmount();
    render(<CommentDialog target={{ kind: 'new', reference: { ...reference, id: 'again' } }} place="Ис 40:31" onClose={jest.fn()} paragraphChoice={{ initial: false }} />);
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'unsavedDraft.restore' }));
    expect(screen.getByLabelText('editor')).toHaveValue('Ожидание');
    expect(screen.getByRole('button', { name: 'comment.kind.paragraph' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockEngine.createNote).toHaveBeenCalledWith(expect.objectContaining({ content: 'Ожидание', paragraph: true }));
    await waitFor(() => expect(keptDrafts()).toEqual([]));
  });

  it.each([false, true])('recovers a kind-only change of a saved comment to paragraph=%s', async paragraph => {
    mockEngine.notes = [{ ...stored, paragraph: !paragraph }];
    const tree = () => <CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} paragraphChoice={{ initial: !paragraph }} />;
    const { unmount } = render(tree());
    const kindName = paragraph ? 'comment.kind.paragraph' : 'comment.kind.comment';
    await userEvent.click(screen.getByRole('button', { name: kindName }));
    unmount();
    expect(keptDrafts()).toEqual([expect.objectContaining({ text: stored.content, paragraph })]);
    render(tree());
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'unsavedDraft.restore' }));
    expect(screen.getByRole('button', { name: kindName })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockEngine.updateNote).toHaveBeenCalledWith(expect.objectContaining({ updates: { paragraph }, expectedBaseline: { paragraph: !paragraph, scriptureRefs: [reference] } }));
    await waitFor(() => expect(keptDrafts()).toEqual([]));
  });

  it('saves the restored reader kind from Studies and retires only the selected source', async () => {
    const source = draftKey('owner', 'c1', 'comment', 'reader-writer');
    const other = draftKey('owner', 'c1', 'comment', 'independent-writer');
    saveDraft(other, { text: 'Different local words.', reference: null, title: '', paragraph: false }, undefined, false, 10);
    saveDraft(source, { text: 'Reader draft words.', reference: null, title: '', paragraph: true }, undefined, false, 20);
    const onClose = jest.fn();
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={onClose} />);
    const offer = await screen.findByRole('status');
    expect(within(offer).getByText('Reader draft words.')).toBeInTheDocument();
    await userEvent.click(within(offer).getByRole('button', { name: 'unsavedDraft.restore' }));
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockEngine.updateNote).toHaveBeenCalledWith(expect.objectContaining({ updates: { content: 'Reader draft words.', paragraph: true } }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(localStorage.getItem(source)).toBeNull();
    expect(localStorage.getItem(other)).not.toBeNull();
  });

  it('preserves a later physical replacement of an adopted legacy comment draft', async () => {
    const key = draftKey('owner', 'new:rst:Isaiah:40:31', 'comment', 'legacy-writer');
    const source = { text: 'Legacy retained words.', reference, title: '' };
    saveDraft(key, source, undefined, false, 10);
    const close = jest.fn();
    render(<CommentDialog target={{ kind: 'new', reference }} place="Isa 40:31" onClose={close} paragraphChoice={{ initial: true }} />);
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'unsavedDraft.restore' }));
    saveDraft(key, source, undefined, false, 20);
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(mockEngine.createNote).toHaveBeenCalledWith(expect.objectContaining({ content: source.text, paragraph: true }));
    expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toMatchObject({ value: source, editedAt: 20 });
  });

  // Codex review r3, 2026-11-07: a copy kept before the kind existed, or by Studies, whose window has no switch, restored and
  // saved in the reader's window is retired — left behind, it was offered again later with words gone stale.
  it.each([true, false])('retires a copy kept without a kind once it is restored and saved in the reader\'s window: title present=%s', async (hasTitle) => {
    saveDraft(draftKey('owner', 'new:rst:Isaiah:40:31', 'comment'), { text: 'Legacy retained words.', reference, ...(hasTitle ? { title: '' } : {}) });
    const close = jest.fn();
    render(<CommentDialog target={{ kind: 'new', reference: { ...reference, id: 'fresh-door' } }} place="Isa 40:31" onClose={close} paragraphChoice={{ initial: false }} />);
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'unsavedDraft.restore' }));
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(mockEngine.createNote).toHaveBeenCalledWith(expect.objectContaining({ content: 'Legacy retained words.', paragraph: false }));
    expect(keptDrafts()).toEqual([]);
  });

  it('retires a written comment\'s copy left by Studies once the reader\'s window restores and saves it', async () => {
    const studies = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('editor'), ' Моё.');
    studies.unmount();
    const close = jest.fn();
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={close} paragraphChoice={{ initial: false }} />);
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'unsavedDraft.restore' }));
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(mockEngine.updateNote).toHaveBeenLastCalledWith(expect.objectContaining({ updates: { content: 'Сила приходит в ожидании. Моё.' } }));
    expect(keptDrafts()).toEqual([]);
  });

  // Words on the device equal to the comment's are no question. Compared with the words being typed, they turned into an
  // offer on the first keystroke and held the window (Codex review, 2026-10-29).
  it('takes words on the device equal to the comment as settled: typing opens no offer and keeps the editor', async () => {
    const first = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('editor'), ' Моё.');
    first.unmount();
    // The save landed; the device's copy was not yet retired.
    mockEngine.notes = [{ ...stored, content: 'Сила приходит в ожидании. Моё.' }];
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('editor'), ' Ещё.');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('editor')).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText('editor')).toHaveValue('Сила приходит в ожидании. Моё. Ещё.');
  });

  it('leaves no copy behind when words on the device equal to the comment are closed untouched', async () => {
    const first = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    await userEvent.type(screen.getByLabelText('editor'), ' Моё.');
    first.unmount();
    mockEngine.notes = [{ ...stored, content: 'Сила приходит в ожидании. Моё.' }];
    const again = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // Left behind, the copy would come back as an offer of old words once the comment changed elsewhere.
    again.unmount();
    expect(keptDrafts()).toEqual([]);
  });

  it.each([[false, true], [true, true], [false, false], [true, false]])('cleans a surviving copy with stored kind %s and title present %s', (paragraph, hasTitle) => {
    const source = draftKey('owner', 'c1', 'comment', 'previous-writer');
    mockEngine.notes = [{ ...stored, paragraph }];
    saveDraft(source, { text: stored.content, reference: null, ...(hasTitle ? { title: '' } : {}), paragraph });
    const { unmount } = render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(localStorage.getItem(source)).toBeNull();
    unmount();
  });

  it('translates a Studies placement refusal when the language changes and keeps the recovered draft', async () => {
    mockPlacementLanguage = 'en';
    const source = draftKey('owner', 'c1', 'comment', 'reader-writer');
    mockEngine.notes = [
      { ...stored, paragraph: false, scriptureRefs: [{ ...reference, fromVerse: 30, toVerse: 31 }] },
      { ...stored, id: 'other', content: 'Neighbouring paragraph', paragraph: true, scriptureRefs: [{ ...reference, id: 'other-ref', fromVerse: 29, toVerse: 30 }] },
    ];
    saveDraft(source, { text: 'Reader draft words.', reference: null, title: '', paragraph: true });
    const tree = () => <CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:30–31" onClose={jest.fn()} />;
    const { rerender } = render(tree());
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'unsavedDraft.restore' }));
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    const refusal = within(screen.getByRole('dialog')).getByRole('alert');
    expect(refusal).toHaveTextContent(/^Paragraphs never cross:.*«Neighbouring paragraph»$/);
    mockPlacementLanguage = 'ru';
    rerender(tree());
    expect(refusal).toHaveTextContent(/^Абзацы не пересекаются:.*«Neighbouring paragraph»$/);
    expect(screen.getByLabelText('editor')).toHaveValue('Reader draft words.');
    expect(mockEngine.updateNote).not.toHaveBeenCalled();
    expect(localStorage.getItem(source)).not.toBeNull();
  });

  it('checks the newly accepted place before keeping a restored paragraph after conflict in Studies', async () => {
    const source = draftKey('owner', 'c1', 'comment', 'reader-writer');
    mockEngine.notes = [
      { ...stored, paragraph: false, scriptureRefs: [{ ...reference, fromVerse: 27, toVerse: 28 }] },
      { ...stored, id: 'other', paragraph: true, scriptureRefs: [{ ...reference, id: 'other-ref', fromVerse: 29, toVerse: 30 }] },
    ];
    const moved = { ...reference, fromVerse: 30, toVerse: 31 };
    mockEngine.updateNote.mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6,
      { content: 'Server words.', type: 'comment', paragraph: false, scriptureRefs: [moved] })),
    persistence: Promise.resolve(), result: Promise.resolve({}) }) as never);
    saveDraft(source, { text: 'Reader draft words.', reference: null, title: '', paragraph: true });
    render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:27–28" onClose={jest.fn()} />);
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'unsavedDraft.restore' }));
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    await userEvent.click(await screen.findByRole('button', { name: 'freshness.conflictKeepMine' }));
    expect(mockEngine.updateNote).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(source)).not.toBeNull();
  });

  it('checks a newer visible place before saving a restored kind in Studies', async () => {
    const source = draftKey('owner', 'c1', 'comment', 'reader-writer');
    const initial = { ...stored, paragraph: false, scriptureRefs: [{ ...reference, fromVerse: 27, toVerse: 28 }] };
    const other = { ...stored, id: 'other', paragraph: true, scriptureRefs: [{ ...reference, id: 'other-ref', fromVerse: 29, toVerse: 30 }] };
    mockEngine.notes = [initial, other];
    saveDraft(source, { text: stored.content, reference: null, title: '', paragraph: true });
    const tree = () => <CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:27–28" onClose={jest.fn()} />;
    const { rerender } = render(tree());
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'unsavedDraft.restore' }));
    mockEngine.notes = [{ ...initial, rev: { note: 5 }, scriptureRefs: [{ ...reference, fromVerse: 30, toVerse: 31 }] }, other];
    rerender(tree());
    await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockEngine.updateNote).not.toHaveBeenCalled();
    expect(localStorage.getItem(source)).not.toBeNull();
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

    describe('an occurrence opened in another Bible', () => {
      const authored = { id: 'r', bible: 'kjv' as const, book: 'Romans', chapter: 16, fromVerse: 24, toVerse: 27 };
      const clicked = 'Rom 16:24';
      const clickedContext = 'Clicked Romans 16:24 in the reader.';
      const placeOf = (ref: { book: string; chapter?: number; fromVerse?: number }) => (
        ref.chapter === 16 && ref.fromVerse === 24 ? 'Rom 14:24–26, 16:24' : `${ref.book} ${ref.chapter}:${ref.fromVerse}`
      );
      const openComment = () => {
        mockInterpolateCommentTitle = true;
        mockEngine.notes = [{ ...stored, scriptureRefs: [authored] }];
        const close = jest.fn();
        render(<CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Rom 14:24–26" openingPlace={clicked} context={clickedContext} bible="rst" placeOf={placeOf} onClose={close} />);
        return close;
      };
      const heading = (place: string) => screen.getByRole('heading', { name: `Comment · ${place}` });

      it('names the clicked occurrence without writing its displayed place on Done', async () => {
        const close = openComment();
        expect(heading(clicked)).toBeInTheDocument();
        expect(screen.getByText(clickedContext)).toBeInTheDocument();
        expect(screen.getByLabelText('editor')).toHaveValue(stored.content);
        await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
        expect(close).toHaveBeenCalled();
        expect(mockEngine.updateNote).not.toHaveBeenCalled();
        expect(mockEngine.notes[0].scriptureRefs).toEqual([authored]);
      });

      it('names and writes an explicit move in the authored Bible, keeping the original range length', async () => {
        const close = openComment();
        await openPlaces();
        await userEvent.click(row('16:23'));
        expect(heading('Romans 16:23')).toBeInTheDocument();
        expect(screen.getByTestId('comment-moved')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
        expect(mockEngine.updateNote).toHaveBeenCalledWith({
          id: 'c1',
          updates: { scriptureRefs: [{ ...authored, fromVerse: 23, toVerse: 26 }] },
          expectedRevision: 4,
          expectedBaseline: { scriptureRefs: [authored] },
        });
        await waitFor(() => expect(close).toHaveBeenCalled());
      });

      it('returns to the clicked occurrence after Put Back without writing a move', async () => {
        const close = openComment();
        await openPlaces();
        await userEvent.click(row('16:23'));
        await userEvent.click(screen.getByRole('button', { name: 'comment.moveBack' }));
        expect(heading(clicked)).toBeInTheDocument();
        expect(screen.getByText(clickedContext)).toBeInTheDocument();
        expect(screen.queryByTestId('comment-moved')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
        expect(mockEngine.updateNote).not.toHaveBeenCalled();
        expect(mockEngine.notes[0].scriptureRefs).toEqual([authored]);
        expect(close).toHaveBeenCalled();
      });

      it('names the stored version explicitly taken after a refusal instead of the opening occurrence', async () => {
        const theirs = [{ id: 'theirs', bible: 'rst' as const, book: 'Romans', chapter: 8, fromVerse: 28 }];
        mockEngine.updateNote.mockImplementationOnce(() => ({ acceptance: Promise.reject(new StaleWriteError('note', 4, 6, { scriptureRefs: theirs })), persistence: Promise.resolve(), result: Promise.resolve({}) }) as never);
        openComment();
        await openPlaces();
        await userEvent.click(row('16:23'));
        await userEvent.click(screen.getByRole('button', { name: 'common.done' }));
        await userEvent.click(await screen.findByRole('button', { name: 'freshness.conflictTakeTheirs' }));
        expect(heading('Romans 8:28')).toBeInTheDocument();
        expect(screen.getByText('Romans 8:28')).toBeInTheDocument();
        expect(screen.queryByText(clickedContext)).not.toBeInTheDocument();
        expect(screen.queryByTestId('comment-moved')).not.toBeInTheDocument();
      });
    });

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

    it('recovers a scoped new-door draft at its moved place without changing the opening address', async () => {
      const openingDocumentId = 'new:rst:Isaiah:40:31';
      const movedReference = { ...reference, fromVerse: 30 };
      const sourceKey = draftKey('owner', openingDocumentId, 'comment', 'earlier-opening');
      saveDraft(sourceKey, { text: 'Kept before moving.', reference: movedReference, title: '' });

      render(<CommentDialog target={{ kind: 'new', reference }} place="Ис 40:31" bible="rst" onClose={jest.fn()} />);
      const offer = await screen.findByRole('status');
      await userEvent.click(within(offer).getByRole('button', { name: 'unsavedDraft.restore' }));

      expect(screen.getByTestId('comment-moved')).toBeInTheDocument();
      expect(screen.getByText('Isaiah 40:30')).toBeInTheDocument();
      expect(readDraftAddress(sourceKey)).toMatchObject({ documentId: openingDocumentId, writerId: 'earlier-opening' });
      expect(localStorage.getItem(sourceKey)).not.toBeNull();
      expect(localStorage.getItem(draftKey('owner', 'new:rst:Isaiah:40:30', 'comment', 'earlier-opening'))).toBeNull();
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
      // The place as chosen, named and quoted in the Bible the window shows (the owner, 2026-11-11); it is saved in the
      // comment's own, below.
      expect(screen.getByText('Psalms 51:10')).toBeInTheDocument();
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
      // It is handed the Bible the screen shows, to name it in.
      expect(placeOf).toHaveBeenCalledWith(expect.objectContaining({ bible: 'kjv', book: 'Romans', chapter: 16 }), 'rst');
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
