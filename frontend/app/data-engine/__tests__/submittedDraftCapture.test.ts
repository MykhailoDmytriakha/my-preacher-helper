import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { editorIdentity } from '../editorIdentity';
import { DataEngine } from '../engine';
import { createIndexedDbManualScopes } from '../manualScopes.client';
import { ResourceObserver } from '../observer';
import { applyCommand } from '../protocol';
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

function fixture() {
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
    const engine = new DataEngine({ runtime, observer, transport, commits: createIndexedDbCommitStore(),
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
