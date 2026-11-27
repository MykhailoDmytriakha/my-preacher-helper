import { watchDraftReserves } from '@/data-engine/draftReserveLifecycle.client';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { createIndexedDbCheckpoints } from '@/data-engine/checkpoint.client';
import { createIndexedDbCommitStore } from '@/data-engine/commits.client';
import { CollectionReader, type CollectionCursor } from '@/data-engine/collections';
import { DataEngine } from '@/data-engine/engine';
import { createIndexedDbManualScopes } from '@/data-engine/manualScopes.client';
import { ResourceObserver } from '@/data-engine/observer';
import { createOutlineTitleDraftStore } from '@/data-engine/outlineTitleDrafts.client';
import { localPlanCellEmergencyStorage } from '@/data-engine/planCellEmergency.client';
import { applyCommand } from '@/data-engine/protocol';
import { DataEngineRuntime } from '@/data-engine/runtime';
import { localServiceOrderReserveStorage } from '@/data-engine/serviceOrderInputReserve.client';
import { installStorageHarness } from '@/data-engine/__tests__/storageHarness';

import type { BrowserDataEngine } from '@/data-engine/browser.client';
import type { OrdinaryEditorLeases } from '@/data-engine/ordinaryEditorLeases.client';
import type { RecoveryPresencePort } from '@/data-engine/recoveryPresence';
import type { CommandResult, DataCommand, DocumentData, EngineTransport, JournalEntry, ResourceSnapshot } from '@/data-engine/types';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const settleEngine = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };

/**
 * Actual editor/runtime/IndexedDB contracts, with only the server and browser transport replaced.
 * `cached: false` starts with no copy of the document on this device, as a link opened for the first time.
 */
export function documentEngineHarness(initial: ResourceSnapshot, { cached: onDevice = true, apply = applyCommand, editorLeases }: {
  cached?: boolean;
  editorLeases?: Pick<OrdinaryEditorLeases, 'acquire'>;
  apply?: (command: DataCommand, current: ResourceSnapshot) => CommandResult | Promise<CommandResult>;
} = {}) {
  const storage = installStorageHarness();
  let server = copy(initial), sequence = 0;
  let cached: ResourceSnapshot | null = onDevice ? copy(initial) : null;
  const journal = new Map<string, JournalEntry>(), receipts = new Map<string, CommandResult>();
  const transport: EngineTransport = {
    read: jest.fn(async () => copy(server)),
    send: jest.fn(async command => {
      const prior = receipts.get(command.operationId);
      if (prior) return copy(prior);
      const result = await apply(command, server);
      receipts.set(command.operationId, copy(result));
      if (result.kind === 'acknowledged') server = copy(result.snapshot);
      return result;
    }),
  };
  const commits = createIndexedDbCommitStore(undefined, editorLeases), checkpoints = createIndexedDbCheckpoints();
  const outlineTitleDrafts = createOutlineTitleDraftStore();
  let engine!: DataEngine;
  let activeRuntime!: DataEngineRuntime;
  let activeObserver!: ResourceObserver;
  const createBrowser = (options?: { withCollections?: boolean; onError?: (error: unknown) => void; beforeSnapshotRead?: () => Promise<void>; beforeSnapshotWrite?: (snapshot: ResourceSnapshot) => Promise<void>; recoveryPresence?: RecoveryPresencePort }): BrowserDataEngine => {
    const runtime = new DataEngineRuntime({ transport, journal: {
      list: async owner => [...journal.values()].filter(item => item.command.owner === owner).map(copy),
      put: async entry => { journal.set(entry.command.operationId, copy(entry)); },
      remove: async (_owner, id) => { journal.delete(id); },
    } });
    activeRuntime = runtime;
    const observer = new ResourceObserver({ transport, source: { listen: () => () => undefined } });
    activeObserver = observer;
    const snapshots = {
      read: async () => { if (options?.beforeSnapshotRead) await options.beforeSnapshotRead(); return cached ? copy(cached) : undefined; }, put: async (_owner: string, value: ResourceSnapshot) => { await options?.beforeSnapshotWrite?.(value); cached = copy(value); },
      list: async (owner: string, collection: string) => cached && cached.resource.collection === collection && cached.value?.userId === owner ? [copy(cached)] : [],
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
      manualScopes: createIndexedDbManualScopes(), snapshots, collections, onError: options?.onError,
      recoveryPresence: options?.recoveryPresence, operationId: () => `operation-${++sequence}`,
      planCellEmergencyStorage: localPlanCellEmergencyStorage, serviceOrderReserveStorage: localServiceOrderReserveStorage });
    const stopEmergency = watchDraftReserves(instance);
    engine = instance;
    return { engine: instance, outlineTitleDrafts, dispose: () => { stopEmergency(); instance.dispose(); },
      editorId: (resource, slot = 'default') => editorIdentity('test-tab', resource, slot, String(++sequence)) };
  };
  return { createBrowser, transport, commits, checkpoints, storage, get runtime() { return activeRuntime; }, get engine() { return engine; }, get server() { return copy(server); },
    /** Another device's deletion the engine has not heard about yet. */
    silentRemoteDelete: () => {
      server = { ...server, metadata: { ...server.metadata!, revision: server.metadata!.revision + 1, deleted: true }, value: null };
    },
    /** Another device's save the engine has not heard about yet: the next command meets it as a conflict. */
    silentRemote: (patch: DocumentData) => {
      server = { ...server, metadata: { ...server.metadata!, revision: server.metadata!.revision + 1 }, value: { ...server.value, ...patch } };
    },
    /** Refresh subscriptions while a command is held, without awaiting the delivery queue. */
    refreshObservedResource: async () => { await activeObserver.refresh(initial.resource); await settleEngine(); },
    remote: async (patch: DocumentData) => {
      server = { ...server, metadata: { ...server.metadata!, revision: server.metadata!.revision + 1 }, value: { ...server.value, ...patch } };
      await engine.retry(initial.resource); await settleEngine();
    } };
}
