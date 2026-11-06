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
/** The parts on the note after the changes laid so far — each laid on the draft the ones before it made, as the form does. */
const laid = () => {
  type Change = (value: Record<string, unknown>) => Record<string, unknown> | null;
  const draft = (commit.mock.calls as unknown as Array<[Change]>).reduce<Record<string, unknown>>((value, [change]) => change(value) ?? value, { ...current });
  return (draft as { analysis: { cuts: number[]; links: Record<string, number> } }).analysis;
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
    (useStudyNotesEngine as jest.Mock).mockImplementation(() => ({
      uid: 'u', notes: [current], loading: false, checking: false,
      createNote: jest.fn(), updateNote: jest.fn(),
      recoverAnalysisCreation: jest.fn().mockResolvedValue(null),
      releaseAnalysisCreation: jest.fn().mockResolvedValue(undefined),
    }));
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

  // Without a pointer that hovers (a phone, an iPad by finger or Pencil) a word touched is the word pointed at: its marks
  // and its line's arrows and dot stand until another word is touched (UX review 04.11, BUG-20261104-analysis-edit-needs-hover).
  it('shows a touched word\'s marks and its line\'s arrows without hover, and not for the mouse', () => {
    // jsdom has no PointerEvent: a mouse event that keeps the pointer's kind.
    class TestPointerEvent extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? ''; }
    }
    const realPointerEvent = window.PointerEvent;
    window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
    try {
      renderEditor(true);
      const marksOf = (index: number) => within(word(index)).getByRole('button', { name: 'analysis.level.sameAria' }).parentElement!;
      const arrowsOf = (index: number) => word(index).closest('[data-line]')!.querySelector<HTMLElement>('button[aria-label="analysis.level.down"]')!.parentElement!;
      expect(marksOf(1)).toHaveClass('hidden');
      fireEvent.pointerDown(word(1), { pointerType: 'mouse', button: 0 });
      expect(marksOf(1)).toHaveClass('hidden');
      fireEvent.pointerDown(word(1), { pointerType: 'touch', button: 0 });
      expect(marksOf(1)).not.toHaveClass('hidden');
      expect(arrowsOf(1)).not.toHaveClass('invisible');
      fireEvent.click(within(word(1)).getByRole('button', { name: 'analysis.level.sameAria' }));
      expect(laid().cuts).toEqual([1, 3]);
      // Another word touched takes the marks over.
      fireEvent.pointerDown(word(5), { pointerType: 'pen', button: 0 });
      expect(marksOf(5)).not.toHaveClass('hidden');
    } finally {
      window.PointerEvent = realPointerEvent;
    }
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

    it('keeps the all-links control in a stable header slot when switching modes', () => {
      // BUG-20261031-analysis-mode-switch-jumps: the centered mode group used to shift when this control appeared.
      renderEditor(true);
      const header = () => document.querySelector('[data-modal-layer] header')!;
      const childTags = () => [...header().children].map((child) => child.tagName);
      const editHeaderShape = childTags();
      const allLinksSlot = screen.getByTestId('analysis-all-links');
      expect(allLinksSlot).toHaveClass('invisible');
      fireEvent.click(screen.getByRole('button', { name: 'analysis.modeView' }));
      expect(childTags()).toEqual(editHeaderShape);
      expect(screen.getByTestId('analysis-all-links')).not.toHaveClass('invisible');
      expect(within(screen.getByTestId('analysis-all-links')).getByRole('switch')).toBeInTheDocument();
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
      // Reopening in edit keeps the saved preference; entering view shows its complete, non-foldable hint.
      unmount();
      renderEditor(true);
      expect(screen.getByTestId('analysis-help-toggle')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('analysis.edit.hintMark')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'analysis.modeView' }));
      expect(screen.queryByTestId('analysis-help-toggle')).not.toBeInTheDocument();
      expect(screen.getByText('analysis.view.hint')).toBeInTheDocument();
    });
  });
});
