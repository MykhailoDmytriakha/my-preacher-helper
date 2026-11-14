import { AsyncLocalStorage } from 'node:async_hooks';

import { createActionClock } from '@/data-engine/actionClock.client';
import { createIndexedDbCheckpoints } from '@/data-engine/checkpoint.client';
import { createIndexedDbCollectionCursors } from '@/data-engine/collectionCursors.client';
import { CollectionReader } from '@/data-engine/collections';
import { createIndexedDbCommitStore } from '@/data-engine/commits.client';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { DataEngine, type ManagedEditor, type ManagedManualForm } from '@/data-engine/engine';
import { createIndexedDbJournal } from '@/data-engine/journal.client';
import { createIndexedDbManualScopes } from '@/data-engine/manualScopes.client';
import { createIndexedDbMembershipScopes } from '@/data-engine/membershipScopes.client';
import { discoverLegacyRecovery } from '@/data-engine/legacyRecovery.client';
import { ResourceObserver } from '@/data-engine/observer';
import { diffFields } from '@/data-engine/protocol';
import { createCommitCollectionWindow } from '@/data-engine/retention.client';
import { DataEngineRuntime } from '@/data-engine/runtime';
import { listDocuments, processCommand, readActionClockChallenge, readCollectionChanges, readDocument } from '@/data-engine/server';
import { createIndexedDbSnapshots } from '@/data-engine/snapshots.client';
import { describeSync, describeManualSync } from '@/data-engine/status';
import { createHttpEngineTransport } from '@/data-engine/transport.client';
import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { watchedStore } from '@/utils/deviceStorage';

import { installWorldFirestore } from './deviceWorld/firestore';
import { clone, DeviceStorage } from './deviceWorld/storage';

import type { CommitRequest } from '@/data-engine/commits';
import type { EditorRecord } from '@/data-engine/controller';
import type { SessionCheckpoint } from '@/data-engine/session';
import type { DocumentData, EngineTransport, CollectionTransport, ResourceRef } from '@/data-engine/types';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() }, FieldValue: { increment: (amount: number) => ({ __testIncrement: amount }) } }));
jest.mock('firebase-admin/firestore', () => ({ ...jest.requireActual('firebase-admin/firestore'), Filter: {
  where: (field: string, operator: string, value: unknown) => ({ kind: 'field', field, operator, value }),
  or: (...filters: unknown[]) => ({ kind: 'or', filters }),
} }));
jest.mock('@/utils/deviceStorage', () => ({ ...jest.requireActual('@/utils/deviceStorage'), watchedStore: jest.fn() }));
jest.mock('@/services/ownerHttpTransport.client', () => ({ requestOwnerJson: jest.fn() }));
jest.mock('@/utils/queryKeys', () => ({ ...jest.requireActual('@/utils/queryKeys'), resolveOwnerUid: () => 'owner' }));

const context = new AsyncLocalStorage<WorldDevice>();
const keyOf = (ref: ResourceRef) => `${ref.collection}/${ref.id}`;
export type Question = { device: string; document: string; kind: string; fields: string[] };
export const sermonRef = { collection: 'sermons', id: 'sermon-x' };
export const noteRef = { collection: 'studyNotes', id: 'note-x' };
export const sermonValue = (): DocumentData => ({ userId: 'owner', title: 'Original', verse: 'John 1:1', date: '2026-11-12', thoughts: [] });
export const noteValue = (): DocumentData => ({ userId: 'owner', title: 'Original', content: 'First paragraph.\n\nSecond paragraph.', tags: [], scriptureRefs: [], isDraft: false, createdAt: '2026-11-12', updatedAt: '2026-11-12' });

function checkpointFields(cp: SessionCheckpoint): string[] {
  return (cp.conflicts.length ? cp.conflicts : diffFields(cp.confirmed.value ?? {}, cp.draft ?? {}))
    .map(item => item.path.join('.') || '$document');
}

