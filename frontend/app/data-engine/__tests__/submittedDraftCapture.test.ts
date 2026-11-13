import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { EditorController } from '../controller';
import { editorIdentity } from '../editorIdentity';
import { DataEngine } from '../engine';
import { createIndexedDbManualScopes } from '../manualScopes.client';
import { ResourceObserver } from '../observer';
import { applyCommand } from '../protocol';
import { collectCommitRows } from '../retention.client';
import { DataEngineRuntime } from '../runtime';
import { installStorageHarness } from './storageHarness';

import type { EditorRecord } from '../controller';
import type { EngineTransport, JournalEntry, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const resource = { collection: 'studyNotes', id: 'submitted-draft' };
const initial: ResourceSnapshot = {
  resource, value: { userId: 'owner', title: 'Draft capture', content: 'base', tags: [], scriptureRefs: [], isDraft: false,
    createdAt: '2026-10-18', updatedAt: '2026-10-18' },
  metadata: { protocol: 1, generation: 'original-generation', revision: 1, deleted: false },
};
const settle = async () => { for (let i = 0; i < 600; i += 1) await Promise.resolve(); };

function fixture(collect?: typeof collectCommitRows) {
  const storage = installStorageHarness();
  const cache = new Map([[JSON.stringify(resource), copy(initial)]]);
  const journal = new Map<string, JournalEntry>();
  let server = copy(initial), sequence = 0;
  const transport: EngineTransport = {
    read: jest.fn(async () => copy(server)),
    send: jest.fn(async command => {
      const result = applyCommand(command, server);
      if (result.kind === 'acknowledged') server = copy(result.snapshot);
      return result;
    }),
  };
  const makeEngine = () => {
    const runtime = new DataEngineRuntime({ transport, journal: {
      list: async owner => copy([...journal.values()].filter(row => row.command.owner === owner)),
      put: async row => { journal.set(row.command.operationId, copy(row)); },
      remove: async (_owner, id) => { journal.delete(id); },
    } });
    const observer = new ResourceObserver({ transport, source: { listen: () => () => undefined } });
    const engine = new DataEngine({ runtime, observer, transport, commits: createIndexedDbCommitStore(collect),
      checkpoints: createIndexedDbCheckpoints(), manualScopes: createIndexedDbManualScopes(), snapshots: {
        read: async (_owner, ref) => { const row = cache.get(JSON.stringify(ref)); return row && copy(row); },
        put: async (_owner, row) => { cache.set(JSON.stringify(row.resource), copy(row)); },
      }, operationId: () => `operation-${++sequence}`, onError: jest.fn() });
    engine.setOnline(false); engine.setOwner('owner');
    return engine;
  };
  const open = (engine: DataEngine) => engine.openEditor(resource, editorIdentity('test-tab', resource, 'document', `opening-${++sequence}`));
  return { storage, makeEngine, open, transport, server: () => server };
}

describe('submitted draft ownership across a restart', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it.each(['one change', 'four rapid changes', 'explicit deletion'] as const)
    ('continues %s after the native transaction commits before its page callback runs', async kind => {
      const s = fixture(), before = s.makeEngine();
      const editor = await s.open(before);
      const wanted = kind === 'four rapid changes' ? 'base|1|2|3|4' : 'kept change';
      let paused = false, capturedAtNativeCommit = false, after: DataEngine | undefined;
      s.storage.holdCompletionAfterCommit = (rows, mode) => {
        if (mode !== 'readwrite' || paused) return false;
        const target = [...rows.values()].some(value => {
          const record = value as EditorRecord;
          return record.checkpoint?.confirmed.resource.id === resource.id
            && (kind === 'explicit deletion' ? record.checkpoint.draft === null && record.checkpoint.dirty
              : record.checkpoint.draft?.content === wanted);
        });
        if (target) {
          paused = true;
          capturedAtNativeCommit = [...rows.values()].some(value => {
            const request = value as import('../commits').CommitRequest;
            if (request.owner !== 'owner' || request.baseline?.resource.id !== resource.id
              || (kind === 'explicit deletion' ? request.value !== null : request.value?.content !== wanted)) return false;
            const identity = rows.get(JSON.stringify(['identity', 'owner', request.id]));
            return Array.isArray(identity) && rows.get(JSON.stringify(identity)) === value;
          });
        }
        return target;
      };
      try {
        // No page callback, lifecycle flush or recovery click can rescue the submitted generation.
        if (kind === 'explicit deletion') void editor.remove().catch(() => undefined);
        else if (kind === 'four rapid changes') {
          for (const number of [1, 2, 3, 4]) void editor.commit(current => ({ ...current, content: `${current?.content}|${number}` })).catch(() => undefined);
        } else void editor.commit(current => ({ ...current, content: wanted })).catch(() => undefined);
        await settle();
        expect(paused).toBe(true);
        before.dispose();
        after = s.makeEngine();
        const reopened = await s.open(after);
        if (kind === 'explicit deletion') expect(reopened.getState().checkpoint.draft).toBeNull();
        else expect(reopened.getState().checkpoint.draft?.content).toBe(wanted);
        expect(capturedAtNativeCommit).toBe(true);
        after.setOnline(true); await after.retry(); await settle();
        if (kind === 'explicit deletion') expect(s.server().value).toBeNull();
        else expect(s.server().value?.content).toBe(wanted);
      } finally {
        before.dispose(); after?.dispose(); s.storage.finishCompletion?.(); await settle();
      }
    });

  it.each(['ordinary draft', 'four rapid saves'] as const)
    ('captures %s directly when leaving an autosaving screen at once', async kind => {
      const s = fixture(), before = s.makeEngine(), wanted = kind === 'ordinary draft' ? 'leaving words' : 'base|1|2|3|4';
      const editor = await s.open(before);
      let paused = false, after: DataEngine | undefined;
      s.storage.holdCompletionAfterCommit = rows => {
        if (paused) return false;
        paused = [...rows.values()].some(value => {
          const request = value as import('../commits').CommitRequest;
          return request.owner === 'owner' && request.baseline?.resource.id === resource.id && request.value?.content === wanted;
        });
        return paused;
      };
      try {
        if (kind === 'ordinary draft') void editor.edit({ ...initial.value, content: wanted }).catch(() => undefined);
        else for (const number of [1, 2, 3, 4]) {
          void editor.commit(current => ({ ...current, content: `${current?.content}|${number}` })).catch(() => undefined);
        }
        editor.close({ flush: true }); await settle();
        expect(paused).toBe(true);
        before.dispose(); after = s.makeEngine();
        expect((await s.open(after)).getState().checkpoint.draft?.content).toBe(wanted);
        after.setOnline(true); await after.retry(); await settle();
        expect(s.server().value?.content).toBe(wanted);
      } finally { before.dispose(); after?.dispose(); s.storage.finishCompletion(); await settle(); }
    });

  it('does not submit later unsent typing after two rapid saved generations', async () => {
    const s = fixture(), before = s.makeEngine();
    const editor = await s.open(before);
    const first = editor.commit(current => ({ ...current, content: 'saved one' }));
    const second = editor.commit(current => ({ ...current, content: 'saved two' }));
    const typing = editor.edit({ ...initial.value, content: 'later unsent words' });
    await Promise.all([first, second, typing]);
    before.dispose();
    const after = s.makeEngine();
    try {
      const reopened = await s.open(after);
      expect(reopened.getState().checkpoint.draft?.content).toBe('saved two');
      expect((await after.listRecoverable(resource)).some(row => row.record.checkpoint.draft?.content === 'later unsent words')).toBe(true);
      after.setOnline(true); await after.retry(); await settle();
      expect(s.server().value?.content).toBe('saved two');
    } finally { after.dispose(); }
  });

  it('allows ordinary draft persistence and a new save after failed request capture', async () => {
    const s = fixture(), before = s.makeEngine();
    const editor = await s.open(before);
    s.storage.writeFailure = true;
    await expect(editor.commit(current => ({ ...current, content: 'failed capture' }))).rejects.toThrow('disk full');
    s.storage.writeFailure = false;
    await editor.edit({ ...initial.value, content: 'recoverable after failure' });
    expect((await createIndexedDbCheckpoints().listRecoverable('owner', resource)).some(row => row.record.checkpoint.draft?.content === 'recoverable after failure')).toBe(true);
    await editor.save();
    before.dispose();
    const after = s.makeEngine();
    try {
      expect((await s.open(after)).getState().checkpoint.draft?.content).toBe('recoverable after failure');
      after.setOnline(true); await after.retry(); await settle();
      expect(s.server().value?.content).toBe('recoverable after failure');
    } finally { after.dispose(); }
  });

  it('clears an older unsent checkpoint when the saved value returns to the confirmed copy', async () => {
    const s = fixture(), engine = s.makeEngine();
    try {
      const editor = await s.open(engine);
      await editor.edit({ ...initial.value, content: 'abandoned draft' });
      await editor.commit(() => initial.value);
      expect(editor.getState().durable).toBe(true);
      expect(await createIndexedDbCheckpoints().listRecoverable('owner', resource)).toEqual([]);
      expect(s.transport.send).not.toHaveBeenCalled();
    } finally { engine.dispose(); }
  });

  it('keeps ordinary unsent typing recoverable without sending it on a fresh opening', async () => {
    const s = fixture(), before = s.makeEngine();
    const editor = await s.open(before);
    await editor.edit({ ...initial.value, content: 'unsent words' });
    before.dispose();
    const after = s.makeEngine();
    try {
      const reopened = await s.open(after);
      expect(reopened.getState().checkpoint.draft?.content).toBe('base');
      expect((await after.listRecoverable(resource)).some(row => row.record.checkpoint.draft?.content === 'unsent words')).toBe(true);
      after.setOnline(true); await after.retry(); await settle();
      expect(s.server().value?.content).toBe('base');
      expect(s.transport.send).not.toHaveBeenCalled();
    } finally { after.dispose(); }
  });

  it('keeps an unfinished selected-field form stage-only across restart', async () => {
    const s = fixture(), before = s.makeEngine();
    const editor = await s.open(before), form = editor.form('manual-content', [['content']]);
    await form.begin(); await form.update(current => ({ ...current, content: 'unfinished form' }));
    before.dispose();
    const after = s.makeEngine();
    try {
      const reopened = await s.open(after), nextForm = reopened.form('manual-content', [['content']]);
      expect(reopened.getState().checkpoint.draft?.content).toBe('base');
      expect((await nextForm.listRecoverable()).some(row => row.record.stage[0]?.value === 'unfinished form')).toBe(true);
      after.setOnline(true); await after.retry(); await settle();
      expect(s.server().value?.content).toBe('base');
      expect(s.transport.send).not.toHaveBeenCalled();
    } finally { after.dispose(); }
  });
});

