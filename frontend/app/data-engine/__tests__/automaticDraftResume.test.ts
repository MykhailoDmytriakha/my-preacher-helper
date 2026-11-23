import { deferred } from '../../../test-utils/deferred';

import { pendingAutosaveReceipts } from '../automaticDraftResume';
import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { CommitQueue } from '../commits';
import { createIndexedDbCommitStore } from '../commits.client';
import { manualScopeIdentity, retirableEditorIdentity } from '../editorIdentity';
import { GROUP_MEETING_SLOT } from '../groupMeetingAutosave';
import { recoverManualScopeRecord } from '../manualScope';
import { createIndexedDbManualScopes } from '../manualScopes.client';
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
  const commits = createIndexedDbCommitStore(), forms = createIndexedDbManualScopes();
  let server = copy(serverCopy);
  let saved = serverCopy.resource.collection === 'groups' ? copy(opening) : undefined;
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
    transport, runtime, checkpoints, commits, manualScopes: forms,
    observer: new ResourceObserver({ transport, source: { listen: () => () => undefined } }),
    snapshots: { read: async (_owner, ref) => saved?.resource.id === ref.id && saved.resource.collection === ref.collection ? copy(saved) : undefined, put: async (_owner, snapshot) => { saved = copy(snapshot); } },
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
  const queue = new CommitQueue({ store: commits, runtime, operationId: () => 'prepared-' + ++sequence, readConfirmed: transport.read });
  queue.setOwner(owner);
  return { engine, checkpoints, commits, forms, queue, transport, start, leaveDraft, stored: () => copy(server) };
}

const meeting = { id: 'meeting', date: '2026-11-23', location: 'Main hall', createdAt: '2026-11-20T12:00:00.000Z' };
const meetingOpening: ResourceSnapshot = { ...opening, value: { ...baseline, meetingDates: [meeting] } };
const meetingStage = (location: string): DocumentData => ({ ...meetingOpening.value, meetingDates: [{ ...meeting, location }] });
const parentEditorId = retirableEditorIdentity('closed-tab', resource, 'group-detail', 'prior');
const scopeId = manualScopeIdentity(parentEditorId, GROUP_MEETING_SLOT);