export class DeviceWorld {
  get now() { return Date.now(); }
  readonly server = installWorldFirestore(() => this.now);
  readonly devices: WorldDevice[] = [];
  private sequence = 0;
  constructor() {
    jest.useFakeTimers({ now: Date.UTC(2026, 10, 12, 12) });
    Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: { bound: (lower: unknown, upper: unknown, lowerOpen = false, upperOpen = false) => ({ lower, upper, lowerOpen, upperOpen }) } });
    jest.mocked(watchedStore).mockImplementation(database => {
      const device = context.getStore();
      if (!device) throw new Error(`Unbound device storage: ${database}`);
      return device.storage.store(database);
    });
    jest.mocked(requestOwnerJson).mockImplementation(async (url, options) => {
      const device = context.getStore();
      if (!device || !device.online) throw Object.assign(new Error('Data engine unavailable'), { code: 'unavailable' });
      const address = new URL(url, 'http://in-process');
      const parts = address.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const collection = parts[3], id = parts[4];
      const headers = new Headers(options.headers);
      let value: unknown;
      if (parts[2] === 'commands') value = await processCommand('owner', options.payload);
      else if (parts[2] === 'documents') value = await readDocument('owner', { collection, id }, { actionClockChallenge: readActionClockChallenge(collection, headers, true) });
      else if (parts[2] === 'collections') value = await listDocuments('owner', collection, {
        ...(address.searchParams.has('cursor') && { cursor: address.searchParams.get('cursor')! }),
        ...(address.searchParams.has('limit') && { limit: Number(address.searchParams.get('limit')) }),
        actionClockChallenge: readActionClockChallenge(collection, headers),
      });
      else if (parts[2] === 'changes') value = await readCollectionChanges('owner', collection, Number(address.searchParams.get('after')));
      else throw new Error(`Unsupported stand route: ${url}`);
      return { status: 200, value: clone(value) } as Awaited<ReturnType<typeof requestOwnerJson>>;
    });
  }
  id(prefix: string) { return `${prefix}-${++this.sequence}`; }
  async seed(resource: ResourceRef, value: DocumentData) {
    const result = await processCommand('owner', { protocol: 1, kind: 'create', owner: 'owner', operationId: this.id('seed'), resource, generation: null, dependsOn: [], value });
    if (result.kind !== 'acknowledged') throw new Error(`Invalid seed: ${JSON.stringify(result)}`);
  }
  async device(name: string, skew = 0) {
    const device = new WorldDevice(this, name, skew); this.devices.push(device);
    await device.boot(); await this.settle(); return device;
  }
  /** Advance fake server time, per-page monotonic clocks and due timers together. */
  async advance(ms: number) {
    jest.advanceTimersByTime(ms);
    for (const device of this.devices) await device.flushDueAutosaves();
    await this.settle();
  }
  async settle(bound = 20000) {
    let previous = '', quiet = 0;
    for (let index = 0; index < bound; index++) {
      await Promise.resolve();
      if (index % 300 === 0) jest.advanceTimersByTime(0);
      const signature = JSON.stringify([this.server.activity, this.server.pending, ...this.devices.flatMap(device => [device.storage.activity, device.storage.pending, device.engine?.getPending()])]);
      if (signature === previous && !this.server.pending && this.devices.every(device => !device.storage.pending)) quiet++; else quiet = 0;
      if (quiet === 300) {
        const stuck = this.devices.flatMap(device => device.online ? device.engine.getPending().filter(entry => ['queued', 'sending'].includes(entry.state)) : []);
        if (stuck.length) throw new Error(`World stopped with runnable delivery: ${JSON.stringify(stuck)}`);
        return;
      }
      previous = signature;
    }
    throw new Error(`World did not settle in ${bound} microtask turns`);
  }
  async snapshot(resource: ResourceRef) { return readDocument('owner', resource); }
  history(resource?: ResourceRef) {
    return [...this.server.documents].filter(([path]) => (!resource || path.startsWith(keyOf(resource) + '/')) && /History\//.test(path)).map(([path, value]) => ({ path, ...clone(value) }));
  }
  async questions(): Promise<Question[]> {
    const result: Question[] = [];
    for (const device of this.devices) await device.run(async () => {
      for (const [document, editor] of device.editors) {
        const status = describeSync(editor.getState(), editor.getObservation(), editor.getDelivery());
        if (status.canAcceptRemote || status.canKeepLocal || ['conflict', 'refused'].includes(status.phase)) {
          const cp = editor.getState().checkpoint;
          result.push({ device: device.name, document, kind: status.phase, fields: checkpointFields(cp) });
        }
      }
      for (const candidate of await device.engine.listRecoverable()) {
        const cp = candidate.record.checkpoint;
        result.push({ device: device.name, document: keyOf(cp.confirmed.resource), kind: candidate.answer ? `recovery:${candidate.answer}` : candidate.record.prepared ? 'legacy-copy' : 'recovery', fields: diffFields(cp.confirmed.value ?? {}, cp.draft ?? {}).map(item => item.path.join('.') || '$document') });
      }
      for (const { resource, form } of device.forms.values()) {
        const editor = device.editors.get(keyOf(resource));
        if (!editor) continue;
        const status = describeManualSync(form.getState(), editor.getState(), describeSync(editor.getState(), editor.getObservation(), editor.getDelivery()), null, editor.getPresence());
        if (form.getState()?.choiceRequired || status?.canAcceptRemote || status?.canKeepLocal) {
          result.push({ device: device.name, document: keyOf(resource), kind: `manual:${status?.phase}`, fields: form.getState()?.record.selection.map(path => path.map(part => typeof part === 'string' ? part : part.id).join('.')) ?? [] });
        }
        for (const copy of await form.listRecoverable()) result.push({ device: device.name, document: keyOf(resource), kind: 'manual-recovery', fields: copy.record!.selection.map(path => path.map(part => typeof part === 'string' ? part : part.id).join('.')) });
      }
      const legacy = device.legacy;
      for (const copy of discoverLegacyRecovery('owner', { storage: { get length() { return legacy.size; }, key: index => [...legacy.keys()][index] ?? null, getItem: key => legacy.get(key) ?? null } })) result.push({ device: device.name, document: copy.resource ? keyOf(copy.resource) : copy.documentId, kind: 'legacy-copy', fields: [copy.aggregate] });
      for (const refusal of device.refusals) result.push(refusal);
    });
    return result;
  }
  dispose() { for (const device of this.devices) device.engine.dispose(); jest.clearAllTimers(); jest.useRealTimers(); }
}

