import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { createSermon } from '@/services/sermon.service';
import { cutStudyNoteIntoScratch, CutStudyNoteError, fetchNoteCutOutline } from '@/services/studies.service';
import { sermonDetailKey, sermonListKey } from '@/utils/queryKeys';

import CreateSermonFromNoteModal, { pickVerseFromRefs } from '../CreateSermonFromNoteModal';

import type { ScratchNote, Sermon } from '@/models/models';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: React.ReactNode) => node,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options === 'object' && Object.keys(options).length > 0
        ? `${key}:${JSON.stringify(options)}`
        : key,
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/hooks/useResolvedUid', () => ({
  useResolvedUid: () => ({ uid: 'u1', isAuthLoading: false }),
}));

jest.mock('@/services/sermon.service', () => ({
  createSermon: jest.fn(),
}));

jest.mock('@/services/studies.service', () => ({
  cutStudyNoteIntoScratch: jest.fn(),
  fetchNoteCutOutline: jest.fn(),
  CutStudyNoteError: class CutStudyNoteError extends Error {
    status: number;
    usageCap: unknown;
    constructor(message: string, status: number, usageCap: unknown = null) {
      super(message);
      this.name = 'CutStudyNoteError';
      this.status = status;
      this.usageCap = usageCap;
    }
  },
}));

const mockCut = cutStudyNoteIntoScratch as jest.Mock;
const mockOutline = fetchNoteCutOutline as jest.Mock;

/** What the outline route answers for a note that fits in one request. */
const oneSliceOutline = {
  noteId: 'n1',
  words: 6300,
  totalSections: 13,
  sections: [],
  slices: [{ offset: 0, limit: 13, words: 6300 }],
  corridor: { min: 16, max: 26 },
};
const mockCreate = createSermon as jest.Mock;

const refs = [
  { book: '1 Chronicles', chapter: 1, toChapter: 9, fromVerse: 1, id: 'range' },
  { book: '1 Chronicles', chapter: 4, fromVerse: 9, toVerse: 10, id: 'key' },
];

const atoms: ScratchNote[] = [
  { id: 'a1', text: 'Мысль первая. (1 Пар 4:9)', createdAt: '2026-09-05T00:00:00.000Z', source: { noteId: 'n1', heading: 'Раздел' } },
  { id: 'a2', text: 'Мысль вторая. (1 Пар 4:10)', createdAt: '2026-09-05T00:00:00.001Z', source: { noteId: 'n1', heading: 'Раздел' } },
];

/** The manuscript the corridor was checked against live: 113 paragraphs, ~6,300 words. */
const LONG_NOTE = Array.from({ length: 113 }, () =>
  Array.from({ length: 56 }, () => 'слово').join(' ')
).join('\n\n');

const cutAnswer = { noteId: 'n1', keyPassage: '1 Пар 4:9-10', sections: [{ heading: 'Раздел', count: 2 }], notes: atoms };

const bornSermon = {
  id: 's-new',
  title: 'Молитва Иависа',
  verse: '1 Пар 4:9-10',
  date: '2026-09-05T00:00:00.000Z',
  thoughts: [],
  userId: 'u1',
  sourceNoteIds: ['n1'],
  scratch: atoms,
} as Sermon;

function renderModal(overrides: Partial<React.ComponentProps<typeof CreateSermonFromNoteModal>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = jest.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <CreateSermonFromNoteModal
        noteId="n1"
        noteTitle="Молитва Иависа"
        scriptureRefs={refs}
        noteContent={LONG_NOTE}
        onClose={onClose}
        {...overrides}
      />
    </QueryClientProvider>
  );
  return { ...utils, queryClient, onClose };
}

const createButton = () => screen.getByRole('button', { name: 'studiesWorkspace.createSermon.create' });
const retryButton = () => screen.getByRole('button', { name: 'studiesWorkspace.createSermon.retry' });
const openButton = () => screen.getByTestId('create-sermon-open');
const titleInput = () => screen.getByLabelText('studiesWorkspace.createSermon.titleLabel');
const verseInput = () => screen.getByLabelText('studiesWorkspace.createSermon.verseLabel') as HTMLTextAreaElement;

