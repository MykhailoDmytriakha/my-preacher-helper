import { createIndexedDbCheckpoints } from '@/data-engine/checkpoint.client';
import { createIndexedDbCommitStore } from '@/data-engine/commits.client';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { DataEngine } from '@/data-engine/engine';
import { ResourceObserver } from '@/data-engine/observer';
import { DataEngineRuntime } from '@/data-engine/runtime';
import { planDataCommand } from '@/data-engine/serverRelations';
import { installStorageHarness } from '@/data-engine/__tests__/storageHarness';
import { settleEngine } from './documentEngineHarness';

import type { BrowserDataEngine } from '@/data-engine/browser.client';
import type { EngineTransport, JournalEntry, ResourceSnapshot } from '@/data-engine/types';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (snapshot: ResourceSnapshot) => JSON.stringify(snapshot.resource);

/** Actual durable request, relation policy and ACK/rebase projection; only server IO is controlled. */
export async function relationRebaseHarness(collection: 'series' | 'studyMaterials' = 'series') {
  installStorageHarness();
  const primary: ResourceSnapshot = { resource: { collection, id: 'primary' },
    value: { userId: 'owner', title: 'Old title', createdAt: '2026-10-16', updatedAt: '2026-10-16',
      ...(collection === 'series' ? { theme: 'Series', bookOrTopic: 'James', status: 'active', items: [], sermonIds: [], seriesKind: 'sermon' }
        : { type: 'study', noteIds: [] }) },
    metadata: { protocol: 1, generation: 'primary-generation', revision: 1, deleted: false } };
  const member: ResourceSnapshot = { resource: { collection: collection === 'series' ? 'sermons' : 'studyNotes', id: 'member' },
    value: { userId: 'owner', title: 'Linked member', createdAt: '2026-10-16', updatedAt: '2026-10-16',
      ...(collection === 'series' ? { verse: 'James 1:5', date: '2026-10-16', thoughts: [], outline: { introduction: [], main: [], conclusion: [] } }
        : { content: 'Note', tags: [], scriptureRefs: [], isDraft: true, materialIds: [] }) },
    metadata: { protocol: 1, generation: 'member-generation', revision: 1, deleted: false } };
  const server = new Map([primary, member].map(snapshot => [key(snapshot), copy(snapshot)]));
  const cached = new Map([primary, member].map(snapshot => [key(snapshot), copy(snapshot)]));
  const journal = new Map<string, JournalEntry>();
  let sequence = 0, changedRemotely = false;
  const transport: EngineTransport = {
    read: jest.fn(async (_owner, resource) => copy(server.get(JSON.stringify(resource)) ?? { resource, value: null, metadata: null })),
    send: jest.fn(async command => {
      if (!changedRemotely) {
        changedRemotely = true;
        server.set(key(primary), { ...copy(primary), value: { ...primary.value, title: 'Remote title' }, metadata: { ...primary.metadata!, revision: 2 } });
      }
      const plan = await planDataCommand(command, server.get(JSON.stringify(command.resource))!, {
        get: async resource => copy(server.get(JSON.stringify(resource))!), list: async () => [],
      });
      for (const snapshot of plan.writes) server.set(key(snapshot), copy(snapshot));
      return plan.result;
    }),
  };
  const runtime = new DataEngineRuntime({ transport, journal: {
    list: async owner => copy([...journal.values()].filter(entry => entry.command.owner === owner)),
    put: async entry => { journal.set(entry.command.operationId, copy(entry)); },
    remove: async (_owner, id) => { journal.delete(id); },
  } });
  const observer = new ResourceObserver({ transport, source: { listen: () => () => undefined } });
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  const engine = new DataEngine({ runtime, observer, transport, commits, checkpoints, snapshots: {
    read: async (_owner, resource) => { const snapshot = cached.get(JSON.stringify(resource)); return snapshot && copy(snapshot); },
    put: async (_owner, snapshot) => { cached.set(key(snapshot), copy(snapshot)); },
  }, operationId: () => `operation-${++sequence}` });
  const browser: BrowserDataEngine = { engine, dispose: () => engine.dispose(),
    editorId: (resource, slot = 'default') => editorIdentity('test-tab', resource, slot, String(++sequence)) };
  engine.setOnline(false); engine.setOwner('owner');
  const editor = await engine.openEditor(primary.resource, browser.editorId(primary.resource));
  await editor.commit(current => ({ ...current, title: 'My title', ...(collection === 'series'
    ? { items: [{ id: 'member-item', type: 'sermon', refId: member.resource.id, position: 1 }] } : { noteIds: [member.resource.id] }) }));
  engine.setOnline(true); await engine.retry(); await settleEngine(); await settleEngine();
  return { browser, engine, editor, primary, member, commits, checkpoints, journal, server, transport };
}
