import { pendingAutosaveReceipts } from '../automaticDraftResume';
import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { CommitQueue } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { retirableEditorIdentity } from '../editorIdentity';
import { DataEngine } from '../engine';
import { ResourceObserver } from '../observer';
import { applyCommand } from '../protocol';
import { forkCheckpoint, recoveryCheckpointId } from '../recovery.client';
import { DataEngineRuntime } from '../runtime';
import { DataSession } from '../session';
import { installStorageHarness } from './storageHarness';

import type { EditorRecord } from '../controller';
import type { CommandResult, DataCommand, DocumentData, JournalEntry, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const owner = 'owner';
const resource = { collection: 'groups', id: 'preparation' };
const local = 'Words typed in the group description';
const baseline: DocumentData = {
  userId: owner, title: 'Opening title', description: 'Opening words', status: 'draft',
  flow: [], templates: [], createdAt: '2026-11-20', updatedAt: '2026-11-20',
};
const opening: ResourceSnapshot = {
  resource, value: baseline, metadata: { protocol: 1, generation: 'group-created', revision: 1, deleted: false },
};
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function boot(serverCopy: ResourceSnapshot, held: boolean | null = false) {
  installStorageHarness();
  const checkpoints = createIndexedDbCheckpoints();
  const commits = createIndexedDbCommitStore();
  let server = copy(serverCopy);
  let saved = copy(opening);
  let sequence = 0;
  const journal = new Map<string, JournalEntry>();
  const transport = {
    read: jest.fn(async () => copy(server)),
    send: jest.fn(async (command: DataCommand): Promise<CommandResult> => {
      const result = applyCommand(command, copy(server));
      if (result.kind === 'acknowledged') server = copy(result.snapshot);
      return result;
    }),
  };
  const runtime = new DataEngineRuntime({ transport, journal: {
    list: async uid => copy([...journal.values()].filter(entry => entry.command.owner === uid)),
    put: async entry => { journal.set(entry.command.operationId, copy(entry)); },
    remove: async (_uid, id) => { journal.delete(id); },
  } });
  const engine = new DataEngine({
    transport, runtime, checkpoints, commits,
    observer: new ResourceObserver({ transport, source: { listen: () => () => undefined } }),
    snapshots: { read: async () => copy(saved), put: async (_owner, snapshot) => { saved = copy(snapshot); } },
    recoveryPresence: { held: async () => held, hold: () => () => undefined },
    operationId: () => 'recovered-' + ++sequence,
  });
  const leaveDraft = async (slot = 'group', title = 'previous-tab', submitted = false, description = local) => {
    const editorId = retirableEditorIdentity(title, resource, slot, String(++sequence));
    const session = new DataSession(opening);
    const record = (): EditorRecord => ({ owner, editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] });
    if (submitted) {
      const queue = new CommitQueue({ store: commits, runtime, operationId: () => 'prepared-' + ++sequence, readConfirmed: transport.read });
      queue.setOwner(owner);
      await commits.activateOrdinaryEditor!(owner, editorId);
      session.edit({ ...baseline, description: 'Earlier submitted words' });
      await queue.save(editorId, session.checkpoint(), { checkpoint: request => {
        session.applyCommit(request);
        return record();
      } });
      await commits.retireOrdinaryEditor!(owner, editorId);
    }
    session.edit({ ...baseline, description });
    await checkpoints.put(record());
    return editorId;
  };
  const start = async (online = true) => {
    if (!online) engine.setOnline(false);
    engine.setOwner(owner);
    await engine.retry();
  };
  return { engine, checkpoints, commits, transport, start, leaveDraft, stored: () => copy(server) };
}