describe('pickVerseFromRefs', () => {
  it('prefers a verse over a chapter range, whatever the order', () => {
    expect(pickVerseFromRefs(refs as never, 'en')).toContain('4:9');
    expect(pickVerseFromRefs([], 'en')).toBe('');
  });
});

describe('CreateSermonFromNoteModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOutline.mockResolvedValue(oneSliceOutline);
    mockCut.mockResolvedValue(cutAnswer);
    mockCreate.mockResolvedValue(bornSermon);
  });

  it('shows what will be created before anything is: title, verse and the expected count', () => {
    renderModal();
    expect(titleInput()).toHaveValue('Молитва Иависа');
    expect(verseInput().value).toContain('4:9');
    expect(screen.getByTestId('create-sermon-expectation')).toHaveTextContent(
      'studiesWorkspace.createSermon.expected:{"count":26,"min":16,"max":26}'
    );
    expect(mockCut).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('measures the note in words and paragraphs, and explains the number only when asked', async () => {
    const user = userEvent.setup();
    renderModal();

    const block = screen.getByTestId('create-sermon-expectation');
    // Units a person can picture — 42 paragraphs and ~5,800 words, never a character count.
    // The counted labels sit INSIDE the line's own interpolation, so the mocked t()
    // serialises them twice and the inner quotes arrive escaped.
    const measured = block.textContent ?? '';
    expect(measured).toContain('measureParagraphs:{\\"count\\":113,\\"formatted\\":\\"113\\"}');
    expect(measured).toContain('measureWords:{\\"count\\":6300,\\"formatted\\":\\"6,300\\"}');
    expect(measured).not.toContain('chars');

    // The reasoning is folded away until the person asks for it.
    expect(screen.queryByTestId('create-sermon-expectation-explainer')).toBeNull();
    const info = screen.getByTestId('create-sermon-expectation-info');
    expect(info).toHaveAttribute('aria-expanded', 'false');

    await user.click(info);
    const explainer = screen.getByTestId('create-sermon-expectation-explainer');
    expect(info).toHaveAttribute('aria-expanded', 'true');
    expect(explainer).toHaveTextContent('studiesWorkspace.createSermon.explainWhat');
    // The rate quoted to the reader comes from the corridor's own constants, not a literal.
    expect(explainer).toHaveTextContent('studiesWorkspace.createSermon.explainHow:{"from":250,"to":400}');
    // The rate in paragraphs is DERIVED from this note (113 paragraphs over 16–26 notes),
    // never a fixed phrase: 56-word paragraphs make it 4–7, not the "one or two" a guess
    // would have promised.
    expect(explainer.textContent).toContain('explainRateParagraphs:{\\"count\\":7,\\"from\\":4,\\"to\\":7}');
    expect(explainer).toHaveTextContent('studiesWorkspace.createSermon.explainHereWithRate');

    await user.click(info);
    expect(screen.queryByTestId('create-sermon-expectation-explainer')).toBeNull();
  });

  it('cuts first, then creates the sermon under one client id with the link and the atoms, then opens the scratch mode', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderModal();
    queryClient.setQueryData(sermonListKey('u1'), [{ id: 'older' } as Sermon]);

    await user.clear(titleInput());
    await user.type(titleInput(), 'Рука Господня');
    await user.click(createButton());

    // The dialog STAYS when it is done: what was made is shown, and one button opens it.
    await waitFor(() => expect(screen.getByTestId('create-sermon-done')).toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-sermon-done')).toHaveTextContent('studiesWorkspace.createSermon.success:{"count":2}');
    expect(openButton()).toHaveFocus();
    await user.click(openButton());
    expect(mockPush).toHaveBeenCalledWith('/sermons/s-new?mode=raw');

    expect(mockCut).toHaveBeenCalledWith('n1', { offset: 0, limit: 13, words: 6300 });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: 'Рука Господня',
        // The verse was never touched, so the cutter's key passage replaces the guessed prefill.
        verse: '1 Пар 4:9-10',
        userId: 'u1',
        thoughts: [],
        sourceNoteIds: ['n1'],
        scratch: atoms,
      })
    );
    expect(mockCreate.mock.calls[0][0].id.length).toBeGreaterThan(0);
    expect(mockCut.mock.invocationCallOrder[0]).toBeLessThan(mockCreate.mock.invocationCallOrder[0]);
    expect(screen.getByTestId('create-sermon-key-passage')).toHaveTextContent(
      'studiesWorkspace.createSermon.keyPassageApplied:{"passage":"1 Пар 4:9-10"}'
    );
    expect(verseInput()).toHaveValue('1 Пар 4:9-10');

    expect(queryClient.getQueryData(sermonDetailKey('u1', 's-new'))).toEqual(bornSermon);
    expect((queryClient.getQueryData(sermonListKey('u1')) as Sermon[]).map((sermon) => sermon.id)).toEqual(['s-new', 'older']);
    for (const key of ['plan', 'cut:0', 'create']) {
      expect(screen.getByTestId(`create-sermon-step-${key}`)).toHaveAttribute('data-status', 'done');
    }
    expect(screen.getByTestId('create-sermon-step-cut:0')).toHaveTextContent('studiesWorkspace.createSermon.cutDone:{"count":2}');
  });

  it('a verse the person typed is never replaced by the key passage', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.clear(verseInput());
    await user.type(verseInput(), 'Ин 15:5');
    await user.click(createButton());

    await waitFor(() => expect(screen.getByTestId('create-sermon-done')).toBeInTheDocument());
    expect(mockCreate.mock.calls[0][0]).toEqual(expect.objectContaining({ verse: 'Ин 15:5' }));
    expect(screen.queryByTestId('create-sermon-key-passage')).toBeNull();
  });

  it('a note without attached references can still be cut: the key passage becomes the verse', async () => {
    const user = userEvent.setup();
    renderModal({ scriptureRefs: [] });
    expect(verseInput()).toHaveValue('');
    expect(createButton()).toBeEnabled();

    await user.click(createButton());
    await waitFor(() => expect(screen.getByTestId('create-sermon-done')).toBeInTheDocument());
    expect(mockCreate.mock.calls[0][0]).toEqual(expect.objectContaining({ verse: '1 Пар 4:9-10' }));
  });

  it('with no verse from anywhere, stops before creating and lets the person type one', async () => {
    const user = userEvent.setup();
    mockCut.mockResolvedValue({ ...cutAnswer, keyPassage: '' });
    renderModal({ scriptureRefs: [] });

    await user.click(createButton());
    await waitFor(() => expect(screen.getByTestId('create-sermon-step-create')).toHaveAttribute('data-status', 'error'));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-sermon-step-create')).toHaveTextContent('studiesWorkspace.createSermon.errors.verseRequired');

    await user.type(verseInput(), 'Ин 15:5');
    await user.click(retryButton());
    await waitFor(() => expect(screen.getByTestId('create-sermon-done')).toBeInTheDocument());
    expect(mockCut).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toEqual(expect.objectContaining({ verse: 'Ин 15:5' }));
  });

  it('a failed cut writes nothing and offers to try the cut again', async () => {
    const user = userEvent.setup();
    mockCut.mockRejectedValueOnce(new CutStudyNoteError('boom', 500));
    renderModal();

    await user.click(createButton());

    await waitFor(() => expect(screen.getByTestId('create-sermon-step-cut:0')).toHaveAttribute('data-status', 'error'));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-sermon-step-cut:0')).toHaveTextContent('studiesWorkspace.createSermon.errors.cutFailed');

    await user.click(retryButton());
    await waitFor(() => expect(screen.getByTestId('create-sermon-done')).toBeInTheDocument());
    expect(mockCut).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('a failed create keeps the atoms, does not pay for a second cut, and retries under the SAME id', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValueOnce(new Error('network'));
    renderModal();

    await user.click(createButton());
    await waitFor(() => expect(screen.getByTestId('create-sermon-step-create')).toHaveAttribute('data-status', 'error'));
    expect(screen.getByTestId('create-sermon-step-create')).toHaveTextContent('studiesWorkspace.createSermon.errors.createFailed');

    await user.click(retryButton());
    await waitFor(() => expect(screen.getByTestId('create-sermon-done')).toBeInTheDocument());
    expect(mockCut).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][0].id).toBe(mockCreate.mock.calls[0][0].id);
  });

  it('names a usage cap, an empty cut and an over-long note for what they are', async () => {
    const user = userEvent.setup();
    mockCut.mockRejectedValueOnce(new CutStudyNoteError('cap', 429, { code: 'USAGE_CAP_REACHED' } as never));
    renderModal();
    await user.click(createButton());
    await waitFor(() => expect(screen.getByTestId('create-sermon-step-cut:0')).toHaveAttribute('data-status', 'error'));
    expect(screen.getByTestId('create-sermon-step-cut:0')).toHaveTextContent('studiesWorkspace.createSermon.errors.usageCap');

    mockCut.mockRejectedValueOnce(new CutStudyNoteError('nothing', 422));
    await user.click(retryButton());
    await waitFor(() => expect(screen.getByTestId('create-sermon-step-cut:0')).toHaveTextContent('studiesWorkspace.createSermon.errors.nothingCut'));

    mockCut.mockRejectedValueOnce(new CutStudyNoteError('long', 413));
    await user.click(retryButton());
    await waitFor(() =>
      expect(screen.getByTestId('create-sermon-step-cut:0')).toHaveTextContent('studiesWorkspace.createSermon.errors.noteTooLong:{"limit":9}')
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('cuts a long note in slices: a step per slice, in the sections the author wrote', async () => {
    const user = userEvent.setup();
    mockOutline.mockResolvedValue({
      ...oneSliceOutline,
      slices: [
        { offset: 0, limit: 5, words: 2400 },
        { offset: 5, limit: 4, words: 1900 },
        { offset: 9, limit: 4, words: 2000 },
      ],
    });
    mockCut
      .mockResolvedValueOnce({ ...cutAnswer, notes: [atoms[0]] })
      .mockResolvedValueOnce({ ...cutAnswer, keyPassage: '', notes: [atoms[1]] })
      .mockResolvedValueOnce({ ...cutAnswer, keyPassage: '', notes: [atoms[0]] });

    renderModal();
    await user.click(createButton());
    await waitFor(() => expect(screen.getByTestId('create-sermon-step-create')).toHaveAttribute('data-status', 'done'));

    // Each slice is one request, asked for by section window, in reading order.
    expect(mockCut.mock.calls.map((call) => call[1])).toEqual([
      { offset: 0, limit: 5, words: 2400 },
      { offset: 5, limit: 4, words: 1900 },
      { offset: 9, limit: 4, words: 2000 },
    ]);
    expect(screen.getByTestId('create-sermon-step-cut:1')).toHaveTextContent(
      'studiesWorkspace.createSermon.steps.cutSlice:{"from":6,"to":9,"total":13}'
    );
    // Every slice's atoms reach the sermon, in the order the note is read.
    expect(mockCreate.mock.calls[0][0].scratch).toEqual([atoms[0], atoms[1], atoms[0]]);
  });

  it('a slice that fails is retried alone: what is already cut is not paid for twice', async () => {
    const user = userEvent.setup();
    mockOutline.mockResolvedValue({
      ...oneSliceOutline,
      slices: [
        { offset: 0, limit: 7, words: 3000 },
        { offset: 7, limit: 6, words: 3000 },
      ],
    });
    mockCut
      .mockResolvedValueOnce({ ...cutAnswer, notes: [atoms[0]] })
      .mockRejectedValueOnce(new CutStudyNoteError('503 status code (no body)', 500))
      .mockResolvedValueOnce({ ...cutAnswer, keyPassage: '', notes: [atoms[1]] });

    renderModal();
    await user.click(createButton());
    await waitFor(() => expect(screen.getByTestId('create-sermon-step-cut:1')).toHaveAttribute('data-status', 'error'));
    expect(screen.getByTestId('create-sermon-step-cut:0')).toHaveAttribute('data-status', 'done');
    expect(mockCreate).not.toHaveBeenCalled();

    await user.click(retryButton());
    await waitFor(() => expect(screen.getByTestId('create-sermon-step-create')).toHaveAttribute('data-status', 'done'));

    // Three calls in all: the first slice was cut once, the second twice.
    expect(mockCut).toHaveBeenCalledTimes(3);
    expect(mockCut.mock.calls.map((call) => call[1].offset)).toEqual([0, 7, 7]);
    // The outline is read once — the plan does not change because a slice failed.
    expect(mockOutline).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].scratch).toEqual([atoms[0], atoms[1]]);
  });

  it('a note that cannot even be read says so, and costs no AI call', async () => {
    const user = userEvent.setup();
    mockOutline.mockRejectedValueOnce(new CutStudyNoteError('nope', 500));

    renderModal();
    await user.click(createButton());
    await waitFor(() => expect(screen.getByTestId('create-sermon-step-plan')).toHaveAttribute('data-status', 'error'));
    expect(screen.getByTestId('create-sermon-step-plan')).toHaveTextContent('studiesWorkspace.createSermon.errors.planFailed');
    expect(mockCut).not.toHaveBeenCalled();
  });

  it('a long verse wraps in the field instead of scrolling its beginning off-screen', async () => {
    const user = userEvent.setup();
    renderModal();

    // A person who pastes the whole verse, not just its reference. The field is a
    // textarea so the text wraps and its beginning stays visible; the value is still one
    // line — a pasted newline becomes a space rather than travelling into the sermon.
    const field = verseInput();
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveAttribute('rows', '1');
    expect(field.className).toContain('resize-none');

    await user.clear(field);
    await user.paste('И воззвал Иавис к Богу Израилеву:\nо, если бы Ты благословил меня!');
    expect(field.value).toBe('И воззвал Иавис к Богу Израилеву: о, если бы Ты благословил меня!');
  });

  it('will not start without a title, and not at all on an empty note', async () => {
    const user = userEvent.setup();
    const { unmount } = renderModal();
    await user.clear(titleInput());
    expect(createButton()).toBeDisabled();
    unmount();

    renderModal({ noteContent: '' });
    expect(createButton()).toBeDisabled();
    expect(screen.queryByTestId('create-sermon-expectation')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('studiesWorkspace.createSermon.errors.empty');
    expect(mockCut).not.toHaveBeenCalled();
  });

  it('can always be closed — while idle on Escape with focus handed back, and while a step is running', async () => {
    const user = userEvent.setup();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    const { onClose, unmount } = renderModal({ returnFocusTo: { current: opener } });

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    opener.remove();
    unmount();

    let releaseCut: (value: typeof cutAnswer) => void = () => undefined;
    mockCut.mockImplementationOnce(() => new Promise((resolve) => { releaseCut = resolve; }));
    const second = renderModal();
    await user.click(createButton());
    await waitFor(() => expect(screen.getByTestId('create-sermon-step-cut:0')).toHaveAttribute('data-status', 'running'));
    await waitFor(() => expect(screen.getByTestId('create-sermon-steps')).toHaveFocus());
    // Two controls now read "close": the corner X and the footer button. Either works.
    const closers = screen.getAllByRole('button', { name: 'studiesWorkspace.createSermon.close' });
    await user.click(closers[closers.length - 1]);
    expect(second.onClose).toHaveBeenCalledTimes(1);
    releaseCut(cutAnswer);
  });
});
