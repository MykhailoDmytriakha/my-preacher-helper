import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import HardQuestionBasisPage from '@/(pages)/(private)/care/questions/[themeId]/basis/[basisId]/page';
import HardQuestionPage from '@/(pages)/(private)/care/questions/[themeId]/[questionId]/page';
import HardQuestionThemePage from '@/(pages)/(private)/care/questions/[themeId]/page';
import HardQuestionsPage from '@/(pages)/(private)/care/questions/page';
import { QuestionEditor } from '@/components/hardQuestions/QuestionEditor';
import { buildLibrary } from '@/utils/hardQuestions';
import { toast } from 'sonner';
import '@testing-library/jest-dom';

import type { HardQuestion, HardQuestionTheme } from '@/models/models';

/**
 * The global `react-i18next` mock answers with the KEY: the screens are proven to say the right
 * thing by key, and the locale test proves the words exist in all three languages. What matters
 * most here is what each screen asks the section's hook to WRITE — its arguments, read back.
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
let mockSearch = '';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  useParams: () => mockParams,
  useSearchParams: () => new URLSearchParams(mockSearch),
  usePathname: () => '/care/questions',
}));
jest.mock('@/hooks/useAppLocale', () => ({ useAppLocale: () => ({ locale: 'ru' }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
const mockOpenPlace = jest.fn();
jest.mock('@/components/bible/VerseWindow', () => {
  // The page's verse window: a pressed place reaches `mockOpenPlace` through the real links context.
  const { ScriptureLinks } = jest.requireActual<typeof import('@/components/bible/ScriptureLinks')>('@/components/bible/ScriptureLinks');
  return {
    ScriptureLinksInWindow: ({ children }: { children: React.ReactNode }) => <ScriptureLinks onOpen={mockOpenPlace}>{children}</ScriptureLinks>,
    useVerseWindow: () => ({ open: jest.fn(), sheet: null }),
  };
});
jest.mock('@/components/bible/useBookTexts', () => ({ useBookTexts: () => new Map() }));
jest.mock('@/components/MarkdownDisplay', () => ({ __esModule: true, default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div> }));
jest.mock('@/data-engine/DataSyncStatus', () => {
  const actual = jest.requireActual<typeof import('@/data-engine/DataSyncStatus')>('@/data-engine/DataSyncStatus');
  return {
    DataSyncStatus: (props: Parameters<typeof actual.DataSyncStatus>[0]) => props.fieldReview
      ? <actual.DataSyncStatus {...props} />
      : props.comparison ? <div role="region" aria-label="dataSync.versionComparison"><p>{props.comparison.mine}</p><p>{props.comparison.stored}</p></div>
        : null,
  };
});
jest.mock('@/data-engine/DataCollectionStatus', () => ({ DataCollectionStatus: () => null }));

// The search lives in the address (its own tests); here it filters, and its clearing is watched.
const mockSetSearch = jest.fn();
jest.mock('@/hooks/useSearchInputQuery', () => {
  const { useState } = jest.requireActual<typeof import('react')>('react');
  return {
    useSearchInputQuery: () => {
      const [value, setValue] = useState('');
      return { value, setValue: (next: string) => { mockSetSearch(next); setValue(next); }, inputRef: { current: null } };
    },
  };
});

// The engine's document and form: what the page reads, and what a form is asked to save.
type Doc = Record<string, unknown> | null;
let mockDocument: Doc = null;
let mockFormDocument: Doc | undefined;
let mockPresence: { kind: string } = { kind: 'present' };
let mockConflictPaths: readonly (readonly string[])[] = [];
let mockBasisConflictId: string | undefined;
let mockThemeOrderReview: ReturnType<typeof import('@/data-engine/react.client').readHardQuestionThemeOrderReview>;
const mockApplyThemeOrderReview = jest.fn().mockResolvedValue(undefined);
let mockAnsweredOperation: string | undefined;
type BasisFormCopy = { scopeId: string; record: { predecessor: { id: string }; savedGeneration: number | null } };
let mockFormCopies: BasisFormCopy[] = [];
let mockPendingFormCopies: Promise<BasisFormCopy[]> | undefined;
let mockFormDirty = false;
let mockComparison: {
  identity: string; hardQuestionFields?: readonly string[]; conflictPaths: readonly (readonly string[])[];
  basisScripture?: { id: string; mine: string[]; stored: string[] };
  mine: Record<string, unknown>; stored: { value: Record<string, unknown>; resource: { collection: string } };
} | null = null;
let mockDraftChoices: { id: string }[] = [];
const mockFormSave = jest.fn((_updater?: (draft: Record<string, unknown>) => Record<string, unknown>, _action?: unknown) => Promise.resolve());
const mockFormUpdate = jest.fn((_updater: (draft: Record<string, unknown>) => Record<string, unknown>) => Promise.resolve());
const mockRecover = jest.fn((_id: string) => Promise.resolve());
jest.mock('@/data-engine/react.client', () => ({
  readHardQuestionThemeOrderReview: () => mockThemeOrderReview,
  readHardQuestionBasisConflict: () => mockBasisConflictId ? { id: mockBasisConflictId, requestId: mockAnsweredOperation } : undefined,
  hasHardQuestionFieldConflict: () => mockConflictPaths.some(path => ['title', 'short', 'detail', 'differ', 'intro', 'alternates', 'scriptureRefs', 'basisIds'].includes(path[0])),
  DataDocumentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDataDocument: () => ({
    data: mockDocument, presence: mockPresence, status: mockConflictPaths.length ? { phase: 'conflict', canKeepLocal: true, canAcceptRemote: true } : null,
    state: { checkpoint: { conflicts: mockConflictPaths.map(path => ({ path })) },
      result: mockAnsweredOperation ? { kind: 'conflict', operationId: mockAnsweredOperation } : undefined }, error: null, readOnly: false, loading: false,
    recoveryIdentity: {}, retry: jest.fn(), keepLocal: jest.fn(), acceptRemote: jest.fn(),
    applyHardQuestionThemeOrderReview: mockApplyThemeOrderReview,
  }),
  useDataForm: () => ({
    data: mockFormDocument === undefined ? mockDocument : mockFormDocument, loading: false, active: true, readOnly: false, dirty: mockFormDirty, busy: false, status: null, comparison: mockComparison, error: null,
    recoveryIdentity: {}, recoveryReady: true, recoveryVersion: '', exactChoice: Boolean(mockComparison), begin: () => Promise.resolve(), update: mockFormUpdate,
    save: mockFormSave, cancel: () => Promise.resolve(), recover: mockRecover, retry: jest.fn(), keepLocal: jest.fn(), acceptRemote: jest.fn(),
    listRecoverable: () => mockPendingFormCopies ?? Promise.resolve(mockFormCopies), discardRecovery: jest.fn(), captureDocumentMetadataAction: () => ({ documentMetadata: { time: null } }),
  }),
  useRecoveryDiscovery: () => ({ choices: mockDraftChoices, loading: false, error: null, recover: jest.fn(), discard: jest.fn() }),
}));

// The section's hook is the seam: a real library from real fixtures, every write a spy.
const theme = (id: string, rank: number, extra: Partial<HardQuestionTheme> = {}): HardQuestionTheme => ({
  id, userId: 'u', title: `Тема ${id}`, rank, groups: [], bases: [], createdAt: 'c', updatedAt: 'c', ...extra,
});
const question = (id: string, extra: Partial<HardQuestion> = {}): HardQuestion => ({
  id, userId: 'u', title: `Вопрос ${id}`, rank: 1000, short: 'Ответ.', createdAt: '2026-11-01', updatedAt: 'c', ...extra,
});
const CLOTHES = theme('clothes', 1000, {
  title: 'Одежда',
  groups: [{ id: 'g1', title: 'Длина' }, { id: 'g2', title: 'Брюки' }],
  bases: [{ id: 'b1', title: 'Мерило — стыдливость' }, { id: 'b2', title: 'Обычай и заповедь' }],
});
let mockThemes: HardQuestionTheme[] = [];
let mockQuestions: HardQuestion[] = [];
let mockComplete = true;
const mockActions = {
  createQuestion: jest.fn((_input: unknown) => Promise.resolve('new-q')),
  createTheme: jest.fn((_input: unknown) => Promise.resolve('new-theme')),
  removeTheme: jest.fn((_id: string) => Promise.resolve()),
  removeQuestion: jest.fn((_id: string) => Promise.resolve()),
  removeGroup: jest.fn((_theme: string, _group: string) => Promise.resolve()),
  removeBasis: jest.fn((_theme: string, _basis: string) => Promise.resolve()),
  placeQuestion: jest.fn(() => Promise.resolve()),
  addGroup: jest.fn((_theme: string, _title: string) => Promise.resolve('g-new')),
  saveBasis: jest.fn((_theme: string, _basis: unknown) => Promise.resolve('b-new')),
};
jest.mock('@/hooks/useHardQuestions', () => ({
  useHardQuestions: () => ({
    library: buildLibrary(mockThemes, mockQuestions), loading: false, complete: mockComplete, themesState: null, questionsState: null, ready: true,
    moveTheme: jest.fn(), moveQuestion: jest.fn(), renameGroup: jest.fn(), moveGroup: jest.fn(), moveBasis: jest.fn(),
    ...mockActions,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockSearch = '';
  mockDocument = null;
  mockFormDocument = undefined;
  mockPresence = { kind: 'present' };
  mockDraftChoices = [];
  mockConflictPaths = [];
  mockBasisConflictId = undefined;
  mockThemeOrderReview = undefined;
  mockAnsweredOperation = undefined;
  mockFormCopies = [];
  mockPendingFormCopies = undefined;
  mockFormDirty = false;
  mockComparison = null;
  mockComplete = true;
  mockThemes = [CLOTHES];
  mockQuestions = [
    question('trousers', { themeId: 'clothes', groupId: 'g2', title: 'Можно ли носить брюки?', short: 'Сами по себе — нет (Втор 22:5).', basisIds: ['b1'], alternates: ['Грех ли брюки?'] }),
    question('length', { themeId: 'clothes', groupId: 'g1', title: 'Какой длины юбка?', detail: 'Подробно.', basisIds: ['b1', 'b2'] }),
    question('ivf', { title: 'Можно ли ЭКО?', short: undefined, createdAt: '2026-11-20' }),
  ];
});

describe('the section\'s first page', () => {
  it('shows a pastor who starts empty what the section is for and two ways in, with no loading of a document', () => {
    mockThemes = []; mockQuestions = [];
    render(<HardQuestionsPage />);
    expect(screen.getByText('hardQuestions.empty.title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hardQuestions.addTheme/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /hardQuestions.import/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'hardQuestions.empty.justQuestion' })).toBeInTheDocument();
  });

  it('says nothing about an empty section while the lists are not known whole', () => {
    mockThemes = []; mockQuestions = []; mockComplete = false;
    render(<HardQuestionsPage />);
    expect(screen.queryByText('hardQuestions.empty.title')).not.toBeInTheDocument();
  });

  it('shows each theme with its count beside the title and its bases with their places; a place opens over the list', () => {
    mockOpenPlace.mockClear();
    mockThemes = [
      theme('clothes', 1000, { title: 'Одежда', bases: [
        { id: 'b1', title: 'Мерило — стыдливость', scriptureRefs: ['1 Тим 2:9', 'Быт 9:23', 'Гал 5:22–23', 'Тит 2:11–12', 'Откр 3:18', 'Рим 25'] },
        { id: 'b2', title: 'Обычай и заповедь' },
      ] }),
      theme('sabbath', 2000, { title: 'Суббота', groups: [{ id: 'g1', title: 'Закон и благодать' }, { id: 'g2', title: 'День Господень' }] }),
    ];
    render(<HardQuestionsPage />);
    const clothes = screen.getByRole('link', { name: /^Одежда/ });
    expect(clothes).toHaveAttribute('href', '/care/questions/clothes');
    expect(within(clothes).getByText('hardQuestions.counts.questions')).toHaveClass('sr-only');
    const card = clothes.closest('article')!;
    expect(within(card).getByRole('link', { name: 'Мерило — стыдливость' })).toHaveAttribute('href', '/care/questions/clothes/basis/b1');
    // Four places at once, the fifth behind «ещё 1»; an entry no Bible can open stays a plain word.
    const places = within(card).getAllByRole('button', { name: /hardQuestions.question.openPlace/ });
    expect(places).toHaveLength(4);
    expect(within(card).getByText('Рим 25').tagName).toBe('SPAN');
    fireEvent.click(within(card).getByRole('button', { name: 'hardQuestions.theme.morePlaces' }));
    expect(within(card).getAllByRole('button', { name: /hardQuestions.question.openPlace/ })).toHaveLength(5);
    fireEvent.click(places[0]);
    expect(mockOpenPlace).toHaveBeenCalledWith(expect.objectContaining({ book: '1 Timothy', chapter: 2, fromVerse: 9 }));
    // A basis kept before the rule says it has no places; a theme with no bases shows its groups.
    expect(within(card).getByText('hardQuestions.theme.noPlaces')).toBeInTheDocument();
    const sabbath = screen.getByRole('link', { name: /^Суббота/ }).closest('article')!;
    expect(within(sabbath).getByText('Закон и благодать · День Господень')).toBeInTheDocument();
  });

  it('offers a new theme beside «+ Вопрос» at the top, and not under the last theme (2026-11-27)', () => {
    render(<HardQuestionsPage />);
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    expect(within(header).getAllByRole('button').map((button) => button.textContent)).toEqual(['hardQuestions.addTheme', 'hardQuestions.addQuestion']);
    const themes = screen.getByRole('heading', { name: 'hardQuestions.themes' }).closest('section')!;
    expect(within(themes).queryByRole('button', { name: /hardQuestions.addTheme/ })).not.toBeInTheDocument();
  });

  it('lists what waits for an answer, the themes, and the questions without a theme', () => {
    render(<HardQuestionsPage />);
    const waiting = screen.getByRole('heading', { name: 'hardQuestions.waiting' }).closest('section')!;
    expect(within(waiting).getByRole('link', { name: /Можно ли ЭКО/ })).toHaveAttribute('href', '/care/questions/none/ivf');
    expect(screen.getByRole('link', { name: /Одежда/ })).toHaveAttribute('href', '/care/questions/clothes');
    const loose = screen.getByRole('heading', { name: 'hardQuestions.withoutTheme' }).closest('section')!;
    expect(within(loose).getByText('Можно ли ЭКО?')).toBeInTheDocument();
  });

  it('finds by other words of the question and by a place of Scripture named in the answer', () => {
    render(<HardQuestionsPage />);
    const box = screen.getByLabelText('hardQuestions.search.label');
    fireEvent.change(box, { target: { value: 'грех ли брюки' } });
    expect(screen.getByRole('link', { name: /Можно ли носить брюки/ })).toHaveAttribute('href', '/care/questions/clothes/trousers');
    fireEvent.change(box, { target: { value: 'Втор 22:5' } });
    const found = screen.getByRole('heading', { name: 'hardQuestions.search.found' }).closest('section')!;
    expect(within(found).getAllByRole('link')).toHaveLength(1);
  });

  it('offers to write down a question it could not find, with the words typed', async () => {
    render(<HardQuestionsPage />);
    fireEvent.change(screen.getByLabelText('hardQuestions.search.label'), { target: { value: 'квантовая физика' } });
    fireEvent.click(screen.getByRole('button', { name: /hardQuestions.search.record/ }));
    expect(await screen.findByLabelText('hardQuestions.dialogs.asked')).toHaveValue('квантовая физика');
  });

  it('«write and answer» opens the new question for answering and never clears the search over that move', async () => {
    render(<HardQuestionsPage />);
    fireEvent.click(screen.getByRole('button', { name: /^hardQuestions.addQuestion$/ }));
    fireEvent.change(await screen.findByLabelText('hardQuestions.dialogs.asked'), { target: { value: '  Можно ли пост в субботу? ' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'hardQuestions.dialogs.writeAndAnswer' })); });
    expect(mockActions.createQuestion).toHaveBeenCalledWith({ title: '  Можно ли пост в субботу? ', themeId: undefined, groupId: undefined });
    expect(mockPush).toHaveBeenCalledWith('/care/questions/none/new-q?edit=1');
    expect(mockSetSearch).not.toHaveBeenCalled();
  });

  it('«answer later» writes the question into its theme and group and stays, clearing the search', async () => {
    render(<HardQuestionsPage />);
    fireEvent.click(screen.getByRole('button', { name: /^hardQuestions.addQuestion$/ }));
    fireEvent.change(await screen.findByLabelText('hardQuestions.dialogs.asked'), { target: { value: 'Шорты летом?' } });
    fireEvent.change(screen.getByLabelText('hardQuestions.dialogs.theme'), { target: { value: 'clothes' } });
    fireEvent.change(screen.getByLabelText('hardQuestions.dialogs.group'), { target: { value: 'g2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'hardQuestions.dialogs.writeForLater' })); });
    expect(mockActions.createQuestion).toHaveBeenCalledWith({ title: 'Шорты летом?', themeId: 'clothes', groupId: 'g2' });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockSetSearch).toHaveBeenCalledWith('');
  });

  it('offers a group list with «+ Новая группа…» for any theme, even one with no groups yet, and none without a theme', async () => {
    mockThemes = [CLOTHES, theme('suffering', 2000, { title: 'Страдания' })];
    render(<HardQuestionsPage />);
    fireEvent.click(screen.getByRole('button', { name: /^hardQuestions.addQuestion$/ }));
    await screen.findByLabelText('hardQuestions.dialogs.asked');
    expect(screen.queryByLabelText('hardQuestions.dialogs.group')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('hardQuestions.dialogs.theme'), { target: { value: 'suffering' } });
    const list = screen.getByLabelText('hardQuestions.dialogs.group');
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual(['hardQuestions.withoutGroup', 'hardQuestions.dialogs.newGroupOption']);
  });
});

/** Opens a page's «⋯» in its header and picks one of its items. */
async function chooseInMenu(menu: string, item: string) {
  fireEvent.click(screen.getByRole('button', { name: menu }));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}
