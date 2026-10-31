import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BlockDiagramSection from '@/components/sermon/prep/exegeticalPlan/BlockDiagramSection';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';

import type { StudyNote } from '@/models/models';

/*
 * Step 3 «Экзегетический план» of a sermon's prep (case 2026-10-12-block-diagram, phase 7; the owner, 31.10: «пришло время
 * показать эту блочную диаграмму в шаге три»): the analysis the sermon was made from stands as its block diagram, drawn as
 * the reader draws it, and a press opens it in the Bible with the way back to the sermon. A sermon without an analysis
 * keeps the «Скоро» note — adding one from the sermon is case 2.
 */
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/useStudyNotesEngine', () => ({ useStudyNotesEngine: jest.fn() }));

const note = (id: string, more: Partial<StudyNote>): StudyNote => ({
  id, userId: 'owner', title: '', content: '', scriptureRefs: [], tags: [], createdAt: '', updatedAt: '', isDraft: false, ...more,
} as StudyNote);
const ANALYSIS = note('analysis-1', {
  type: 'analysis', title: 'Разбор · Руфь 1:16–18',
  content: '- куда ты пойдешь,\n  - туда и я пойду,\n- народ твой будет моим народом',
  scriptureRefs: [{ id: 'ref-1', bible: 'rst', book: 'Ruth', chapter: 1, fromVerse: 16, toVerse: 18 }],
});
const PLAIN = note('note-1', { type: 'note', title: 'Заметка', content: 'Мысли о Руфи' });
const notes = (list: StudyNote[], loading = false) =>
  jest.mocked(useStudyNotesEngine).mockReturnValue({ notes: list, loading } as unknown as ReturnType<typeof useStudyNotesEngine>);

describe('the block diagram of a sermon\'s step 3', () => {
  beforeEach(() => jest.clearAllMocks());

  it('draws the analysis the sermon was made from and opens it in the Bible, the way back leading to the sermon', async () => {
    notes([PLAIN, ANALYSIS]);
    render(<BlockDiagramSection sermonId="sermon-1" sourceNoteIds={['note-1', 'analysis-1']} />);
    expect(jest.mocked(useStudyNotesEngine)).toHaveBeenCalledWith(true);
    const section = screen.getByTestId('block-diagram-analyses');
    expect(screen.getAllByTestId('block-diagram-analysis')).toHaveLength(1);
    expect(within(section).getByText('analysis.title')).toBeInTheDocument();
    const outline = within(section).getByTestId('analysis-outline');
    // Whole on the page, without a scroll of its own (the owner, 31.10: «без скроллинга… видна полностью»).
    expect(outline.className).not.toMatch(/max-h-|overflow-y-auto/);
    // A part a line, each step deeper, as on the verse in the reader.
    const lines = [...outline.querySelectorAll<HTMLElement>('[data-analysis-line]')];
    expect(lines.map((line) => [line.textContent, line.style.paddingLeft])).toEqual([
      ['куда ты пойдешь,', '0px'], ['туда и я пойду,', '14px'], ['народ твой будет моим народом', '0px'],
    ]);
    expect(screen.queryByText('wizard.steps.exegeticalPlan.blockDiagram.comingSoon')).not.toBeInTheDocument();

    await userEvent.click(within(section).getByRole('button', { name: 'bible.mine.openAnalysis' }));
    const href = new URL(mockPush.mock.calls[0][0], 'https://app.invalid');
    expect(href.pathname).toBe('/bible');
    expect(Object.fromEntries(href.searchParams)).toMatchObject({ book: 'ruth', at: '1:16', to: '18', tr: 'rst', from: '/sermons/sermon-1', analysis: 'analysis-1', mode: 'view' });
  });

  it('keeps «Скоро» for a sermon made from a plain note: a note is not an analysis', () => {
    notes([PLAIN]);
    render(<BlockDiagramSection sermonId="sermon-1" sourceNoteIds={['note-1']} />);
    expect(screen.queryByTestId('block-diagram-analyses')).not.toBeInTheDocument();
    expect(screen.getByText('wizard.steps.exegeticalPlan.blockDiagram.comingSoon')).toBeInTheDocument();
  });

  it('keeps «Скоро» for a sermon made from nothing, and asks for no notes', () => {
    notes([ANALYSIS]);
    render(<BlockDiagramSection sermonId="sermon-1" sourceNoteIds={[]} />);
    expect(jest.mocked(useStudyNotesEngine)).toHaveBeenCalledWith(false);
    expect(screen.getByText('wizard.steps.exegeticalPlan.blockDiagram.comingSoon')).toBeInTheDocument();
  });

  it('shows nothing while the sermon\'s notes are being read, rather than «Скоро» flashing before the analysis', () => {
    notes([], true);
    const { container } = render(<BlockDiagramSection sermonId="sermon-1" sourceNoteIds={['analysis-1']} />);
    expect(container).toBeEmptyDOMElement();
  });
});