describe('starting again after a meeting edit was saved on the device', () => {
  let device: ReturnType<typeof boot>;
  beforeEach(() => { device = boot(meetingOpening); });
  afterEach(() => device.engine.dispose());

  const time = (ms: number) => ({ earliestMs: 1_800_000_000_000 + ms, latestMs: 1_800_000_000_001 + ms });
  const locationProof = (after: string, ms: number) =>
    ({ location: { rowId: meeting.id, rowCreatedAt: meeting.createdAt, after, time: time(ms) } });
  const leaveMeeting = async (location: string, generation = 1) => {
    await device.forms.create({ owner, scopeId, parentEditorId, slot: GROUP_MEETING_SLOT, commitReferences: [],
      record: { kind: 'manual', version: 1, owner, resource, scopeId, selection: [['meetingDates']], baseline: meetingOpening,
        predecessor: null, stage: [{ exists: true, value: meetingStage(location).meetingDates }],
        savedSelection: [{ exists: true, value: [meeting] }], generation, savedGeneration: null, openingGeneration: 0,
        active: true, autosaveGroupMeeting: true, groupMeetingFieldCaptures: locationProof(location, 10) } });
  };

  const queueChange = (identity: string, value: DocumentData, options?: Parameters<CommitQueue['save']>[2]) => {
    const session = new DataSession(meetingOpening);
    session.edit(value);
    return device.queue.save(identity, session.checkpoint(), options);
  };

  it.each(['Later hall', meeting.location])('sends %s after an earlier Save survived without its form receipt', async location => {
    await leaveMeeting(location, 2);
    await queueChange(scopeId, meetingStage('First hall'), { groupMeetingFieldCaptures: locationProof('First hall', 0) });

    await device.start();
    await device.engine.retry();

    expect(device.transport.send).toHaveBeenCalledTimes(2);
    const command = device.transport.send.mock.calls[1][0];
    expect(command.kind === 'update' && command.groupMeetingFieldActions?.location?.time).toEqual(time(10));
    expect(device.stored().value?.meetingDates).toEqual([{ ...meeting, location }]);
  });

  it('retires the exact closed form once its surviving Save is acknowledged', async () => {
    await leaveMeeting('First hall');
    await queueChange(scopeId, meetingStage('First hall'), { groupMeetingFieldCaptures: locationProof('First hall', 0) });

    await device.start();
    await device.engine.retry();

    expect(device.stored().value?.meetingDates).toEqual([{ ...meeting, location: 'First hall' }]);
    expect(device.transport.send).toHaveBeenCalledTimes(1);
    expect(await device.forms.list(owner)).toHaveLength(0);
  });

  it('retries after a same-group change first appears during the startup target read', async () => {
    await leaveMeeting('Later hall');
    const reading = deferred(), continueRead = deferred();
    device.transport.read.mockImplementationOnce(async () => {
      reading.resolve();
      await continueRead.promise;
      return device.stored();
    });
    const started = device.start();
    await reading.promise;
    try {
      expect(await queueChange('independent-title', { ...meetingOpening.value, title: 'New title' })).not.toBeNull();
    } finally { continueRead.resolve(); }
    await started;
    await device.engine.retry();

    expect(device.stored().value).toMatchObject({ title: 'New title', meetingDates: [{ ...meeting, location: 'Later hall' }] });
    expect(device.transport.send).toHaveBeenCalledTimes(2);
  });

  it('cannot fork a recovered meeting draft after the automatic save has claimed its source version', async () => {
    await leaveMeeting('Later hall');
    const [source] = await device.forms.list(owner);
    const version = (await device.forms.pinRecovery!(source))!;
    const recoveredId = manualScopeIdentity(parentEditorId, GROUP_MEETING_SLOT, 'recovered');
    const origin = { id: source.scopeId, version };

    await device.start();
    await expect(device.forms.create({ ...source, scopeId: recoveredId,
      record: recoverManualScopeRecord(source.record, recoveredId, origin) }, origin))
      .rejects.toMatchObject({ code: 'decision-changed' });
    expect(await device.forms.read(owner, recoveredId)).toBeUndefined();
    expect(device.transport.send).toHaveBeenCalledTimes(1);
  });
});

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

describe('a new study note after the page was killed before it could submit a creation', () => {
  const noteResource = { collection: 'studyNotes', id: 'reserved-note' };
  const absent: ResourceSnapshot = { resource: noteResource, value: null, metadata: null };
  const draft = {
    userId: owner, title: 'New note', type: 'note', content: 'Words from before the crash', tags: [], scriptureRefs: [],
    isDraft: true, createdAt: '2026-11-20', updatedAt: '2026-11-20',
  };
  const editorId = retirableEditorIdentity('closed-note-tab', noteResource, 'study-note', 'opening');
  let device: ReturnType<typeof boot> | undefined;
  afterEach(() => device?.engine.dispose());

  async function keepCreation(current: ReturnType<typeof boot>) {
    const session = new DataSession(absent);
    session.edit(draft);
    await current.checkpoints.put({ owner, editorId, checkpoint: session.checkpoint(),
      prepared: null, unfinalized: [], autoSaveOnResume: true });
  }

  it('creates the note once at the original reserved address when the person returns', async () => {
    device = boot(absent);
    await keepCreation(device);

    await device.start();

    expect(device.stored().value?.content).toBe(draft.content);
    expect(device.transport.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create', resource: noteResource }));
    await device.engine.retry();
    expect(device.transport.send).toHaveBeenCalledTimes(1);
    expect(await device.checkpoints.read(owner, editorId)).toBeUndefined();
  });

  it.each([false, true])('keeps the copy without writing if the reserved address has already existed (deleted: %s)', async deleted => {
    const present: ResourceSnapshot = { ...absent, value: deleted ? null : { ...draft, content: 'Other words' },
      metadata: { protocol: 1, generation: 'other-creation', revision: 1, deleted } };
    device = boot(present);
    await keepCreation(device);

    await device.start();

    expect(device.transport.send).not.toHaveBeenCalled();
    expect(device.stored()).toEqual(present);
    expect((await device.checkpoints.read(owner, editorId))?.checkpoint.draft?.content).toBe(draft.content);
  });
});