const chooseInThemeMenu = (item: string) => chooseInMenu('hardQuestions.theme.actions', item);

describe('a theme', () => {
  beforeEach(() => { mockParams = { themeId: 'clothes' }; mockDocument = { title: 'Одежда' }; });

  it('numbers its questions through the groups, as the theme reads, and shows its bases with what rests on them', () => {
    render(<HardQuestionThemePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Одежда' })).toBeInTheDocument();
    const length = screen.getByRole('link', { name: /Какой длины юбка/ });
    const trousers = screen.getByRole('link', { name: /Можно ли носить брюки/ });
    expect(within(length).getByText('1')).toBeInTheDocument();
    expect(within(trousers).getByText('2')).toBeInTheDocument();
    const basesSection = screen.getByRole('heading', { name: 'hardQuestions.theme.bases' }).closest('section')!;
    expect(within(basesSection).getByRole('link', { name: /Мерило — стыдливость/ })).toHaveAttribute('href', '/care/questions/clothes/basis/b1');
    // A question's line names the basis it rests on by its title: the short label is gone (2026-11-26).
    expect(within(trousers).getByText('Мерило — стыдливость')).toBeInTheDocument();
  });

  it('opens theme text comparison from its reading page without a duplicate review button', () => {
    mockConflictPaths = [['intro']];
    mockComparison = {
      identity: 'theme review', hardQuestionFields: ['intro'], conflictPaths: [['intro']],
      mine: { intro: 'Моё вступление' }, stored: { value: { intro: 'Сохранённое вступление' }, resource: { collection: 'hardQuestionThemes' } },
    };
    render(<HardQuestionThemePage />);
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.versionComparison' }));
    const dialog = screen.getByRole('dialog', { name: 'hardQuestions.theme.editTitle' });
    expect(within(dialog).getByText('Моё вступление')).toBeInTheDocument();
    expect(within(dialog).getByText('Сохранённое вступление')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'common.save' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'dataSync.versionComparison' })).not.toBeInTheDocument();
  });

  it('opens a basis reference comparison from its theme and shows the compared places', () => {
    mockDocument = { ...CLOTHES };
    mockConflictPaths = [['bases', 'id:b1', 'scriptureRefs']];
    mockBasisConflictId = 'b1';
    mockComparison = {
      identity: 'basis scripture review', conflictPaths: mockConflictPaths,
      basisScripture: { id: 'b1', mine: ['Ин 3:16'], stored: ['Ин 3:17'] },
      mine: mockDocument, stored: { value: mockDocument, resource: { collection: 'hardQuestionThemes' } },
    };
    render(<HardQuestionThemePage />);
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.versionComparison' }));
    const dialog = screen.getByRole('dialog', { name: 'hardQuestions.basis.editTitle' });
    expect(within(dialog).getByText('Ин 3:16')).toBeInTheDocument();
    expect(within(dialog).getByText('Ин 3:17')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'common.save' })).toBeDisabled();
  });

  it('returns to the exact saved reference comparison after the form was reopened', async () => {
    mockDocument = { ...CLOTHES };
    mockConflictPaths = [['bases', 'id:b1', 'scriptureRefs']];
    mockBasisConflictId = 'b1';
    mockAnsweredOperation = 'refused-places';
    mockFormCopies = [
      { scopeId: 'another-draft', record: { predecessor: { id: 'different-request' }, savedGeneration: 3 } },
      { scopeId: 'form-reopen-without-save', record: { predecessor: { id: 'refused-places' }, savedGeneration: null } },
      { scopeId: 'form-that-saved', record: { predecessor: { id: 'refused-places' }, savedGeneration: 4 } },
    ];
    render(<HardQuestionThemePage />);
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.versionComparison' }));
    await waitFor(() => expect(mockRecover).toHaveBeenCalledWith('form-that-saved'));
    expect(mockRecover).toHaveBeenCalledTimes(1);
  });

  it('keeps words typed while the saved basis comparison is being found', async () => {
    mockDocument = { ...CLOTHES };
    mockConflictPaths = [['bases', 'id:b1', 'scriptureRefs']];
    mockBasisConflictId = 'b1';
    mockAnsweredOperation = 'refused-places';
    let answer!: (sources: BasisFormCopy[]) => void;
    mockPendingFormCopies = new Promise(resolve => { answer = resolve; });
    const page = render(<HardQuestionThemePage />);
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.versionComparison' }));
    mockFormDirty = true;
    page.rerender(<HardQuestionThemePage />);
    await act(async () => answer([{ scopeId: 'old form', record: { predecessor: { id: 'refused-places' }, savedGeneration: 4 } }]));
    expect(mockRecover).not.toHaveBeenCalled();
  });

  it('applies a separate decision for the order and the disputed words', async () => {
    mockConflictPaths = [['bases'], ['bases', 'id:b1', 'text']];
    const version = (value: string | { id: string; title: string; scriptureRefs: string[] }[]) => ({ exists: true, value });
    const first = { id: 'b1', title: 'Основание', scriptureRefs: ['Ин 3:16'] };
    const second = { id: 'b2', title: 'Основание', scriptureRefs: ['Ин 3:17'] };
    mockThemeOrderReview = { identity: 'combined review', fields: [
      { id: 'order', path: ['bases'], base: version([]), mine: version([first, second]), theirs: version([second, first]) },
      { id: 'text', path: ['bases', 'id:b1', 'text'], rowTitle: 'Основание', base: version('Было'),
        mine: version('Мой текст'), theirs: version('Сохранённый текст') },
    ] };
    render(<HardQuestionThemePage />);
    const review = screen.getByRole('region', { name: 'dataSync.versionComparison' });
    const apply = within(review).getByRole('button', { name: 'dataSync.applyReviewedVersions' });
    const order = within(review).getByRole('group', { name: 'hardQuestions.theme.basisOrder' });
    const text = within(review).getByRole('group', { name: 'Основание · hardQuestions.basis.fieldText' });
    expect(within(order).getByText(/1\. Основание · Ин 3:16/)).toBeInTheDocument();
    expect(within(order).getByText(/1\. Основание · Ин 3:17/)).toBeInTheDocument();
    expect(apply).toBeDisabled();
    fireEvent.click(within(order).getByRole('radio', { name: /dataSync.yourVersion/ }));
    expect(apply).toBeDisabled();
    fireEvent.click(within(text).getByRole('radio', { name: /dataSync.storedVersion/ }));
    fireEvent.click(apply);
    await waitFor(() => expect(mockApplyThemeOrderReview).toHaveBeenCalledWith(
      expect.objectContaining({ conflicts: expect.any(Array) }), 'combined review', { order: 'local', text: 'remote' },
    ));
  });

  it('a basis card\'s places open in the verse window, while the card itself still opens the basis', () => {
    mockOpenPlace.mockClear();
    mockThemes = [{ ...CLOTHES, bases: [{ id: 'b1', title: 'Мерило — стыдливость', scriptureRefs: ['1 Тим 2:9'] }, { id: 'b2', title: 'Обычай и заповедь' }] }];
    render(<HardQuestionThemePage />);
    const basesSection = screen.getByRole('heading', { name: 'hardQuestions.theme.bases' }).closest('section')!;
    expect(within(basesSection).getByRole('link', { name: 'Мерило — стыдливость' })).toHaveAttribute('href', '/care/questions/clothes/basis/b1');
    const place = within(basesSection).getByRole('button', { name: /hardQuestions.question.openPlace/ });
    expect(place.closest('a')).toBeNull();
    fireEvent.click(place);
    expect(mockOpenPlace).toHaveBeenCalledWith(expect.objectContaining({ book: '1 Timothy', chapter: 2, fromVerse: 9 }));
    expect(within(basesSection).getByText('hardQuestions.theme.noPlaces')).toBeInTheDocument();
  });

  it('has one view: no switch to read the theme whole (removed at the owner\'s word, 2026-11-26)', () => {
    render(<HardQuestionThemePage />);
    expect(screen.queryByRole('group', { name: 'hardQuestions.theme.modes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'hardQuestions.theme.modeRead' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hardQuestions.arrange$/ })).toBeEnabled();
  });

  it('keeps «+ Вопрос» in sight and the theme\'s rarer actions behind «⋯»: a new group, its edit, its removal last', async () => {
    render(<HardQuestionThemePage />);
    const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
    expect(within(header).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent))
      .toEqual(['hardQuestions.addQuestion', 'hardQuestions.theme.actions']);
    expect(screen.queryByRole('button', { name: /hardQuestions.theme.(edit|remove)$/ })).not.toBeInTheDocument();
    fireEvent.click(within(header).getByRole('button', { name: 'hardQuestions.theme.actions' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['hardQuestions.dialogs.newGroup', 'hardQuestions.theme.edit', 'hardQuestions.theme.remove']);
    fireEvent.click(items[1]);
    const themeWindow = await screen.findByRole('dialog', { name: 'hardQuestions.theme.editTitle' });
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    // The menu hands focus back to «⋯» a frame after the choice; the window opens after that and keeps the keyboard,
    // instead of losing it to the button behind it (live, 2026-11-26).
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(themeWindow).toContainElement(document.activeElement as HTMLElement);
  });

  it('removes the theme alone after saying its questions stay, without a theme', async () => {
    render(<HardQuestionThemePage />);
    await chooseInThemeMenu('hardQuestions.theme.remove');
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText('hardQuestions.theme.removeKeeps')).toBeInTheDocument();
    expect(within(confirm).queryByRole('checkbox')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'common.delete' })); });
    expect(mockActions.removeTheme).toHaveBeenCalledWith('clothes');
    expect(mockReplace).toHaveBeenCalledWith('/care/questions');
  });

  it('does not make a basis without a place of Scripture: it says so under the places and puts the cursor there', async () => {
    render(<HardQuestionThemePage />);
    fireEvent.click(screen.getByRole('button', { name: /hardQuestions.theme.addBasis$/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('hardQuestions.basis.fieldTitle'), { target: { value: 'Мерило' } });
    const save = within(dialog).getByRole('button', { name: 'hardQuestions.basis.create' });
    expect(save).toBeEnabled();
    await act(async () => { fireEvent.click(save); });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('hardQuestions.basis.needsPlace');
    const places = within(dialog).getByLabelText('hardQuestions.basis.places');
    expect(places).toHaveFocus();
    expect(places).toHaveAttribute('aria-invalid', 'true');
    expect(mockActions.saveBasis).not.toHaveBeenCalled();
    // Words are not a place: the refusal stands until a place a Bible can open is added.
    fireEvent.change(places, { target: { value: 'стыдливость' } });
    fireEvent.keyDown(places, { key: 'Enter' });
    await act(async () => { fireEvent.click(save); });
    expect(mockActions.saveBasis).not.toHaveBeenCalled();
    fireEvent.change(places, { target: { value: '1 Тим 2:9' } });
    fireEvent.keyDown(places, { key: 'Enter' });
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(save); });
    expect(mockActions.saveBasis).toHaveBeenCalledWith('clothes', expect.objectContaining({ title: 'Мерило', scriptureRefs: ['стыдливость', '1 Тим 2:9'] }));
  });

  it('removes a group after asking, leaving its questions in the theme', async () => {
    render(<HardQuestionThemePage />);
    // The second group, «Брюки» (the trail of ids: g1 then g2).
    fireEvent.click(screen.getAllByRole('button', { name: 'hardQuestions.theme.removeGroup' })[1]);
    const confirm = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'common.delete' })); });
    expect(mockActions.removeGroup).toHaveBeenCalledWith('clothes', 'g2');
  });

  it('makes a group from the theme\'s «⋯» and brings it into sight, lit, where it landed at the end of the theme', async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) { scrolled.push(this); };
    mockActions.addGroup.mockImplementationOnce(async () => {
      mockThemes = [{ ...CLOTHES, groups: [...(CLOTHES.groups ?? []), { id: 'g-new', title: 'Украшения' }] }];
      return 'g-new';
    });
    try {
      render(<HardQuestionThemePage />);
      // A new group from the top of the theme, in its «⋯» — not under the last group, screens below (the owner could
      // not find it there, 2026-11-26), and nowhere else on the page.
      expect(screen.queryByRole('button', { name: /Группа|addGroup|newGroup/ })).not.toBeInTheDocument();
      await chooseInThemeMenu('hardQuestions.dialogs.newGroup');
      fireEvent.change(await screen.findByLabelText('hardQuestions.dialogs.groupTitle'), { target: { value: 'Украшения' } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.save' })); });
      expect(mockActions.addGroup).toHaveBeenCalledWith('clothes', 'Украшения');
      await waitFor(() => expect(scrolled.map((element) => element.getAttribute('data-group-id'))).toContain('g-new'));
      expect(document.querySelector('[data-group-id="g-new"]')?.className).toContain('outline-rose-400/70');
      expect(document.querySelector('[data-group-id="g1"]')?.className).toContain('outline-transparent');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('does not make a second group under a name the theme has: it says so and keeps saving off', async () => {
    render(<HardQuestionThemePage />);
    await chooseInThemeMenu('hardQuestions.dialogs.newGroup');
    fireEvent.change(await screen.findByLabelText('hardQuestions.dialogs.groupTitle'), { target: { value: ' длина ' } });
    expect(screen.getByText('hardQuestions.dialogs.groupTaken')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
    expect(mockActions.addGroup).not.toHaveBeenCalled();
  });

  it('names a new group in the new question\'s window: the list turns into a field, and the question waits for the name', async () => {
    render(<HardQuestionThemePage />);
    fireEvent.click(screen.getByRole('button', { name: /^hardQuestions.addQuestion$/ }));
    fireEvent.change(await screen.findByLabelText('hardQuestions.dialogs.asked'), { target: { value: 'Серьги?' } });
    const newGroup = screen.getByRole('option', { name: 'hardQuestions.dialogs.newGroupOption' }) as HTMLOptionElement;
    fireEvent.change(screen.getByLabelText('hardQuestions.dialogs.group'), { target: { value: newGroup.value } });
    const name = screen.getByLabelText('hardQuestions.dialogs.group');
    expect(name.tagName).toBe('INPUT');
    expect(name).toHaveFocus();
    expect(screen.getByRole('button', { name: 'hardQuestions.dialogs.writeForLater' })).toBeDisabled();
    fireEvent.change(name, { target: { value: 'Украшения' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'hardQuestions.dialogs.writeForLater' })); });
    expect(mockActions.createQuestion).toHaveBeenCalledWith({ title: 'Серьги?', themeId: 'clothes', newGroupTitle: 'Украшения' });
  });

  it('a new group named like one the theme has takes the question into it, and «×» returns to the list', async () => {
    render(<HardQuestionThemePage />);
    fireEvent.click(screen.getByRole('button', { name: /^hardQuestions.addQuestion$/ }));
    fireEvent.change(await screen.findByLabelText('hardQuestions.dialogs.asked'), { target: { value: 'Макси?' } });
    const newGroupValue = (screen.getByRole('option', { name: 'hardQuestions.dialogs.newGroupOption' }) as HTMLOptionElement).value;
    fireEvent.change(screen.getByLabelText('hardQuestions.dialogs.group'), { target: { value: newGroupValue } });
    fireEvent.click(screen.getByRole('button', { name: 'hardQuestions.dialogs.backToGroups' }));
    const list = screen.getByLabelText('hardQuestions.dialogs.group');
    expect(list.tagName).toBe('SELECT');
    expect(list).toHaveFocus();
    fireEvent.change(list, { target: { value: newGroupValue } });
    fireEvent.change(screen.getByLabelText('hardQuestions.dialogs.group'), { target: { value: 'ДЛИНА' } });
    expect(screen.getByText('hardQuestions.dialogs.groupExistsJoin')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'hardQuestions.dialogs.writeForLater' })); });
    expect(mockActions.createQuestion).toHaveBeenCalledWith({ title: 'Макси?', themeId: 'clothes', groupId: 'g1' });
  });

  it('«Отмена» in the new question\'s window asks before it drops the typed words, and closes at once with nothing typed', async () => {
    render(<HardQuestionThemePage />);
    fireEvent.click(screen.getByRole('button', { name: /^hardQuestions.addQuestion$/ }));
    fireEvent.change(await screen.findByLabelText('hardQuestions.dialogs.asked'), { target: { value: 'Серьги?' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(await screen.findByText('common.discardChanges.title')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.discardChanges.keep' })); });
    expect(screen.getByLabelText('hardQuestions.dialogs.asked')).toHaveValue('Серьги?');
    fireEvent.change(screen.getByLabelText('hardQuestions.dialogs.asked'), { target: { value: '' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.cancel' })); });
    await waitFor(() => expect(screen.queryByLabelText('hardQuestions.dialogs.asked')).not.toBeInTheDocument());
  });

  it('keeps the already open theme form and its unsent words when the theme disappears', async () => {
    mockFormDocument = { ...CLOTHES, title: 'Набранное название', intro: 'Вступление, которое я ещё не сохранил' };
    mockFormDirty = true;
    const view = render(<HardQuestionThemePage />);
    await chooseInThemeMenu('hardQuestions.theme.edit');
    const original = await screen.findByRole('dialog', { name: 'hardQuestions.theme.editTitle' });
    const intro = within(original).getByLabelText('hardQuestions.dialogs.intro');
    expect(intro).toHaveValue('Вступление, которое я ещё не сохранил');

    mockDocument = null;
    mockPresence = { kind: 'absent' };
    view.rerender(<HardQuestionThemePage />);
    expect(screen.getByText('recordAvailability.notFound')).toBeInTheDocument();
    const retained = screen.getByRole('dialog', { name: 'hardQuestions.theme.editTitle' });
    expect(within(retained).getByLabelText('hardQuestions.dialogs.intro')).toBe(intro);
    expect(intro).toHaveAttribute('readonly');
    expect(intro).toHaveValue('Вступление, которое я ещё не сохранил');
    expect(within(retained).getByRole('button', { name: 'common.save' })).toBeDisabled();
    expect(within(retained).getByRole('button', { name: 'hardQuestions.draft.copy' })).toBeEnabled();
  });

  it('says the theme was deleted when the open form has no unsaved edit', async () => {
    mockFormDocument = { ...CLOTHES, intro: 'Вступление с сервера' };
    const view = render(<HardQuestionThemePage />);
    await chooseInThemeMenu('hardQuestions.theme.edit');
    await screen.findByRole('dialog', { name: 'hardQuestions.theme.editTitle' });
    mockThemes = [];
    mockDocument = null;
    mockPresence = { kind: 'absent' };
    view.rerender(<HardQuestionThemePage />);
    const dialog = screen.getByRole('dialog', { name: 'hardQuestions.theme.editTitle' });
    expect(within(dialog).getByText('dataSync.phase.deleted')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'hardQuestions.draft.copy' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'common.save' })).toBeDisabled();
  });

  it('a theme removed elsewhere shows the words its form left unsent on this device, to copy (Codex review 2026-11-27)', () => {
    mockDraftChoices = [{ id: 'draft-1', words: ['Одежда', 'Вступление, набранное здесь'] } as { id: string }];
    mockParams = { themeId: 'gone-theme' };
    mockThemes = [];
    mockDocument = null;
    mockPresence = { kind: 'absent' };
    render(<HardQuestionThemePage />);
    expect(screen.getByText('hardQuestions.draft.orphan')).toBeInTheDocument();
    expect(screen.getByText(/Вступление, набранное здесь/)).toBeInTheDocument();
  });

  it('says a theme that is gone is gone, instead of loading for ever', () => {
    mockParams = { themeId: 'deleted' };
    mockDocument = null;
    mockPresence = { kind: 'absent' };
    render(<HardQuestionThemePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'recordAvailability.notFound' })).toBeInTheDocument();
    expect(screen.queryByText('recordAvailability.checking')).not.toBeInTheDocument();
  });
});

describe('a question', () => {
  const open = (id: string, themeSegment: string, doc: Record<string, unknown>) => {
    mockParams = { themeId: themeSegment, questionId: id };
    mockDocument = doc;
  };

  it('shows the short answer, the bases as links to their pages, its other wordings and the places it names', () => {
    open('trousers', 'clothes', { userId: 'u', title: 'Можно ли носить брюки?', themeId: 'clothes', groupId: 'g2', rank: 1, short: 'Сами по себе — нет (Втор 22:5).', basisIds: ['b1', 'gone'], alternates: ['Грех ли брюки?'] });
    render(<HardQuestionPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Можно ли носить брюки?' })).toBeInTheDocument();
    expect(screen.getAllByTestId('markdown')[0]).toHaveTextContent('Сами по себе — нет (Втор 22:5).');
    const bases = screen.getByRole('heading', { name: 'hardQuestions.question.restsOn' }).closest('section')!;
    expect(within(bases).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/care/questions/clothes/basis/b1']);
    expect(screen.getByText(/«Грех ли брюки\?»/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'hardQuestions.question.openPlace' })).toHaveLength(1);
  });

  it('opens the exact answer comparison from its reading page and omits text already ordered by the engine', () => {
    open('ivf', 'none', { userId: 'u', title: 'Можно ли ЭКО?', rank: 1 });
    mockConflictPaths = [['short'], ['detail']];
    mockComparison = {
      identity: 'question review', hardQuestionFields: ['detail'], conflictPaths: [['detail']],
      mine: { short: 'Старый краткий ответ', detail: 'Моё объяснение' },
      stored: { value: { short: 'Новый краткий ответ', detail: 'Сохранённое объяснение' }, resource: { collection: 'hardQuestions' } },
    };
    render(<HardQuestionPage />);
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.versionComparison' }));
    const comparison = screen.getByRole('region', { name: 'dataSync.versionComparison' });
    expect(within(comparison).getByText('Моё объяснение')).toBeInTheDocument();
    expect(within(comparison).getByText('Сохранённое объяснение')).toBeInTheDocument();
    expect(within(comparison).queryByText('Старый краткий ответ')).not.toBeInTheDocument();
    expect(within(comparison).queryByText('Новый краткий ответ')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
  });

  it.each([1, null])('reopens the exact question submission when comparing after navigation (%s)', async savedGeneration => {
    open('ivf', 'none', { userId: 'u', title: 'Можно ли ЭКО?', rank: 1 });
    mockConflictPaths = [['alternates']];
    mockAnsweredOperation = 'earlier-save';
    mockFormCopies = [
      { scopeId: 'unrelated-form', record: { predecessor: { id: 'another-save' }, savedGeneration: 1 } },
      { scopeId: 'previous-question-form', record: { predecessor: { id: 'earlier-save' }, savedGeneration } },
    ];
    render(<HardQuestionPage />);
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.versionComparison' }));
    await waitFor(() => expect(mockRecover).toHaveBeenCalledWith('previous-question-form'));
    expect(mockRecover).toHaveBeenCalledTimes(1);
  });

  it('is laid out as the theme\'s page: its number and group under the title, «Изменить» in sight, the rest behind «⋯»', async () => {
    open('trousers', 'clothes', { userId: 'u', title: 'Можно ли носить брюки?', themeId: 'clothes', groupId: 'g2', rank: 1, short: 'Сами по себе — нет (Втор 22:5).', basisIds: ['b1'] });
    mockThemes = [{ ...CLOTHES, bases: [{ id: 'b1', title: 'Мерило — стыдливость', scriptureRefs: ['1 Тим 2:9'] }, { id: 'b2', title: 'Обычай и заповедь' }] }];
    mockOpenPlace.mockClear();
    render(<HardQuestionPage />);
    const header = screen.getByRole('heading', { level: 1, name: 'Можно ли носить брюки?' }).closest('header')!;
    expect(within(header).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent))
      .toEqual(['hardQuestions.question.edit', 'hardQuestions.question.actions']);
    expect(within(header).getByText('hardQuestions.question.numbered · Брюки')).toBeInTheDocument();
    fireEvent.click(within(header).getByRole('button', { name: 'hardQuestions.question.actions' }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['hardQuestions.question.move', 'hardQuestions.question.removeQuestion']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    // The bases it rests on, as in the section's list: each with its places, a place opening in the verse window.
    const bases = screen.getByRole('heading', { name: 'hardQuestions.question.restsOn' }).closest('section')!;
    fireEvent.click(within(bases).getByRole('button', { name: /hardQuestions.question.openPlace/ }));
    expect(mockOpenPlace).toHaveBeenCalledWith(expect.objectContaining({ book: '1 Timothy', chapter: 2, fromVerse: 9 }));
    expect(screen.getByRole('heading', { name: 'hardQuestions.basis.places' })).toHaveClass('text-lg');
  });

  it('a move that fails says so and keeps the window with its choice (Codex review 2026-11-27)', async () => {
    open('trousers', 'clothes', { userId: 'u', title: 'Можно ли носить брюки?', themeId: 'clothes', groupId: 'g2', rank: 1, short: 'Нет.' });
    mockActions.placeQuestion.mockImplementationOnce(() => Promise.reject(new Error('gone')));
    render(<HardQuestionPage />);
    await chooseInMenu('hardQuestions.question.actions', 'hardQuestions.question.move');
    const dialog = await screen.findByRole('dialog', { name: 'hardQuestions.dialogs.moveQuestion' });
    fireEvent.change(within(dialog).getAllByRole('combobox')[1], { target: { value: 'g1' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'hardQuestions.dialogs.move' })); });
    expect(toast.error).toHaveBeenCalledWith('hardQuestions.saveFailed');
    expect(screen.getByRole('dialog', { name: 'hardQuestions.dialogs.moveQuestion' })).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('sends a question standing under the wrong theme to its own address', () => {
    open('trousers', 'none', { userId: 'u', title: 'Можно ли носить брюки?', themeId: 'clothes', rank: 1, short: 'Да.' });
    render(<HardQuestionPage />);
    expect(mockReplace).toHaveBeenCalledWith('/care/questions/clothes/trousers');
  });

  it('a question with no answer still shows what it does hold: where churches differ', () => {
    open('ivf', 'none', { userId: 'u', title: 'Можно ли ЭКО?', rank: 1, differ: 'Общины решают по-разному.' });
    render(<HardQuestionPage />);
    expect(screen.getByText('hardQuestions.question.noAnswer')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'hardQuestions.question.differ' })).toBeInTheDocument();
    expect(screen.getByText('Общины решают по-разному.')).toBeInTheDocument();
  });

  it('a question deleted elsewhere shows the words left unsaved on this device, to copy', async () => {
    jest.mocked(jest.requireMock('@/data-engine/react.client').useRecoveryDiscovery);
    mockDraftChoices = [{ id: 'draft-1', words: ['Можно ли ЭКО?', 'Слова, набранные здесь'] } as { id: string }];
    open('ivf', 'none', null as unknown as Record<string, unknown>);
    mockPresence = { kind: 'absent' };
    render(<HardQuestionPage />);
    expect(screen.getByText('hardQuestions.draft.orphan')).toBeInTheDocument();
    expect(screen.getByText(/Слова, набранные здесь/)).toBeInTheDocument();
  });

  it('a question with no answer says so and opens its form to answer', () => {
    open('ivf', 'none', { userId: 'u', title: 'Можно ли ЭКО?', rank: 1 });
    render(<HardQuestionPage />);
    expect(screen.getByText('hardQuestions.question.noAnswer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'hardQuestions.question.startAnswer' }));
    expect(screen.getByLabelText('hardQuestions.question.fieldTitle')).toHaveValue('Можно ли ЭКО?');
  });

  it('after a reload, offers the unsaved words back and takes them into the form', async () => {
    mockDraftChoices = [{ id: 'draft-1' }];
    open('ivf', 'none', { userId: 'u', title: 'Можно ли ЭКО?', rank: 1 });
    render(<HardQuestionPage />);
    fireEvent.click(screen.getByRole('button', { name: 'hardQuestions.draft.resume' }));
    expect(screen.getByLabelText('hardQuestions.question.fieldTitle')).toBeInTheDocument();
    await waitFor(() => expect(mockRecover).toHaveBeenCalledWith('draft-1'));
  });

  it('keeps the form and its words when the question is deleted while it is being edited', () => {
    open('ivf', 'none', { userId: 'u', title: 'Можно ли ЭКО?', rank: 1 });
    const view = render(<HardQuestionPage />);
    fireEvent.click(screen.getByRole('button', { name: 'hardQuestions.question.startAnswer' }));
    mockDocument = null;
    mockPresence = { kind: 'absent' };
    view.rerender(<HardQuestionPage />);
    expect(screen.getByText('hardQuestions.draft.goneWhileEditing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
  });

  it('removes the question after asking and returns to its theme', async () => {
    open('trousers', 'clothes', { userId: 'u', title: 'Можно ли носить брюки?', themeId: 'clothes', rank: 1, short: 'Да.' });
    render(<HardQuestionPage />);
    await chooseInMenu('hardQuestions.question.actions', 'hardQuestions.question.removeQuestion');
    const confirm = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'common.delete' })); });
    expect(mockActions.removeQuestion).toHaveBeenCalledWith('trousers');
    expect(mockReplace).toHaveBeenCalledWith('/care/questions/clothes');
  });
});

describe('the question form', () => {
  it('saves only its own fields, cleaned, and never stamps updatedAt (the server does: a form that sets it is refused)', async () => {
    mockDocument = { userId: 'u', title: ' Можно ли? ', rank: 1, updatedAt: 'as stored', short: ' ', alternates: ['Грех ли?', 'грех ли?', ''], basisIds: ['b1', 'gone'], detail: ' Разбор. ' };
    render(<QuestionEditor questionId="q" bases={[{ id: 'b1', title: 'Мерило' }]} onDone={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.save' })); });
    const updater = mockFormSave.mock.calls[0][0]!;
    const saved = updater({ ...mockDocument! });
    // A basis link the form did not touch stays, even one the theme no longer shows: filtering by the bases
    // known at Save dropped every link of an answer saved while its theme was loading (Codex review).
    expect(saved).toEqual({ userId: 'u', title: 'Можно ли?', rank: 1, updatedAt: 'as stored', alternates: ['Грех ли?'], basisIds: ['b1', 'gone'], detail: 'Разбор.' });
  });
});

describe('a basis', () => {
  beforeEach(() => { mockParams = { themeId: 'clothes', basisId: 'b1' }; mockDocument = { title: 'Одежда' }; });

  it('opens the theme form for an opening-words conflict while reading a basis', () => {
    mockConflictPaths = [['intro']];
    mockComparison = {
      identity: 'theme review from basis', hardQuestionFields: ['intro'], conflictPaths: [['intro']],
      mine: { intro: 'Моё вступление' }, stored: { value: { intro: 'Сохранённое вступление' }, resource: { collection: 'hardQuestionThemes' } },
    };
    render(<HardQuestionBasisPage />);
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.versionComparison' }));
    const dialog = screen.getByRole('dialog', { name: 'hardQuestions.theme.editTitle' });
    expect(within(dialog).getByText('Моё вступление')).toBeInTheDocument();
    expect(within(dialog).getByText('Сохранённое вступление')).toBeInTheDocument();
  });

  it('an edited basis with no place is not saved: the window asks for one (a basis kept before the rule)', async () => {
    mockDocument = { title: 'Одежда', bases: [{ id: 'b1', title: 'Мерило — стыдливость' }] };
    mockFormSave.mockClear();
    render(<HardQuestionBasisPage />);
    await chooseInMenu('hardQuestions.basis.actions', 'hardQuestions.basis.editBasis');
    const dialog = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'common.save' })); });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('hardQuestions.basis.needsPlace');
    expect(within(dialog).getByLabelText('hardQuestions.basis.places')).toHaveFocus();
    expect(mockFormSave).not.toHaveBeenCalled();
  });

  it('has no label field, and saving an older basis drops the label it still holds (removed at the owner\'s word, 2026-11-26)', async () => {
    const stored = { id: 'b1', title: 'Мерило — стыдливость', label: 'Стыдливость', scriptureRefs: ['1 Тим 2:9'], note: 'kept' };
    mockDocument = { title: 'Одежда', bases: [stored] };
    mockFormSave.mockClear();
    render(<HardQuestionBasisPage />);
    expect(screen.queryByText('Стыдливость')).not.toBeInTheDocument();
    await chooseInMenu('hardQuestions.basis.actions', 'hardQuestions.basis.editBasis');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByDisplayValue('Стыдливость')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'common.save' })); });
    expect(mockFormSave).toHaveBeenCalledTimes(1);
    const saved = mockFormSave.mock.calls[0][0]!({ title: 'Одежда', bases: [stored] }) as { bases: unknown[] };
    // Only what the form selects changes: a field it does not show stays (Codex review 2026-11-27).
    expect(saved.bases).toEqual([{ id: 'b1', title: 'Мерило — стыдливость', scriptureRefs: ['1 Тим 2:9'], note: 'kept' }]);
  });

  it('is laid out as the theme\'s page: the basis\'s dot and counts, «⋯» alone in the header, chapters, the theme\'s numbers', async () => {
    render(<HardQuestionBasisPage />);
    const header = screen.getByRole('heading', { level: 1, name: 'Мерило — стыдливость' }).closest('header')!;
    expect(within(header).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['hardQuestions.basis.actions']);
    expect(within(header).getByText('hardQuestions.basis.kind · hardQuestions.counts.questions')).toBeInTheDocument();
    fireEvent.click(within(header).getByRole('button', { name: 'hardQuestions.basis.actions' }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['hardQuestions.basis.editBasis', 'hardQuestions.basis.removeBasis']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    // A basis with no place says so and offers to give it one; the questions carry the numbers the theme gives them.
    const places = screen.getByRole('region', { name: 'hardQuestions.basis.places' });
    expect(within(places).getByText('hardQuestions.theme.noPlaces')).toBeInTheDocument();
    const resting = screen.getByRole('heading', { name: 'hardQuestions.basis.resting' }).closest('section')!;
    const numbers = within(resting).getAllByRole('link').map((link) => link.querySelector('[aria-hidden="true"]')?.textContent);
    const theme = buildLibrary(mockThemes, mockQuestions).themeById.get('clothes')!;
    expect(numbers).toEqual(theme.bases.find((use) => use.basis.id === 'b1')!.questions.map((question) => String(theme.questions.indexOf(question) + 1)));
    fireEvent.click(within(places).getByRole('button', { name: 'hardQuestions.basis.addPlaces' }));
    expect(await screen.findByRole('dialog', { name: 'hardQuestions.basis.editTitle' })).toBeInTheDocument();
  });

  it('shows what rests on it and removes it after saying the answers keep their words', async () => {
    render(<HardQuestionBasisPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Мерило — стыдливость' })).toBeInTheDocument();
    const resting = screen.getByRole('heading', { name: 'hardQuestions.basis.resting' }).closest('section')!;
    expect(within(resting).getAllByRole('link')).toHaveLength(2);
    await chooseInMenu('hardQuestions.basis.actions', 'hardQuestions.basis.removeBasis');
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText('hardQuestions.basis.removeKeeps')).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'common.delete' })); });
    expect(mockActions.removeBasis).toHaveBeenCalledWith('clothes', 'b1');
  });
});

