import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type React from 'react';

import { ReaderCommentDialog, useCommentDoors, useReaderCommenting } from '@/components/bible/ReaderCommentDialog';
import { passageCovers } from '@/utils/scriptureUsage';
import { passagesIn, type Passage } from '@/utils/scriptureReferenceNumbering';
import { verseWords, type BookText } from '@/utils/bibleText';

import type { StudyNote } from '@/models/models';
import type { BibleId } from '@/utils/bibles';
import type { MinePlace } from '@/components/bible/useBookUsage';

jest.mock('@/components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange, placeholder, editable = true }: { value: string; onChange: (value: string) => void; placeholder?: string; editable?: boolean }) => (
    <textarea aria-label="comment-editor" placeholder={placeholder} value={value} readOnly={!editable} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const mockEngine = {
  uid: 'qa-owner',
  notes: [] as StudyNote[],
  createNote: jest.fn(),
  updateNote: jest.fn(),
  deleteNote: jest.fn(),
};
jest.mock('@/hooks/useStudyNotesEngine', () => ({ useStudyNotesEngine: () => mockEngine }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/components/bible/useBookTexts', () => ({ useBookTexts: () => new Map() }));
jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), fetchBookText: jest.fn(() => new Promise(() => undefined)) }));
jest.mock('@/components/bible/search/BibleSearch', () => ({ BibleSearch: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock('@locales/useTranslation', () => {
  const actual = jest.requireActual('@locales/useTranslation');
  const english = require('../../../locales/en/translation.json');
  return {
    ...actual,
    useTranslation: () => {
      const result = actual.useTranslation();
      return {
        ...result,
        t: (key: string, options?: { place?: string }) => (key === 'comment.title'
          ? english.comment.title.replace('{{place}}', options?.place ?? '')
          : result.t(key, options)),
      };
    },
  };
});

const rstRomans = JSON.parse(readFileSync(join(__dirname, '../../../public/bible-text/rst/v1/romans.json'), 'utf8')) as BookText;
const kjvRomans = JSON.parse(readFileSync(join(__dirname, '../../../public/bible-text/kjv/v1/romans.json'), 'utf8')) as BookText;
const laterKjvReference = { id: 'romans-kjv-reference', bible: 'kjv' as const, book: 'Romans', chapter: 16, fromVerse: 24, toVerse: 27 };
const wholeChapterReference = { id: 'romans-whole-reference', bible: 'rst' as const, book: 'Romans', chapter: 14, toChapter: 14 };
const originalBody = 'QA223 retained comment words.';

const storedComment = (reference: typeof laterKjvReference | typeof wholeChapterReference): StudyNote => ({
  id: 'qa223-comment', userId: 'qa-owner', type: 'comment', content: originalBody, scriptureRefs: [reference], tags: [],
  createdAt: '', updatedAt: '', isDraft: false, rev: { note: 7 },
});

function ReaderDoorsHarness({ wholeChapter = false, canSwitchBible = false }: { wholeChapter?: boolean; canSwitchBible?: boolean }) {
  const [bible, setBible] = useState<BibleId>('rst');
  const bookId = 'Romans';
  const reference = wholeChapter ? wholeChapterReference : laterKjvReference;
  const projected = passagesIn(reference, bible);
  const { commenting, setCommenting } = useReaderCommenting(bookId, bible);
  const commentOn = (chapter: number, verse: number | null) => projected.some((passage) => (verse === null
    ? passage.fromVerse === undefined && passage.chapter <= chapter && chapter <= passage.toChapter
    : passage.chapter === chapter && passage.fromVerse === verse)) ? 'qa223-comment' : undefined;
  const commentPassage = (id: string, at: MinePlace): Passage | undefined => (id === 'qa223-comment'
    ? projected.find((passage) => (at.verse === null
      ? passage.fromVerse === undefined && passage.chapter <= at.chapter && at.chapter <= passage.toChapter
      : passageCovers(passage, at.chapter, at.verse)))
    : undefined);
  const doors = useCommentDoors({ ready: true, commentOn, commentPassage, setCommenting, bookId, bible });
  const text = bible === 'rst' ? rstRomans : kjvRomans;
  const passageOf = (id: string) => id === 'qa223-comment' ? projected[0] : undefined;

  return (
    <>
      {wholeChapter
        ? <button type="button" onClick={() => doors.chapter?.open(14)}>Open chapter comment</button>
        : <button type="button" onClick={() => doors.verse?.open({ chapter: 16, verse: 24 })}>Open verse comment</button>}
      {canSwitchBible ? <button type="button" onClick={() => setBible('kjv')}>Switch reader Bible</button> : null}
      <ReaderCommentDialog commenting={commenting} text={text} bookId={bookId} bible={bible} locale="en" passageOf={passageOf} onClose={() => setCommenting(null)} />
    </>
  );
}

beforeEach(() => {
  mockEngine.notes = [storedComment(laterKjvReference)];
  mockEngine.createNote.mockReset();
  mockEngine.updateNote.mockReset();
  mockEngine.deleteNote.mockReset();
  window.localStorage.clear();
});

describe('reader comment doors preserve the selected displayed passage', () => {
  it('opens an existing multi-piece comment at its later RST verse-menu occurrence', async () => {
    const user = userEvent.setup();
    render(<ReaderDoorsHarness />);
    await user.click(screen.getByRole('button', { name: 'Open verse comment' }));

    const dialog = await screen.findByRole('dialog', { name: 'Comment · Rom 16:24' });
    expect(screen.getByLabelText('comment-editor')).toHaveValue(originalBody);
    expect(dialog).toHaveTextContent(verseWords(rstRomans.chapters[15][23]));
    await user.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockEngine.createNote).not.toHaveBeenCalled();
    expect(mockEngine.updateNote).not.toHaveBeenCalled();
  });

  it('opens an existing whole-chapter comment from the chapter door with that chapter context', async () => {
    mockEngine.notes = [storedComment(wholeChapterReference)];
    const user = userEvent.setup();
    render(<ReaderDoorsHarness wholeChapter />);
    await user.click(screen.getByRole('button', { name: 'Open chapter comment' }));

    const dialog = await screen.findByRole('dialog', { name: 'Comment · Rom 14' });
    expect(screen.getByLabelText('comment-editor')).toHaveValue(originalBody);
    expect(dialog).toHaveTextContent('comment.wholeChapter');
    await user.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockEngine.createNote).not.toHaveBeenCalled();
    expect(mockEngine.updateNote).not.toHaveBeenCalled();
  });

  it('ignores a reader opening place after the active Bible scope changes', async () => {
    const user = userEvent.setup();
    render(<ReaderDoorsHarness canSwitchBible />);
    await user.click(screen.getByRole('button', { name: 'Open verse comment' }));
    await screen.findByRole('dialog', { name: 'Comment · Rom 16:24' });
    await user.click(screen.getByRole('button', { name: 'Switch reader Bible' }));

    const dialog = await screen.findByRole('dialog', { name: 'Comment · Rom 16:24–27' });
    expect(screen.getByLabelText('comment-editor')).toHaveValue(originalBody);
    expect(dialog).toHaveTextContent(verseWords(kjvRomans.chapters[15][23]));
    expect(dialog).not.toHaveTextContent(verseWords(rstRomans.chapters[15][23]));
    await user.click(screen.getByRole('button', { name: 'common.done' }));
    expect(mockEngine.createNote).not.toHaveBeenCalled();
    expect(mockEngine.updateNote).not.toHaveBeenCalled();
  });
});
