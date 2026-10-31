import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';

import kjvEphesians from '../../../public/bible-text/kjv/v1/ephesians.json';

import { AnalysisEditor, type AnalysisOpening } from '@/components/bible/analysis/AnalysisEditor';
import { ReaderAnalysis } from '@/components/bible/analysis/ReaderAnalysis';
import { useDataDocument } from '@/data-engine/react.client';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { passageWords } from '@/utils/passageAnalysis';
import { resetDeviceStorageForTests, STORAGE_ANSWER_SETTLE_MS, STORAGE_SILENCE_MS, STORAGE_WAKE_GRACE_MS, trackStorage } from '@/utils/deviceStorage';

import type { StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';
import type { VerseCopy } from '@/components/bible/verseCopy/useVerseCopy';

jest.mock('@/hooks/useStudyNotesEngine', () => ({
  ...jest.requireActual('@/hooks/useStudyNotesEngine'),
  useStudyNotesEngine: jest.fn(),
}));
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataDocument: jest.fn(),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/bible/verseCopy/VerseCopyBar', () => ({ VerseCopyBar: () => null }));

const rstText: BookText = {
  id: 'Ephesians',
  chapters: [[
    '¶Павел, волею Божиею Апостол Иисуса Христа, находящимся в Ефесе святым и верным во Христе Иисусе:',
    'благодать вам и мир от Бога Отца нашего и Господа Иисуса Христа.',
  ]],
};
const passage = { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 2 };
const rstWordCount = passageWords(rstText, passage).length;
const sourceAnalysis: StudyNote = {
  id: 'rst-analysis-1', userId: 'owner', title: 'Analysis', content: '- Павел волею Божиею\n- Апостол Иисуса Христа', tags: [],
  isDraft: false, createdAt: '2026-10-30T10:00:00.000Z', updatedAt: '2026-10-30T10:00:00.000Z', type: 'analysis',
  scriptureRefs: [{ id: 'reference-1', bible: 'rst', book: 'Ephesians', ...passage }],
  analysis: { bible: 'rst', words: rstWordCount, cuts: [3], links: {}, relations: {} },
};
const locale: AppLocale = 'en';
const baseUrl = '/bible?book=ephesians&read=kjv&return=mine';
const canonicalRstUrl = '/bible?book=ephesians&read=rst&return=mine';

type Engine = {
  uid: string; notes: StudyNote[]; loading: boolean; checking: boolean;
  createNote: jest.Mock; updateNote: jest.Mock;
  recoverAnalysisCreation: jest.Mock; releaseAnalysisCreation: jest.Mock;
  combineAnalysisCreation: jest.Mock; refetch: jest.Mock;
};
let engine: Engine;
let formNote: StudyNote | undefined;
let commit: jest.Mock;

function putAddress(query: string, state: object = { nextRouter: 'preserved' }) {
  window.history.replaceState(state, '', query);
}
function editor(opening: AnalysisOpening, text: BookText, bible: BibleId, onClose = jest.fn()) {
  return { ...render(<AnalysisEditor opening={opening} text={text} bookId="Ephesians" bible={bible} locale={locale} onClose={onClose} />), onClose };
}
function reader(text: BookText, bible: BibleId, initialOpening: AnalysisOpening | null = null) {
  const copy = { purpose: null, picking: false, startPassage: jest.fn(), clear: jest.fn() } as unknown as VerseCopy;
  function Harness() {
    const [opening, onOpening] = useState<AnalysisOpening | null>(initialOpening);
    return <ReaderAnalysis copy={copy} text={text} wide bookId="Ephesians" bible={bible} locale={locale}
      opening={opening} onOpening={onOpening} />;
  }
  return render(<Harness />);
}

beforeEach(() => {
  cleanup();
  engine = { uid: 'owner', notes: [sourceAnalysis], loading: false, checking: false,
    recoverAnalysisCreation: jest.fn().mockResolvedValue(null),
    releaseAnalysisCreation: jest.fn().mockResolvedValue(undefined),
    combineAnalysisCreation: jest.fn().mockResolvedValue('existing-analysis'),
    refetch: jest.fn().mockResolvedValue(undefined),
    createNote: jest.fn().mockImplementation((value: Partial<StudyNote>) => {
      const made: StudyNote = { ...sourceAnalysis, ...value, id: 'created-analysis', type: 'analysis' };
      engine.notes = [...engine.notes, made];
      return { note: made, acceptance: Promise.resolve() };
    }),
    updateNote: jest.fn(() => ({ result: Promise.resolve() })),
  };
  formNote = sourceAnalysis;
  commit = jest.fn(() => Promise.resolve());
  (useStudyNotesEngine as jest.Mock).mockReturnValue(engine);
  (useDataDocument as jest.Mock).mockImplementation((resource: { id: string } | null) => {
    const data = resource ? formNote ?? engine.notes.find((entry) => entry.id === resource.id) ?? null : null;
    return { data, confirmed: data ? { value: data } : null, state: data ? {} : null, status: data ? { phase: 'saved' } : null,
      readOnly: false, loading: false, error: null, commit, recoveryIdentity: {}, retry: jest.fn(), keepLocal: jest.fn(), acceptRemote: jest.fn() };
  });
});

afterEach(() => { cleanup(); jest.restoreAllMocks(); });

describe('an analysis opened outside its original Bible context', () => {
  it.each([false, undefined, true] as const)('moves to its source preserving an explicit or default viewing mode (%s)', async (editing) => {
    putAddress(`${baseUrl}&analysis=${sourceAnalysis.id}&mode=view`);
    const { unmount } = editor({ kind: 'open', id: sourceAnalysis.id, editing }, kjvEphesians as BookText, 'kjv');

    expect(screen.queryByText('Paul')).not.toBeInTheDocument();
    expect(screen.queryByText('Apostle')).not.toBeInTheDocument();
    await waitFor(() => {
      const address = new URL(window.location.href);
      expect(address.searchParams.get('read')).toBe('rst');
      expect(address.searchParams.get('book')).toBe('ephesians');
      expect(address.searchParams.get('analysis')).toBe(sourceAnalysis.id);
      expect(address.searchParams.get('mode')).toBe(editing === true ? 'edit' : 'view');
    });
    expect(window.history.state).toEqual({ nextRouter: 'preserved' });
    unmount();
  });

  it('notifies Next of application navigation while preserving custom history state', () => {
    putAddress(baseUrl, { __NA: true, _N: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['router-tree'], bibleEntry: 'same-visit', custom: 'kept' });
    const replace = jest.spyOn(window.history, 'replaceState');
    const view = editor({ kind: 'open', id: sourceAnalysis.id, editing: false }, kjvEphesians as BookText, 'kjv');
    const arrival = replace.mock.calls.find(([, , url]) => String(url).includes('read=rst'));
    expect(arrival).toBeDefined();
    // Next's real App Router ignores application URL changes carrying these internal dispatch markers.
    expect(arrival![0]).not.toHaveProperty('__NA');
    expect(arrival![0]).not.toHaveProperty('_N');
    expect(arrival![0]).toMatchObject({ bibleEntry: 'same-visit', custom: 'kept' });
    view.unmount();
    replace.mockRestore();
  });

  it('publishes explicit close to Next rather than leaving a stale analysis in router parameters', () => {
    putAddress(`${canonicalRstUrl}&analysis=${sourceAnalysis.id}&mode=view`, { __NA: true, _N: true, bibleEntry: 'visit' });
    reader(rstText, 'rst', { kind: 'open', id: sourceAnalysis.id, editing: false });
    const replace = jest.spyOn(window.history, 'replaceState');
    fireEvent.click(screen.getByRole('button', { name: 'analysis.back' }));
    const closed = replace.mock.calls.find(([, , url]) => !String(url).includes('analysis='));
    expect(closed).toBeDefined();
    expect(closed![0]).not.toHaveProperty('__NA');
    expect(closed![0]).not.toHaveProperty('_N');
    expect(closed![0]).toMatchObject({ bibleEntry: 'visit' });
    replace.mockRestore();
  });

  it('clears only analysis address fields when the person closes the editor', () => {
    putAddress(`${canonicalRstUrl}&analysis=${sourceAnalysis.id}&mode=view`);
    reader(rstText, 'rst', { kind: 'open', id: sourceAnalysis.id, editing: false });
    fireEvent.click(screen.getByRole('button', { name: 'analysis.back' }));

    const address = new URL(window.location.href);
    expect(address.searchParams.get('read')).toBe('rst');
    expect(address.searchParams.has('analysis')).toBe(false);
    expect(address.searchParams.has('mode')).toBe(false);
  });

  it('keeps a newly created analysis address when the reader unmounts to follow navigation', async () => {
    engine.notes = [];
    formNote = undefined;
    putAddress(canonicalRstUrl);
    const view = editor({ kind: 'new', passage }, rstText, 'rst');
    const word = document.querySelector('[data-word="1"]');
    expect(word).not.toBeNull();
    await act(async () => { fireEvent.click(word!); });
    expect(engine.createNote).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(new URL(window.location.href).searchParams.get('analysis')).toBe('created-analysis'));

    view.unmount();
    const address = new URL(window.location.href);
    expect(address.searchParams.get('analysis')).toBe('created-analysis');
    expect(address.searchParams.get('mode')).toBe('edit');
  });

  it('restores edit mode from a direct analysis URL', () => {
    putAddress(`${canonicalRstUrl}&analysis=${sourceAnalysis.id}&mode=edit`);
    reader(rstText, 'rst');

    expect(screen.getByRole('button', { name: 'analysis.modeEdit' })).toHaveAttribute('aria-pressed', 'true');
    expect(new URL(window.location.href).searchParams.get('mode')).toBe('edit');
  });
});


