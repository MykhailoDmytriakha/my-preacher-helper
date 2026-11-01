import { inMemoryRelationReader } from '@test-utils/inMemoryRelationReader';

import { DataEngine } from '../engine';
import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { ResourceObserver } from '../observer';
import { createIndexedDbCommitStore } from '../commits.client';
import { DataEngineRuntime } from '../runtime';
import { planDataCommand } from '../serverRelations';
import { installStorageHarness } from './storageHarness';

import type { CommandResult, DocumentData, EngineTransport, JournalEntry, ResourceRef, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (resource: ResourceRef) => `${resource.collection}/${resource.id}`;
const reference = (id: string, verse: number) => ({ id, bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: verse, toVerse: verse });
const note = (id: string, verse: number, owner = 'owner'): ResourceSnapshot => ({
  resource: { collection: 'studyNotes', id }, metadata: { protocol: 1, generation: `${id}-generation`, revision: 1, deleted: false },
  value: { userId: owner, title: id, content: `original-${id}`, type: 'analysis', tags: ['saved'], isDraft: false,
    scriptureRefs: [reference(`${id}-ref`, verse)], analysis: { bible: 'rst', words: 1, cuts: [], links: {}, relations: {} },
    createdAt: 'then', updatedAt: 'then' },
});
const reshaped = (snapshot: ResourceSnapshot, content: string, verse: number): DocumentData => ({ ...snapshot.value!, content,
  scriptureRefs: [reference(`${snapshot.resource.id}-ref`, verse)], analysis: { ...(snapshot.value!.analysis as DocumentData), words: 1 } });

function setup(options: { target?: 'existing' | 'new'; holdReads?: boolean } = {}) {
  const storage = installStorageHarness(), commits = createIndexedDbCommitStore();
  const source = note('source', 1), target = options.target === 'new'
    ? { resource: { collection: 'studyNotes', id: 'target' }, metadata: null, value: null }
    : note('target', 3);
  const rows = new Map<string, ResourceSnapshot>([[key(source.resource), clone(source)], ...(target.value ? [[key(target.resource), clone(target)] as const] : [])]);
  const entries = new Map<string, JournalEntry>(), receipts = new Map<string, CommandResult>();
  let transportMode: 'apply' | 'refuse' | 'unknown' = 'apply';
  let loseReplyAfterApply = false;
  let held: (() => void) | undefined, readStarted: (() => void) | undefined;
  let holdReads = Boolean(options.holdReads);
  const read = async (resource: ResourceRef): Promise<ResourceSnapshot> => {
    if (holdReads && resource.id === 'source') await new Promise<void>(resolve => { held = resolve; readStarted?.(); });
    return clone(rows.get(key(resource)) ?? { resource, value: null, metadata: null });
  };
  const transport: EngineTransport = {
    read: jest.fn(async (_owner, resource) => read(resource)),
    send: jest.fn(async command => {
      if (transportMode === 'unknown') throw new Error('reply unavailable');
      if (transportMode === 'refuse') return { kind: 'refused' as const, operationId: command.operationId, code: 'invalid-document' };
      const saved = receipts.get(command.operationId); if (saved) return clone(saved);
      const planned = await planDataCommand(command, await read(command.resource), inMemoryRelationReader(command.owner, read, () => rows.values()));
      for (const snapshot of planned.writes) rows.set(key(snapshot.resource), clone(snapshot));
      receipts.set(command.operationId, clone(planned.result));
      if (loseReplyAfterApply) { loseReplyAfterApply = false; throw new Error('ACK lost after server commit'); }
      return planned.result;
    }),
  };
  const cached = new Map<string, ResourceSnapshot>([[key(source.resource), clone(source)], ...(target.value ? [[key(target.resource), clone(target)] as const] : [])]);
  let operation = 0;
  const createEngine = () => {
    const runtime = new DataEngineRuntime({ transport, journal: {
      list: async owner => clone([...entries.values()].filter(entry => entry.command.owner === owner)),
      put: async entry => { entries.set(entry.command.operationId, clone(entry)); },
      remove: async (_owner, id) => { entries.delete(id); },
    } });
    const engine = new DataEngine({ runtime, transport, commits, checkpoints: createIndexedDbCheckpoints(),
      observer: new ResourceObserver({ transport, source: { listen: () => () => undefined } }),
      snapshots: { read: async (_owner, resource) => {
        if (holdReads && resource.id === 'source') await new Promise<void>(resolve => { held = resolve; readStarted?.(); });
        const value = cached.get(key(resource)); return value && clone(value);
      }, put: async (_owner, snapshot) => { cached.set(key(snapshot.resource), clone(snapshot)); } },
      operationId: () => `reshape-${++operation}` });
    engine.setOnline(false); engine.setOwner('owner'); return engine;
  };
  const edits = (value = source.value!, targetValue = target.value) => [
    { resource: source.resource, expected: value, value: reshaped({ ...source, value }, 'remaining source words', 1) },
    { resource: target.resource, expected: targetValue, value: targetValue
      ? reshaped({ ...target, value: targetValue }, 'joined removed words', 2)
      : { userId: 'owner', title: 'target', content: 'joined removed words', type: 'analysis', tags: [], isDraft: false,
        scriptureRefs: [reference('target-ref', 2)], analysis: { bible: 'rst', words: 1, cuts: [], links: {}, relations: {} },
        createdAt: 'now', updatedAt: 'now' } },
  ] as const;
  return { source, target, rows, cached, commits, storage, transport, createEngine, edits,
    setMode: (mode: typeof transportMode) => { transportMode = mode; },
    loseReplyAfterApply: () => { loseReplyAfterApply = true; },
    holdRead: () => { holdReads = true; },
    waitForRead: () => new Promise<void>(resolve => { readStarted = resolve; }),
    releaseRead: () => { holdReads = false; held?.(); held = undefined; } };
}

describe('DataEngine analysis reshape capture and recovery', () => {
  it('keeps a real three-part reshape action identity behind its action-level recovery path', async () => {
    const s = setup(), engine = s.createEngine();
    await engine.reshapeStudyAnalysis(s.edits());
    const primary = (await s.commits.list('owner')).find(request => request.id === request.atomic?.id)!;
    expect(JSON.parse(primary.editorId)).toHaveLength(3);
    expect(await engine.formWorkPending(s.source.resource)).toBe(true);
    expect((await engine.listAnalysisReshapes()).map(action => action.id)).toContain(primary.id);
    engine.dispose();
  });

  it.each(['existing', 'new'] as const)('lists a globally recoverable %s recipient action after every editor closes', async targetKind => {
    const s = setup({ target: targetKind }), engine = s.createEngine();
    await engine.reshapeStudyAnalysis(s.edits());
    const [action] = await engine.listAnalysisReshapes();
    expect(action).toMatchObject({ resource: s.source.resource, title: 'source', delivery: { phase: 'queued', canDiscard: false } });
    const requests = await s.commits.list('owner'), primary = requests.find(request => request.id === request.atomic?.id)!;
    expect(primary.atomic?.kind).toBe('analysis-reshape');
    expect(primary.atomic?.participants).toHaveLength(2);
    expect(primary.predecessor).toBeNull();
    expect((await s.commits.list('owner')).map(request => request.baseline.resource.id)).toEqual(['source', 'target']);
    engine.dispose();
  });

  it('restarts offline from the exact saved action and delivers the same participant ancestry once', async () => {
    const s = setup({ target: 'new' }), first = s.createEngine();
    await first.reshapeStudyAnalysis(s.edits());
    const before = await s.commits.list('owner'), primary = before.find(request => request.id === requestId(before))!;
    const participantIds = primary.atomic!.participants;
    first.dispose();
    const restarted = s.createEngine(); restarted.setOnline(true); await restarted.retry();
    expect(s.transport.send).toHaveBeenCalledTimes(1);
    const command = jest.mocked(s.transport.send).mock.calls[0][0];
    expect(command.operationId).toBe(primary.id);
    expect(command).toMatchObject({ kind: 'relation', relation: 'analysis-reshape' });
    expect((await s.commits.list('owner')).filter(request => participantIds.includes(request.id)).every(request => request.state === 'acknowledged')).toBe(true);
    expect((await restarted.listAnalysisReshapes())).toEqual([]);
    restarted.dispose();
  });

  it('pins each participant behind its exact pending predecessor when the author already saved earlier words', async () => {
    const s = setup(), engine = s.createEngine(), editor = await engine.openEditor(s.source.resource, 'reader');
    const initial = editor.getState().checkpoint.draft!;
    await editor.edit({ ...initial, content: 'words saved before reshape' }); await editor.save();
    const predecessor = (await s.commits.list('owner')).find(request => request.baseline.resource.id === 'source')!;
    const expected = editor.getState().checkpoint.draft!;
    await engine.reshapeStudyAnalysis(s.edits(expected));
    const requests = await s.commits.list('owner'), primary = requests.find(request => request.id === request.atomic?.id)!;
    const sourceParticipant = requests.find(request => request.id === primary.atomic!.participants[0])!;
    expect(sourceParticipant.predecessor).toBe(predecessor.id);
    expect(primary.atomic?.participants).toHaveLength(2);
    expect(sourceParticipant.value?.content).toBe('remaining source words');
    editor.close(); engine.dispose();
  });

  it('refuses to pin an ambiguous saved chain and leaves both prior requests untouched', async () => {
    const s = setup(), engine = s.createEngine();
    const left = await engine.openEditor(s.source.resource, 'left'), right = await engine.openEditor(s.source.resource, 'right');
    const leftDraft = left.getState().checkpoint.draft!, rightDraft = right.getState().checkpoint.draft!;
    await left.edit({ ...leftDraft, title: 'Left title' }); await right.edit({ ...rightDraft, title: 'Right title' });
    await left.save(); await right.save();
    const before = await s.commits.list('owner');
    expect(before.filter(request => request.baseline.resource.id === 'source')).toHaveLength(2);
    await expect(engine.reshapeStudyAnalysis(s.edits())).rejects.toMatchObject({ code: 'resolve-version-first' });
    const after = await s.commits.list('owner');
    expect(after.map(request => request.id)).toEqual(before.map(request => request.id));
    expect(after.every(request => request.atomic?.kind !== 'analysis-reshape')).toBe(true);
    left.close(); right.close(); engine.dispose();
  });

  it('refuses admission on a stale displayed authored frame without changing the saved source', async () => {
    const s = setup(), engine = s.createEngine(), stale = { ...s.source.value!, content: 'stale displayed words' };
    const saved = clone(s.source);
    await expect(engine.reshapeStudyAnalysis(s.edits(stale))).rejects.toMatchObject({ code: 'resolve-version-first' });
    expect(await s.commits.list('owner')).toEqual([]);
    expect(s.rows.get(key(s.source.resource))).toEqual(saved);
    engine.dispose();
  });

  it('does not let a second capture of the same source enter while the first is awaiting its pin', async () => {
    const s = setup({ holdReads: true }), engine = s.createEngine(), started = s.waitForRead();
    const first = engine.reshapeStudyAnalysis(s.edits()); await started;
    await expect(engine.reshapeStudyAnalysis(s.edits())).rejects.toMatchObject({ code: 'action-in-progress' });
    s.releaseRead(); await first;
    expect((await s.commits.list('owner')).filter(request => request.atomic?.id === request.id)).toHaveLength(1);
    engine.dispose();
  });

  it('keeps an invoked capture alive when its editor closes during the read', async () => {
    const s = setup(), engine = s.createEngine();
    const editor = await engine.openEditor(s.source.resource, 'reader');
    s.holdRead();
    const started = s.waitForRead(), pending = engine.reshapeStudyAnalysis(s.edits()); await started;
    editor.close(); s.releaseRead(); await pending;
    expect(await engine.listAnalysisReshapes()).toHaveLength(1);
    engine.dispose();
  });

  it('aborts capture if the owner changes before its pinned reads finish', async () => {
    const s = setup({ holdReads: true }), engine = s.createEngine(), started = s.waitForRead();
    const pending = engine.reshapeStudyAnalysis(s.edits()); await started;
    engine.setOwner(null); s.releaseRead();
    await expect(pending).rejects.toThrow();
    expect(await s.commits.list('owner')).toEqual([]);
    engine.dispose();
  });

  it('keeps a whole relation conflicted when the source authored frame changed after capture', async () => {
    const s = setup(), engine = s.createEngine(); await engine.reshapeStudyAnalysis(s.edits());
    const remote = clone(s.rows.get(key(s.source.resource))!);
    remote.metadata = { ...remote.metadata!, revision: 2 };
    remote.value = { ...remote.value!, content: 'remote authored words' };
    s.rows.set(key(s.source.resource), remote);
    engine.setOnline(true); await engine.retry();
    const action = (await engine.listAnalysisReshapes())[0];
    expect(action.delivery.phase).toBe('conflict');
    expect(s.rows.get(key(s.target.resource))?.value?.content).toBe('original-target');
    const participants = (await s.commits.list('owner')).filter(request => action.id === request.id || request.atomic?.id === action.id);
    expect(participants.find(request => request.id === action.id)?.state).toBe('conflict');
    expect(participants.every(request => request.state !== 'acknowledged')).toBe(true);
    engine.dispose();
  });

  it('refuses stale participant generation after capture without writing any target', async () => {
    const s = setup({ target: 'new' }), engine = s.createEngine(); await engine.reshapeStudyAnalysis(s.edits());
    const remote = clone(s.rows.get(key(s.source.resource))!);
    remote.metadata = { ...remote.metadata!, generation: 'replacement-generation', revision: 2 };
    s.rows.set(key(s.source.resource), remote);
    engine.setOnline(true); await engine.retry();
    expect((await engine.listAnalysisReshapes())[0].delivery.phase).toBe('refused');
    expect(s.rows.has(key(s.target.resource))).toBe(false);
    engine.dispose();
  });

  it('does not discard an unknown action and retries its identical server identity', async () => {
    const s = setup(), engine = s.createEngine(); await engine.reshapeStudyAnalysis(s.edits());
    const action = (await engine.listAnalysisReshapes())[0]; s.setMode('unknown');
    const unknown = new Promise<import('../types').JournalEntry>(resolve => {
      const stop = engine.subscribeSavedWork(() => {
        const entry = engine.getPending().find(candidate => candidate.command.owner === 'owner');
        if (entry?.state === 'unknown') { stop(); resolve(entry); }
      });
      const current = engine.getPending().find(candidate => candidate.command.owner === 'owner');
      if (current?.state === 'unknown') { stop(); resolve(current); }
    });
    engine.setOnline(true); await engine.retry();
    const unanswered = await unknown;
    const journal = await engine.listPending();
    const delivery = (await engine.listAnalysisReshapes())[0].delivery;
    expect(unanswered.state).toBe('unknown');
    expect(journal.find(entry => entry.command.operationId === unanswered.command.operationId)?.state).toBe('unknown');
    expect(delivery.canDiscard).toBe(false);
    const submitted = jest.mocked(s.transport.send).mock.calls[0][0];
    await expect(engine.discardAnalysisReshape(action.id)).rejects.toThrow();
    s.setMode('apply'); await engine.retry();
    expect(jest.mocked(s.transport.send).mock.calls.slice(1).some(([command]) => JSON.stringify(command) === JSON.stringify(submitted))).toBe(true);
    expect(s.rows.get(key(s.target.resource))?.value?.content).toBe('joined removed words');
    engine.dispose();
  });

  it('replays a lost post-commit ACK after restart without applying the relation twice', async () => {
    const s = setup({ target: 'new' }), first = s.createEngine(); await first.reshapeStudyAnalysis(s.edits());
    s.loseReplyAfterApply();
    const unknown = new Promise<import('../types').JournalEntry>(resolve => {
      const stop = first.subscribeSavedWork(() => {
        const entry = first.getPending().find(candidate => candidate.state === 'unknown');
        if (entry) { stop(); resolve(entry); }
      });
    });
    first.setOnline(true); await first.retry();
    const unanswered = await unknown, command = jest.mocked(s.transport.send).mock.calls[0][0];
    expect(unanswered.state).toBe('unknown');
    expect(s.rows.get(key(s.source.resource))?.metadata?.revision).toBe(2);
    expect(s.rows.get(key(s.target.resource))?.metadata?.revision).toBe(1);
    expect(s.rows.get(key(s.target.resource))?.value?.scriptureRefs).toHaveLength(1);
    first.dispose();

    const restarted = s.createEngine(); restarted.setOnline(true); await restarted.retry();
    expect(s.transport.send).toHaveBeenCalledTimes(2);
    expect(jest.mocked(s.transport.send).mock.calls[1][0]).toEqual(command);
    expect(s.rows.get(key(s.source.resource))?.metadata?.revision).toBe(2);
    expect(s.rows.get(key(s.target.resource))?.metadata?.revision).toBe(1);
    expect(s.rows.get(key(s.target.resource))?.value?.scriptureRefs).toHaveLength(1);
    expect((await restarted.listAnalysisReshapes())).toEqual([]);
    restarted.dispose();
  });

  it('cancels a refused whole action while preserving later unrelated source metadata', async () => {
    const s = setup({ target: 'new' }), engine = s.createEngine(), editor = await engine.openEditor(s.source.resource, 'reader');
    await engine.reshapeStudyAnalysis(s.edits());
    const action = (await engine.listAnalysisReshapes())[0];
    s.setMode('refuse'); engine.setOnline(true); await engine.retry();
    expect((await engine.listAnalysisReshapes())[0].delivery).toMatchObject({ phase: 'refused', canDiscard: true });
    const draft = editor.getState().checkpoint.draft!;
    const laterRefs = [reference('later-owned-ref', 4)];
    await editor.edit({ ...draft, title: 'Later title', tags: ['later tag'], content: 'later authored words',
      scriptureRefs: laterRefs, analysis: { ...(draft.analysis as DocumentData), cuts: [1] } });
    await engine.discardAnalysisReshape(action.id);
    expect(editor.getState().checkpoint.draft).toMatchObject({ title: 'Later title', tags: ['later tag'], content: 'later authored words' });
    expect(editor.getState().checkpoint.draft?.scriptureRefs).toEqual(laterRefs);
    expect(editor.getState().checkpoint.conflicts.map(conflict => conflict.path[0])).toEqual(expect.arrayContaining(['content', 'analysis', 'scriptureRefs']));
    expect(s.rows.has(key(s.target.resource))).toBe(false);
    expect(await engine.listAnalysisReshapes()).toEqual([]);
    editor.close(); engine.dispose();
  });
});

function requestId(requests: Awaited<ReturnType<ReturnType<typeof createIndexedDbCommitStore>['list']>>) {
  return requests.find(request => request.atomic?.kind === 'analysis-reshape' && request.id === request.atomic.id)?.id;
}