it('pins a closing Save in its native checkpoint until its exact ACK settles the closed copy', async () => {
  const s = fixture(), before = s.makeEngine();
  let after: DataEngine | undefined;
  try {
    const editor = await s.open(before);
    await editor.edit({ ...initial.value, content: 'last words on leaving' });
    editor.close({ flush: true }); await settle();
    const checkpoints = [...s.storage.rows.values()].filter((value): value is EditorRecord => Boolean((value as EditorRecord).checkpoint));
    expect(checkpoints).toHaveLength(1);
    expect(Object.keys(checkpoints[0].checkpoint.pending)).toHaveLength(1);
    before.dispose(); after = s.makeEngine();
    after.setOnline(true); await after.retry(); await settle();
    expect(s.server().value?.content).toBe('last words on leaving');
    expect(await after.listRecoverable(resource)).toEqual([]);
    expect(s.transport.send).toHaveBeenCalledTimes(1);
  } finally { before.dispose(); after?.dispose(); }
});

it('keeps later private words recoverable when leaving without flush while an earlier Save is delivered', async () => {
  const s = fixture(), before = s.makeEngine();
  let after: DataEngine | undefined;
  try {
    const editor = await s.open(before);
    await editor.commit(current => ({ ...current, content: 'submitted words' }));
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'later private words' });
    editor.close({ flush: false }); await settle();
    before.dispose(); after = s.makeEngine();
    after.setOnline(true); await after.retry(); await settle();
    expect(s.server().value?.content).toBe('submitted words');
    const copies = await after.listRecoverable(resource);
    expect(copies).toHaveLength(1);
    expect(copies[0].record.checkpoint.draft?.content).toBe('later private words');
    expect(copies[0].record.checkpoint.pending).toEqual({});
    expect(s.transport.send).toHaveBeenCalledTimes(1);
  } finally { before.dispose(); after?.dispose(); }
});

