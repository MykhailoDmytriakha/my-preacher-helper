import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';

import kjvEphesians from '../../../public/bible-text/kjv/v1/ephesians.json';

import { AnalysisEditor, type AnalysisOpening } from '@/components/bible/analysis/AnalysisEditor';
import { ReaderAnalysis } from '@/components/bible/analysis/ReaderAnalysis';
import { useDataDocument } from '@/data-engine/react.client';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { passageWords } from '@/utils/passageAnalysis';

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
