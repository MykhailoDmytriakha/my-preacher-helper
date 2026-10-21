// Runs against the REAL react-markdown: a reference in a note's text must become a link on the list.
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { fireEvent, render, screen } from '@testing-library/react';

import MarkdownDisplay from '@/components/MarkdownDisplay';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useTags } from '@/hooks/useTags';

import StudiesPage from '../page';

import type { StudyNote } from '@/models/models';

// The card draws the note's text as the real card does, through MarkdownDisplay.
jest.mock('../StudyNoteCard', () => ({
  __esModule: true,
  default: ({ note }: { note: { content: string } }) => <MarkdownDisplay content={note.content} />,
}));

const mockRouter = { push: jest.fn(), refresh: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/studies',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('nuqs', () => {
  const React = require('react');
  return { useQueryState: (_key: string, options?: { defaultValue?: string }) => React.useState(options?.defaultValue ?? '') };
});

jest.mock('@/hooks/useStudyNotes', () => ({ useStudyNotes: jest.fn() }));
jest.mock('@/hooks/useStudyNoteShareLinks', () => ({ useStudyNoteShareLinks: jest.fn() }));
jest.mock('@/hooks/useTags', () => ({ useTags: jest.fn() }));

const note = (content: string, title = 'Пастырь'): StudyNote => ({
  id: 'note-1', userId: 'mock-user', title, content, scriptureRefs: [], tags: [],
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', isDraft: false, type: 'note',
});

/*
 * A reference in a note's text is a link on the list of notes, and it opens the Bible where the note
 * meant, with the way back to the notes (the owner, 2026-10-20, case 2026-10-12-block-diagram, 2.2.2).
 */
describe('StudiesPage — references in notes', () => {
  beforeEach(() => {
    mockRouter.push.mockClear();
    (useStudyNotes as jest.Mock).mockReturnValue({
      uid: 'mock-user', notes: [note('Господь — Пастырь мой (Пс 22:1): я ни в чём не буду нуждаться.')], loading: false, error: null,
      refetch: jest.fn(), createNote: jest.fn(), updating: false, updateNote: jest.fn(), deleteNote: jest.fn(),
    });
    (useStudyNoteShareLinks as jest.Mock).mockReturnValue({
      uid: 'mock-user', shareLinks: [], loading: false, error: null, refetch: jest.fn(), createShareLink: jest.fn(), deleteShareLink: jest.fn(),
    });
    (useTags as jest.Mock).mockReturnValue({
      tags: { requiredTags: [], customTags: [] }, requiredTags: [], customTags: [], allTags: [],
      loading: false, error: null, refreshTags: jest.fn(), addCustomTag: jest.fn(), removeCustomTag: jest.fn(), updateTag: jest.fn(),
    });
  });

  it('draws a reference in a note as a link that opens the Synodal psalm the note meant, and comes back to the notes', () => {
    render(<StudiesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Пс 22:1' }));
    const href = mockRouter.push.mock.calls[0]?.[0] as string;
    const query = new URL(href, 'https://app.test').searchParams;
    expect(query.get('book')).toBe('psalms');
    expect(query.get('at')).toBe('22:1');
    expect(query.get('tr')).toBe('rst');
    expect(query.get('from')).toBe('/studies');
  });
});

describe('StudiesPage — a note\'s title says its language', () => {
  it('opens "1Цар 3:5" of a note titled in Ukrainian as 1 Kings in Ohienko', () => {
    (useStudyNotes as jest.Mock).mockReturnValue({
      uid: 'mock-user', notes: [note('1Цар 3:5', 'Мій Господь')], loading: false, error: null,
      refetch: jest.fn(), createNote: jest.fn(), updating: false, updateNote: jest.fn(), deleteNote: jest.fn(),
    });
    (useStudyNoteShareLinks as jest.Mock).mockReturnValue({
      uid: 'mock-user', shareLinks: [], loading: false, error: null, refetch: jest.fn(), createShareLink: jest.fn(), deleteShareLink: jest.fn(),
    });
    (useTags as jest.Mock).mockReturnValue({
      tags: { requiredTags: [], customTags: [] }, requiredTags: [], customTags: [], allTags: [],
      loading: false, error: null, refreshTags: jest.fn(), addCustomTag: jest.fn(), removeCustomTag: jest.fn(), updateTag: jest.fn(),
    });
    mockRouter.push.mockClear();
    render(<StudiesPage />);
    fireEvent.click(screen.getByRole('button', { name: '1Цар 3:5' }));
    const query = new URL(mockRouter.push.mock.calls[0]?.[0] as string, 'https://app.test').searchParams;
    expect(query.get('book')).toBe('1-kings');
    expect(query.get('tr')).toBe('ubio');
  });
});
