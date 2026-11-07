import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { CommitQueue } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { DataEngine } from '../engine';
import { createIndexedDbManualScopes } from '../manualScopes.client';
import { ResourceObserver } from '../observer';
import { applyCommand } from '../protocol';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import { installStorageHarness } from './storageHarness';

import type { EditorRecord } from '../controller';
import type { CommandResult, DataCommand, JournalEntry, ResourceRef, ResourceSnapshot } from '../types';

// BUG-20261107-engine-state-held-by-old-local-backlog: an editor closed while its Save was on the way left its copy on
// the device for good — 61 of 62 copies on the owner's device held nothing of his, yet each kept its answered rows,
// and every later storage pass read all of them in full until the store stopped answering. The engine now finishes
// what the closed editor would have done on those answers while open — and nothing more.
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const owner = 'owner';
const resource: ResourceRef = { collection: 'studyNotes', id: 'note' };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const opening: ResourceSnapshot = {
  resource,
  value: { userId: owner, title: 'Opening title', content: 'Opening words', tags: [], scriptureRefs: [], isDraft: false,
    createdAt: '2026-11-07', updatedAt: '2026-11-07' },
  metadata: { protocol: 1, generation: 'closed-editor-generation', revision: 1, deleted: false },
};
const rowKey = (...key: unknown[]) => JSON.stringify(key);

/** One device: an editor saved «Saved words» (and `saves` more), closed, and the answers arrived after it was gone. */
async function closedEditorWithAnsweredSave(held: boolean | null, options: { cache?: 'works' | 'fails'; saves?: number } = {}) {
  const editorId = 'closed-editor';
  const storage = installStorageHarness();
  const checkpoints = createIndexedDbCheckpoints(), commits = createIndexedDbCommitStore();
  let server = clone(opening), sequence = 0;
  const transport = {
    read: jest.fn(async () => clone(server)),
    send: jest.fn(async (command: DataCommand): Promise<CommandResult> => {
      const result = applyCommand(command, clone(server));
      if (result.kind === 'acknowledged') server = clone(result.snapshot);
      return result;
    }),
  };
  const journals = new Map<string, JournalEntry>();
  const journal = {
    list: async (uid: string) => clone([...journals.values()].filter(entry => entry.command.owner === uid)),
    put: async (entry: JournalEntry) => { journals.set(entry.command.operationId, clone(entry)); },
    remove: async (_uid: string, id: string) => { journals.delete(id); },
  };
  const sending = new DataEngineRuntime({ transport, journal }); sending.setOwner(owner);
  const queue = new CommitQueue({ store: commits, runtime: sending, operationId: () => `closed-${++sequence}`, readConfirmed: async () => clone(server) });
  queue.setOwner(owner);
  const editor = new DataSession(opening);
  const save = async (content: string) => {
    editor.edit({ ...opening.value!, content });
    const request = await queue.save(editorId, editor.checkpoint(), {
      checkpoint: saved => {
        editor.registerCommit(saved.id, saved.editGeneration, saved.value, saved.command?.operationId);
        return { owner, editorId, checkpoint: editor.checkpoint(), prepared: null, unfinalized: [] } satisfies EditorRecord;
      },
    });
    if (!request) throw new Error('The editor did not produce a Save');
    return request;
  };
  const request = await save('Saved words');
  for (let n = 1; n <= (options.saves ?? 0); n += 1) await save(`Saved words, revision ${n}`);
  await queue.drain(true);
  const rows = await commits.list(owner);
  if (rows.some(row => row.state !== 'acknowledged' || row.unfinalized.length)) throw new Error('A Save was not answered');
  const cache = new Map<string, ResourceSnapshot>(), cacheState = { fails: options.cache === 'fails' };
  const engine = new DataEngine({ transport, checkpoints, commits, manualScopes: createIndexedDbManualScopes(),
    snapshots: {
      read: async () => clone(cache.get('note') ?? opening),
      put: async (_owner, snapshot) => { if (cacheState.fails) throw new Error('Snapshot cache unavailable'); cache.set('note', clone(snapshot)); },
    },
    observer: new ResourceObserver({ transport, source: { listen: () => () => undefined } }),
    runtime: new DataEngineRuntime({ transport, journal: { list: async () => [], put: async () => undefined, remove: async () => undefined } }),
    recoveryPresence: { held: async () => held, hold: () => () => undefined }, operationId: () => `engine-${++sequence}`, onError: () => undefined });
  engine.setOnline(false);
  return { engine, checkpoints, commits, request, editorId, storage, editor, cache, cacheState };
}

type Device = Awaited<ReturnType<typeof closedEditorWithAnsweredSave>>;
const rowsOf = async (s: Device) => (await s.commits.list(owner)).map(item => item.id);
const pass = async (s: Device) => { s.engine.setOwner(owner); await s.engine.retry().catch(() => undefined); };