export class WorldDevice {
  readonly storage = new DeviceStorage();
  readonly editors = new Map<string, ManagedEditor>();
  readonly forms = new Map<string, { resource: ResourceRef; form: ManagedManualForm }>();
  readonly legacy = new Map<string, string>();
  readonly refusals: Question[] = [];
  readonly errors: unknown[] = [];
  online = true;
  private loadAt: number;
  private slept = 0;
  get elapsed() { return this.world.now - this.loadAt - this.slept; }
  origin = 1;
  engine!: DataEngine;
  runtime!: DataEngineRuntime;
  transport!: EngineTransport & CollectionTransport;
  clock!: ReturnType<typeof createActionClock>;
  private autoSave = new Map<string, { at: number; editor: ManagedEditor }>();
  constructor(readonly world: DeviceWorld, readonly name: string, public skew: number) { this.loadAt = world.now; }
  run<T>(action: () => T): T { return context.run(this, action); }
  async boot() {
    await this.run(async () => {
      this.clock = createActionClock(() => ({ wallMs: this.world.now + this.skew, elapsedMs: this.elapsed, originMs: this.origin }), () => this.world.id('probe'));
      const http = createHttpEngineTransport(this.clock);
      const transport: EngineTransport & CollectionTransport = {
        read: (...args) => this.run(() => http.read(...args)), send: (...args) => this.run(() => http.send(...args)),
        list: (...args) => this.run(() => http.list(...args)), changes: (...args) => this.run(() => http.changes(...args)),
      };
      this.transport = transport;
      const journal = createIndexedDbJournal(), snapshots = createIndexedDbSnapshots(), cursors = createIndexedDbCollectionCursors();
      const window = createCommitCollectionWindow();
      const commits = createIndexedDbCommitStore(window.collect), checkpoints = createIndexedDbCheckpoints(window.collect);
      this.runtime = new DataEngineRuntime({ transport, journal });
      const observer = new ResourceObserver({ transport, source: { listen: () => () => undefined } });
      const collections = new CollectionReader({ observer, transport, snapshots, cursors, onError: error => this.errors.push(error) });
      this.engine = new DataEngine({ runtime: this.runtime, observer, transport, snapshots, collections, commits, checkpoints,
        manualScopes: createIndexedDbManualScopes(window.collect), membershipScopes: createIndexedDbMembershipScopes(), deferCommitCollection: window.begin,
        operationId: () => this.world.id(this.name), onError: error => this.errors.push(error) });
      this.engine.setOnline(this.online); this.engine.setOwner('owner');
      // Bind lazy database handles to this device before any timer can use them.
      await snapshots.list('owner', 'sermons'); await journal.list('owner'); await cursors.read('owner', 'sermons');
      await commits.list('owner'); await checkpoints.listRecoverable('owner');
    });
  }
  async open(resource: ResourceRef, create = false) {
    return this.run(async () => {
      const id = editorIdentity(this.name, resource, 'default', this.world.id('editor'));
      const editor = create ? await this.engine.createEditor(resource, id) : await this.engine.openEditor(resource, id);
      this.editors.set(keyOf(resource), editor); await this.world.settle(); return editor;
    });
  }
  shown(resource: ResourceRef) {
    const editor = this.required(resource), state = editor.getState();
    return { draft: clone(state.checkpoint.draft), confirmed: clone(state.checkpoint.confirmed), remote: clone(state.checkpoint.remoteCandidate), status: describeSync(state, editor.getObservation(), editor.getDelivery()) };
  }
  private async perform<T>(resource: ResourceRef, action: () => Promise<T>): Promise<T> {
    return this.run(async () => {
      try {
        const result = await action();
        for (let index = this.refusals.length - 1; index >= 0; index--) if (this.refusals[index].document === keyOf(resource)) this.refusals.splice(index, 1);
        return result;
      } catch (error) {
        if ((error as { code?: string }).code === 'decision-required') this.refusals.push({ device: this.name, document: keyOf(resource), kind: 'decision-required', fields: [] });
        throw error;
      }
    });
  }
  private required(resource: ResourceRef) { const editor = this.editors.get(keyOf(resource)); if (!editor) throw new Error(`Document not open: ${keyOf(resource)}`); return editor; }
  /** Mirrors useDataDocument.update; the group title option captures at typing, not delivery. */
  async update(resource: ResourceRef, updater: (value: DocumentData) => DocumentData, options: { autosave?: boolean; groupTitle?: boolean } = {}) {
    return this.perform(resource, async () => {
      const editor = this.required(resource), shown = editor.getState().checkpoint;
      const time = options.groupTitle ? this.clock.capture('owner') : undefined;
      await editor.edit(updater(clone(shown.draft!)), shown, time ? { field: 'title', time } : undefined);
      if (options.autosave !== false) this.autoSave.set(keyOf(resource), { at: this.world.now + 750, editor });
    });
  }
  /** Manual title forms call captureDocumentMetadataAction on the Save click. */
  async saveField(resource: ResourceRef, field: string, value: string) {
    return this.perform(resource, async () => {
      const form = this.required(resource).form(`baseline-${field}`, [[field]]);
      this.forms.set(keyOf(resource) + '/' + field, { resource, form });
      await form.begin(); await form.update(current => ({ ...current, [field]: value }));
      const time = this.clock.capture('owner') ?? null;
      await form.save(undefined, { documentMetadata: { time } });
      await this.world.settle();
    });
  }
  async save(resource: ResourceRef, updater?: (value: DocumentData) => DocumentData) {
    return this.perform(resource, async () => {
      this.autoSave.delete(keyOf(resource));
      const editor = this.required(resource);
      if (updater) await editor.commit(value => updater(value!)); else await editor.save();
      await this.world.settle();
    });
  }
  async addThought(resource: ResourceRef, id: string, text: string) {
    await this.update(resource, value => ({ ...value, thoughts: [...value.thoughts as DocumentData[], { id, text, tags: [], date: new Date(this.world.now).toISOString() }] }));
    await this.world.advance(750);
  }
  async remove(resource: ResourceRef) { await this.perform(resource, () => this.required(resource).remove()); await this.world.settle(); }
  async leave(resource: ResourceRef, flush = true) {
    this.autoSave.delete(keyOf(resource)); this.run(() => this.required(resource).close({ flush })); this.editors.delete(keyOf(resource)); await this.world.settle();
  }
  goOffline() { this.online = false; this.run(() => this.engine.setOnline(false)); }
  async goOnline() { this.online = true; this.run(() => this.engine.setOnline(true)); await this.world.settle(); }
  async refresh(resource: ResourceRef) { await this.run(() => this.engine.retry(resource)); await this.world.settle(); }
  async reload() {
    this.run(() => this.engine.dispose()); this.editors.clear(); this.forms.clear(); this.autoSave.clear(); this.loadAt = this.world.now; this.slept = 0; this.origin++;
    await this.boot(); await this.world.settle();
  }
  async sleep(ms: number) {
    await this.world.advance(ms);
    this.slept += ms;
  }
  async flushDueAutosaves() {
    for (const [key, save] of this.autoSave) if (save.at <= this.world.now) {
      this.autoSave.delete(key);
      if (describeSync(save.editor.getState(), save.editor.getObservation(), save.editor.getDelivery()).canSave) await this.run(() => save.editor.save());
    }
  }
  /** Seed terminal refused requests held by closed checkpoints of distinct other documents. */
  seedHistoryFrom(source: WorldDevice, count: number) {
    const stateName = 'preacher-data-engine-state-v1';
    const donor = source.storage.databases.get(stateName)!;
    const request = [...donor.values()].find(value => ['queued', 'prepared'].includes((value as CommitRequest).state)) as CommitRequest;
    const checkpoint = [...donor.values()].find(value => Boolean((value as EditorRecord).checkpoint)) as EditorRecord;
    if (!request || !checkpoint) throw new Error('History donor needs a submitted request and its checkpoint');
    const rows = this.storage.databases.get(stateName)!;
    for (let index = 0; index < count; index++) {
      const id = `old-request-${index}`, editorId = `old-editor-${index}`;
      const resource = { collection: 'sermons', id: `old-document-${index}` };
      const baseline = { ...clone(request.baseline), resource };
      const row: CommitRequest = { ...clone(request), id, editorId, baseline, working: baseline,
        state: 'refused', command: null, result: { kind: 'refused', operationId: id, code: 'invalid-argument' }, unfinalized: [] };
      const cp: EditorRecord = { ...clone(checkpoint), editorId, prepared: null, unfinalized: [],
        checkpoint: { ...clone(checkpoint.checkpoint), confirmed: baseline,
          pending: { [id]: { generation: row.editGeneration, value: row.value } }, remoteCandidate: null } };
      const key = ['request', 'owner', editorId, row.editGeneration];
      rows.set(JSON.stringify(key), row);
      rows.set(JSON.stringify(['identity', 'owner', id]), key);
      rows.set(JSON.stringify(['checkpoint', 'owner', editorId]), cp);
    }
  }
  async openList(collection: string) { return this.run(() => this.engine.readCollection(collection)); }
}