it('captures a leaving Save with its checkpoint and no retention sweep, while an ordinary Save still sweeps', async () => {
  let sweeps = 0, fullReads = 0;
  const s = fixture((store, read, owner, done) => { sweeps += 1; collectCommitRows(store, read, owner, done); });
  // One retention sweep reads nine row kinds in full (six request kinds, checkpoints, manual and reference rows).
  s.storage.onFullRead = (_kind, mode) => { if (mode === 'readwrite') fullReads += 1; };
  const engine = s.makeEngine();
  try {
    const editor = await s.open(engine);
    await editor.edit({ ...initial.value, content: 'ordinary words' }); await settle();
    sweeps = 0; fullReads = 0;
    await editor.save(); await settle();
    const ordinary = { sweeps, fullReads };
    await editor.edit({ ...editor.getState().checkpoint.draft, content: 'last words on leaving' }); await settle();
    sweeps = 0; fullReads = 0;
    editor.close({ flush: true }); await settle();
    // The ordinary Save is measured as it was before the leaving capture stopped sweeping: unchanged.
    expect({ ordinary, leaving: { sweeps, fullReads } }).toEqual({ ordinary: { sweeps: 2, fullReads: 45 }, leaving: { sweeps: 0, fullReads: 0 } });
    // The request and the checkpoint that pins it were written together.
    const closed = [...s.storage.rows.values()].filter((value): value is EditorRecord => Boolean((value as EditorRecord).checkpoint));
    expect(closed).toHaveLength(1);
    expect(closed[0].checkpoint.draft?.content).toBe('last words on leaving');
    expect(Object.keys(closed[0].checkpoint.pending)).toHaveLength(2);
  } finally { engine.dispose(); }
});

it('still captures the leaving Save when the closing record cannot be taken from the editor', async () => {
  const s = fixture(), before = s.makeEngine();
  let after: DataEngine | undefined;
  const capture = jest.spyOn(EditorController.prototype, 'captureRecoveryChoice').mockImplementation(() => {
    throw new Error('The editor was retired a moment ago');
  });
  try {
    const editor = await s.open(before);
    await editor.edit({ ...initial.value, content: 'words kept without a closing record' });
    expect(() => editor.close({ flush: true })).not.toThrow();
    await settle();
    capture.mockRestore();
    before.dispose(); after = s.makeEngine();
    after.setOnline(true); await after.retry(); await settle();
    expect(s.server().value?.content).toBe('words kept without a closing record');
  } finally { capture.mockRestore(); before.dispose(); after?.dispose(); }
});
