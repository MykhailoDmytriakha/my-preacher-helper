import rstEphesians from '../../../public/bible-text/rst/v1/ephesians.json';

import { analysisMarkdown, passageWords, storedAnalysis, type AnalysisState } from '@/utils/passageAnalysis';
import type { BookText } from '@/utils/bibleText';
import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { analysisCreationScope } from '../analysisCreation';
import { ANALYSIS_CREATION_TRANSFER_PREFIX } from '../analysisCreationCapture';
import { DataEngine } from '../engine';
import { editorIdentity } from '../editorIdentity';
import { createIndexedDbManualScopes } from '../manualScopes.client';
import { ResourceObserver } from '../observer';
import { planDataCommand } from '../serverRelations';
import { DataEngineRuntime } from '../runtime';
import { installStorageHarness } from './storageHarness';

import type { JournalEntry } from '../types';
import type { CommitRequest } from '../commits';
import type { DocumentData, EngineTransport, ResourceRef, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const owner = 'owner';
const source: ResourceRef = { collection: 'studyNotes', id: 'analysis-create-source' };
const target: ResourceRef = { collection: 'studyNotes', id: 'analysis-create-target' };
const text = rstEphesians as unknown as BookText;
const passage = { chapter: 1, fromVerse: 2, toChapter: 1, toVerse: 2 };
const words = passageWords(text, passage);
const key = (resource: ResourceRef, uid = owner) => JSON.stringify([uid, resource.collection, resource.id]);
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const settle = async () => { for (let index = 0; index < 500; index += 1) await Promise.resolve(); };

function analysis(id: string, cuts: number[], patch: Partial<DocumentData> = {}): DocumentData {
  const state: AnalysisState = { cuts, links: {}, relations: [] };
  return {
    userId: owner, type: 'analysis', title: `Analysis ${id}`, content: analysisMarkdown(words, state), tags: [`tag-${id}`],
    isDraft: false, createdAt: '2026-10-31T08:00:00.000Z', updatedAt: '2026-10-31T08:00:00.000Z',
    scriptureRefs: [{ id: `ref-${id}`, bible: 'rst', book: 'Ephesians', ...passage }],
    analysis: storedAnalysis(state, 'rst', words.length) as unknown as DocumentData, ...patch,
  };
}

const targetSnapshot = (value = analysis(target.id, [2])): ResourceSnapshot => ({
  resource: target, value, metadata: { protocol: 1, generation: 'target-generation', revision: 1, deleted: false },
});

function fixture() {
  const storage = installStorageHarness();
  const server = new Map<string, ResourceSnapshot>([[key(target), targetSnapshot()]]);
  const local = new Map<string, ResourceSnapshot>([[key(target), targetSnapshot()]]);
  const journal = new Map<string, JournalEntry>();
  let sequence = 0;
  const absent = (resource: ResourceRef): ResourceSnapshot => ({ resource, value: null, metadata: null });
  const read = async (resource: ResourceRef): Promise<ResourceSnapshot> => copy(server.get(key(resource)) ?? absent(resource));
  const transport: EngineTransport = {
    read: jest.fn(async (_uid, resource) => read(resource)),
    send: jest.fn(async command => {
      const primary = await read(command.resource);
      const plan = await planDataCommand(command, primary, {
        get: read,
        list: async (collection, limit, filter, select) => [...server.values()]
          .filter(row => row.resource.collection === collection && row.value?.userId === command.owner)
          .filter(row => !filter || (filter.field === 'type' && row.value?.type === filter.value))
          .filter(row => !select || select(row))
          .slice(0, limit).map(copy),
      });
      for (const written of plan.writes) server.set(key(written.resource), copy(written));
      return plan.result;
    }),
  };
  const makeEngine = () => {
    const runtime = new DataEngineRuntime({ journal: {
      list: async uid => copy([...journal.values()].filter(entry => entry.command.owner === uid)),
      put: async entry => { journal.set(entry.command.operationId, copy(entry)); },
      remove: async (_uid, id) => { journal.delete(id); },
    }, transport });
    const observer = new ResourceObserver({ transport, source: { listen: () => () => undefined } });
    const engine = new DataEngine({
      runtime, observer, transport, commits: createIndexedDbCommitStore(), checkpoints: createIndexedDbCheckpoints(),
      manualScopes: createIndexedDbManualScopes(), operationId: () => `operation-${++sequence}`, onError: jest.fn(),
      snapshots: {
        read: async (uid, resource) => {
          const snapshot = uid === owner ? local.get(key(resource)) : undefined;
          return snapshot ? copy(snapshot) : undefined;
        },
        put: async (uid, snapshot) => { if (uid === owner) local.set(key(snapshot.resource), copy(snapshot)); },
      },
    });
    engine.setOwner(owner);
    engine.setOnline(false);
    return engine;
  };
  return { storage, server, local, transport, makeEngine };
}

async function seedRefusedCreation(s: ReturnType<typeof fixture>, options: { scope?: boolean; keepOpen?: boolean; secondBranch?: boolean } = {}) {
  const engine = s.makeEngine();
  const targetEditor = await engine.openEditor(target, editorIdentity('handoff-test', target, 'target', 'cache-target'));
  targetEditor.dispose();
  const sourceEditor = await engine.createEditor(source, editorIdentity('handoff-test', source, 'source', 'create-source'));
  const sourceValue = analysis(source.id, [5]);
  await sourceEditor.edit(sourceValue);
  const captured = await sourceEditor.commitWithReceipt(() => sourceValue, {
    ...(options.scope === false ? {} : { captureScope: analysisCreationScope(source.id) }),
  });
  engine.setOnline(true);
  await engine.retry();
  await expect(captured.persistence).rejects.toMatchObject({ code: 'analysis-exists' });

  if (options.secondBranch) {
    const branch = await engine.createEditor(source, editorIdentity('handoff-test', source, 'source', 'second-branch'));
    const branchValue = analysis(source.id, [5, 8]);
    await branch.edit(branchValue);
    const branchCapture = await branch.commitWithReceipt(() => branchValue, { captureScope: analysisCreationScope(source.id) });
    await engine.retry();
    await expect(branchCapture.persistence).rejects.toMatchObject({ code: 'analysis-exists' });
    branch.dispose();
  }
  if (!options.keepOpen) sourceEditor.dispose();
  engine.setOnline(false);
  const rows = await createIndexedDbCommitStore().list(owner);
  expect(rows.filter(row => row.baseline.resource.id === source.id)).toHaveLength(options.secondBranch ? 2 : 1);
  expect(rows.find(row => row.baseline.resource.id === source.id)).toMatchObject({
    state: 'refused', command: { kind: 'create' }, result: { kind: 'refused', code: 'analysis-exists' },
  });
  return { engine, sourceEditor, sourceValue };
}

async function seedPendingCreation(s: ReturnType<typeof fixture>) {
  const engine = s.makeEngine();
  const editor = await engine.createEditor(source, editorIdentity('handoff-test', source, 'source', 'pending-source'));
  const value = analysis(source.id, [5]);
  await editor.edit(value);
  const receipt = await editor.commitWithReceipt(() => value, { captureScope: analysisCreationScope(source.id) });
  await engine.retry();
  const rows = await createIndexedDbCommitStore().list(owner);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ state: 'prepared', command: { kind: 'create' }, retentionScope: analysisCreationScope(source.id) });
  expect(jest.mocked(s.transport.send)).not.toHaveBeenCalled();
  return { engine, editor, value, receipt };
}

