import { fireEvent, render, screen } from '@testing-library/react';

import { AnalysisEditor } from '@/components/bible/analysis/AnalysisEditor';
import { BibleIcon } from '@/components/bible/BibleIcon';
import { analysesListHref, analysisPassageHref, forgetListArrival, readListArrival } from '@/components/bible/analysis/analysisAddress';
import { resetAnalysisHelpPrefsForTests } from '@/components/bible/analysis/analysisHelpPrefs';
import { useDataDocument } from '@/data-engine/react.client';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { historyStepHere } from '@/utils/historyStep';
import { passageWords } from '@/utils/passageAnalysis';
import { PLACE_DOOR_TONES } from '@/utils/themeColors';

import type { AnalysisDoor } from '@/components/bible/analysis/AnalysisParts';
import type { StudyNote } from '@/models/models';
import type { BookText } from '@/utils/bibleText';
import type { ReactNode } from 'react';

/*
 * The owner, 03.11: «Когда я был в изучении и открыл разбор, я хочу перейти к Библии. А если я был в Библии… то я могу
 * выйти туда к изучению… перекрёстки». An analysis has two homes — its passage in the Bible and the list of all analyses in
 * Studies. Its screen's way back leads where the person came from; beside it, one door leads to the other home.
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
const ANALYSIS: StudyNote = {
  id: 'an-1', userId: 'u', content: '', title: 'Разбор', tags: [], isDraft: false, materialIds: [], createdAt: '', updatedAt: '', type: 'analysis',
  scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 1, toVerse: 2 } as StudyNote['scriptureRefs'][number]],
  analysis: { bible: 'rst', words: total, cuts: [3], links: {}, relations: {} },
};

const screenWith = (props: { door?: AnalysisDoor; onOpenScreen?: (href: string) => void; marksStatus?: ReactNode }) => render(
  <AnalysisEditor opening={{ kind: 'open', id: ANALYSIS.id, editing: false }} text={EPHESIANS} bookId="Ephesians" bible="rst" locale="ru" onClose={jest.fn()} {...props} />,
);

describe('the analysis screen\'s crossroads — the way back where it came from, a door to its other home', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAnalysisHelpPrefsForTests();
    (useStudyNotesEngine as jest.Mock).mockImplementation(() => ({ uid: 'u', notes: [ANALYSIS], loading: false, checking: false, createNote: jest.fn(), updateNote: jest.fn(), recoverAnalysisCreation: jest.fn().mockResolvedValue(null), releaseAnalysisCreation: jest.fn().mockResolvedValue(undefined) }));
    (useDataDocument as jest.Mock).mockImplementation((resource: { id: string } | null) => ({
      data: resource ? ANALYSIS : null, state: resource ? {} : null, status: resource ? { phase: 'saved' } : null,
      readOnly: false, loading: false, error: null, commit: jest.fn(() => Promise.resolve()), recoveryIdentity: {},
    }));
  });

  it('stands the door right after the way back, named by the home it leads to', () => {
    screenWith({ door: { home: 'analyses', href: () => '/studies?tab=analyses' }, onOpenScreen: jest.fn() });
    const door = screen.getByRole('button', { name: 'analysis.door.analyses' });
    expect(screen.getByRole('button', { name: /analysis\.back/ }).nextElementSibling).toBe(door);
    // A phone's bar is narrow: there the door is its icon alone, its name shown from a wider screen up.
    expect(door).toHaveTextContent(/^analysis\.door\.analyses$/);
    expect(door.querySelector('span')).toHaveClass('hidden', 'sm:inline');
  });

  it('leaves for the other home at the address asked at the press, for the note the screen holds', () => {
    const href = jest.fn((id: string | null) => `/studies?tab=analyses&at=${id}`);
    const onOpenScreen = jest.fn();
    screenWith({ door: { home: 'analyses', href }, onOpenScreen });
    expect(href).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'analysis.door.analyses' }));
    expect(href).toHaveBeenCalledWith('an-1');
    expect(onOpenScreen).toHaveBeenCalledWith('/studies?tab=analyses&at=an-1');
  });

  it('stays where it is when the other home has no address for it', () => {
    const onOpenScreen = jest.fn();
    screenWith({ door: { home: 'bible', href: () => null }, onOpenScreen });
    fireEvent.click(screen.getByRole('button', { name: 'analysis.door.bible' }));
    expect(onOpenScreen).not.toHaveBeenCalled();
  });

  it('wears the colour and the sign of the place it leads to', () => {
    // The owner, 04.11: «бледная заливка» — the Bible's indigo with its book and cross from the menu (the open book is a
    // sermon's sign), analyses' violet with their steps.
    const { container: sign } = render(<BibleIcon />);
    const bibleSign = sign.querySelector('path')?.getAttribute('d');
    const { unmount } = screenWith({ door: { home: 'bible', href: () => null }, onOpenScreen: jest.fn() });
    const bible = screen.getByRole('button', { name: 'analysis.door.bible' });
    expect(bible).toHaveClass(...PLACE_DOOR_TONES.bible.split(' '), 'bg-indigo-50');
    expect(bible.querySelector('path')?.getAttribute('d')).toBe(bibleSign);
    unmount();
    screenWith({ door: { home: 'analyses', href: () => null }, onOpenScreen: jest.fn() });
    const analyses = screen.getByRole('button', { name: 'analysis.door.analyses' });
    expect(analyses).toHaveClass(...PLACE_DOOR_TONES.analyses.split(' '), 'bg-violet-50');
  });

  it('shows the book\'s marks notice its host gives — also with no marks to draw (the device\'s storage silent)', () => {
    // Codex, 04.11: the notice with its Retry was tested only on the hook; the screen itself must show it.
    screenWith({ marksStatus: <div data-testid="marks-notice">retry</div> });
    expect(screen.getByTestId('marks-notice')).toBeInTheDocument();
  });

  it('draws no door where its host gives none', () => {
    screenWith({ onOpenScreen: jest.fn() });
    expect(screen.queryByRole('button', { name: /analysis\.door/ })).not.toBeInTheDocument();
  });
});

describe('the addresses of an analysis\'s two homes', () => {
  it('opens its passage in the Bible, lit, the way back leading to where it was open', () => {
    const href = analysisPassageHref(ANALYSIS, { locale: 'ru', from: '/studies?tab=analyses&analysis=an-1&mode=view' });
    expect(Object.fromEntries(new URL(href ?? '/none', 'https://app.test').searchParams)).toEqual({
      book: 'ephesians', at: '1:1', to: '2', tr: 'rst', read: 'rst', from: '/studies?tab=analyses&analysis=an-1&mode=view',
    });
    expect(analysisPassageHref({ ...ANALYSIS, scriptureRefs: [] }, { locale: 'ru' })).toBeNull();
  });

  it('opens the list of analyses at this one — and at none for an analysis not yet kept', () => {
    expect(analysesListHref('an-1')).toBe('/studies?tab=analyses&at=an-1');
    expect(analysesListHref(null)).toBe('/studies?tab=analyses');
  });

  it('forgets the analysis the list was opened at and keeps the step of a window opened meanwhile', () => {
    // Codex, 04.11: the list let the way in go while another analysis stood open over it, and the address's quiet change
    // wiped that window's step — closing it then left an extra stop for Back.
    window.history.replaceState({ screenStep: 'b-step' }, '', '/studies?tab=analyses&at=a&analysis=b&mode=view');
    forgetListArrival();
    expect(window.location.search).toBe('?tab=analyses&analysis=b&mode=view');
    expect(historyStepHere()).toBe('b-step');
    window.history.replaceState(null, '', '/');
  });

  it('reads the analysis the list was opened at from the address', () => {
    window.history.replaceState(null, '', analysesListHref('an-1'));
    expect(readListArrival()).toBe('an-1');
    window.history.replaceState(null, '', '/studies?tab=analyses');
    expect(readListArrival()).toBeNull();
  });
});
