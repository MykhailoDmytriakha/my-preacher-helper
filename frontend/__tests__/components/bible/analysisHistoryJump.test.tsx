import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { ReaderAnalysis } from '@/components/bible/analysis/ReaderAnalysis';
import { useAnalysisAddress } from '@/components/bible/analysis/useAnalysisAddress';
import { historyStepHere } from '@/utils/historyStep';

import { fetchBookText } from '@/utils/bibleText';

import { StudyAnalysisWindow, useStudyAnalysisOpening } from '../../../app/(pages)/(private)/studies/StudyAnalysisWindow';

import type { AnalysisOpening } from '@/components/bible/analysis/useAnalysisNote';
import type { VerseCopy } from '@/components/bible/verseCopy/useVerseCopy';
import type { StudyNote } from '@/models/models';
import type { BookText } from '@/utils/bibleText';

/*
 * Codex, 04.11: analysis B open, analysis A's earlier entry picked from Back's list of history. The host opened nothing,
 * since B was still open when it looked; B then closed — and the address named A with no screen showing it. Both hosts —
 * Studies' list and the reader — open the analysis the address names once the one left has closed.
 */
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { error: jest.fn(), loading: jest.fn(), dismiss: jest.fn() }) }));
jest.mock('@/components/bible/analysis/AnalysisEditor', () => ({
  AnalysisEditor: ({ opening, onClose }: { opening: AnalysisOpening; onClose: () => void }) => {
    const id = opening.kind === 'open' ? opening.id : null;
    const mode = opening.kind === 'open' && opening.editing ? 'edit' : 'view';
    useAnalysisAddress({ opening, id, mode, gone: false, onGone: onClose, onBack: onClose });
    return <div data-testid="screen" data-id={id ?? ''} data-mode={mode} />;
  },
}));
jest.mock('@/components/bible/analysis/useAnalysisReshape', () => ({ useAnalysisReshape: () => jest.fn() }));
jest.mock('@/components/bible/verseCopy/VerseCopyBar', () => ({ VerseCopyBar: () => null }));
jest.mock('@/components/bible/verseCopy/PassagePickBar', () => ({ PassagePickBar: () => null }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/utils/bibleText', () => ({ ...jest.requireActual('@/utils/bibleText'), fetchBookText: jest.fn() }));
jest.mock('@/components/bible/analysis/useAnalysisBookMarks', () => ({ useAnalysisBookMarks: () => ({ source: null, status: null }) }));

const analysis = (id: string): StudyNote => ({
  id, userId: 'u', title: `Разбор ${id}`, content: '', tags: [], isDraft: false, materialIds: [], createdAt: '', updatedAt: '',
  type: 'analysis', scriptureRefs: [],
} as StudyNote);
const here = () => `${window.location.pathname}${window.location.search}`;

function StudiesHost({ notes }: { notes: StudyNote[] }) {
  const { opened, open, close } = useStudyAnalysisOpening(notes, false);
  return (
    <>
      {opened ? <ScreenInStudies key={opened.note.id} id={opened.note.id} onClose={close} /> : null}
      <button type="button" onClick={() => open(notes[1], false)}>B</button>
    </>
  );
}
function ScreenInStudies({ id, onClose }: { id: string; onClose: () => void }) {
  useAnalysisAddress({ opening: { kind: 'open', id, editing: false }, id, mode: 'view', gone: false, onGone: onClose, onBack: onClose });
  return <div data-testid="screen" data-id={id} />;
}

const TEXT: BookText = { id: 'Ephesians', chapters: [['Павел']] };
const copy = { purpose: null, picking: false, clear: jest.fn(), startPassage: jest.fn() } as unknown as VerseCopy;
function ReaderHost() {
  const [opening, setOpening] = useState<AnalysisOpening | null>(null);
  return (
    <>
      <ReaderAnalysis copy={copy} text={TEXT} wide bookId="Ephesians" bible="rst" locale="ru" opening={opening} onOpening={setOpening} onOpenScreen={jest.fn()} />
      <button type="button" onClick={() => setOpening({ kind: 'open', id: 'b', editing: false })}>B</button>
    </>
  );
}

function StudiesWindowHost({ notes }: { notes: StudyNote[] }) {
  const { opened, close } = useStudyAnalysisOpening(notes, false);
  return opened ? <StudyAnalysisWindow key={opened.note.id} note={opened.note} editing={opened.editing} onClose={close} /> : null;
}

const withPassage = (id: string) => ({ ...analysis(id), scriptureRefs: [{ id: 'r', book: 'Ephesians', chapter: 1, fromVerse: 1, toVerse: 2 }] } as StudyNote);
const BOOK = { id: 'Ephesians', chapters: [['Павел']] };

describe('a jump in history from one analysis\'s step to another\'s', () => {
  it('while an analysis\'s book comes in the same moment as Back, nothing opens over where Back led', async () => {
    // Codex, 04.11 (round 4): the book resolved between Back and the host's look; the screen mounted and wrote its address
    // again, and the host kept it.
    let arrive: (book: never) => void = () => {};
    (fetchBookText as jest.Mock).mockReturnValue(new Promise((resolve) => { arrive = resolve; }));
    const LIST = '/studies?tab=analyses';
    window.history.pushState(null, '', LIST);
    window.history.pushState(null, '', `${LIST}&analysis=a&mode=view`);
    render(<StudiesWindowHost notes={[withPassage('a')]} />);
    const sameMoment = () => arrive(BOOK as never);
    window.addEventListener('popstate', sameMoment, { once: true });
    act(() => window.history.back());
    await waitFor(() => expect(here()).toBe(LIST));
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(screen.queryByTestId('screen')).not.toBeInTheDocument();
    expect(here()).toBe(LIST);
  });

  it('back to the same analysis in its other mode, while the book is still coming, opens it in that mode', async () => {
    // Codex, 04.11 (round 4): the waiting opening was kept for the same analysis in the mode of the entry left.
    let arrive: (book: never) => void = () => {};
    (fetchBookText as jest.Mock).mockReturnValue(new Promise((resolve) => { arrive = resolve; }));
    const EDIT = '/studies?tab=analyses&analysis=a&mode=edit';
    window.history.pushState({ screenStep: 'a-edit' }, '', EDIT);
    window.history.pushState({ screenStep: 'a-view' }, '', '/studies?tab=analyses&analysis=a&mode=view');
    render(<StudiesWindowHost notes={[withPassage('a')]} />);
    act(() => window.history.back());
    await waitFor(() => expect(here()).toBe(EDIT));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    await act(async () => { arrive(BOOK as never); });
    await waitFor(() => expect(screen.getByTestId('screen')).toHaveAttribute('data-mode', 'edit'));
    expect(here()).toBe(EDIT);
  });

  it('while an analysis\'s book is still coming, Back lets the opening go: nothing opens later over where Back led', async () => {
    // Codex, 04.11: the window had no screen yet to hear Back, and opened when the book came, over the list it had left.
    let arrive: (book: never) => void = () => {};
    (fetchBookText as jest.Mock).mockReturnValue(new Promise((resolve) => { arrive = resolve; }));
    const LIST = '/studies?tab=analyses';
    window.history.pushState(null, '', LIST);
    window.history.pushState(null, '', `${LIST}&analysis=a&mode=view`);
    render(<StudiesWindowHost notes={[{ ...analysis('a'), scriptureRefs: [{ id: 'r', book: 'Ephesians', chapter: 1, fromVerse: 1, toVerse: 2 }] } as StudyNote]} />);
    act(() => window.history.back());
    await waitFor(() => expect(here()).toBe(LIST));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    await act(async () => { arrive({ id: 'Ephesians', chapters: [['Павел']] } as never); });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.queryByTestId('screen')).not.toBeInTheDocument();
    expect(here()).toBe(LIST);
  });

  // Screens left mounted are unmounted here and take their steps a moment later: let that end inside this test.
  afterEach(async () => {
    cleanup();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    window.history.replaceState(null, '', '/');
  });

  it('over Studies\' list, opens the analysis the entry names', async () => {
    const A = '/studies?tab=analyses&analysis=a&mode=view';
    window.history.pushState({ screenStep: 'a-step' }, '', A);
    window.history.pushState(null, '', '/bible?book=ephesians');
    window.history.pushState(null, '', '/studies?tab=analyses');
    render(<StudiesHost notes={[analysis('a'), analysis('b')]} />);
    act(() => screen.getByRole('button', { name: 'B' }).click());
    expect(screen.getByTestId('screen')).toHaveAttribute('data-id', 'b');
    act(() => window.history.go(-3));
    await waitFor(() => expect(here()).toBe(A));
    await waitFor(() => expect(screen.getByTestId('screen')).toHaveAttribute('data-id', 'a'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(here()).toBe(A);
    expect(historyStepHere()).toBe('a-step');
  });

  it('over the reader\'s text, opens the analysis the entry names', async () => {
    const A = '/bible?book=ephesians&analysis=a&mode=view';
    window.history.pushState({ screenStep: 'a-step' }, '', A);
    window.history.pushState(null, '', '/studies?tab=analyses');
    window.history.pushState(null, '', '/bible?book=ephesians');
    render(<ReaderHost />);
    act(() => screen.getByRole('button', { name: 'B' }).click());
    expect(screen.getByTestId('screen')).toHaveAttribute('data-id', 'b');
    act(() => window.history.go(-3));
    await waitFor(() => expect(here()).toBe(A));
    await waitFor(() => expect(screen.getByTestId('screen')).toHaveAttribute('data-id', 'a'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(here()).toBe(A);
  });
});
