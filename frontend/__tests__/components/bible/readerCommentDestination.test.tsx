import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { toast } from 'sonner';
import '@testing-library/jest-dom';

import { ReaderCommentDialog } from '@/components/bible/ReaderCommentDialog';
import { layParagraphs } from '@/components/bible/commentParagraphs';
import { useVerseCopy } from '@/components/bible/verseCopy/useVerseCopy';
import { passagesIn } from '@/utils/scriptureReferenceNumbering';

import type { BookText } from '@/utils/bibleText';
import type { ScriptureReference, StudyNote } from '@/models/models';
import type { BibleId } from '@/utils/bibles';

jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ language: 'en',
  t: (key: string, options?: { title?: string }) => options?.title ? key + ': ' + options.title : key,
}) }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange }: { value: string; onChange(value: string): void }) =>
    <textarea aria-label="comment-editor" value={value} onChange={event => onChange(event.target.value)} />,
}));
const mockEngine = { uid: 'owner', notes: [] as StudyNote[], createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() };
jest.mock('@/hooks/useStudyNotesEngine', () => ({ useStudyNotesEngine: () => mockEngine }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
let mockTarget = { book: 'Romans', chapter: 1, verse: 7 };
jest.mock('@/components/bible/BiblePicker', () => ({
  BookNavigator: ({ onOpen }: { onOpen(book: string, place: { chapter: number; verse: number }): void }) =>
    <button type="button" onClick={() => onOpen(mockTarget.book, mockTarget)}>Choose target place</button>,
}));
const mockTexts = new Map<string, BookText>();
jest.mock('@/components/bible/useBookTexts', () => ({ useBookTexts: () => mockTexts }));

const ruth = JSON.parse(readFileSync(join(__dirname, '../../../public/bible-text/kjv/v1/ruth.json'), 'utf8')) as BookText;
const romans = JSON.parse(readFileSync(join(__dirname, '../../../public/bible-text/kjv/v1/romans.json'), 'utf8')) as BookText;
const originalWords = 'My preserved comment words';
const reference = (book: string, chapter: number, fromVerse: number, toVerse?: number, bible: BibleId = 'kjv'): ScriptureReference =>
  ({ id: 'reference', bible, book, chapter, fromVerse, ...(toVerse === undefined ? {} : { toVerse }) });
type Props = { existing?: ScriptureReference[]; source?: ScriptureReference; owner?: string; ready?: boolean; readerBible?: BibleId };
function Window({ existing = [reference('Romans', 1, 5, 8)], source = reference('Ruth', 1, 1, 3), owner = 'other', ready = true, readerBible = 'kjv' }: Props) {
  const textRef = useRef<HTMLDivElement>(null);
  const copy = useVerseCopy({ textRef, text: ruth, bookId: 'Ruth', bible: readerBible, enabled: true });
  const layout = (book: string) => {
    const laid = layParagraphs(existing.filter(ref => ref.book === book).flatMap((ref, index) =>
      passagesIn(ref, readerBible).map((passage, piece) => ({ id: `target-${index}-${piece}`, owner, passage })))).laid;
    return { laid, bodyOf: () => book === 'Ruth' ? originalWords : 'Target paragraph words' };
  };
  // Keep legacy current-book inputs so these same behavior tests also run on the parent revision.
  const paragraphs = { laid: layout('Ruth').laid, bodyOf: () => originalWords,
    paragraphsForBook: (book: string) => ready ? layout(book) : null };
  return <ReaderCommentDialog commenting={{ kind: 'edit', id: 'moving' }} setCommenting={jest.fn()} text={ruth}
    bookId="Ruth" bible={readerBible} locale="en" passageOf={() => passagesIn(source, readerBible)[0]}
    onClose={jest.fn()} copy={copy} wide {...paragraphs} />;
}
async function moveAndSave() {
  fireEvent.click(screen.getByRole('button', { name: 'comment.move' }));
  fireEvent.click(screen.getByRole('button', { name: 'comment.moveElsewhere' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose target place' }));
  fireEvent.click(screen.getByRole('button', { name: 'common.done' }));
  await Promise.resolve();
}
beforeEach(() => {
  window.localStorage.clear(); jest.clearAllMocks();
  mockTarget = { book: 'Romans', chapter: 1, verse: 7 };
  mockTexts.clear(); mockTexts.set('Ruth', ruth); mockTexts.set('Romans', romans);
  mockEngine.notes = [{ id: 'moving', userId: 'owner', type: 'comment', content: originalWords,
    scriptureRefs: [reference('Ruth', 1, 1, 3)], tags: [], createdAt: '', updatedAt: '', isDraft: false, rev: { note: 4 } }];
  mockEngine.updateNote.mockReturnValue({ acceptance: Promise.resolve(), persistence: Promise.resolve(), result: Promise.resolve({}) });
});

it('refuses a moved paragraph crossing a paragraph in the destination book and retains its words', async () => {
  render(<Window />); await moveAndSave();
  expect(toast.error).toHaveBeenCalledWith('comment.pick.cross: Target paragraph words');
  expect(mockEngine.updateNote).not.toHaveBeenCalled();
  expect(screen.getByLabelText('comment-editor')).toHaveValue(originalWords);
});
it('refuses a third paragraph level in another book', async () => {
  mockTarget.verse = 8;
  render(<Window existing={[reference('Romans', 1, 5, 14), reference('Romans', 1, 7, 12)]} />); await moveAndSave();
  expect(toast.error).toHaveBeenCalledWith('comment.pick.deep');
  expect(mockEngine.updateNote).not.toHaveBeenCalled();
});
it('checks the destination pieces in the reader Bible while preserving the authored Bible', async () => {
  mockTarget = { book: 'Romans', chapter: 16, verse: 24 };
  const source = reference('Ruth', 1, 1, 4);
  mockEngine.notes[0].scriptureRefs = [source];
  render(<Window source={source} readerBible="rst" existing={[reference('Romans', 14, 23, 25, 'rst')]} />); await moveAndSave();
  expect(toast.error).toHaveBeenCalledWith('comment.pick.cross: Target paragraph words');
  expect(mockEngine.updateNote).not.toHaveBeenCalled();
  expect(mockEngine.notes[0].scriptureRefs).toEqual([source]);
});
it('waits for a known comment collection before deciding that a destination paragraph is free', async () => {
  render(<Window ready={false} />); await moveAndSave();
  expect(toast.error).toHaveBeenCalledWith('comment.pick.unavailable');
  expect(mockEngine.updateNote).not.toHaveBeenCalled();
});
it('keeps the existing same-book rule', async () => {
  mockTarget = { book: 'Ruth', chapter: 1, verse: 7 };
  render(<Window existing={[reference('Ruth', 1, 5, 8)]} />); await moveAndSave();
  expect(toast.error).toHaveBeenCalledWith('comment.pick.cross: My preserved comment words');
  expect(mockEngine.updateNote).not.toHaveBeenCalled();
});
it('allows a noncrossing paragraph in another book', async () => {
  mockTarget.verse = 10;
  render(<Window />); await moveAndSave();
  await waitFor(() => expect(mockEngine.updateNote).toHaveBeenCalledTimes(1));
  expect(toast.error).not.toHaveBeenCalled();
});
it('excludes every destination piece owned by the comment being moved', async () => {
  render(<Window owner="moving" />); await moveAndSave();
  await waitFor(() => expect(mockEngine.updateNote).toHaveBeenCalledTimes(1));
  expect(toast.error).not.toHaveBeenCalled();
});
it('allows a single verse even when the paragraph collection is not ready', async () => {
  const source = reference('Ruth', 1, 1);
  mockEngine.notes[0].scriptureRefs = [source];
  render(<Window source={source} ready={false} />); await moveAndSave();
  await waitFor(() => expect(mockEngine.updateNote).toHaveBeenCalledTimes(1));
  expect(toast.error).not.toHaveBeenCalled();
});
