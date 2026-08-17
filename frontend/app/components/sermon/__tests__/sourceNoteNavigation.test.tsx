import { render, screen } from '@testing-library/react';
import React from 'react';

import SermonsBuiltOnNote from '@/(pages)/(private)/studies/components/SermonsBuiltOnNote';
import SourceNoteChips from '@/components/sermon/SourceNoteChips';
import { useSermonsBuiltOnNote, useSourceNotes } from '@/hooks/useSermonNoteLinks';

import type { Sermon, StudyNote } from '@/models/models';

/**
 * THE WHOLE POINT IS THE ROUND TRIP: press the note on the sermon and you are in the note;
 * press the sermon on the note and you are in the sermon. These assertions are about the two
 * destinations, because a chip that renders but goes nowhere would still look finished.
 *
 * They also hold down the quiet half of the design: with nothing linked, neither side draws a
 * heading, a placeholder or an empty list.
 */
jest.mock('next/link', () => {
  const MockLink = ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
  MockLink.displayName = 'MockLink';
  return MockLink;
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.title ? `${key}:${options.title as string}` : key,
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/hooks/useSermonNoteLinks', () => ({
  useSourceNotes: jest.fn(),
  useSermonsBuiltOnNote: jest.fn(),
}));

const mockUseSourceNotes = useSourceNotes as jest.MockedFunction<typeof useSourceNotes>;
const mockUseSermonsBuiltOnNote = useSermonsBuiltOnNote as jest.MockedFunction<
  typeof useSermonsBuiltOnNote
>;

const aNote = (id: string, title?: string): StudyNote =>
  ({ id, title, userId: 'u1', content: '', scriptureRefs: [], tags: [], isDraft: false,
     createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }) as StudyNote;

const aSermon = (id: string, title: string): Sermon =>
  ({ id, title, verse: '', date: '2026-08-10T00:00:00.000Z', thoughts: [], userId: 'u1' }) as Sermon;

const sermonWithLinks = { id: 's1', sourceNoteIds: ['n1'] } as Sermon;

beforeEach(() => jest.clearAllMocks());

describe('sermon → note', () => {
  it('the chip opens the note it names', () => {
    mockUseSourceNotes.mockReturnValue({
      notes: [aNote('n1', 'Wine and wineskins')],
      missingIds: [],
      loading: false,
    });

    render(<SourceNoteChips sermon={sermonWithLinks} />);

    const chip = screen.getByTestId('source-note-chip');
    expect(chip).toHaveAttribute('href', '/studies/n1');
    expect(chip).toHaveTextContent('Wine and wineskins');
  });

  it('falls back to the untitled label rather than an empty chip', () => {
    mockUseSourceNotes.mockReturnValue({ notes: [aNote('n1')], missingIds: [], loading: false });

    render(<SourceNoteChips sermon={sermonWithLinks} />);

    expect(screen.getByTestId('source-note-chip')).toHaveTextContent('studiesWorkspace.untitled');
  });

  it('draws nothing when the sermon has no source note', () => {
    mockUseSourceNotes.mockReturnValue({ notes: [], missingIds: [], loading: false });

    const { container } = render(<SourceNoteChips sermon={{ id: 's1' } as Sermon} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('note → sermon', () => {
  it('lists every sermon built on the note, each one a way in', () => {
    mockUseSermonsBuiltOnNote.mockReturnValue({
      sermons: [aSermon('s1', 'New wine'), aSermon('s2', 'The sixth jar')],
      loading: false,
    });

    render(<SermonsBuiltOnNote noteId="n1" />);

    const links = screen.getAllByTestId('built-sermon-link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/sermons/s1', '/sermons/s2']);
    expect(links[0]).toHaveTextContent('New wine');
  });

  it('draws nothing while no sermon points at the note', () => {
    mockUseSermonsBuiltOnNote.mockReturnValue({ sermons: [], loading: false });

    const { container } = render(<SermonsBuiltOnNote noteId="n1" />);

    expect(container).toBeEmptyDOMElement();
  });
});

it('says "based on" once, not on every chip, and still names each note for a screen reader', () => {
  mockUseSourceNotes.mockReturnValue({
    notes: [aNote('n1', 'Wine and wineskins'), aNote('n2', 'Job and the mediator')],
    missingIds: [],
    loading: false,
  });

  render(<SourceNoteChips sermon={{ id: 's1', sourceNoteIds: ['n1', 'n2'] } as Sermon} />);

  const chips = screen.getAllByTestId('source-note-chip');
  expect(chips).toHaveLength(2);
  expect(screen.getAllByText('sermon.sourceNotes.label')).toHaveLength(1);
  // The row reads once; assistive tech has no row to look along, so both keep the full name.
  chips.forEach((chip) => expect(chip).toHaveAttribute('aria-label', expect.stringContaining('sermon.sourceNotes.openNote')));
  expect(chips[1]).toHaveTextContent('Job and the mediator');
});
