import { fireEvent, render, screen, within } from '@testing-library/react';

import { AnalysisEditor } from '@/components/bible/analysis/AnalysisEditor';
import { resetAnalysisHelpPrefsForTests } from '@/components/bible/analysis/analysisHelpPrefs';
import { useDataDocument } from '@/data-engine/react.client';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { passageWords } from '@/utils/passageAnalysis';

import { ANALYSIS_RELATION_TONES } from '@/utils/themeColors';

import type { StudyNote } from '@/models/models';
import type { BookText } from '@/utils/bibleText';

/*
 * A line of an analysis is cut and glued only by its marks (the owner, 31.10: «через нажатие на слово убираем… иногда
 * слова выделены, и ты такое нажимаешь, а оно переносится… только по кнопкам»): in «Правка» a press on a word changes
 * nothing; ↵ over a word cuts the line there on its step, ↳ one step under, and the mark over a line's first word glues it
 * back. In «Просмотр» a press on a word still lights its part up.
 */
jest.mock('@/hooks/useStudyNotesEngine', () => ({ ...jest.requireActual('@/hooks/useStudyNotesEngine'), useStudyNotesEngine: jest.fn() }));
jest.mock('@/data-engine/react.client', () => ({ ...jest.requireActual('@/data-engine/react.client'), useDataDocument: jest.fn() }));

const EPHESIANS: BookText = {
  id: 'Ephesians',
  chapters: [[
    '¶Павел, волею Божиею Апостол Иисуса Христа, находящимся в Ефесе святым и верным во Христе Иисусе:',
    'благодать вам и мир от Бога Отца нашего и Господа Иисуса Христа.',
  ]],
};
const PASSAGE = { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 2 };
const total = passageWords(EPHESIANS, PASSAGE).length;

/** Eph 1:1–2 cut once: «Павел, волею Божиею» / «Апостол Иисуса Христа, …». */
const ANALYSIS: StudyNote = {
  id: 'an-1', userId: 'u', content: '', title: 'Разбор', tags: [], isDraft: false, materialIds: [], createdAt: '', updatedAt: '', type: 'analysis',
  scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 1, toVerse: 2 } as StudyNote['scriptureRefs'][number]],
  analysis: { bible: 'rst', words: total, cuts: [3], links: {}, relations: {} },
};

/** The note the editor opens: the analysis above, or one with links of meaning. */
let current: StudyNote = ANALYSIS;
const commit = jest.fn(() => Promise.resolve());
/** The parts the last change laid on the note. */
const laid = () => {
  const change = (commit.mock.calls.at(-1) as unknown as [(value: Record<string, unknown>) => { analysis: { cuts: number[]; links: Record<string, number> } }])[0];
  return change({ ...current }).analysis;
};

const renderEditor = (editing: boolean) => render(
  <AnalysisEditor opening={{ kind: 'open', id: ANALYSIS.id, editing }} text={EPHESIANS} bookId="Ephesians" bible="rst" locale="ru" onClose={jest.fn()} />,
);
const word = (index: number) => document.querySelector<HTMLElement>(`[data-word="${index}"]`)!;

