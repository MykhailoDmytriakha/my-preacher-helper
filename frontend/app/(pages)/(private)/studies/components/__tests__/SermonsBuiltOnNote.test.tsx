import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { useSermonsBuiltOnNote } from '@/hooks/useSermonNoteLinks';

import SermonsBuiltOnNote from '../SermonsBuiltOnNote';

import type { Sermon } from '@/models/models';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ru' },
  }),
}));

jest.mock('@/hooks/useSermonNoteLinks', () => ({
  useSermonsBuiltOnNote: jest.fn(),
}));

// The dialog has its own suite; here it only has to receive what the note knows about itself.
jest.mock('../CreateSermonFromNoteModal', () => ({
  __esModule: true,
  default: (props: { noteId: string; noteTitle: string; noteContent: string; scriptureRefs: unknown[]; onClose: () => void }) => (
    <div data-testid="create-modal-stub">
      <span data-testid="stub-props">{`${props.noteId}|${props.noteTitle}|${props.noteContent}|${props.scriptureRefs.length}`}</span>
      <button type="button" onClick={props.onClose}>
        close
      </button>
    </div>
  ),
}));

const mockUseSermonsBuiltOnNote = useSermonsBuiltOnNote as jest.MockedFunction<typeof useSermonsBuiltOnNote>;

const aSermon = (id: string, title: string, verse = ''): Sermon =>
  ({ id, title, verse, date: '2026-08-10T00:00:00.000Z', thoughts: [], userId: 'u1' }) as Sermon;

describe('SermonsBuiltOnNote — the door from a note to a sermon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSermonsBuiltOnNote.mockReturnValue({ sermons: [], loading: false });
  });

  it('renders nothing for an unsaved note: there is nothing on the server to cut', () => {
    const { container } = render(<SermonsBuiltOnNote noteId={undefined} noteTitle="Draft" noteContent="черновик" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reads the same on every saved note: heading, an honest empty line, and the door', () => {
    render(<SermonsBuiltOnNote noteId="n1" noteTitle="Иавис" noteContent="Иавис воззвал к Богу." />);
    expect(screen.getByText('studiesWorkspace.builtSermons.title')).toBeInTheDocument();
    expect(screen.getByTestId('built-sermons-empty')).toHaveTextContent('studiesWorkspace.builtSermons.empty');
    expect(screen.getByTestId('create-sermon-from-note')).toBeInTheDocument();
  });

  it('lists the sermons, hides the empty line, and keeps the door under the list', () => {
    mockUseSermonsBuiltOnNote.mockReturnValue({ sermons: [aSermon('s1', 'One'), aSermon('s2', 'Two')], loading: false });
    render(<SermonsBuiltOnNote noteId="n1" noteTitle="Иавис" noteContent="Иавис воззвал к Богу." />);
    expect(screen.getByText('studiesWorkspace.builtSermons.title')).toBeInTheDocument();
    expect(screen.getAllByTestId('built-sermon-link')).toHaveLength(2);
    expect(screen.queryByTestId('built-sermons-empty')).toBeNull();
    expect(screen.getByTestId('create-sermon-from-note')).toBeInTheDocument();
  });

  it('gives the name the whole row, so two sermons from one note are told apart', () => {
    // The names of sermons grown out of one note open with the same words. On one line beside
    // a date the column left 142px for the name and cut it at seventeen characters, which drew
    // two DIFFERENT sermons as two identical rows.
    mockUseSermonsBuiltOnNote.mockReturnValue({
      sermons: [
        aSermon('s1', 'Молитва Иависа: не своё умение, а рука Господня', '1 Пар 4:10'),
        aSermon('s2', 'Молитва Иависа: рука Господня над делом рук наших', '1 Пар 4:9-10'),
      ],
      loading: false,
    });
    render(<SermonsBuiltOnNote noteId="n1" noteTitle="Иавис" noteContent="Иавис воззвал к Богу." />);

    const titles = screen.getAllByTestId('built-sermon-title');
    expect(titles.map((node) => node.textContent)).toEqual([
      'Молитва Иависа: не своё умение, а рука Господня',
      'Молитва Иависа: рука Господня над делом рук наших',
    ]);
    // Two lines, not one truncated one: the class is what buys the second line back.
    expect(titles[0]).toHaveClass('line-clamp-2');

    // The passage leads the second line — it is what actually differs between the two.
    const metas = screen.getAllByTestId('built-sermon-meta');
    expect(metas[0]).toHaveTextContent('1 Пар 4:10 · 10.08.2026');
    expect(metas[1]).toHaveTextContent('1 Пар 4:9-10 · 10.08.2026');

    expect(screen.getByTestId('built-sermons-count')).toHaveTextContent('2');
  });

  it('shows the date alone when a sermon has no verse yet: no orphaned separator', () => {
    mockUseSermonsBuiltOnNote.mockReturnValue({ sermons: [aSermon('s1', 'Без стиха')], loading: false });
    render(<SermonsBuiltOnNote noteId="n1" noteTitle="Иавис" noteContent="Иавис воззвал к Богу." />);
    expect(screen.getByTestId('built-sermon-meta')).toHaveTextContent('10.08.2026');
    expect(screen.getByTestId('built-sermon-meta').textContent).not.toContain('·');
  });

  it('holds the door shut while the note has edits the server has not confirmed, and says why', () => {
    render(<SermonsBuiltOnNote noteId="n1" noteTitle="Иавис" noteContent="Иавис воззвал к Богу." noteBusy />);
    const button = screen.getByTestId('create-sermon-from-note');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'studiesWorkspace.builtSermons.createDisabledUnsaved');
  });

  it('opens the dialog with what the note knows about itself, and closes it again', async () => {
    const user = userEvent.setup();
    render(
      <SermonsBuiltOnNote
        noteId="n1"
        noteTitle="Молитва Иависа"
        noteContent="Иавис воззвал к Богу."
        scriptureRefs={[{ book: '1 Chronicles', chapter: 4, fromVerse: 9, toVerse: 10, id: 'r1' }]}
      />
    );
    expect(screen.queryByTestId('create-modal-stub')).toBeNull();

    await user.click(screen.getByTestId('create-sermon-from-note'));
    expect(screen.getByTestId('stub-props')).toHaveTextContent('n1|Молитва Иависа|Иавис воззвал к Богу.|1');

    await user.click(screen.getByText('close'));
    expect(screen.queryByTestId('create-modal-stub')).toBeNull();
  });
});