describe('a closed editor\'s copy after its Saves were answered', () => {
  it('is removed with its answered rows once no tab holds the editor', async () => {
    const s = await closedEditorWithAnsweredSave(false);
    expect(await s.checkpoints.read(owner, s.editorId)).toBeDefined();
    expect(await rowsOf(s)).toEqual([s.request.id]);

    await pass(s);

    expect(await s.checkpoints.read(owner, s.editorId)).toBeUndefined();
    expect(await rowsOf(s)).toEqual([]);
    expect(s.cache.get('note')?.value?.content).toBe('Saved words');
    s.engine.dispose();
  });

  it.each([[true, 'still open in some tab'], [null, 'of unknown presence']] as const)('stays while the editor is %s (%s)', async (held, _why) => {
    const s = await closedEditorWithAnsweredSave(held);
    const before = await s.checkpoints.read(owner, s.editorId);

    await pass(s);

    expect(await s.checkpoints.read(owner, s.editorId)).toEqual(before);
    expect(await rowsOf(s)).toEqual([s.request.id]);
    s.engine.dispose();
  });

  it('keeps words typed after the Saves, with their version, and lets go of the answered Saves', async () => {
    const s = await closedEditorWithAnsweredSave(false, { saves: 5 });
    const stored = (await s.checkpoints.read(owner, s.editorId))!;
    const later = DataSession.restore(stored.checkpoint);
    later.edit({ ...later.checkpoint().draft!, content: 'Words typed after the Saves' });
    await s.checkpoints.put({ ...stored, checkpoint: later.checkpoint() });
    const typed = (await s.checkpoints.read(owner, s.editorId))!;
    expect(Object.keys(typed.checkpoint.pending)).toHaveLength(6);

    await pass(s);

    const kept = (await s.checkpoints.read(owner, s.editorId))!;
    expect(kept.checkpoint.draft?.content).toBe('Words typed after the Saves');
    expect(kept.checkpoint.pending).toEqual({});
    expect(kept.recoveryVersion).toBe(typed.recoveryVersion);
    expect(await rowsOf(s)).toEqual([]);
    const offered = await s.engine.listRecoverable(resource);
    expect(offered.map(choice => choice.record.checkpoint.draft?.content)).toEqual(['Words typed after the Saves']);
    s.engine.dispose();
  });

  it('waits while an older answered row is the device\'s only accepted copy, and settles once it is cached', async () => {
    const s = await closedEditorWithAnsweredSave(false, { cache: 'fails' });
    // Rows written before the separate accepted-cache hold existed carry only the projection hold.
    s.storage.rows.delete(rowKey('reference', owner, 'accepted-cache', s.request.id));
    expect(s.storage.rows.has(rowKey('reference', owner, 'projection', s.request.id))).toBe(true);

    await pass(s);

    expect(await s.checkpoints.read(owner, s.editorId)).toBeDefined();
    const [answered] = await s.commits.list(owner);
    expect(answered.result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { content: 'Saved words' } } });

    s.cacheState.fails = false;
    await pass(s);

    expect(s.cache.get('note')?.value?.content).toBe('Saved words');
    expect(await s.checkpoints.read(owner, s.editorId)).toBeUndefined();
    expect(await rowsOf(s)).toEqual([]);
    s.engine.dispose();
  });

  it('lets go of a cancelled Save whose row still has its projection hold, as on the owner\'s device, keeping the unsaved words', async () => {
    const s = await closedEditorWithAnsweredSave(false);
    const key = rowKey('request', owner, s.editorId, s.request.editGeneration);
    const row = s.storage.rows.get(key) as Record<string, unknown>;
    s.storage.rows.set(key, { ...row, state: 'cancelled', result: null });
    s.storage.rows.delete(rowKey('reference', owner, 'accepted-cache', s.request.id));
    expect(s.storage.rows.has(rowKey('reference', owner, 'projection', s.request.id))).toBe(true);

    await pass(s);

    const kept = (await s.checkpoints.read(owner, s.editorId))!;
    expect(kept.checkpoint.draft?.content).toBe('Saved words');
    expect(kept.checkpoint.pending).toEqual({});
    expect(s.storage.rows.has(rowKey('reference', owner, 'projection', s.request.id))).toBe(false);
    expect(await rowsOf(s)).toEqual([]);
    s.engine.dispose();
  });

  it('settles an older copy as stored on the owner\'s device: no version, no accepted-cache hold, no conflicts field', async () => {
    const s = await closedEditorWithAnsweredSave(false);
    const older = clone((await s.checkpoints.read(owner, s.editorId))!);
    delete older.recoveryVersion;
    delete (older.checkpoint as unknown as Record<string, unknown>).conflicts;
    s.storage.rows.set(rowKey('checkpoint', owner, s.editorId), older);
    s.storage.rows.delete(rowKey('reference', owner, 'accepted-cache', s.request.id));

    await pass(s);

    expect(await s.checkpoints.read(owner, s.editorId)).toBeUndefined();
    expect(await rowsOf(s)).toEqual([]);
    s.engine.dispose();
  });
});

describe('settling closed copies in storage', () => {
  it('leaves a copy that changed after it was read, and refuses one that still holds unanswered work', async () => {
    const s = await closedEditorWithAnsweredSave(false);
    const stored = (await s.checkpoints.read(owner, s.editorId))!;
    const settled: EditorRecord = { ...clone(stored), checkpoint: { ...clone(stored.checkpoint), pending: {}, dirty: false,
      draft: clone(stored.checkpoint.confirmed.value) } };
    const changed = clone(stored); changed.checkpoint.draft!.content = 'Changed by a live writer';
    await s.checkpoints.put(changed);
    await s.checkpoints.settleClosed!(owner, [{ stored, settled }]);
    expect((await s.checkpoints.read(owner, s.editorId))?.checkpoint.draft?.content).toBe('Changed by a live writer');

    const current = (await s.checkpoints.read(owner, s.editorId))!;
    await s.checkpoints.settleClosed!(owner, [{ stored: current, settled: current }]);
    expect(await s.checkpoints.read(owner, s.editorId)).toEqual(current);
    s.engine.dispose();
  });
});
