import { createIndexedDbCheckpoints } from '@/data-engine/checkpoint.client';
import { createIndexedDbCommitStore } from '@/data-engine/commits.client';
import { CollectionReader, type CollectionCursor } from '@/data-engine/collections';
import { DataEngine } from '@/data-engine/engine';
import { createIndexedDbManualScopes } from '@/data-engine/manualScopes.client';
import { ResourceObserver } from '@/data-engine/observer';
import { applyCommand } from '@/data-engine/protocol';
import { DataEngineRuntime } from '@/data-engine/runtime';
import { installStorageHarness } from '@/data-engine/__tests__/storageHarness';

import type { BrowserDataEngine } from '@/data-engine/browser.client';
import type { CommandResult, DocumentData, EngineTransport, JournalEntry, ResourceSnapshot } from '@/data-engine/types';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const settleEngine = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };

/** Actual editor/runtime/IndexedDB contracts, with only the server and browser transport replaced. */
export function documentEngineHarness(initial: ResourceSnapshot) {
  installStorageHarness();
  let server = copy(initial), cached = copy(initial), sequence = 0;
  const journal = new Map<string, JournalEntry>(), receipts = new Map<string, CommandResult>();
  const transport: EngineTransport = {
    read: jest.fn(async () => copy(server)),
    send: jest.fn(async command => {
      const prior = receipts.get(command.operationId);
      if (prior) return copy(prior);
      const result = applyCommand(command, server);
      receipts.set(command.operationId, copy(result));
      if (result.kind === 'acknowledged') server = copy(result.snapshot);
      return result;
    }),
  };
  const commits = createIndexedDbCommitStore(), checkpoints = createIndexedDbCheckpoints();
  let engine!: DataEngine;
  const createBrowser = (options?: { withCollections?: boolean; onError?: (error: unknown) => void }): BrowserDataEngine => {
    const runtime = new DataEngineRuntime({ transport, journal: {
      list: async owner => [...journal.values()].filter(item => item.command.owner === owner).map(copy),
      put: async entry => { journal.set(entry.command.operationId, copy(entry)); },
      remove: async (_owner, id) => { journal.delete(id); },
    } });
    const observer = new ResourceObserver({ transport, source: { listen: () => () => undefined } });
    const snapshots = {
      read: async () => copy(cached), put: async (_owner: string, value: ResourceSnapshot) => { cached = copy(value); },
      list: async (owner: string, collection: string) => cached.resource.collection === collection && cached.value?.userId === owner ? [copy(cached)] : [],
    };
    let cursor: CollectionCursor | undefined;
    const collections = options?.withCollections ? new CollectionReader({ observer, snapshots, cursors: {
      read: async () => cursor,
      put: async (_owner, _collection, _expected, next) => (cursor = { ...next, revision: (cursor?.revision ?? 0) + 1 }),
    }, transport: {
      list: async () => ({ snapshots: [copy(server)], nextCursor: null, version: 0 }),
      changes: async () => ({ snapshots: [copy(server)], cursor: 0, version: 0, hasMore: false }),
    } }) : undefined;
    const instance = new DataEngine({ runtime, observer, transport, commits, checkpoints,
      manualScopes: createIndexedDbManualScopes(), snapshots, collections, operationId: () => `operation-${++sequence}` });
    engine = instance;
    return { engine: instance, dispose: () => instance.dispose(), editorId: () => `editor-${++sequence}` };
  };
  return { createBrowser, transport, commits, checkpoints, get engine() { return engine; }, get server() { return copy(server); },
    /** Another device's deletion the engine has not heard about yet. */
    silentRemoteDelete: () => {
      server = { ...server, metadata: { ...server.metadata!, revision: server.metadata!.revision + 1, deleted: true }, value: null };
    },
    /** Another device's save the engine has not heard about yet: the next command meets it as a conflict. */
    silentRemote: (patch: DocumentData) => {
      server = { ...server, metadata: { ...server.metadata!, revision: server.metadata!.revision + 1 }, value: { ...server.value, ...patch } };
    },
    remote: async (patch: DocumentData) => {
      server = { ...server, metadata: { ...server.metadata!, revision: server.metadata!.revision + 1 }, value: { ...server.value, ...patch } };
      await engine.retry(initial.resource); await settleEngine();
    } };
}
