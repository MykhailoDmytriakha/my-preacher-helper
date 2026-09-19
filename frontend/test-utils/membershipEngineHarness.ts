import { createIndexedDbCheckpoints } from '@/data-engine/checkpoint.client';
import { createIndexedDbCommitStore } from '@/data-engine/commits.client';
import { CollectionReader, type CollectionCursor } from '@/data-engine/collections';
import { DataEngine } from '@/data-engine/engine';
import { createIndexedDbManualScopes } from '@/data-engine/manualScopes.client';
import { createIndexedDbMembershipScopes } from '@/data-engine/membershipScopes.client';
import { ResourceObserver } from '@/data-engine/observer';
import { DataEngineRuntime } from '@/data-engine/runtime';
import { planDataCommand } from '@/data-engine/serverRelations';
import { installStorageHarness } from '@/data-engine/__tests__/storageHarness';

import type { BrowserDataEngine } from '@/data-engine/browser.client';
import type { CommandResult, EngineTransport, JournalEntry, ResourceRef, ResourceSnapshot } from '@/data-engine/types';

const copy = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const key = (resource: ResourceRef) => JSON.stringify([resource.collection, resource.id]);

/** Real collection, stage, queue and transaction planner; only I/O is replaced. */
export function membershipEngineHarness(initial: ResourceSnapshot[]) {
  const disk = installStorageHarness();
  const server = new Map(initial.map(snapshot => [key(snapshot.resource), copy(snapshot)]));
  const owners = new Map(initial.map(snapshot => [key(snapshot.resource), snapshot.value?.userId]));
  const cached = new Map(initial.map(snapshot => [key(snapshot.resource), copy(snapshot)]));
  const journal = new Map<string, JournalEntry>(), receipts = new Map<string, CommandResult>();
  const cursors = new Map<string, CollectionCursor>();
  let sequence = 0, version = 1, engine!: DataEngine;
  const read = (resource: ResourceRef) => copy(server.get(key(resource)) ?? { resource, value: null, metadata: null });
  const transport: EngineTransport = {
    read: jest.fn(async (_owner, resource) => read(resource)),
    send: jest.fn(async command => {
      if (receipts.has(command.operationId)) return copy(receipts.get(command.operationId)!);
      const plan = await planDataCommand(command, read(command.resource), {
        get: async resource => read(resource),
        list: async collection => copy([...server.values()].filter(snapshot => snapshot.resource.collection === collection)),
      });
      for (const snapshot of plan.writes) { server.set(key(snapshot.resource), copy(snapshot)); owners.set(key(snapshot.resource), command.owner); }
      if (plan.writes.length) version += 1;
      const result = plan.result.kind === 'acknowledged' ? { ...plan.result,
        relatedSnapshots: plan.writes.filter(snapshot => key(snapshot.resource) !== key(command.resource)) } : plan.result;
      receipts.set(command.operationId, copy(result)); return result;
    }),
  };
  const commits = createIndexedDbCommitStore(), scopes = createIndexedDbMembershipScopes();
  const collectionTransport = {
    list: jest.fn(async (owner: string, collection: string) => ({ snapshots: copy([...server.values()].filter(snapshot => snapshot.resource.collection === collection && owners.get(key(snapshot.resource)) === owner)), nextCursor: null, version, legacyOpen: true })),
    changes: jest.fn(async () => ({ snapshots: [], cursor: version, version, hasMore: false, legacyOpen: true })),
  };
  const createBrowser = (): BrowserDataEngine => {
    const runtime = new DataEngineRuntime({ transport, journal: {
      list: async owner => copy([...journal.values()].filter(entry => entry.command.owner === owner)),
      put: async entry => { journal.set(entry.command.operationId, copy(entry)); },
      remove: async (_owner, id) => { journal.delete(id); },
    } });
    const snapshots = {
      read: async (_owner: string, resource: ResourceRef) => copy(cached.get(key(resource))),
      put: async (_owner: string, snapshot: ResourceSnapshot) => { cached.set(key(snapshot.resource), copy(snapshot)); },
      list: async (owner: string, collection: string) => copy([...cached.values()].filter(snapshot => snapshot.resource.collection === collection && owners.get(key(snapshot.resource)) === owner)),
    };
    const observer = new ResourceObserver({ transport, source: { listen: () => () => undefined } });
    const collections = new CollectionReader({ observer, snapshots, cursors: {
      read: async (owner, collection) => copy(cursors.get(`${owner}:${collection}`)),
      put: async (owner, collection, expected, next) => {
        const value = { ...next, revision: (expected?.revision ?? 0) + 1 }; cursors.set(`${owner}:${collection}`, value); return copy(value);
      },
    }, transport: collectionTransport });
    engine = new DataEngine({ transport, runtime, snapshots, observer, collections, commits, checkpoints: createIndexedDbCheckpoints(),
      membershipScopes: scopes, manualScopes: createIndexedDbManualScopes(), operationId: () => `operation-${++sequence}` });
    const instance = engine;
    return { engine: instance, dispose: () => instance.dispose(), editorId: () => `editor-${++sequence}` };
  };
  return { createBrowser, transport, collectionTransport, commits, scopes, disk, read, get engine() { return engine; },
    replace: (snapshot: ResourceSnapshot) => { server.set(key(snapshot.resource), copy(snapshot)); if (snapshot.value) owners.set(key(snapshot.resource), snapshot.value.userId); version += 1; } };
}
