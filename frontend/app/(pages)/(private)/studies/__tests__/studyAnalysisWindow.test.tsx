import { act, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';

import { fetchBookText } from '@/utils/bibleText';

import { StudyAnalysisWindow } from '../StudyAnalysisWindow';

import type { AnalysisDoor } from '@/components/bible/analysis/AnalysisParts';
import type { StudyNote } from '@/models/models';
import type { ReactNode } from 'react';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), loading: jest.fn(), dismiss: jest.fn() } }));
jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), fetchBookText: jest.fn() }));
// The book's marks cannot open here (the device's storage silent): no tools, but the notice with its Retry.
jest.mock('@/components/bible/analysis/useAnalysisBookMarks', () => ({
  useAnalysisBookMarks: () => ({ source: null, status: require('react').createElement('div', { 'data-testid': 'marks-notice' }) }),
}));
// The analysis screen has its own suites; here only what Studies hands it matters.
let mockDoor: AnalysisDoor | undefined;
jest.mock('@/components/bible/analysis/AnalysisEditor', () => ({
  AnalysisEditor: ({ opening, bible, bookId, backLabel, door, marksStatus }: { opening: { id: string; editing?: boolean }; bible: string; bookId: string; backLabel?: string; door?: AnalysisDoor; marksStatus?: ReactNode }) => {
    mockDoor = door;
    return <div data-testid="editor" data-id={opening.id} data-editing={String(opening.editing)} data-bible={bible} data-book={bookId} data-back={backLabel}>{marksStatus}</div>;
  },
}));

const fetchText = fetchBookText as jest.MockedFunction<typeof fetchBookText>;

const analysis = (overrides: Partial<StudyNote> = {}): StudyNote => ({
  id: 'a1',
  userId: 'u1',
  title: 'Разбор · Еф 1:3–14',
  content: '- Благословен Бог',
  scriptureRefs: [{ id: 'r1', book: 'Ephesians', chapter: 1, fromVerse: 3, toVerse: 14, bible: 'rst' }],
  tags: [],
  createdAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
  isDraft: false,
  type: 'analysis',
  analysis: { bible: 'rst', words: 171, cuts: [], links: {} },
  ...overrides,
});

describe('StudyAnalysisWindow — a passage analysis opened in Studies', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens the Bible\'s analysis screen on the analysis\'s own Bible, whatever the interface speaks', async () => {
    // The interface here is English (King James by default); the analysis was made on the Synodal and its words are
    // counted there — laid on another text they would stand on other words (BUG-20261030-analysis-other-bible-overwrite).
    fetchText.mockResolvedValue({ id: 'Ephesians', chapters: [] } as never);
    render(<StudyAnalysisWindow note={analysis()} editing={false} onClose={jest.fn()} />);
    const editor = await screen.findByTestId('editor');
    expect(fetchText).toHaveBeenCalledWith('Ephesians', 'rst');
    expect(editor).toHaveAttribute('data-bible', 'rst');
    expect(editor).toHaveAttribute('data-book', 'Ephesians');
    expect(editor).toHaveAttribute('data-editing', 'false');
    // Its way back leads to Studies' list, not to a Bible text that is not behind it.
    expect(editor).toHaveAttribute('data-back', 'analysis.backToList');
    // The book's marks' notice reaches the screen, also with no marks to draw (Codex, 04.11).
    expect(within(editor).getByTestId('marks-notice')).toBeInTheDocument();
  });

  it('offers a door to its passage in the Bible, lit there, the way back leading to this analysis open over the list', async () => {
    // The owner, 03.11: «Когда я был в изучении и открыл разбор, я хочу перейти к Библии».
    fetchText.mockResolvedValue({ id: 'Ephesians', chapters: [] } as never);
    render(<StudyAnalysisWindow note={analysis()} editing={false} onClose={jest.fn()} />);
    await screen.findByTestId('editor');
    expect(mockDoor?.home).toBe('bible');
    // Asked at the press: the address then names the analysis in the mode it is in.
    window.history.replaceState(null, '', '/studies?tab=analyses&analysis=a1&mode=edit');
    const href = mockDoor?.href('a1') ?? null;
    expect(href?.startsWith('/bible?')).toBe(true);
    expect(Object.fromEntries(new URL(href ?? '/none', 'https://app.test').searchParams)).toEqual({
      book: 'ephesians', at: '1:3', to: '14', tr: 'rst', read: 'rst', from: '/studies?tab=analyses&analysis=a1&mode=edit',
    });
  });

  it('says it is reading the book when the book takes a moment — and nothing for one kept on the device', async () => {
    // Codex UX, 04.11: a book not kept on the device rendered nothing while it came, and the press looked like it did nothing.
    const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
    let arrive: (book: never) => void = () => {};
    fetchText.mockReturnValue(new Promise((resolve) => { arrive = resolve; }) as never);
    const onClose = jest.fn();
    const { unmount } = render(<StudyAnalysisWindow note={analysis()} editing={false} onClose={onClose} />);
    await pause(200);
    expect(toast.loading).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.loading).toHaveBeenCalledWith('bible.loading', expect.objectContaining({ id: expect.any(String) })));
    const { id, action } = (toast.loading as jest.Mock).mock.calls[0][1] as { id: string; action: { label: string; onClick: () => void } };
    // Codex, 04.11: a book that takes long must be let go — the person may turn to something else meanwhile.
    expect(action.label).toBe('common.cancel');
    act(() => action.onClick());
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { arrive({ id: 'Ephesians', chapters: [] } as never); });
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    expect(toast.dismiss).toHaveBeenCalledWith(id);
    unmount();
    (toast.loading as jest.Mock).mockClear();
    fetchText.mockResolvedValue({ id: 'Ephesians', chapters: [] } as never);
    render(<StudyAnalysisWindow note={analysis()} editing={false} onClose={jest.fn()} />);
    await screen.findByTestId('editor');
    await pause(700);
    expect(toast.loading).not.toHaveBeenCalled();
  });

  it('says a book it cannot read and opens nothing', async () => {
    fetchText.mockRejectedValue(new Error('offline'));
    const onClose = jest.fn();
    render(<StudyAnalysisWindow note={analysis()} editing onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('bible.loadError');
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
  });
});
