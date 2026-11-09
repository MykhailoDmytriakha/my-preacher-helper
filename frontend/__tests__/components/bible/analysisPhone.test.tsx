import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { AnalysisEditor } from '@/components/bible/analysis/AnalysisEditor';
import { resetAnalysisHelpPrefsForTests } from '@/components/bible/analysis/analysisHelpPrefs';
import { resetMarkToolForTests } from '@/components/bible/marks/markTool';
import { useDataDocument } from '@/data-engine/react.client';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { textMargin, tieArrows } from '@/components/bible/analysis/analysisGeometry';
import { analysisState, passageWords } from '@/utils/passageAnalysis';

import type { AnalysisDoor } from '@/components/bible/analysis/AnalysisParts';
import type { AnalysisMarks } from '@/components/bible/analysis/useAnalysisMarks';
import type { StudyNote } from '@/models/models';
import type { BookText } from '@/utils/bibleText';

/*
 * THE ANALYSIS ON A PHONE (the owner's choice on the canvas «Шапка разбора на телефоне», 2026-11-07, variant 4): on the
 * phone he sent, the bar stood in four rows over a quarter of the screen and the text started a quarter of the way in.
 * One bar — back, the place, ⋯, «Править»/«Готово» — that leaves while the text is scrolled down; ‹ › of the line touched
 * in a capsule at the bottom; no marker, pencil or eraser; and what the analysis says, said over the text.
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
const total = passageWords(EPHESIANS, { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 2 }).length;
/** Eph 1:1–2 in two lines on one step: «Павел, волею Божиею» / «Апостол Иисуса Христа, …», a link of meaning between them. */
const ANALYSIS: StudyNote = {
  id: 'an-1', userId: 'u', content: '', title: 'Разбор', tags: [], isDraft: false, materialIds: [], createdAt: '', updatedAt: '', type: 'analysis',
  scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 1, toVerse: 2 } as StudyNote['scriptureRefs'][number]],
  analysis: { bible: 'rst', words: total, cuts: [3], links: {}, relations: { '1-4': { dir: 'fwd', color: 'amber' } } },
};

/** The note the screen is served: the analysis above, unless a test lays a changed one over it. */
let current: StudyNote = ANALYSIS;
const commit = jest.fn(() => Promise.resolve());
/** The parts on the note after the changes laid so far, each on the draft the ones before it made, as the form does. */
const laid = () => {
  type Change = (value: Record<string, unknown>) => Record<string, unknown> | null;
  const draft = (commit.mock.calls as unknown as Array<[Change]>).reduce<Record<string, unknown>>((value, [change]) => change(value) ?? value, { ...ANALYSIS });
  return (draft as { analysis: { links: Record<string, number> } }).analysis;
};

/** The screen's width, as `matchMedia` answers it: a phone 390 px wide unless a test says otherwise. */
let width = 390;
const answers = (query: string) => {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
};

// jsdom has no PointerEvent: a mouse event that keeps the pointer's kind.
class TestPointerEvent extends MouseEvent {
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? ''; }
}
const realPointerEvent = window.PointerEvent;
const realMatchMedia = window.matchMedia;

const onClose = jest.fn();
const renderEditor = (editing: boolean, extra: { marks?: AnalysisMarks; door?: AnalysisDoor; onEditVerses?: () => void; onOpenScreen?: (href: string) => void } = {}) => render(
  <AnalysisEditor opening={{ kind: 'open', id: ANALYSIS.id, editing }} text={EPHESIANS} bookId="Ephesians" bible="rst" locale="ru" onClose={onClose} {...extra} />,
);
const word = (index: number) => document.querySelector<HTMLElement>(`[data-word="${index}"]`)!;
const bar = () => screen.getByTestId('analysis-phone-bar');
const pane = () => document.querySelector<HTMLElement>('[role="dialog"] .overflow-auto')!;
const scrollTo = (element: HTMLElement, top: number) => {
  Object.defineProperty(element, 'scrollTop', { value: top, configurable: true });
  fireEvent.scroll(element);
};

