import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import SourceNoteSection, { atomsOwnedByNotes } from '@/components/sermon/SourceNoteSection';
import { useSourceNotes } from '@/hooks/useSermonNoteLinks';

import type { ScratchNote, Sermon, StudyNote } from '@/models/models';

/**
 * THE NOTE AND THE ATOMS CUT FROM IT ARE ONE STREAM, AND THAT IS WHAT IS ASSERTED HERE.
 *
 * The screen this replaced kept them apart — thoughts on top, note below — and at twenty-eight
 * thoughts the note left the screen entirely. What holds the fix together is not the order of
 * two blocks but the fact that an atom stands under the heading it was cut from, so the tests
 * below are about placement: an atom with a heading belongs to that section, an atom whose
 * heading no longer exists opens the note instead of vanishing, and an atom with no note behind
 * it is not claimed here at all.
 *
 * The collapsed-by-default bar is asserted too, because it is the half that keeps the note
 * cheap when the thoughts are many: fold it and the whole note costs one row.
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
      options && 'count' in options ? `${key}:${options.count as number}` : key,
    i18n: { language: 'ru' },
  }),
}));

jest.mock('@/hooks/useSermonNoteLinks', () => ({ useSourceNotes: jest.fn() }));

const mockUseSourceNotes = useSourceNotes as jest.MockedFunction<typeof useSourceNotes>;

const NOTE_BODY = [
  '# Девять глав одних имён',
  '',
  'Первые девять глав даются труднее всего.',
  '',
  '# Единственная молитва среди переписи',
  '',
  'Иавис стоит в четвёртой главе.',
].join('\n');

const aNote = (overrides: Partial<StudyNote> = {}): StudyNote =>
  ({
    id: 'n1',
    userId: 'u1',
    title: 'Молитва Иависа',
    content: NOTE_BODY,
    scriptureRefs: [],
    tags: [],
    isDraft: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }) as StudyNote;

const anAtom = (id: string, text: string, heading: string, noteId = 'n1'): ScratchNote => ({
  id,
  text,
  createdAt: '2026-09-02T00:00:00.000Z',
  source: { noteId, heading },
});

const sermon = { id: 's1', sourceNoteIds: ['n1'] } as Sermon;

const linkNotes = (notes: StudyNote[]) =>
  mockUseSourceNotes.mockReturnValue({ notes, missingIds: [], loading: false });

beforeEach(() => jest.clearAllMocks());

describe('the atoms stand inside the note', () => {
  it('puts an atom under the heading it was cut from, not in a list of its own', () => {
    linkNotes([aNote()]);
    render(
      <SourceNoteSection
        sermon={sermon}
        scratchNotes={[anAtom('a1', 'Иавис отличился молитвой', 'Единственная молитва среди переписи')]}
      />
    );

    // Sections arrive folded, so the atom is not on screen until its own heading is opened —
    // which is the point: the note greets the reader as a table of contents.
    expect(screen.queryByText('Иавис отличился молитвой')).not.toBeInTheDocument();

    // The heading arrives as raw markdown here — `MarkdownDisplay` does not transform in jsdom —
    // so it is matched by substring rather than by an exact string.
    fireEvent.click(screen.getByText(/Единственная молитва среди переписи/));

    const atoms = screen.getByTestId('section-atoms');
    expect(atoms).toHaveTextContent('Иавис отличился молитвой');
  });

  it('counts the atoms of a section beside its heading while it is still folded', () => {
    linkNotes([aNote()]);
    render(
      <SourceNoteSection
        sermon={sermon}
        scratchNotes={[
          anAtom('a1', 'первый', 'Девять глав одних имён'),
          anAtom('a2', 'второй', 'Девять глав одних имён'),
        ]}
      />
    );

    expect(screen.getByText('sermon.sourceNoteSection.cutBadge:2')).toBeInTheDocument();
  });

  it('opens the note with an atom whose heading the note no longer has', () => {
    linkNotes([aNote()]);
    render(
      <SourceNoteSection
        sermon={sermon}
        scratchNotes={[anAtom('a1', 'Вырезано до первого заголовка', '')]}
      />
    );

    // Visible without opening anything: it stands above the note's own first words.
    expect(screen.getByTestId('loose-atoms')).toHaveTextContent('Вырезано до первого заголовка');
  });
});

describe('the bar is all it costs when folded', () => {
  it('shows the note name and no body when it arrives closed', () => {
    linkNotes([aNote()]);
    render(<SourceNoteSection sermon={sermon} defaultOpen={false} scratchNotes={[]} />);

    expect(screen.getByText('Молитва Иависа')).toBeInTheDocument();
    expect(screen.getByTestId('source-note-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Девять глав одних имён/)).not.toBeInTheDocument();
  });

  it('opens on the bar and keeps the door to the note itself', () => {
    linkNotes([aNote()]);
    render(<SourceNoteSection sermon={sermon} defaultOpen={false} scratchNotes={[]} />);

    fireEvent.click(screen.getByTestId('source-note-toggle'));

    expect(screen.getByText(/Девять глав одних имён/)).toBeInTheDocument();
    expect(screen.getByTestId('source-note-open')).toHaveAttribute('href', '/studies/n1');
  });
});

describe('nothing is invented for a sermon with no note', () => {
  it('renders nothing at all when no note is linked', () => {
    linkNotes([]);
    const { container } = render(<SourceNoteSection sermon={{ id: 's1' } as Sermon} scratchNotes={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('atomsOwnedByNotes — the link decides, not the heading', () => {
  it('claims an atom whose remembered heading was renamed away', () => {
    const owned = atomsOwnedByNotes([aNote()], [anAtom('a1', 'текст', 'Заголовка больше нет')]);

    expect(owned.has('a1')).toBe(true);
  });

  it('leaves an atom that names no note to whoever else shows it', () => {
    const loose: ScratchNote = { id: 'a2', text: 'записано голосом', createdAt: '2026-09-02T00:00:00.000Z' };
    const owned = atomsOwnedByNotes([aNote()], [loose]);

    expect(owned.has('a2')).toBe(false);
  });

  it('leaves an atom cut from a note this sermon is not built on', () => {
    const owned = atomsOwnedByNotes([aNote()], [anAtom('a3', 'чужое', 'Девять глав одних имён', 'other-note')]);

    expect(owned.has('a3')).toBe(false);
  });
});
