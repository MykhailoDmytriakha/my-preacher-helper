import { act, renderHook } from '@testing-library/react';

import kjvEphesians from '../../../public/bible-text/kjv/v1/ephesians.json';

import { analysisState, storedAnalysis, passageOfReference, useAnalysisNote, type AnalysisOpening } from '@/components/bible/analysis/useAnalysisNote';
import { useDataDocument } from '@/data-engine/react.client';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { changeRelation, cutAt, needsArrow, passageWords, relateWords, tieTo, type AnalysisState } from '@/utils/passageAnalysis';

import type { DocumentData, ResourceSnapshot } from '@/data-engine/types';
import type { StudyNote } from '@/models/models';
import type { BookText } from '@/utils/bibleText';

jest.mock('@/hooks/useStudyNotesEngine', () => ({ ...jest.requireActual('@/hooks/useStudyNotesEngine'), useStudyNotesEngine: jest.fn() }));
jest.mock('@/data-engine/react.client', () => ({ ...jest.requireActual('@/data-engine/react.client'), useDataDocument: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const EPHESIANS: BookText = {
  id: 'Ephesians',
  chapters: [[
    '¶Павел, волею Божиею Апостол Иисуса Христа, находящимся в Ефесе святым и верным во Христе Иисусе:',
    'благодать вам и мир от Бога Отца нашего и Господа Иисуса Христа.',
  ]],
};
const PASSAGE = { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 2 };
const total = passageWords(EPHESIANS, PASSAGE).length;

/** An analysis of Eph 1:1–2 already made on another device: one cut, one link of meaning. */
const madeElsewhere: StudyNote = {
  id: 'elsewhere', userId: 'u', content: '', title: 'Разбор', tags: [], isDraft: false, materialIds: [], createdAt: '', updatedAt: '', type: 'analysis',
  scriptureRefs: [{ id: 'r', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 1, toVerse: 2 } as StudyNote['scriptureRefs'][number]],
  analysis: { bible: 'rst', words: total, cuts: [3], links: {}, relations: { '1-4': { dir: 'fwd', color: 'amber' } } },
};

type Engine = { uid: string; notes: StudyNote[]; loading: boolean; checking: boolean; createNote: jest.Mock; updateNote: jest.Mock; recoverAnalysisCreation: jest.Mock; releaseAnalysisCreation: jest.Mock; combineAnalysisCreation: jest.Mock; refetch: jest.Mock };
const engine: Engine = { uid: 'u', notes: [], loading: true, checking: false, createNote: jest.fn(), updateNote: jest.fn(), recoverAnalysisCreation: jest.fn(), releaseAnalysisCreation: jest.fn(), combineAnalysisCreation: jest.fn(), refetch: jest.fn() };
/** The note's form: open on a note the list holds, its draft that note; `commit` the change laid on it. */
const commit = jest.fn(() => Promise.resolve());
let formNote: StudyNote | undefined;
let formPhase = 'saved';
let formRefusal: string | null = null;
let formStateAvailable = true;
let formConfirmed: ResourceSnapshot | null = null;
let formActionResolutionRequired = false;
const form = (resource: { id: string } | null) => {
  const note = resource ? formNote ?? engine.notes.find((entry) => entry.id === resource.id) : undefined;
  return { data: note ?? null, confirmed: formConfirmed, state: note && formStateAvailable ? { result: formRefusal ? { kind: 'refused', code: formRefusal } : null, actionResolutionRequired: formActionResolutionRequired } : null, status: note ? { phase: formPhase } : null, readOnly: false, loading: false, error: null, commit, recoveryIdentity: {} };
};
let opening: AnalysisOpening = { kind: 'new', passage: PASSAGE };
const render = () => renderHook(() => useAnalysisNote({ opening, text: EPHESIANS, bookId: 'Ephesians', bible: 'rst', locale: 'ru' }));

describe('an analysis note — what the screen may write', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    engine.notes = [];
    engine.loading = true;
    engine.checking = false;
    engine.createNote.mockReset().mockImplementation(() => ({ note: { id: 'made-here' }, acceptance: Promise.resolve() }));
    engine.refetch.mockReset().mockResolvedValue(undefined);
    engine.releaseAnalysisCreation.mockReset().mockResolvedValue(undefined);
    engine.recoverAnalysisCreation.mockReset().mockResolvedValue(null);
    engine.combineAnalysisCreation.mockReset().mockResolvedValue('elsewhere');
    formRefusal = null;
    formStateAvailable = true;
    formConfirmed = null;
    formActionResolutionRequired = false;
    engine.updateNote.mockReset().mockImplementation(() => ({ result: Promise.resolve() }));
    (useStudyNotesEngine as jest.Mock).mockImplementation(() => engine);
    commit.mockClear();
    formNote = undefined;
    formPhase = 'saved';
    opening = { kind: 'new', passage: PASSAGE };
    (useDataDocument as jest.Mock).mockImplementation(form);
  });
  afterEach(() => jest.useRealTimers());

  it('retires only the temporary capture hold after a passage opening acquires its answering form', async () => {
    engine.loading = false; engine.notes = [madeElsewhere];
    formStateAvailable = false;
    const holds = new Set([madeElsewhere.id]);
    engine.releaseAnalysisCreation.mockImplementation(async (sourceId: string, adoptedId: string) => {
      if (sourceId === madeElsewhere.id && adoptedId === madeElsewhere.id) holds.delete(sourceId);
    });
    const { result, rerender } = render();
    expect(result.current.state.cuts).toEqual([3]);
    expect(holds.has(madeElsewhere.id)).toBe(true);
    expect(engine.releaseAnalysisCreation).not.toHaveBeenCalled();
    await act(async () => { formStateAvailable = true; rerender(); });
    expect(holds.size).toBe(0);
    expect(result.current.id).toBe(madeElsewhere.id);
    expect(result.current.state.cuts).toEqual([3]);
    expect(engine.createNote).not.toHaveBeenCalled();
    expect(engine.updateNote).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('retires a late-listed passage capture without creating or rewriting its analysis', async () => {
    const holds = new Set([madeElsewhere.id]);
    engine.releaseAnalysisCreation.mockImplementation(async (sourceId: string, adoptedId: string) => {
      if (sourceId === madeElsewhere.id && adoptedId === madeElsewhere.id) holds.delete(sourceId);
    });
    const { result, rerender } = render();
    expect(holds.has(madeElsewhere.id)).toBe(true);
    await act(async () => { engine.loading = false; engine.notes = [madeElsewhere]; rerender(); });
    expect(holds.size).toBe(0);
    expect(result.current.id).toBe(madeElsewhere.id);
    expect(result.current.state.cuts).toEqual([3]);
    expect(engine.createNote).not.toHaveBeenCalled();
    expect(engine.updateNote).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('changes nothing before the person\'s analyses are read, then shows the one already made', () => {
    const { result, rerender } = render();
    expect(result.current.ready).toBe(false);
    act(() => result.current.change(cutAt(result.current.state, 5, total)!));
    expect(result.current.state.cuts).toEqual([]);
    engine.loading = false;
    engine.notes = [madeElsewhere];
    rerender();
    expect(result.current.ready).toBe(true);
    expect(result.current.state.cuts).toEqual([3]);
    expect(result.current.state.relations).toEqual([{ a: 1, b: 4, dir: 'fwd', color: 'amber' }]);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(engine.createNote).not.toHaveBeenCalled();
    expect(engine.updateNote).not.toHaveBeenCalled();
    // A change now goes onto the note's form — laid on its newest draft — not as an action of its own.
    act(() => result.current.change(cutAt(result.current.state, 5, total)!));
    expect(commit).toHaveBeenCalledTimes(1);
    const laid = (commit.mock.calls[0] as unknown as [(value: Record<string, unknown>) => Record<string, unknown>])[0]({ ...madeElsewhere, title: 'kept' });
    expect(laid).toMatchObject({ title: 'kept', analysis: { cuts: [3, 5] } });
    expect(engine.updateNote).not.toHaveBeenCalled();
  });

  it('keeps a change on its way: a draft arriving meanwhile does not take it back, and is taken in once the change lands', async () => {
    // The owner, 30.10: «иногда выбранный цвет сбивается».
    engine.loading = false;
    engine.notes = [madeElsewhere];
    let land: () => void = () => undefined;
    commit.mockImplementationOnce(() => new Promise<void>((done) => { land = done; }));
    const { result, rerender } = render();
    const pink = changeRelation(result.current.state, 1, 4, { color: 'pink' }, total);
    act(() => result.current.change(pink));
    // While the pink is on its way the form's draft changes — a cut made elsewhere, the link still amber in it.
    engine.notes = [{ ...madeElsewhere, analysis: { ...madeElsewhere.analysis!, cuts: [3, 8] } }];
    rerender();
    expect(result.current.state.relations[0].color).toBe('pink');
    // The pink lands in the draft beside the cut; the screen takes the draft in.
    engine.notes = [{ ...madeElsewhere, analysis: { ...madeElsewhere.analysis!, cuts: [3, 8], relations: { '1-4': { dir: 'fwd', color: 'pink' } } } }];
    rerender();
    await act(async () => { land(); });
    expect(result.current.state.cuts).toEqual([3, 8]);
    expect(result.current.state.relations[0].color).toBe('pink');
  });

  it('takes in a draft whose only change is a tie drawn elsewhere, and keeps it under the next change here', () => {
    // Codex, 31.10: a change of `drawn` alone did not move the screen's key — ignored, then erased by the next change.
    const tied = { ...madeElsewhere, analysis: { ...madeElsewhere.analysis!, links: { 3: 1 } } };
    engine.loading = false;
    engine.notes = [tied];
    const { result, rerender } = render();
    expect(result.current.state.drawn).toEqual([]);
    engine.notes = [{ ...tied, analysis: { ...tied.analysis, drawn: [3] } }];
    rerender();
    expect(result.current.state.drawn).toEqual([3]);
    act(() => result.current.change(changeRelation(result.current.state, 1, 4, { color: 'pink' }, total)));
    const laid = (commit.mock.calls.at(-1) as unknown as [(value: Record<string, unknown>) => { analysis: { drawn?: number[] } }])[0]({ ...tied });
    expect(laid.analysis.drawn).toEqual([3]);
  });

  it('takes no change and no undo while the note\'s form waits for a decision', () => {
    engine.loading = false;
    engine.notes = [madeElsewhere];
    const { result, rerender } = render();
    act(() => result.current.change(cutAt(result.current.state, 5, total)!));
    expect(commit).toHaveBeenCalledTimes(1);
    formPhase = 'conflict';
    rerender();
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.undo());
    act(() => result.current.change(cutAt(result.current.state, 9, total)!));
    expect(commit).toHaveBeenCalledTimes(1);
    // The person takes a version; nothing held back from before comes over it.
    formPhase = 'saved';
    rerender();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('reads the passage from the same copy as the parts: the form\'s draft, not an older list', () => {
    engine.loading = false;
    engine.notes = [madeElsewhere];
    formNote = { ...madeElsewhere, scriptureRefs: [{ ...madeElsewhere.scriptureRefs[0], toVerse: 1 }] };
    opening = { kind: 'open', id: 'elsewhere' };
    const { result } = render();
    expect(result.current.passage).toMatchObject({ fromVerse: 1, toVerse: 1 });
  });

  it('never writes over an analysis that turns up only after the person began: the work goes to a note of its own', () => {
    engine.loading = false;
    const { result, rerender } = render();
    const mine = relateWords(result.current.state, 6, 9, total) as AnalysisState;
    act(() => result.current.change(mine));
    engine.notes = [madeElsewhere];
    rerender();
    expect(result.current.state.relations).toEqual(mine.relations);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(engine.updateNote).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(engine.createNote).toHaveBeenCalledTimes(1);
    expect(engine.createNote.mock.calls[0][0].analysis.relations).toEqual({ '6-9': { dir: 'fwd', color: 'amber' } });
  });

  it('starts nothing while the list is still asked of the server and not whole: the analysis made elsewhere may be on its way', () => {
    // Codex, 30.10: a list only partly on this device let a second analysis of the same passage be made.
    engine.loading = false;
    engine.checking = true;
    const { result, rerender } = render();
    expect(result.current.ready).toBe(false);
    act(() => result.current.change(cutAt(result.current.state, 5, total)!));
    expect(engine.createNote).not.toHaveBeenCalled();
    // The server answered: it holds the analysis, which the screen takes.
    engine.checking = false;
    engine.notes = [madeElsewhere];
    rerender();
    expect(result.current.state.cuts).toEqual([3]);
    expect(engine.createNote).not.toHaveBeenCalled();
  });

  it('keeps the work on the screen when this device refuses to keep a new analysis, says so, and saves it again', async () => {
    // Codex, 30.10: the refusal was silent and closing the screen lost the first cut.
    engine.loading = false;
    engine.createNote.mockImplementationOnce(() => ({ note: { id: 'refused' }, acceptance: Promise.reject(new Error('quota')) }));
    const { result } = render();
    await act(async () => { result.current.change(cutAt(result.current.state, 5, total)!); });
    expect(result.current.refused).toBe(true);
    expect(result.current.state.cuts).toEqual([5]);
    await act(async () => { result.current.saveAgain(); });
    expect(engine.createNote).toHaveBeenCalledTimes(2);
    expect(engine.createNote.mock.calls[1][0].analysis.cuts).toEqual([5]);
    expect(result.current.refused).toBe(false);
  });

  it('retries a failed local creation under the same reserved note and capture scope', async () => {
    engine.loading = false;
    engine.createNote.mockImplementationOnce(() => ({ note: { id: 'refused' }, acceptance: Promise.reject(new Error('quota')) }));
    const { result } = render();
    await act(async () => { result.current.change(cutAt(result.current.state, 5, total)!); });
    await act(async () => { result.current.saveAgain(); });
    const first = engine.createNote.mock.calls[0][1], retry = engine.createNote.mock.calls[1][1];
    expect(first).toMatchObject({ id: expect.any(String), captureScope: expect.any(String) });
    expect(retry).toEqual(first);
    expect(engine.recoverAnalysisCreation).toHaveBeenCalledWith(first.id);
  });

  it('finds an already captured creation before retrying after its late local rejection', async () => {
    engine.loading = false;
    engine.createNote.mockImplementationOnce(() => ({ note: { id: 'queued' }, acceptance: Promise.reject(new Error('late projection')) }));
    const { result } = render();
    await act(async () => { result.current.change(cutAt(result.current.state, 5, total)!); });
    engine.recoverAnalysisCreation.mockResolvedValue({ ...madeElsewhere, id: 'queued' });
    await act(async () => { result.current.saveAgain(); });
    expect(engine.createNote).toHaveBeenCalledTimes(1);
    expect(result.current.id).toBe('queued');
    expect(result.current.refused).toBe(false);
  });

  it('keeps an existing confirmed source when its ordinary update is refused as analysis-exists', async () => {
    engine.loading = false;
    const source = { ...madeElsewhere, id: 'source', analysis: { ...madeElsewhere.analysis!, cuts: [5], relations: {} } };
    const other = { ...madeElsewhere, id: 'other' };
    engine.notes = [source, other];
    opening = { kind: 'open', id: source.id, editing: true };
    formConfirmed = { resource: { collection: 'studyNotes', id: source.id }, value: source as unknown as DocumentData, metadata: { protocol: 1, generation: 'source-generation', revision: 7, deleted: false } };
    formPhase = 'refused'; formRefusal = 'analysis-exists';
    const { result, rerender } = render();
    await act(async () => { rerender(); });
    expect(result.current.sync?.confirmed).toEqual(formConfirmed);
    expect(engine.combineAnalysisCreation).not.toHaveBeenCalled();
    expect(result.current.duplicateRefusal).toBe(false);
    expect(result.current.id).toBe(source.id);
    expect(result.current.state.cuts).toEqual([5]);
    expect(result.current.sync?.status?.phase).toBe('refused');
    expect(engine.combineAnalysisCreation).not.toHaveBeenCalled();
  });

  it('does not transfer an unconfirmed atomic reshape participant that requires whole-action resolution', async () => {
    engine.loading = false;
    const source = { ...madeElsewhere, id: 'made-here', analysis: { ...madeElsewhere.analysis!, cuts: [5], relations: {} } };
    engine.notes = [source, madeElsewhere];
    opening = { kind: 'open', id: source.id, editing: true };
    formConfirmed = { resource: { collection: 'studyNotes', id: source.id }, value: null, metadata: null };
    formActionResolutionRequired = true;
    formPhase = 'refused'; formRefusal = 'analysis-exists';
    const { result, rerender } = render();
    await act(async () => { rerender(); });
    expect(result.current.sync?.confirmed).toMatchObject({ value: null, metadata: null });
    expect(result.current.sync?.state?.actionResolutionRequired).toBe(true);
    expect(result.current.duplicateRefusal).toBe(false);
    expect(result.current.id).toBe(source.id);
    expect(result.current.state.cuts).toEqual([5]);
    expect(result.current.sync?.status?.phase).toBe('refused');
    expect(engine.combineAnalysisCreation).not.toHaveBeenCalled();
  });

  it('adopts the existing passage only after the engine captures both sets of marks', async () => {
    engine.loading = false;
    const { result, rerender } = render();
    await act(async () => { result.current.change(cutAt(result.current.state, 5, total)!); });
    engine.notes = [{ ...madeElsewhere, id: 'made-here', analysis: { ...madeElsewhere.analysis!, cuts: [5], relations: {} } }, madeElsewhere];
    formConfirmed = { resource: { collection: 'studyNotes', id: 'made-here' }, value: null, metadata: null };
    formPhase = 'refused'; formRefusal = 'analysis-exists';
    let finish!: (id: string) => void;
    engine.combineAnalysisCreation.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    await act(async () => { rerender(); });
    expect(engine.combineAnalysisCreation).toHaveBeenCalledTimes(1);
    expect(engine.combineAnalysisCreation).toHaveBeenCalledWith('made-here', 'elsewhere', EPHESIANS);
    expect(result.current.id).toBe('made-here');
    expect(result.current.state.cuts).toEqual([5]);
    expect(result.current.ready).toBe(false);
    engine.notes = [{ ...madeElsewhere, analysis: { ...madeElsewhere.analysis!, cuts: [3, 5] } }];
    formPhase = 'queued'; formRefusal = null;
    await act(async () => { finish('elsewhere'); });
    expect(result.current.id).toBe('elsewhere');
    expect(result.current.state.cuts).toEqual([3, 5]);
    expect(engine.createNote).toHaveBeenCalledTimes(1);
  });

  it('captures marks authored before the first form opened before combining with the existing analysis', async () => {
    engine.loading = false;
    let captured!: () => void;
    engine.createNote.mockImplementationOnce(() => ({ note: { id: 'made-here' }, acceptance: new Promise<void>(resolve => { captured = resolve; }) }));
    const { result, rerender } = render();
    const first = cutAt(result.current.state, 5, total)!;
    const later = cutAt(first, 9, total)!;
    act(() => { result.current.change(first); result.current.change(later); });
    expect(engine.createNote).toHaveBeenCalledTimes(1);
    engine.notes = [{ ...madeElsewhere, id: 'made-here', analysis: { ...madeElsewhere.analysis!, cuts: [5], relations: {} } }, madeElsewhere];
    formConfirmed = { resource: { collection: 'studyNotes', id: 'made-here' }, value: null, metadata: null };
    formPhase = 'refused'; formRefusal = 'analysis-exists';
    (commit as jest.Mock).mockImplementationOnce(async update => { engine.notes[0] = update(engine.notes[0]); });
    engine.combineAnalysisCreation.mockImplementationOnce(async () => {
      engine.notes[1] = { ...madeElsewhere, analysis: { ...madeElsewhere.analysis!, cuts: [3, 5, 9] } };
      return 'elsewhere';
    });
    await act(async () => { captured(); rerender(); });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(engine.notes[0].analysis?.cuts).toEqual([5, 9]);
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(engine.combineAnalysisCreation.mock.invocationCallOrder[0]);
    expect(result.current.state.cuts).toEqual([3, 5, 9]);
  });

  it('keeps an incompatible saved creation for review without repeatedly retrying or discarding it', async () => {
    engine.loading = false;
    const { result, rerender } = render();
    await act(async () => { result.current.change(cutAt(result.current.state, 5, total)!); });
    engine.notes = [{ ...madeElsewhere, id: 'made-here', analysis: { ...madeElsewhere.analysis!, cuts: [5], relations: {} } }, madeElsewhere];
    formConfirmed = { resource: { collection: 'studyNotes', id: 'made-here' }, value: null, metadata: null };
    formPhase = 'refused'; formRefusal = 'analysis-exists';
    engine.combineAnalysisCreation.mockRejectedValue(new Error('Needs review'));
    await act(async () => { rerender(); });
    expect(engine.combineAnalysisCreation).toHaveBeenCalledTimes(1);
    expect(result.current.creationReview).toBe(true);
    expect(result.current.id).toBe('made-here');
    expect(result.current.state.cuts).toEqual([5]);
    await act(async () => { rerender(); jest.advanceTimersByTime(30000); });
    expect(engine.combineAnalysisCreation).toHaveBeenCalledTimes(1);
    await act(async () => { result.current.openExistingAnalysis(); });
    expect(result.current.id).toBe('elsewhere');
    expect(engine.notes.map(note => note.id)).toEqual(['made-here', 'elsewhere']);
    expect(engine.updateNote).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not automatically choose between several existing same-passage copies', async () => {
    engine.loading = false;
    const { result, rerender } = render();
    await act(async () => { result.current.change(cutAt(result.current.state, 5, total)!); });
    engine.notes = [{ ...madeElsewhere, id: 'made-here', analysis: { ...madeElsewhere.analysis!, cuts: [5], relations: {} } },
      madeElsewhere, { ...madeElsewhere, id: 'another-existing-copy' }];
    formConfirmed = { resource: { collection: 'studyNotes', id: 'made-here' }, value: null, metadata: null };
    formPhase = 'refused'; formRefusal = 'analysis-exists';
    await act(async () => { rerender(); });
    expect(engine.combineAnalysisCreation).not.toHaveBeenCalled();
    expect(result.current.id).toBe('made-here');
    expect(result.current.state.cuts).toEqual([5]);
    expect(result.current.creationReview).toBe(true);
  });

  it('reopens the retained transfer destination after a restart still naming its retired source', async () => {
    engine.loading = false;
    opening = { kind: 'open', id: 'retired-local-source' };
    engine.notes = [madeElsewhere];
    engine.recoverAnalysisCreation.mockResolvedValue(madeElsewhere);
    let mounted!: ReturnType<typeof render>;
    await act(async () => { mounted = render(); });
    expect(engine.recoverAnalysisCreation).toHaveBeenCalledWith('retired-local-source');
    expect(mounted.result.current.id).toBe('elsewhere');
    expect(mounted.result.current.state.cuts).toEqual([3]);
    expect(mounted.result.current.missing).toBe(false);
    expect(engine.createNote).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('releases a proven same-address capture after lookup without replacing marks typed meanwhile', async () => {
    engine.loading = false; engine.notes = [madeElsewhere];
    opening = { kind: 'open', id: madeElsewhere.id };
    let finish!: (note: StudyNote) => void;
    engine.recoverAnalysisCreation.mockImplementationOnce(() => new Promise<StudyNote>(resolve => { finish = resolve; }));
    (commit as jest.Mock).mockImplementationOnce(async update => { engine.notes[0] = update(engine.notes[0]); });
    const { result } = render();
    await act(async () => { result.current.change(cutAt(result.current.state, 5, total)!); });
    await act(async () => { finish(madeElsewhere); });
    expect(engine.releaseAnalysisCreation).toHaveBeenCalledWith(madeElsewhere.id, madeElsewhere.id);
    expect(result.current.id).toBe(madeElsewhere.id);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(result.current.state.cuts).toEqual([3, 5]);
  });

  it('does not wait for ever on a check that never answers: after 8 s it goes by what this device has', () => {
    // Codex, 30.10: a frozen device store left the list «being checked» and the screen never ready.
    engine.loading = false;
    engine.checking = true;
    const { result } = render();
    expect(result.current.ready).toBe(false);
    act(() => { jest.advanceTimersByTime(8000); });
    expect(result.current.ready).toBe(true);
    act(() => result.current.change(cutAt(result.current.state, 5, total)!));
    expect(engine.createNote).toHaveBeenCalledTimes(1);
  });

  it('takes nothing more after a refusal, and takes the refused note as it is once it shows in the list', async () => {
    // Codex, 30.10: a creation refused after it was queued — a second change, or «Сохранить ещё раз», made a second note,
    // and taking the first one back laid the screen's older parts over what was added to it elsewhere.
    engine.loading = false;
    engine.createNote.mockImplementationOnce(() => ({ note: { id: 'queued' }, acceptance: Promise.reject(new Error('checkpoint')) }));
    const { result, rerender } = render();
    await act(async () => { result.current.change(cutAt(result.current.state, 5, total)!); });
    expect(result.current.refused).toBe(true);
    expect(result.current.ready).toBe(false);
    act(() => result.current.change(cutAt(result.current.state, 9, total)!));
    expect(engine.createNote).toHaveBeenCalledTimes(1);
    expect(result.current.state.cuts).toEqual([5]);
    // The queued note reaches the list after all — with a cut made on another device since.
    engine.notes = [{ ...madeElsewhere, id: 'queued', analysis: { ...madeElsewhere.analysis!, cuts: [5, 9], relations: {} } }];
    rerender();
    expect(result.current.refused).toBe(false);
    expect(result.current.id).toBe('queued');
    expect(result.current.state.cuts).toEqual([5, 9]);
    expect(commit).not.toHaveBeenCalled();
    act(() => result.current.change(cutAt(result.current.state, 12, total)!));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(engine.createNote).toHaveBeenCalledTimes(1);
  });

  it('never reads into the screen an analysis of the passage that turned up after the person began here', async () => {
    // Codex, 30.10: refused twice, the screen took the other note's parts and lost the last cut.
    engine.loading = false;
    engine.createNote.mockImplementationOnce(() => ({ note: { id: 'refused' }, acceptance: Promise.reject(new Error('quota')) }));
    const { result, rerender } = render();
    await act(async () => { result.current.change(cutAt(result.current.state, 5, total)!); });
    engine.notes = [madeElsewhere];
    rerender();
    expect(result.current.state.cuts).toEqual([5]);
    expect(result.current.id).toBeNull();
    expect(result.current.refused).toBe(true);
  });

  it('does not wait for ever on an empty list whose check never answers either', () => {
    // Codex, 30.10: with nothing on the device the list is «loading» as well as «checking», and the 8 s did not count.
    engine.loading = true;
    engine.checking = true;
    const { result } = render();
    act(() => { jest.advanceTimersByTime(8000); });
    expect(result.current.ready).toBe(true);
  });
  it.each([
    { context: 'another Bible', bible: 'kjv' as const, bookId: 'Ephesians', text: kjvEphesians as BookText },
    { context: 'another book with the same words', bible: 'rst' as const, bookId: 'Galatians', text: { ...EPHESIANS, id: 'Galatians' } },
    { context: 'a text file from another book', bible: 'rst' as const, bookId: 'Ephesians', text: { ...EPHESIANS, id: 'Galatians' } },
  ])('does not write saved word positions against $context', async ({ bible, bookId, text }) => {
    engine.loading = false;
    engine.notes = [madeElsewhere];
    opening = { kind: 'open', id: madeElsewhere.id, editing: true };
    const { result, unmount } = renderHook(() => useAnalysisNote({ opening, text, bookId, bible, locale: 'ru' }));
    await act(async () => {
      const next = cutAt(result.current.state, 5, result.current.total);
      if (next) result.current.change(next);
      result.current.flush();
    });
    unmount();
    const stored = commit.mock.calls.reduce<Record<string, unknown>>((value, args) => {
      const update = (args as unknown as [(data: Record<string, unknown>) => Record<string, unknown> | null])[0];
      return update(value) ?? value;
    }, JSON.parse(JSON.stringify(madeElsewhere)) as Record<string, unknown>);
    expect(stored).toEqual(madeElsewhere);
    expect(engine.updateNote).not.toHaveBeenCalled();
    expect(engine.createNote).not.toHaveBeenCalled();
  });

  it('keeps an existing source-Bible analysis editable on its own text', async () => {
    engine.loading = false;
    engine.notes = [madeElsewhere];
    opening = { kind: 'open', id: madeElsewhere.id, editing: true };
    const { result } = render();
    await act(async () => { result.current.change(cutAt(result.current.state, 5, result.current.total)!); });
    expect(commit).toHaveBeenCalledTimes(1);
    const lay = (commit.mock.calls[0] as unknown as [(value: Record<string, unknown>) => Record<string, unknown>])[0];
    expect(lay({ ...madeElsewhere })).toMatchObject({ analysis: { bible: 'rst', cuts: [3, 5] } });
  });

  it('still creates a new analysis in the Bible the person is reading', async () => {
    engine.loading = false;
    const text = kjvEphesians as BookText;
    const { result } = renderHook(() => useAnalysisNote({ opening, text, bookId: 'Ephesians', bible: 'kjv', locale: 'en' }));
    await act(async () => { result.current.change(cutAt(result.current.state, 5, result.current.total)!); });
    expect(engine.createNote).toHaveBeenCalledTimes(1);
    expect(engine.createNote.mock.calls[0][0]).toMatchObject({ analysis: { bible: 'kjv', cuts: [5] }, scriptureRefs: [{ bible: 'kjv', book: 'Ephesians' }] });
  });

});


describe('analysis passage in the Bible that owns its words', () => {
  it('projects reference numbering into the word Bible', () => {
    expect(passageOfReference({ id: 'psalm', bible: 'rst', book: 'Psalms', chapter: 22, fromVerse: 1, toVerse: 2 }, 'kjv'))
      .toEqual({ chapter: 23, fromVerse: 1, toChapter: 23, toVerse: 2 });
  });
  it('retains an exact canonical cross-chapter ending', () => {
    expect(passageOfReference({ id: 'seam', bible: 'kjv', book: 'Isaiah', chapter: 52, fromVerse: 13, endChapter: 53, toVerse: 12 }, 'kjv'))
      .toEqual({ chapter: 52, fromVerse: 13, toChapter: 53, toVerse: 12 });
  });
  it("continues reading the analysis feature's earlier exact toChapter spans", () => {
    expect(passageOfReference({ id: 'legacy-seam', bible: 'kjv', book: 'Isaiah', chapter: 52, fromVerse: 13, toChapter: 53, toVerse: 12 }, 'kjv'))
      .toEqual({ chapter: 52, fromVerse: 13, toChapter: 53, toVerse: 12 });
  });
  it('never silently reads only one piece of a discontinuous projection', () => {
    expect(passageOfReference({ id: 'split', bible: 'kjv', book: 'Romans', chapter: 16, fromVerse: 24, toVerse: 27 }, 'rst')).toBeNull();
  });
});

describe('a drawn tie kept in the note', () => {
  // The owner, 31.10: a tie drawn from the line's dot shows its arrow — also after a reload, on another device.
  it('keeps which ties the person drew, and an analysis with none keeps the shape it had', () => {
    const cut = cutAt(cutAt({ cuts: [], links: {}, relations: [] }, 3, total, 'under')!, 6, total, 'under')!;
    expect(storedAnalysis(cut, 'rst', total)).not.toHaveProperty('drawn');
    const drawn = tieTo(cut, 6, 3, total) as AnalysisState;
    const kept = storedAnalysis(drawn, 'rst', total);
    expect(kept.drawn).toEqual([6]);
    const read = analysisState(kept, total);
    expect(read.drawn).toEqual([6]);
    expect(needsArrow(read, 6)).toBe(true);
  });
});
