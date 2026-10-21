// Runs against the REAL react-markdown: a reference in the note's text must become a link on the note's page.
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { fireEvent, render, screen } from '@testing-library/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useTags } from '@/hooks/useTags';

import StudyNoteEditorPage from '../page';

import type { StudyNote } from '@/models/models';

jest.mock('next/navigation', () => ({ useRouter: jest.fn(), useParams: jest.fn(), useSearchParams: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }) }));
jest.mock('@/hooks/useDocumentFreshness', () => ({
  useDocumentFreshness: () => ({ state: 'fresh', remote: null, remotelyDeleted: false, markSynced: jest.fn() }),
}));
jest.mock('@/hooks/useWideViewport', () => ({ useWideViewport: () => true, useRoomyHeader: () => true }));
jest.mock('@/hooks/useStudyNotes');
jest.mock('@/hooks/useTags');
jest.mock('@/hooks/useStudyNoteShareLinks');
jest.mock('@/hooks/useSermonNoteLinks', () => ({ useSermonsBuiltOnNote: () => ({ sermons: [] }) }));
jest.mock('@/services/firebaseAuth.service', () => ({ auth: { currentUser: { getIdToken: jest.fn().mockResolvedValue('token') } } }));
jest.mock('../../components/SermonsBuiltOnNote', () => ({ __esModule: true, default: () => null }));
// The window itself has its own tests; here it says which passage the page asked it for.
jest.mock('@/components/bible/ScripturePreviewSheet', () => ({
  ScripturePreviewSheet: ({ reference }: { reference: { bible?: string; book: string; chapter?: number; fromVerse?: number; label?: string } }) => (
    <div role="dialog" aria-label={reference.label}>{`${reference.bible} ${reference.book} ${reference.chapter}:${reference.fromVerse}`}</div>
  ),
}));

const note = (title: string, content: string): StudyNote => ({
  id: 'note-1', userId: 'user-1', title, content, tags: [], scriptureRefs: [], type: 'note', isDraft: false,
  createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z',
});

const open = (notes: StudyNote[]) => {
  (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), replace: jest.fn(), back: jest.fn() });
  (useParams as jest.Mock).mockReturnValue({ id: 'note-1' });
  (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
  (useStudyNotes as jest.Mock).mockReturnValue({ uid: 'user-1', notes, loading: false, createNote: jest.fn(), updateNote: jest.fn(), deleteNote: jest.fn() });
  (useTags as jest.Mock).mockReturnValue({ tags: { requiredTags: [], customTags: [] } });
  (useStudyNoteShareLinks as jest.Mock).mockReturnValue({ shareLinks: [], loading: false, deleteShareLink: jest.fn() });
  render(<StudyNoteEditorPage />);
};

/*
 * The owner, 2026-10-21: on a note's own page its references were words. Pressed, a reference in the
 * text opens the window the note's reference chips open — the passage, and the notes on it.
 */
describe('a note\'s page — references in its text', () => {
  it('opens a reference pressed in the text in the note\'s verse window', () => {
    open([note('Войди в покой', 'Христос говорит: «не выходите…» (Мф 24:26). И там другой призыв (Лк 17:30).')]);
    fireEvent.click(screen.getByRole('button', { name: 'Мф 24:26' }));
    expect(screen.getByRole('dialog', { name: 'Мф 24:26' })).toHaveTextContent('rst Matthew 24:26');
  });

  it('reads "1Цар 3:5" of a note titled in Ukrainian as 1 Kings in Ohienko', () => {
    open([note('Мій Господь з’явився уві сні', '1Цар 3:5')]);
    fireEvent.click(screen.getByRole('button', { name: '1Цар 3:5' }));
    expect(screen.getByRole('dialog', { name: '1Цар 3:5' })).toHaveTextContent('ubio 1 Kings 3:5');
  });
});