describe('starting again after a group description was saved on the device but not submitted', () => {
  let device: ReturnType<typeof boot> | undefined;
  afterEach(() => device?.engine.dispose());

  it('sends the closed autosaved editor’s words without reopening its page', async () => {
    device = boot(opening);
    const editorId = await device.leaveDraft();

    await device.start();

    expect(device.stored().value?.description).toBe(local);
    expect(device.transport.send).toHaveBeenCalledTimes(1);
    expect(await device.checkpoints.read(owner, editorId)).toBeUndefined();
    await device.engine.retry();
    expect(device.transport.send).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft offline and sends it when startup work can reach the server', async () => {
    device = boot(opening);
    const editorId = await device.leaveDraft();
    await device.start(false);
    expect(device.transport.read).not.toHaveBeenCalled();
    expect((await device.checkpoints.read(owner, editorId))?.checkpoint.draft?.description).toBe(local);

    device.engine.setOnline(true);
    await device.engine.retry();

    expect(device.stored().value?.description).toBe(local);
    expect(device.transport.send).toHaveBeenCalledTimes(1);
  });

  it('keeps an independently renamed group when it sends the unsent description', async () => {
    device = boot({ ...opening, value: { ...baseline, title: 'Renamed on the phone' },
      metadata: { ...opening.metadata!, revision: 2 } });
    await device.leaveDraft();

    await device.start();

    expect(device.stored().value).toMatchObject({ title: 'Renamed on the phone', description: local });
    expect(device.transport.send).toHaveBeenCalledTimes(1);
  });

  it('keeps a competing copy available when the same words changed on another device', async () => {
    const changed = { ...opening, value: { ...baseline, description: 'Words on the other device' },
      metadata: { ...opening.metadata!, revision: 2 } };
    device = boot(changed);
    const editorId = await device.leaveDraft();

    await device.start();

    expect(device.transport.send).not.toHaveBeenCalled();
    expect(device.stored()).toEqual(changed);
    expect((await device.checkpoints.read(owner, editorId))?.checkpoint.draft?.description).toBe(local);
  });

  it.each([true, null])('keeps the source when its tab status is %s', async held => {
    device = boot(opening, held);
    const editorId = await device.leaveDraft();
    await device.start();
    expect(device.transport.send).not.toHaveBeenCalled();
    expect((await device.checkpoints.read(owner, editorId))?.checkpoint.draft?.description).toBe(local);
  });

  it('sends the later draft after the earlier captured Save settles on this startup', async () => {
    device = boot(opening);
    const editorId = await device.leaveDraft('group', 'interrupted-tab', true);

    await device.start();

    expect(device.transport.send).toHaveBeenCalledTimes(2);
    expect(device.stored().value?.description).toBe(local);
    expect(await device.checkpoints.read(owner, editorId)).toBeUndefined();
  });

  it.each([local, baseline.description as string])('sends %s when the earlier Save answers after startup', async later => {
    const current = boot(opening);
    device = current;
    const editorId = await current.leaveDraft('group', 'interrupted-tab', true, later);
    const originalSend = current.transport.send.getMockImplementation()!;
    current.transport.send.mockRejectedValue(new Error('The first delivery had no answer'));

    await current.start();
    const waiting = (await current.checkpoints.read(owner, editorId))!.checkpoint;
    expect(waiting.draft?.description).toBe(later);
    expect(waiting.dirty).toBe(later !== baseline.description);
    expect(Object.keys(waiting.pending)).toHaveLength(1);

    current.transport.send.mockImplementation(originalSend);
    await current.engine.retry();

    expect(current.stored().value?.description).toBe(later);
    expect(await current.checkpoints.read(owner, editorId)).toBeUndefined();
    expect(current.transport.send.mock.calls.flatMap(([command]) =>
      command.kind === 'update' ? command.changes.flatMap(change => change.after.value ?? []) : [])).toContain(later);
  });

  it('recognizes an already-answered receipt even if the stored copy was read just before that answer', async () => {
    const current = boot(opening);
    device = current;
    const editorId = await current.leaveDraft('group', 'interrupted-tab', true);
    const record = (await current.checkpoints.read(owner, editorId))!;
    const [request] = await current.commits.list(owner);
    expect(pendingAutosaveReceipts([{ id: recoveryCheckpointId(owner, editorId), record }],
      [{ ...request, state: 'acknowledged' }])).toMatchObject([{ receipts: [request.id] }]);
  });

  it('does not capture a source if manual recovery took that exact version first', async () => {
    const current = boot(opening);
    device = current;
    const editorId = await current.leaveDraft();
    current.transport.read.mockImplementationOnce(async () => {
      await forkCheckpoint(current.checkpoints, owner, recoveryCheckpointId(owner, editorId), 'manual-recovery', resource);
      return opening;
    });

    await current.start();

    expect(current.transport.send).not.toHaveBeenCalled();
    expect((await current.checkpoints.read(owner, 'manual-recovery'))?.checkpoint.draft?.description).toBe(local);
  });

  it('does not create a recovery fork from the prior source version after startup claimed its save', async () => {
    const current = boot(opening);
    device = current;
    const editorId = await current.leaveDraft();
    const checkpoints = current.checkpoints;
    const originalSend = current.transport.send.getMockImplementation()!;
    let signal!: () => void;
    const sendStarted = new Promise<void>(resolve => { signal = resolve; });
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    current.transport.send.mockImplementationOnce(async command => { signal(); await hold; return originalSend(command); });
    let running: Promise<void> | undefined;
    try {
      const fork = forkCheckpoint({
        read: checkpoints.read, pinRecovery: checkpoints.pinRecovery,
        create: async (record, origin) => {
          running = current.start();
          await sendStarted;
          return checkpoints.create(record, origin);
        },
      }, owner, recoveryCheckpointId(owner, editorId), 'stale-recovery', resource);
      await expect(fork).rejects.toMatchObject({ code: 'decision-changed' });
    } finally {
      release();
      await running;
    }
    expect(current.transport.send).toHaveBeenCalledTimes(1);
    expect(await checkpoints.read(owner, 'stale-recovery')).toBeUndefined();
  });

  it('retries one transient startup read without offering an extra decision', async () => {
    device = boot(opening);
    await device.leaveDraft();
    device.transport.read.mockRejectedValueOnce(Object.assign(new Error('Temporary loss'), { code: 'unavailable' }));
    await device.start();
    await device.engine.retry();

    expect(device.transport.send).toHaveBeenCalledTimes(1);
    expect(device.stored().value?.description).toBe(local);
  });

  it('rejects a discarded-copy command once the same source has queued its autosave', async () => {
    const current = boot(opening);
    device = current;
    const editorId = await current.leaveDraft();
    const record = (await current.checkpoints.read(owner, editorId))!;
    const originalSend = current.transport.send.getMockImplementation()!;
    let waiting!: () => void;
    const started = new Promise<void>(resolve => { waiting = resolve; });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    current.transport.send.mockImplementationOnce(async command => {
      waiting();
      await held;
      return originalSend(command);
    });
    const start = current.start();
    await started;

    try {
      await expect(current.engine.discardRecovery({ id: recoveryCheckpointId(owner, editorId), record })).rejects.toThrow();
      expect(Object.keys((await current.checkpoints.read(owner, editorId))!.checkpoint.pending)).toHaveLength(1);
    } finally {
      release();
      await start;
    }
    expect(current.stored().value?.description).toBe(local);
  });

  it('does not choose between two unsent copies of the same group', async () => {
    device = boot(opening);
    const first = await device.leaveDraft();
    const second = await device.leaveDraft('group', 'another-tab');

    await device.start();

    expect(device.transport.read).not.toHaveBeenCalled();
    expect(device.transport.send).not.toHaveBeenCalled();
    expect(await device.checkpoints.read(owner, first)).toBeDefined();
    expect(await device.checkpoints.read(owner, second)).toBeDefined();
  });

  it('keeps a newer local draft if the source changed during the fresh read', async () => {
    const current = boot(opening);
    device = current;
    const editorId = await current.leaveDraft();
    current.transport.read.mockImplementationOnce(async () => {
      const record = (await current.checkpoints.read(owner, editorId))!;
      const session = DataSession.restore(record.checkpoint);
      session.edit({ ...baseline, description: 'Words written after startup began' });
      await current.checkpoints.put({ ...record, checkpoint: session.checkpoint() });
      return opening;
    });

    await current.start();

    expect(current.transport.send).not.toHaveBeenCalled();
    expect((await current.checkpoints.read(owner, editorId))?.checkpoint.draft?.description).toBe('Words written after startup began');
  });

  it('keeps the old account’s draft if the account changes during its read', async () => {
    const current = boot(opening);
    device = current;
    const editorId = await current.leaveDraft();
    current.transport.read.mockImplementationOnce(async () => {
      current.engine.setOwner('another-user');
      return opening;
    });

    await expect(current.start()).rejects.toThrow();
    expect(current.transport.send).not.toHaveBeenCalled();
    expect((await current.checkpoints.read(owner, editorId))?.checkpoint.draft?.description).toBe(local);
  });

  it('keeps an explicitly saved screen’s draft for that screen to decide', async () => {
    device = boot(opening);
    const editorId = await device.leaveDraft('group-conduct');
    await device.start();
    expect(device.transport.send).not.toHaveBeenCalled();
    expect((await device.checkpoints.read(owner, editorId))?.checkpoint.draft?.description).toBe(local);
  });
});