describe('cutting and gluing the lines of an analysis', () => {
  beforeEach(() => {
    commit.mockClear();
    current = ANALYSIS;
    localStorage.clear();
    resetAnalysisHelpPrefsForTests();
    (useStudyNotesEngine as jest.Mock).mockImplementation(() => ({ uid: 'u', notes: [current], loading: false, checking: false, createNote: jest.fn(), updateNote: jest.fn() }));
    (useDataDocument as jest.Mock).mockImplementation((resource: { id: string } | null) => ({
      data: resource ? current : null, state: resource ? {} : null, status: resource ? { phase: 'saved' } : null,
      readOnly: false, loading: false, error: null, commit, recoveryIdentity: {},
    }));
  });

  it('cuts nothing at a press on a word in «Правка» — not inside a line, not on its first word', () => {
    renderEditor(true);
    expect(word(1)).toHaveTextContent('волею');
    fireEvent.click(word(1));
    fireEvent.click(word(3));
    expect(commit).not.toHaveBeenCalled();
  });

  it('cuts a line by ↵ over a word, one step under by ↳, and glues it back by the mark over its first word', () => {
    renderEditor(true);
    fireEvent.click(within(word(1)).getByRole('button', { name: 'analysis.level.sameAria' }));
    expect(laid().cuts).toEqual([1, 3]);
    fireEvent.click(within(word(5)).getByRole('button', { name: 'analysis.level.underAria' }));
    expect(laid().cuts).toEqual([1, 3, 5]);
    // One step under the line it is cut from: it hangs on a word of that line.
    expect(laid().links['5']).toBeGreaterThanOrEqual(3);
    fireEvent.click(within(word(3)).getByRole('button', { name: 'analysis.markGlue' }));
    expect(laid().cuts).toEqual([1, 5]);
  });

  it('still lights a part up at a press on its word in «Просмотр», changing nothing', () => {
    renderEditor(false);
    fireEvent.click(word(4));
    expect(document.querySelector('[data-line="3"]')).not.toHaveClass('opacity-30');
    expect(document.querySelector('[data-line="0"]')).toHaveClass('opacity-30');
    expect(commit).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'analysis.markGlue' })).not.toBeInTheDocument();
  });

  describe('a word\'s links of meaning', () => {
    // «волею» is linked to «Иисуса» (amber) and to «находящимся» (pink).
    const LINKED: StudyNote = { ...ANALYSIS, analysis: { ...ANALYSIS.analysis!, relations: { '1-4': { dir: 'fwd', color: 'amber' }, '1-7': { dir: 'none', color: 'pink' } } } };
    beforeEach(() => { current = LINKED; });

    it('rings a linked word at rest, not only while pointed at (the owner, 31.10: «обводка… остались»)', () => {
      renderEditor(true);
      expect(word(4)).toHaveClass('ring-2', ...ANALYSIS_RELATION_TONES.amber.ring.split(' '));
      expect(word(7)).toHaveClass('ring-2', ...ANALYSIS_RELATION_TONES.pink.ring.split(' '));
      expect(word(2)).not.toHaveClass('ring-2');
      // The lines go with the pointer: none drawn while nothing is pointed at.
      expect(document.querySelector('[data-relation-arrow]')).toBeNull();
    });

    it('opens the menu of its link at a press on a ringed word in «Правка», and changes nothing by the press', () => {
      renderEditor(true);
      fireEvent.click(word(4));
      const menu = screen.getByRole('dialog', { name: 'analysis.relation.menu' });
      expect(menu.querySelectorAll('[data-relation-item]')).toHaveLength(1);
      expect(menu.querySelector('[data-relation-item="1-4"]')).not.toBeNull();
      expect(commit).not.toHaveBeenCalled();
      // A press on a word with no link lets the menu go.
      fireEvent.click(word(2));
      expect(screen.queryByRole('dialog', { name: 'analysis.relation.menu' })).not.toBeInTheDocument();
    });

    it('shows every link of a word with several, and one taken away leaves the other', () => {
      renderEditor(true);
      fireEvent.click(word(1));
      const menu = screen.getByRole('dialog', { name: 'analysis.relation.menuWord' });
      expect([...menu.querySelectorAll('[data-relation-item]')].map((item) => item.getAttribute('data-relation-item'))).toEqual(['1-4', '1-7']);
      fireEvent.click(within(menu.querySelector<HTMLElement>('[data-relation-item="1-4"]')!).getByRole('button', { name: /analysis\.relation\.drop/ }));
      const change = (commit.mock.calls.at(-1) as unknown as [(value: Record<string, unknown>) => { analysis: { relations: Record<string, unknown> } }])[0];
      expect(Object.keys(change({ ...current }).analysis.relations)).toEqual(['1-7']);
      // The one left: the menu now names that link.
      expect(screen.getByRole('dialog', { name: 'analysis.relation.menu' }).querySelectorAll('[data-relation-item]')).toHaveLength(1);
    });

    it('opens no menu at a press on a ringed word in «Просмотр»: the press lights the part', () => {
      renderEditor(false);
      fireEvent.click(word(4));
      expect(screen.queryByRole('dialog', { name: /analysis\.relation\./ })).not.toBeInTheDocument();
      expect(word(4)).toHaveClass('ring-2');
    });
  });

  describe('the side panel\'s help', () => {
    // The owner, 31.10: «она должна сворачиваться… поначалу она нужна, а потом ты уже выучиваешь, и она тебе не нужна».
    it('shows every explanation at first, folds to a sign and a short name a tool, and stays folded on this device', () => {
      const { unmount } = renderEditor(true);
      const toggle = screen.getByTestId('analysis-help-toggle');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('analysis.edit.hintMark')).toBeInTheDocument();
      fireEvent.click(toggle);
      expect(screen.getByTestId('analysis-help-toggle')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('analysis.edit.hintMark')).not.toBeInTheDocument();
      expect(within(screen.getByTestId('analysis-help-short')).getAllByText(/^analysis\.help\./)).toHaveLength(8);
      expect(JSON.parse(localStorage.getItem('analysis:help') ?? '{}')).toMatchObject({ short: true });
      // Opened again — another analysis, another day — it is still folded.
      unmount();
      renderEditor(false);
      expect(screen.getByTestId('analysis-help-toggle')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText('analysis.help.view')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('analysis-help-toggle'));
      expect(screen.getByText('analysis.view.hint')).toBeInTheDocument();
    });
  });
});