// jsdom has no hit test either: a dot dropped there lands on no word.
const realElementFromPoint = document.elementFromPoint;
beforeAll(() => {
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
  document.elementFromPoint = () => null;
});
afterAll(() => { window.PointerEvent = realPointerEvent; window.matchMedia = realMatchMedia; document.elementFromPoint = realElementFromPoint; });

beforeEach(() => {
  width = 390;
  window.matchMedia = jest.fn((query: string) => ({
    matches: answers(query), media: query, onchange: null,
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
  current = ANALYSIS;
  commit.mockClear();
  onClose.mockClear();
  localStorage.clear();
  resetAnalysisHelpPrefsForTests();
  resetMarkToolForTests();
  (useStudyNotesEngine as jest.Mock).mockImplementation(() => ({
    uid: 'u', notes: [current], loading: false, checking: false, createNote: jest.fn(), updateNote: jest.fn(),
    recoverAnalysisCreation: jest.fn().mockResolvedValue(null), releaseAnalysisCreation: jest.fn().mockResolvedValue(undefined),
  }));
  (useDataDocument as jest.Mock).mockImplementation((resource: { id: string } | null) => ({
    data: resource ? current : null, state: resource ? {} : null, status: resource ? { phase: 'saved' } : null,
    readOnly: false, loading: false, error: null, commit, recoveryIdentity: {},
  }));
});

const LENT_MARKS: AnalysisMarks = { marks: {}, order: { keys: [], position: new Map(), words: new Map() }, mark: jest.fn(() => true) };

describe('the analysis on a phone', () => {
  it('has one bar — back, the place, ⋯, «Править» — and no marks\' tools, mode switch or «Готово» that closes', () => {
    renderEditor(false, { marks: LENT_MARKS });
    const own = within(bar());
    expect(own.getByRole('button', { name: 'analysis.back' })).toBeInTheDocument();
    expect(own.getByRole('heading')).toBeInTheDocument();
    expect(own.getByRole('button', { name: 'analysis.more' })).toBeInTheDocument();
    expect(own.getByRole('button', { name: 'analysis.startEdit' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'analysis.modes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'analysis.done' })).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'bible.marks.toolbar' })).not.toBeInTheDocument();
  });

  it('keeps the marks\' tools on a wide screen, beside the modes', () => {
    width = 1280;
    renderEditor(false, { marks: LENT_MARKS });
    expect(screen.queryByTestId('analysis-phone-bar')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'analysis.modes' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'bible.marks.toolbar' })).toBeInTheDocument();
  });

  it('«Править» opens «Правка»; «Готово» there goes back to «Просмотр» and does not close the analysis', () => {
    renderEditor(false);
    fireEvent.click(within(bar()).getByRole('button', { name: 'analysis.startEdit' }));
    expect(within(bar()).queryByRole('button', { name: 'analysis.back' })).not.toBeInTheDocument();
    fireEvent.click(within(bar()).getByRole('button', { name: 'analysis.done' }));
    expect(within(bar()).getByRole('button', { name: 'analysis.startEdit' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(bar()).getByRole('button', { name: 'analysis.back' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps no margin: the verse number that opens a line stands in it, and no arrows stand left of the lines', () => {
    renderEditor(true);
    const number = document.querySelector('[data-lead="0"]')!;
    expect(number).not.toHaveClass('absolute');
    expect(pane()).toHaveStyle({ paddingLeft: '20px' });
    expect(document.querySelector('[data-line] button[aria-label="analysis.level.up"]')).toBeNull();
  });

  it('moves the line touched by the capsule\'s ‹ ›: pale until a line is touched, then the steps of that line', () => {
    renderEditor(true);
    const capsule = () => screen.getByRole('toolbar', { name: /analysis\.phone\./ });
    expect(capsule()).toHaveAccessibleName('analysis.phone.pickLine');
    expect(within(capsule()).getByRole('button', { name: 'analysis.level.down' })).toBeDisabled();
    fireEvent.pointerDown(word(4), { pointerType: 'touch', button: 0 });
    expect(capsule()).toHaveAccessibleName('analysis.phone.line');
    expect(within(capsule()).getByRole('button', { name: 'analysis.level.up' })).toBeDisabled();
    fireEvent.click(within(capsule()).getByRole('button', { name: 'analysis.level.down' }));
    // «Апостол…» goes under «Павел, волею Божиею».
    expect(laid().links).toEqual({ 3: 0 });
  });

  // The owner, 2026-11-07: «верхняя строка ИБО, с ней ничего невозможно сделать» — the first line's › acts too.
  it('steps the first line down under the next one from the capsule', () => {
    renderEditor(true);
    fireEvent.pointerDown(word(0), { pointerType: 'touch', button: 0 });
    const capsule = screen.getByRole('toolbar', { name: 'analysis.phone.line' });
    fireEvent.click(within(capsule).getByRole('button', { name: 'analysis.level.down' }));
    expect(laid().links).toEqual({ 0: 3 });
  });

  it('lets the bar go while the text is scrolled down in «Просмотр», brings it back on a scroll up, and keeps it in «Правка»', () => {
    renderEditor(false);
    scrollTo(pane(), 30);
    scrollTo(pane(), 240);
    expect(bar()).toHaveAttribute('data-hidden', 'true');
    scrollTo(pane(), 200);
    expect(bar()).not.toHaveAttribute('data-hidden');
    scrollTo(pane(), 420);
    expect(bar()).toHaveAttribute('data-hidden', 'true');
    // Back near the top it stands whatever the direction.
    scrollTo(pane(), 20);
    expect(bar()).not.toHaveAttribute('data-hidden');
    fireEvent.click(within(bar()).getByRole('button', { name: 'analysis.startEdit' }));
    scrollTo(pane(), 300);
    scrollTo(pane(), 600);
    expect(bar()).not.toHaveAttribute('data-hidden');
  });

  it('keeps the rare in ⋯: all the links at once, the other home and the verses', () => {
    const editVerses = jest.fn();
    const door: AnalysisDoor = { home: 'analyses', href: () => '/studies/analyses' };
    renderEditor(false, { door, onEditVerses: editVerses, onOpenScreen: jest.fn() });
    fireEvent.click(within(bar()).getByRole('button', { name: 'analysis.more' }));
    const sheet = screen.getByRole('dialog', { name: 'analysis.more' });
    expect(within(sheet).getByRole('button', { name: 'analysis.door.analyses' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'analysis.editVerses' })).toBeInTheDocument();
    const links = within(sheet).getByRole('switch');
    expect(links).not.toBeChecked();
    fireEvent.click(links);
    // Switched, the sheet steps aside to show the links; opened again, the switch says so.
    expect(screen.queryByRole('dialog', { name: 'analysis.more' })).not.toBeInTheDocument();
    fireEvent.click(within(bar()).getByRole('button', { name: 'analysis.more' }));
    expect(within(screen.getByRole('dialog', { name: 'analysis.more' })).getByRole('switch')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    expect(screen.queryByRole('dialog', { name: 'analysis.more' })).not.toBeInTheDocument();
  });
});

/*
 * BUG-20261107-analysis-messages-hidden-below-lg: what the analysis says — a tie made or refused — stood only in the side
 * panel, which a phone and an iPad upright do not have; a refused drag said nothing at all.
 */
describe('what the analysis says', () => {
  afterEach(() => { jest.useRealTimers(); });

  const dropTheDotOnNothing = (pointerType = 'touch') => {
    const dot = document.querySelector<HTMLElement>('[data-handle="3"]')!;
    fireEvent.pointerDown(dot, { pointerType, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(dot, { pointerType, clientX: 80, clientY: 90 });
    fireEvent.pointerUp(dot, { pointerType, clientX: 80, clientY: 90 });
  };

  it.each([[390], [820]])('is said over the text at %i px, and goes by itself', (screenWidth) => {
    width = screenWidth;
    jest.useFakeTimers();
    renderEditor(true);
    dropTheDotOnNothing();
    expect(screen.getByRole('status')).toHaveTextContent('analysis.tie.miss');
    act(() => { jest.advanceTimersByTime(5_100); });
    expect(screen.queryByText('analysis.tie.miss')).not.toBeInTheDocument();
  });

  it('shows a refused desktop drag above the independently scrollable help', () => {
    width = 1280;
    current = { ...ANALYSIS, analysis: { ...ANALYSIS.analysis!, links: { 3: 1 }, drawn: [3] } };
    renderEditor(true);
    const help = screen.getByTestId('analysis-help-toggle');
    expect(help).toHaveAttribute('aria-expanded', 'true');

    dropTheDotOnNothing('mouse');

    const warning = screen.getByText('analysis.tie.has');
    const sidebar = screen.getByRole('complementary');
    expect(sidebar).toContainElement(warning);
    expect(sidebar.firstElementChild).toBe(warning);
    expect(warning.nextElementSibling).toContainElement(help);
    expect(warning.nextElementSibling).toHaveClass('overflow-auto');
    expect(commit).not.toHaveBeenCalled();
  });
});

/*
 * Codex's review of the phone form, 2026-11-07: five ways it failed a person, each held here.
 */
describe('the phone form, where it was found failing', () => {
  /** A screen whose width changes, telling the hooks that listen, as a turned phone does. */
  const resizable = () => {
    const listeners: Array<{ query: string; listener: (event: MediaQueryListEvent) => void }> = [];
    window.matchMedia = jest.fn((query: string) => ({
      matches: answers(query), media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: jest.fn(),
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.push({ query, listener }),
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        const at = listeners.findIndex((entry) => entry.listener === listener);
        if (at >= 0) listeners.splice(at, 1);
      },
    })) as unknown as typeof window.matchMedia;
    return (next: number) => act(() => { width = next; [...listeners].forEach((entry) => entry.listener({ matches: answers(entry.query) } as MediaQueryListEvent)); });
  };

  it('lets go of the touched line when the passage changes under it, so the capsule moves nothing the person did not touch', () => {
    const { rerender } = renderEditor(true);
    fireEvent.pointerDown(word(4), { pointerType: 'touch', button: 0 });
    expect(screen.getByRole('toolbar', { name: 'analysis.phone.line' })).toBeInTheDocument();
    // Another device chose the verses again: verse 2 alone, so word 4 is now another word.
    const shorter = passageWords(EPHESIANS, { chapter: 1, fromVerse: 2, toChapter: 1, toVerse: 2 }).length;
    current = { ...ANALYSIS, scriptureRefs: [{ ...ANALYSIS.scriptureRefs[0], fromVerse: 2 }], analysis: { ...ANALYSIS.analysis!, words: shorter, cuts: [3], links: {}, relations: {} } };
    rerender(<AnalysisEditor opening={{ kind: 'open', id: ANALYSIS.id, editing: true }} text={EPHESIANS} bookId="Ephesians" bible="rst" locale="ru" onClose={onClose} />);
    expect(screen.getByRole('toolbar', { name: 'analysis.phone.pickLine' })).toBeInTheDocument();
  });

  it('keeps ⋯ open through a turn of the phone, and a phone on its side keeps the phone form', () => {
    const turn = resizable();
    renderEditor(false, { onOpenScreen: jest.fn() });
    fireEvent.click(within(bar()).getByRole('button', { name: 'analysis.more' }));
    turn(900);
    expect(screen.getByRole('dialog', { name: 'analysis.more' })).toBeInTheDocument();
  });

  it('closes ⋯ first on Escape, not the analysis under it', () => {
    // The registry of windows puts the one with the highest z-index on top: the real numbers of these classes.
    const style = document.createElement('style');
    style.textContent = '.z-\\[120\\]{z-index:120}.z-\\[125\\]{z-index:125}.z-40{z-index:40}';
    document.head.appendChild(style);
    try {
      renderEditor(false);
      fireEvent.click(within(bar()).getByRole('button', { name: 'analysis.more' }));
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'analysis.more' })).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      style.remove();
    }
  });

  it('lets go of a drag under way when the passage changes under it: the drop makes no tie between other words', () => {
    const { rerender } = renderEditor(true);
    const dot = document.querySelector<HTMLElement>('[data-handle="3"]')!;
    fireEvent.pointerDown(dot, { pointerType: 'touch', button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(dot, { pointerType: 'touch', clientX: 60, clientY: 80 });
    const shorter = passageWords(EPHESIANS, { chapter: 1, fromVerse: 2, toChapter: 1, toVerse: 2 }).length;
    current = { ...ANALYSIS, scriptureRefs: [{ ...ANALYSIS.scriptureRefs[0], fromVerse: 2 }], analysis: { ...ANALYSIS.analysis!, words: shorter, cuts: [3], links: {}, relations: {} } };
    rerender(<AnalysisEditor opening={{ kind: 'open', id: ANALYSIS.id, editing: true }} text={EPHESIANS} bookId="Ephesians" bible="rst" locale="ru" onClose={onClose} />);
    // The finger lets go over the new text's first word.
    const drop = document.elementFromPoint;
    document.elementFromPoint = () => word(0);
    try {
      fireEvent.pointerUp(document.querySelector<HTMLElement>('[data-handle="3"]') ?? dot, { pointerType: 'touch', clientX: 60, clientY: 80 });
    } finally {
      document.elementFromPoint = drop;
    }
    expect(commit).not.toHaveBeenCalled();
  });

  it('keeps the touched line when a new copy of the same text arrives', () => {
    const { rerender } = renderEditor(true);
    fireEvent.pointerDown(word(4), { pointerType: 'touch', button: 0 });
    const copy: BookText = { ...EPHESIANS, chapters: EPHESIANS.chapters.map((chapter) => [...chapter]) };
    rerender(<AnalysisEditor opening={{ kind: 'open', id: ANALYSIS.id, editing: true }} text={copy} bookId="Ephesians" bible="rst" locale="ru" onClose={onClose} />);
    expect(screen.getByRole('toolbar', { name: 'analysis.phone.line' })).toBeInTheDocument();
  });

  it('gives the focus back to the analysis when ⋯ is closed after the phone turned and ⋯ itself is gone', () => {
    const turn = resizable();
    const style = document.createElement('style');
    style.textContent = '.z-\\[120\\]{z-index:120}.z-\\[125\\]{z-index:125}';
    document.head.appendChild(style);
    try {
      renderEditor(false);
      const more = within(bar()).getByRole('button', { name: 'analysis.more' });
      more.focus();
      fireEvent.click(more);
      turn(1200);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'analysis.more' })).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(document.body);
      expect(screen.getByRole('dialog', { name: 'analysis.title' })).toContainElement(document.activeElement as HTMLElement);
    } finally {
      style.remove();
    }
  });

  it('brings the bar back on a slow scroll up of many small steps', () => {
    renderEditor(false);
    [30, 120, 300].forEach((top) => scrollTo(pane(), top));
    expect(bar()).toHaveAttribute('data-hidden', 'true');
    [297, 294, 291, 288].forEach((top) => scrollTo(pane(), top));
    expect(bar()).not.toHaveAttribute('data-hidden');
  });

  it('gives the text as much left room as its farthest tie needs: eleven ties to one line stay on a phone', () => {
    const cuts = Array.from({ length: 11 }, (_, k) => k + 1);
    const state = analysisState({ bible: 'rst', words: 12, cuts, links: Object.fromEntries(cuts.map((k) => [k, 0])), drawn: cuts, relations: {} }, 12);
    // Where the lines start, as AnalysisLine lays them: 8 + 26 per step, and the words' own 6 px.
    const geometry = { words: Object.fromEntries([0, ...cuts].map((k) => [k, { x: k === 0 ? 14 : 40, y: k * 50, w: 40, h: 30 }])), leads: {}, mids: {}, flags: {}, width: 354, height: 600 };
    const arrows = tieArrows(state, geometry);
    const farthest = Math.min(...arrows.flatMap((arrow) => arrow.points!.map(([x]) => x)));
    expect(farthest + 20).toBeLessThan(0);
    expect(farthest + textMargin(arrows, 20)).toBeGreaterThanOrEqual(6);
    // A few ties change nothing: the margin is the screen's own.
    expect(textMargin(arrows.slice(0, 2), 20)).toBe(20);
    expect(textMargin([], 80)).toBe(80);
  });
});