describe('ordinary departure before the first analysis capture', () => {
  type Exit = 'done' | 'back' | 'escape' | 'verses';
  const leave = (exit: Exit) => {
    if (exit === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    else fireEvent.click(screen.getByRole('button', {
      name: exit === 'done' ? 'analysis.done' : exit === 'back' ? 'analysis.back' : 'analysis.editVerses',
    }));
  };
  const firstCapture = async () => {
    engine.notes = [];
    formNote = undefined;
    putAddress(canonicalRstUrl);
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const acceptance = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    let created!: StudyNote;
    engine.createNote.mockImplementation((value: Partial<StudyNote>) => {
      created = { ...sourceAnalysis, ...value, id: 'first-analysis-capture', type: 'analysis' };
      return { note: created, acceptance };
    });
    const onClose = jest.fn(), onEditVerses = jest.fn();
    const opening: AnalysisOpening = { kind: 'new', passage };
    const element = (nextOpening: AnalysisOpening = opening) => <AnalysisEditor opening={nextOpening} text={rstText}
      bookId="Ephesians" bible="rst" locale={locale} onClose={onClose} onEditVerses={onEditVerses} />;
    const view = render(element());
    const word = document.querySelector('[data-word="5"]');
    expect(word).not.toBeNull();
    await act(async () => { fireEvent.click(word!); });
    expect(engine.createNote).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-line="5"]')).not.toBeNull();
    return { view, element, onClose, onEditVerses, resolve, reject, created: () => created };
  };

  describe.each(['pending', 'refused'] as const)('while the first local capture is %s', (state) => {
    it.each(['done', 'back', 'escape', 'verses'] as const)('keeps the authored mark before an ordinary %s departure', async (exit) => {
      const capture = await firstCapture();
      try {
        if (state === 'refused') {
          await act(async () => { capture.reject(new Error('Device capture refused')); });
          expect(screen.getByText('analysis.notKept')).toBeInTheDocument();
        }
        leave(exit);
        // An explicit discard choice is different from an ordinary attempt to leave.
        // A disabled exit or a confirmation may protect the only currently usable copy.
        expect(capture.onClose).not.toHaveBeenCalled();
        expect(capture.onEditVerses).not.toHaveBeenCalled();
        expect(document.querySelector('[data-line="5"]')).not.toBeNull();
        expect(new URL(window.location.href).searchParams.get('analysis')).toBe('first-analysis-capture');
      } finally {
        capture.view.unmount();
        await act(async () => { capture.resolve(); });
      }
    });
  });

  it('leaves an unchanged passage without making an analysis', () => {
    engine.notes = [];
    formNote = undefined;
    putAddress(canonicalRstUrl);
    const view = editor({ kind: 'new', passage }, rstText, 'rst');
    leave('done');
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(engine.createNote).not.toHaveBeenCalled();
  });

  it('leaves normally once the first capture has accepted ownership', async () => {
    const capture = await firstCapture();
    try {
      engine.notes = [capture.created()];
      formNote = capture.created();
      await act(async () => { capture.resolve(); });
      leave('done');
      expect(capture.onClose).toHaveBeenCalledTimes(1);
      expect(capture.onEditVerses).not.toHaveBeenCalled();
      expect(new URL(window.location.href).searchParams.has('analysis')).toBe(false);
    } finally { capture.view.unmount(); }
  });


  it('keeps the mark when Stay is chosen after a capture refusal', async () => {
    const capture = await firstCapture();
    try {
      await act(async () => { capture.reject(new Error('Device capture refused')); });
      leave('done');
      await screen.findByRole('dialog', { name: 'analysis.leaveUnkept.title' });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'analysis.leaveUnkept.stay' })); });
      expect(screen.queryByRole('dialog', { name: 'analysis.leaveUnkept.title' })).not.toBeInTheDocument();
      expect(capture.onClose).not.toHaveBeenCalled();
      expect(document.querySelector('[data-line="5"]')).not.toBeNull();
      expect(new URL(window.location.href).searchParams.get('analysis')).toBe('first-analysis-capture');
    } finally { capture.view.unmount(); await act(async () => { capture.resolve(); }); }
  });

  it.each(['done', 'back', 'escape', 'verses'] as const)('performs the %s departure only after explicit Leave', async (exit) => {
    const capture = await firstCapture();
    try {
      await act(async () => { capture.reject(new Error('Device capture refused')); });
      leave(exit);
      await screen.findByRole('dialog', { name: 'analysis.leaveUnkept.title' });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'analysis.leaveUnkept.leave' })); });
      expect(capture.onClose).toHaveBeenCalledTimes(exit === 'verses' ? 0 : 1);
      expect(capture.onEditVerses).toHaveBeenCalledTimes(exit === 'verses' ? 1 : 0);
      expect(new URL(window.location.href).searchParams.has('analysis')).toBe(false);
      expect(engine.createNote).toHaveBeenCalledTimes(1);
      expect(engine.updateNote).not.toHaveBeenCalled();
    } finally { capture.view.unmount(); await act(async () => { capture.resolve(); }); }
  });

  it('lets Escape dismiss the departure question without dismissing the unkept analysis', async () => {
    const capture = await firstCapture();
    try {
      leave('done');
      await screen.findByRole('dialog', { name: 'analysis.leaveUnkept.title' });
      await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
      expect(screen.queryByRole('dialog', { name: 'analysis.leaveUnkept.title' })).not.toBeInTheDocument();
      expect(capture.onClose).not.toHaveBeenCalled();
      expect(document.querySelector('[data-line="5"]')).not.toBeNull();
      leave('escape');
      expect(await screen.findByRole('dialog', { name: 'analysis.leaveUnkept.title' })).toBeInTheDocument();
      expect(capture.onClose).not.toHaveBeenCalled();
    } finally { capture.view.unmount(); await act(async () => { capture.resolve(); }); }
  });

  it('withdraws an obsolete question when the original first capture is accepted', async () => {
    const capture = await firstCapture();
    try {
      leave('done');
      await screen.findByRole('dialog', { name: 'analysis.leaveUnkept.title' });
      engine.notes = [capture.created()]; formNote = capture.created();
      await act(async () => { capture.resolve(); });
      expect(screen.queryByRole('dialog', { name: 'analysis.leaveUnkept.title' })).not.toBeInTheDocument();
      expect(capture.onClose).not.toHaveBeenCalled();
      leave('done');
      expect(capture.onClose).toHaveBeenCalledTimes(1);
    } finally { capture.view.unmount(); }
  });

  it.each(['account', 'opening'] as const)('withdraws a question belonging to the previous %s', async (changed) => {
    const capture = await firstCapture();
    try {
      leave('done');
      await screen.findByRole('dialog', { name: 'analysis.leaveUnkept.title' });
      if (changed === 'account') engine.uid = 'next-owner';
      capture.view.rerender(capture.element(changed === 'opening'
        ? { kind: 'new', passage: { chapter: 1, fromVerse: 2, toChapter: 1, toVerse: 2 } } : undefined));
      expect(screen.queryByRole('dialog', { name: 'analysis.leaveUnkept.title' })).not.toBeInTheDocument();
      expect(capture.onClose).not.toHaveBeenCalled();
      expect(capture.onEditVerses).not.toHaveBeenCalled();
      expect(engine.createNote).toHaveBeenCalledTimes(1);
    } finally { capture.view.unmount(); await act(async () => { capture.resolve(); }); }
  });

  it('retries a refusal under the original creation target, then leaves without another question', async () => {
    const capture = await firstCapture();
    try {
      await act(async () => { capture.reject(new Error('Device capture refused')); });
      engine.createNote.mockImplementationOnce((value: Partial<StudyNote>) => {
        const made = { ...capture.created(), ...value };
        engine.notes = [made]; formNote = made;
        return { note: made, acceptance: Promise.resolve() };
      });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'analysis.saveAgain' })); });
      expect(engine.createNote).toHaveBeenCalledTimes(2);
      expect(engine.createNote.mock.calls[1][1]).toEqual(engine.createNote.mock.calls[0][1]);
      expect(engine.createNote.mock.calls[1][0].analysis.cuts).toEqual([5]);
      leave('done');
      expect(capture.onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'analysis.leaveUnkept.title' })).not.toBeInTheDocument();
    } finally { capture.view.unmount(); }
  });

  it('shows shared storage silence without failing or duplicating an unanswered first write', async () => {
    const capture = await firstCapture();
    let answerStorage!: () => void;
    jest.useFakeTimers();
    const pendingStorage = trackStorage('engine-state', new Promise<void>(resolve => { answerStorage = resolve; }));
    try {
      expect(screen.getByText('analysis.firstCaptureSaving')).toBeInTheDocument();
      expect(screen.queryByText('analysis.loading')).not.toBeInTheDocument();
      await act(async () => { await jest.advanceTimersByTimeAsync(STORAGE_SILENCE_MS + STORAGE_WAKE_GRACE_MS + 1); });
      expect(screen.getByText('deviceStorage.title')).toBeInTheDocument();
      expect(screen.getByText('analysis.firstCaptureWaiting')).toBeInTheDocument();
      expect(screen.queryByText('analysis.notKept')).not.toBeInTheDocument();
      expect(engine.createNote).toHaveBeenCalledTimes(1);
      await act(async () => {
        answerStorage(); await pendingStorage;
        await jest.advanceTimersByTimeAsync(STORAGE_ANSWER_SETTLE_MS + STORAGE_WAKE_GRACE_MS + 1);
      });
      expect(screen.getByText('analysis.firstCaptureSaving')).toBeInTheDocument();
      engine.notes = [capture.created()]; formNote = capture.created();
      await act(async () => { capture.resolve(); });
      expect(screen.queryByText('analysis.firstCaptureSaving')).not.toBeInTheDocument();
      expect(screen.queryByText('analysis.firstCaptureWaiting')).not.toBeInTheDocument();
      expect(engine.createNote).toHaveBeenCalledTimes(1);
    } finally {
      capture.view.unmount(); answerStorage(); await pendingStorage;
      await act(async () => { capture.resolve(); });
      resetDeviceStorageForTests(); jest.useRealTimers();
    }
  });

});