describe('public analysis creation handoff', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('atomically transfers one refused creation, replays after restart, and delivers one target update', async () => {
    const s = fixture();
    const first = await seedRefusedCreation(s);
    const sendsBefore = jest.mocked(s.transport.send).mock.calls.length;
    try {
      await expect(first.engine.transferStudyAnalysisCreation(source.id, target.id, text)).resolves.toEqual(target);
      expect(jest.mocked(s.transport.send)).toHaveBeenCalledTimes(sendsBefore);
      expect(jest.mocked(s.transport.read)).not.toHaveBeenCalled();
      const captured = await createIndexedDbCommitStore().list(owner);
      expect(captured.filter(request => request.transferredFrom)).toHaveLength(1);
      expect(captured.find(request => request.baseline.resource.id === source.id)).toMatchObject({
        state: 'cancelled', transferredTo: { resource: target },
      });
      const transfer = captured.find(request => request.transferredFrom)!;
      expect(transfer.value).toMatchObject({ title: 'Analysis analysis-create-target', tags: ['tag-analysis-create-target'] });
      expect((transfer.value!.analysis as DocumentData).cuts).toEqual([2, 5]);
      expect(transfer.baseline.resource).toEqual(target);
      await expect(first.engine.findStudyAnalysisCreation(source.id)).resolves.toEqual({ resource: target, value: transfer.value });

      first.engine.dispose();
      const restarted = s.makeEngine();
      try {
        await expect(restarted.transferStudyAnalysisCreation(source.id, target.id, text)).resolves.toEqual(target);
        await expect(restarted.findStudyAnalysisCreation(source.id)).resolves.toEqual({ resource: target, value: transfer.value });
        expect((await createIndexedDbCommitStore().list(owner)).filter(request => request.transferredFrom)).toHaveLength(1);
        expect(jest.mocked(s.transport.send)).toHaveBeenCalledTimes(sendsBefore);
        restarted.setOnline(true);
        await restarted.retry();
        const writes = jest.mocked(s.transport.send).mock.calls.map(([command]) => command);
        expect(writes.filter(command => command.resource.id === source.id)).toHaveLength(1);
        expect(writes.filter(command => command.resource.id === target.id && command.kind === 'update')).toHaveLength(1);
        expect((await createIndexedDbCommitStore().list(owner)).find(request => request.id === transfer.id)).toMatchObject({ state: 'acknowledged' });
        expect((await s.server.get(key(target)))?.value?.title).toBe('Analysis analysis-create-target');
        expect((s.server.get(key(target))?.value?.analysis as DocumentData).cuts).toEqual([2, 5]);
      } finally { restarted.dispose(); }
    } finally { first.engine.dispose(); }
  });

  it('keeps the refused source and writes no destination request when the IndexedDB transaction fails', async () => {
    const s = fixture(), seeded = await seedRefusedCreation(s);
    try {
      s.storage.writeFailure = true;
      await expect(seeded.engine.transferStudyAnalysisCreation(source.id, target.id, text)).rejects.toThrow('disk full');
      s.storage.writeFailure = false;
      const rows = await createIndexedDbCommitStore().list(owner);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ baseline: { resource: source }, state: 'refused', result: { code: 'analysis-exists' } });
      expect(rows.some(request => request.transferredFrom)).toBe(false);
      expect(jest.mocked(s.transport.send)).toHaveBeenCalledTimes(1);
    } finally { s.storage.writeFailure = false; seeded.engine.dispose(); }
  });

  it('holds an ambiguous source branch for explicit review', async () => {
    const s = fixture(), seeded = await seedRefusedCreation(s, { secondBranch: true });
    try {
      await expect(seeded.engine.transferStudyAnalysisCreation(source.id, target.id, text))
        .rejects.toMatchObject({ code: 'analysis-creation-review' });
      const rows = await createIndexedDbCommitStore().list(owner);
      expect(rows.filter(request => request.baseline.resource.id === source.id).map(request => request.state)).toEqual(['refused', 'refused']);
      expect(rows.some(request => request.transferredFrom)).toBe(false);
    } finally { seeded.engine.dispose(); }
  });

  it('does not consume an unscoped legacy refused create', async () => {
    const s = fixture(), seeded = await seedRefusedCreation(s, { scope: false });
    try {
      await expect(seeded.engine.transferStudyAnalysisCreation(source.id, target.id, text))
        .rejects.toMatchObject({ code: 'analysis-creation-review' });
      const rows = await createIndexedDbCommitStore().list(owner);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: 'refused', result: { code: 'analysis-exists' } });
      expect(rows[0].retentionScope).toBeUndefined();
    } finally { seeded.engine.dispose(); }
  });

  it('preserves mounted later source typing instead of transferring an older capture', async () => {
    const s = fixture(), seeded = await seedRefusedCreation(s, { keepOpen: true });
    try {
      await seeded.sourceEditor.edit({ ...seeded.sourceValue, title: 'Later unsent source title' });
      const laterDraft = seeded.sourceEditor.getState().checkpoint.draft;
      await expect(seeded.engine.transferStudyAnalysisCreation(source.id, target.id, text))
        .rejects.toMatchObject({ code: 'analysis-creation-review' });
      expect(seeded.sourceEditor.getState().checkpoint.draft).toEqual(laterDraft);
      const rows = await createIndexedDbCommitStore().list(owner);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: 'refused', value: seeded.sourceValue });
      expect(rows.some(request => request.transferredFrom)).toBe(false);
    } finally { seeded.engine.dispose(); }
  });

  it('retains the source when the cached destination has a different positional basis', async () => {
    const s = fixture(), seeded = await seedRefusedCreation(s);
    try {
      const divergent = analysis(target.id, [2], { scriptureRefs: [{ id: 'new-target-ref', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 1, toVerse: 1 }] });
      const snapshot: ResourceSnapshot = { ...targetSnapshot(divergent), metadata: { protocol: 1, generation: 'new-target-generation', revision: 2, deleted: false } };
      s.local.set(key(target), snapshot);
      s.server.set(key(target), snapshot);
      await expect(seeded.engine.transferStudyAnalysisCreation(source.id, target.id, text))
        .rejects.toMatchObject({ code: 'analysis-creation-review' });
      const rows = await createIndexedDbCommitStore().list(owner);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: 'refused', baseline: { value: null, metadata: null } });
      expect(rows.some(request => request.transferredFrom)).toBe(false);
    } finally { seeded.engine.dispose(); }
  });

  it('returns null when no local creation capture exists', async () => {
    const s = fixture(), engine = s.makeEngine();
    try {
      await expect(engine.findStudyAnalysisCreation(source.id)).resolves.toBeNull();
      expect(jest.mocked(s.transport.read)).not.toHaveBeenCalled();
      expect(jest.mocked(s.transport.send)).not.toHaveBeenCalled();
    } finally { engine.dispose(); }
  });

  it('finds the exact durable creation before delivery and repeated lookup performs no writes or network I/O', async () => {
    const s = fixture(), seeded = await seedPendingCreation(s);
    try {
      const before = [...s.storage.rows.entries()];
      const networkReads = jest.mocked(s.transport.read).mock.calls.length;
      const networkWrites = jest.mocked(s.transport.send).mock.calls.length;
      const expected = { resource: source, value: seeded.value };
      await expect(seeded.engine.findStudyAnalysisCreation(source.id)).resolves.toEqual(expected);
      await expect(seeded.engine.findStudyAnalysisCreation(source.id)).resolves.toEqual(expected);
      expect([...s.storage.rows.entries()]).toEqual(before);
      expect(jest.mocked(s.transport.read)).toHaveBeenCalledTimes(networkReads);
      expect(jest.mocked(s.transport.send)).toHaveBeenCalledTimes(networkWrites);
      expect(seeded.receipt.requestId).toBeTruthy();
    } finally { seeded.engine.dispose(); }
  });

  it('refuses a cancelled source capture instead of offering it for recreation', async () => {
    const s = fixture(), seeded = await seedRefusedCreation(s, { keepOpen: true });
    try {
      await seeded.sourceEditor.acceptRemote();
      await expect(seeded.engine.findStudyAnalysisCreation(source.id))
        .rejects.toMatchObject({ code: 'analysis-creation-review' });
      expect((await createIndexedDbCommitStore().list(owner))[0]).toMatchObject({ state: 'cancelled' });
    } finally { seeded.engine.dispose(); }
  });

  it('refuses transferred-source lookup when a newer closed source editor has private work', async () => {
    const s = fixture(), seeded = await seedRefusedCreation(s);
    try {
      await seeded.engine.transferStudyAnalysisCreation(source.id, target.id, text);
      const sourceEditorId = editorIdentity('handoff-test', source, 'source', 'later-private-source');
      const sourceEditor = await seeded.engine.createEditor(source, sourceEditorId);
      const privateSource = analysis(source.id, [5, 9], { title: 'Later private source edit' });
      await sourceEditor.edit(privateSource);
      sourceEditor.close({ flush: false });

      expect((await createIndexedDbCheckpoints().read(owner, sourceEditorId))?.checkpoint.draft).toEqual(privateSource);
      const rowsBeforeLookup = await createIndexedDbCommitStore().list(owner);
      const sendsBeforeLookup = jest.mocked(s.transport.send).mock.calls.length;
      const readsBeforeLookup = jest.mocked(s.transport.read).mock.calls.length;
      await expect(seeded.engine.findStudyAnalysisCreation(source.id))
        .rejects.toMatchObject({ code: 'analysis-creation-review' });

      expect((await createIndexedDbCheckpoints().read(owner, sourceEditorId))?.checkpoint.draft).toEqual(privateSource);
      expect(await createIndexedDbCommitStore().list(owner)).toEqual(rowsBeforeLookup);
      expect(jest.mocked(s.transport.send)).toHaveBeenCalledTimes(sendsBeforeLookup);
      expect(jest.mocked(s.transport.read)).toHaveBeenCalledTimes(readsBeforeLookup);
    } finally { seeded.engine.dispose(); }
  });

  it('refuses transferred-source lookup when a mounted source editor has later private work', async () => {
    const s = fixture(), seeded = await seedRefusedCreation(s);
    try {
      await seeded.engine.transferStudyAnalysisCreation(source.id, target.id, text);
      const sourceEditorId = editorIdentity('handoff-test', source, 'source', 'mounted-private-source');
      const sourceEditor = await seeded.engine.createEditor(source, sourceEditorId);
      const privateSource = analysis(source.id, [5, 9], { title: 'Mounted later source edit' });
      await sourceEditor.edit(privateSource);

      expect(sourceEditor.getState().checkpoint.draft).toEqual(privateSource);
      const rowsBeforeLookup = await createIndexedDbCommitStore().list(owner);
      const sendsBeforeLookup = jest.mocked(s.transport.send).mock.calls.length;
      const readsBeforeLookup = jest.mocked(s.transport.read).mock.calls.length;
      await expect(seeded.engine.findStudyAnalysisCreation(source.id))
        .rejects.toMatchObject({ code: 'analysis-creation-review' });

      expect(sourceEditor.getState().checkpoint.draft).toEqual(privateSource);
      expect(await createIndexedDbCommitStore().list(owner)).toEqual(rowsBeforeLookup);
      expect(jest.mocked(s.transport.send)).toHaveBeenCalledTimes(sendsBeforeLookup);
      expect(jest.mocked(s.transport.read)).toHaveBeenCalledTimes(readsBeforeLookup);
    } finally { seeded.engine.dispose(); }
  });

  it('allows transferred-source lookup from a mounted source editor with no private edits', async () => {
    const s = fixture(), seeded = await seedRefusedCreation(s);
    try {
      await seeded.engine.transferStudyAnalysisCreation(source.id, target.id, text);
      const sourceEditor = await seeded.engine.createEditor(source,
        editorIdentity('handoff-test', source, 'source', 'empty-mounted-source'));
      expect(sourceEditor.getState().checkpoint.draft).toBeNull();
      const transferRequestIdsBefore = (await createIndexedDbCommitStore().list(owner))
        .filter(request => request.transferredFrom).map(request => request.id);
      const sendsBeforeLookup = jest.mocked(s.transport.send).mock.calls.length;
      const readsBeforeLookup = jest.mocked(s.transport.read).mock.calls.length;

      await expect(seeded.engine.findStudyAnalysisCreation(source.id)).resolves.toMatchObject({ resource: target });

      expect((await createIndexedDbCommitStore().list(owner)).filter(request => request.transferredFrom).map(request => request.id)).toEqual(transferRequestIdsBefore);
      expect(jest.mocked(s.transport.send)).toHaveBeenCalledTimes(sendsBeforeLookup);
      expect(jest.mocked(s.transport.read)).toHaveBeenCalledTimes(readsBeforeLookup);
    } finally { seeded.engine.dispose(); }
  });

  it('refuses transfer when a closed source editor retains newer private work', async () => {
    const s = fixture(), seeded = await seedRefusedCreation(s);
    const sourceEditorId = editorIdentity('handoff-test', source, 'source', 'closed-private-source-before-transfer');
    try {
      const sourceEditor = await seeded.engine.createEditor(source, sourceEditorId);
      const privateSource = analysis(source.id, [5, 9], { title: 'Closed later source edit' });
      await sourceEditor.edit(privateSource);
      sourceEditor.close({ flush: false });
      const rowsBeforeTransfer = await createIndexedDbCommitStore().list(owner);

      expect((await createIndexedDbCheckpoints().read(owner, sourceEditorId))?.checkpoint.draft).toEqual(privateSource);
      await expect(seeded.engine.transferStudyAnalysisCreation(source.id, target.id, text))
        .rejects.toMatchObject({ code: 'analysis-creation-review' });

      expect((await createIndexedDbCheckpoints().read(owner, sourceEditorId))?.checkpoint.draft).toEqual(privateSource);
      expect(await createIndexedDbCommitStore().list(owner)).toEqual(rowsBeforeTransfer);
      expect((await createIndexedDbCommitStore().list(owner)).some(request => request.transferredFrom)).toBe(false);
    } finally { seeded.engine.dispose(); }
  });

  it('refuses transfer when a mounted target editor has newer private work', async () => {
    const s = fixture(), seeded = await seedRefusedCreation(s);
    try {
      const targetEditor = await seeded.engine.openEditor(target,
        editorIdentity('handoff-test', target, 'target', 'mounted-private-target-before-transfer'));
      const privateTarget = analysis(target.id, [2, 8], { title: 'Mounted later target edit' });
      await targetEditor.edit(privateTarget);
      const rowsBeforeTransfer = await createIndexedDbCommitStore().list(owner);
      const sendsBeforeTransfer = jest.mocked(s.transport.send).mock.calls.length;

      await expect(seeded.engine.transferStudyAnalysisCreation(source.id, target.id, text))
        .rejects.toMatchObject({ code: 'analysis-creation-review' });

      expect(targetEditor.getState().checkpoint.draft).toEqual(privateTarget);
      expect(await createIndexedDbCommitStore().list(owner)).toEqual(rowsBeforeTransfer);
      expect(jest.mocked(s.transport.send)).toHaveBeenCalledTimes(sendsBeforeTransfer);
    } finally { seeded.engine.dispose(); }
  });

  it('does not disclose a same-scope creation row stored for a different owner', async () => {
    const s = fixture(), engine = s.makeEngine();
    const foreignValue = analysis(source.id, [5], { userId: 'another-owner' });
    const baseline: ResourceSnapshot = { resource: source, value: null, metadata: null };
    const foreign: CommitRequest = {
      id: 'foreign-analysis-create', owner: 'another-owner', editorId: 'foreign-editor', editGeneration: 1,
      baseline, value: foreignValue, predecessor: null, revision: 0, initialized: false, working: baseline,
      intended: foreignValue, command: null, submitted: null, sequence: 0, state: 'queued', result: null,
      unfinalized: [], retentionScope: analysisCreationScope(source.id),
    };
    try {
      await createIndexedDbCommitStore().create(foreign);
      await expect(engine.findStudyAnalysisCreation(source.id)).resolves.toBeNull();
      expect(jest.mocked(s.transport.read)).not.toHaveBeenCalled();
    } finally { engine.dispose(); }
  });

  it('refuses transfer when a closed target editor left a durable private analysis draft', async () => {
    const s = fixture(), seeded = await seedRefusedCreation(s);
    const targetEditorId = editorIdentity('handoff-test', target, 'target', 'closed-private-target');
    try {
      const editor = await seeded.engine.openEditor(target, targetEditorId);
      const privateTarget = analysis(target.id, [2, 8], { title: 'Private target edit' });
      await editor.edit(privateTarget);
      editor.close({ flush: false });

      const stored = await createIndexedDbCheckpoints().read(owner, targetEditorId);
      expect(stored?.checkpoint.draft).toEqual(privateTarget);
      expect((await seeded.engine.listRecoverable(target)).some(item => item.record.editorId === targetEditorId
        && item.record.checkpoint.draft?.title === 'Private target edit')).toBe(true);

      await expect(seeded.engine.transferStudyAnalysisCreation(source.id, target.id, text))
        .rejects.toMatchObject({ code: 'analysis-creation-review' });
      expect((await createIndexedDbCheckpoints().read(owner, targetEditorId))?.checkpoint.draft).toEqual(privateTarget);
      const rows = await createIndexedDbCommitStore().list(owner);
      expect(rows.find(request => request.baseline.resource.id === source.id)).toMatchObject({ state: 'refused' });
      expect(rows.some(request => request.transferredFrom)).toBe(false);
    } finally { seeded.engine.dispose(); }
  });

  it('rejects capture release before an open editor adopts the request and keeps its hold', async () => {
    const s = fixture(), seeded = await seedPendingCreation(s);
    const requestId = seeded.receipt.requestId!;
    try {
      seeded.editor.dispose();
      await expect(seeded.engine.releaseStudyAnalysisCreation(source.id, source.id))
        .rejects.toMatchObject({ code: 'analysis-creation-review' });
      expect((await seeded.engine.listWriteCaptures('analysis-creation:')).map(row => row.requestId)).toEqual([requestId]);
      expect((await createIndexedDbCommitStore().list(owner)).some(request => request.id === requestId)).toBe(true);
    } finally { seeded.engine.dispose(); }
  });

  it('releases a creation hold only after its open source editor owns the pending request', async () => {
    const s = fixture();
    s.server.delete(key(target)); s.local.delete(key(target));
    const seeded = await seedPendingCreation(s), requestId = seeded.receipt.requestId!;
    const sourceEditorId = editorIdentity('handoff-test', source, 'source', 'pending-source');
    try {
      expect((await seeded.engine.listWriteCaptures('analysis-creation:')).map(row => row.requestId)).toEqual([requestId]);
      expect(seeded.editor.getState().checkpoint.pending).toHaveProperty(requestId);
      await seeded.engine.releaseStudyAnalysisCreation(source.id, source.id);
      expect(await seeded.engine.listWriteCaptures('analysis-creation:')).toEqual([]);
      expect((await createIndexedDbCommitStore().list(owner)).some(request => request.id === requestId)).toBe(true);
      expect((await createIndexedDbCheckpoints().read(owner, sourceEditorId))?.checkpoint.pending).toHaveProperty(requestId);

      seeded.engine.setOnline(true);
      await seeded.engine.retry();
      await expect(seeded.receipt.persistence).resolves.toMatchObject({ resource: source, value: seeded.value });
      await settle();
      expect(s.server.get(key(source))?.value).toMatchObject(seeded.value);
      expect((await createIndexedDbCommitStore().list(owner)).some(request => request.id === requestId)).toBe(false);
    } finally { seeded.engine.dispose(); }
  });

  it.each(['pending', 'acknowledged'] as const)('releases a %s transfer hold when a restarted editor opens the target directly', async state => {
    const s = fixture(), seeded = await seedRefusedCreation(s);
    const commits = createIndexedDbCommitStore();
    try {
      await seeded.engine.transferStudyAnalysisCreation(source.id, target.id, text);
      const rows = await commits.list(owner);
      const sourceRequest = rows.find(request => request.baseline.resource.id === source.id)!;
      const transfer = rows.find(request => request.transferredFrom)!;
      if (state === 'acknowledged') {
        seeded.engine.setOnline(true);
        await seeded.engine.retry();
        expect((await commits.list(owner)).find(request => request.id === transfer.id)?.state).toBe('acknowledged');
      }
      seeded.engine.dispose();

      const restarted = s.makeEngine();
      try {
        const other = { collection: 'studyNotes', id: 'unrelated-analysis' };
        const otherEditor = await restarted.createEditor(other, editorIdentity('handoff-test', other, 'analysis', 'unrelated-opening'));
        const otherValue = analysis(other.id, [8]);
        const otherReceipt = await otherEditor.commitWithReceipt(() => otherValue, { captureScope: analysisCreationScope(other.id) });

        await expect(restarted.releaseStudyAnalysisCreation(target.id, target.id))
          .rejects.toMatchObject({ code: 'analysis-creation-review' });
        expect((await restarted.listWriteCaptures('analysis-creation:')).map(row => row.requestId)).toContain(sourceRequest.id);
        expect((await restarted.listWriteCaptures(ANALYSIS_CREATION_TRANSFER_PREFIX)).map(row => row.requestId)).toContain(transfer.id);

        const editor = await restarted.openEditor(target, editorIdentity('handoff-test', target, 'target', 'direct-opening'));
        const adopted = editor.getState().checkpoint;
        if (state === 'pending') expect(adopted.pending).toHaveProperty(transfer.id);
        else expect(adopted.confirmed.metadata?.revision).toBe(2);
        expect(adopted.draft?.analysis).toEqual(transfer.value?.analysis);

        await restarted.releaseStudyAnalysisCreation(target.id, target.id);
        await restarted.releaseStudyAnalysisCreation(target.id, target.id);

        expect(await restarted.listWriteCaptures(ANALYSIS_CREATION_TRANSFER_PREFIX)).toEqual([]);
        expect((await restarted.listWriteCaptures('analysis-creation:')).map(row => row.requestId)).toEqual([otherReceipt.requestId]);
        expect(editor.getState().checkpoint.draft?.analysis).toEqual(transfer.value?.analysis);
        if (state === 'pending') {
          expect(editor.getState().checkpoint.pending).toHaveProperty(transfer.id);
          expect((await commits.list(owner)).find(request => request.id === transfer.id)?.value).toEqual(transfer.value);
        }
      } finally { restarted.dispose(); }
    } finally { seeded.engine.dispose(); }
  });

  it('projects both transfer sides, keeps later source and destination words, then collects their requests', async () => {
    const s = fixture(), seeded = await seedRefusedCreation(s);
    try {
      await seeded.engine.transferStudyAnalysisCreation(source.id, target.id, text);
      const rows = await createIndexedDbCommitStore().list(owner);
      const sourceRequest = rows.find(request => request.baseline.resource.id === source.id)!;
      const transfer = rows.find(request => request.transferredFrom)!;
      const sourceEditor = await seeded.engine.openEditor(source, sourceRequest.editorId);
      const laterPrivateSource = analysis(source.id, [5, 9], { title: 'Later private source title' });
      await sourceEditor.edit(laterPrivateSource);
      sourceEditor.close({ flush: false });
      expect((await createIndexedDbCheckpoints().read(owner, sourceRequest.editorId))?.checkpoint.draft).toEqual(laterPrivateSource);
      const actionEditor = await seeded.engine.openEditor(target, transfer.editorId);
      const laterPrivateValue = { ...transfer.value!, title: 'Later private target title' };
      await actionEditor.edit(laterPrivateValue);
      actionEditor.close({ flush: false });
      expect((await createIndexedDbCheckpoints().read(owner, transfer.editorId))?.checkpoint.draft).toEqual(laterPrivateValue);
      const editor = await seeded.engine.openEditor(target, editorIdentity('handoff-test', target, 'target', 'adopt-transfer'));
      expect(editor.getState().checkpoint.pending).toHaveProperty(transfer.id);
      expect((await seeded.engine.listWriteCaptures('analysis-creation:')).map(row => row.requestId)).toContain(sourceRequest.id);
      expect((await seeded.engine.listWriteCaptures(ANALYSIS_CREATION_TRANSFER_PREFIX)).map(row => row.requestId)).toContain(transfer.id);

      await seeded.engine.releaseStudyAnalysisCreation(source.id, target.id);
      expect(await seeded.engine.listWriteCaptures('analysis-creation:')).toEqual([]);
      expect(await seeded.engine.listWriteCaptures(ANALYSIS_CREATION_TRANSFER_PREFIX)).toEqual([]);
      expect((await createIndexedDbCommitStore().list(owner)).map(request => request.id)).toContain(transfer.id);

      seeded.engine.setOnline(true);
      await seeded.engine.retry();
      await settle();
      expect(editor.getState().checkpoint.pending).not.toHaveProperty(transfer.id);
      expect(s.server.get(key(target))?.value?.analysis).toEqual(transfer.value?.analysis);
      const projectedActionCheckpoint = await createIndexedDbCheckpoints().read(owner, transfer.editorId);
      expect(projectedActionCheckpoint?.checkpoint.draft?.title).toBe('Later private target title');
      expect(projectedActionCheckpoint?.checkpoint.pending).not.toHaveProperty(transfer.id);
      const afterDelivery = await createIndexedDbCommitStore().list(owner);
      expect(afterDelivery.some(request => request.id === transfer.id)).toBe(false);
      const originalSourceCheckpoint = await createIndexedDbCheckpoints().read(owner, sourceRequest.editorId);
      expect({
        rowState: afterDelivery.find(request => request.id === sourceRequest.id)?.state ?? null,
        rowRetentionScope: afterDelivery.find(request => request.id === sourceRequest.id)?.retentionScope ?? null,
        sourcePending: Boolean(originalSourceCheckpoint?.checkpoint.pending[sourceRequest.id]),
      }).toEqual({ rowState: null, rowRetentionScope: null, sourcePending: false });
      expect(originalSourceCheckpoint?.checkpoint.draft).toEqual(laterPrivateSource);
      expect(originalSourceCheckpoint?.checkpoint.draft?.analysis).toMatchObject({ cuts: [5, 9] });
    } finally { seeded.engine.dispose(); }
  });
});
