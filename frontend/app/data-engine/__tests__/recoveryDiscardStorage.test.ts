import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { createIndexedDbManualScopes } from '../manualScopes.client';
import { createIndexedDbMembershipScopes } from '../membershipScopes.client';
import { DataSession } from '../session';
import { DataEngine } from '../engine';
import { ResourceObserver } from '../observer';
import { DataEngineRuntime } from '../runtime';
import { installStorageHarness } from './storageHarness';

import type { CommitRequest } from '../commits';
import type { EditorRecord } from '../controller';
import type { StoredManualScope } from '../manualScopes.client';
import type { MembershipScopeRecord } from '../membershipScope';
import type { ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const owner = 'owner', resource = { collection: 'sermons', id: 'sermon' };
const baseline: ResourceSnapshot = { resource, value: { userId: owner, title: 'Confirmed words' },
  metadata: { protocol: 1, generation: 'generation', revision: 1, deleted: false } };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const current = () => true;
const checkpoint = (editorId = 'source'): EditorRecord => {
  const session = new DataSession(baseline);
  session.edit({ ...baseline.value!, title: `Draft ${editorId}` });
  return { owner, editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
};
const manual = (scopeId = 'form'): StoredManualScope => ({ owner, scopeId, parentEditorId: 'parent', slot: 'title', commitReferences: [], record: {
  kind: 'manual', version: 1, owner, scopeId, resource, selection: [['title']], baseline, predecessor: null,
  stage: [{ exists: true, value: 'Selected words' }], savedSelection: [{ exists: true, value: 'Confirmed words' }],
  generation: 1, savedGeneration: null, active: true,
} });
const request = (editorId = 'source'): CommitRequest => ({ id: 'request', owner, editorId, editGeneration: 1, baseline,
  value: { ...baseline.value!, title: 'Saved words' }, predecessor: null, revision: 0, initialized: false, working: baseline,
  intended: { ...baseline.value!, title: 'Saved words' }, command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] });
const membership = (scopeId = 'membership'): MembershipScopeRecord => ({ kind: 'membership', version: 1, owner, scopeId,
  revision: 0, generation: 1, phase: 'editing', requestIds: [], pins: [], action: null });
let disk: ReturnType<typeof installStorageHarness>;
beforeEach(() => { jest.clearAllMocks(); disk = installStorageHarness(); });

it('removes only the exact selected checkpoint while preserving another copy and its source ancestry', async () => {
  const store = createIndexedDbCheckpoints();
  await store.put(checkpoint('second'));
  const second = (await store.read(owner, 'second'))!, first = checkpoint('first');
  first.recoveryOrigins = [{ id: JSON.stringify([owner, 'second']), version: second.recoveryVersion! }];
  await store.put(first);
  const chosen = (await store.read(owner, 'first'))!;
  await store.discardRecovery!(chosen, current);
  expect(await store.read(owner, 'first')).toBeUndefined();
  expect(await store.read(owner, 'second')).toEqual(second);
});

it('refuses a selected version after newer words were stored under the same checkpoint identity', async () => {
  const store = createIndexedDbCheckpoints(); await store.put(checkpoint());
  const stale = (await store.read(owner, 'source'))!, newer = copy(stale);
  newer.checkpoint.draft!.title = 'Later independent words'; await store.put(newer);
  await expect(store.discardRecovery!(stale, current)).rejects.toMatchObject({ code: 'decision-changed' });
  expect((await store.read(owner, 'source'))?.checkpoint.draft?.title).toBe('Later independent words');
});

it('uses the whole legacy record when there is no version and refuses a changed owner or resource', async () => {
  const store = createIndexedDbCheckpoints(), original = checkpoint();
  disk.rows.set(JSON.stringify(['checkpoint', owner, 'source']), copy(original));
  const stale = copy(original); stale.checkpoint.draft!.title = 'Not the listed copy';
  await expect(store.discardRecovery!(stale, current)).rejects.toMatchObject({ code: 'decision-changed' });
  const wrong = copy(original); wrong.checkpoint.confirmed.resource.id = 'other';
  await expect(store.discardRecovery!(wrong, current)).rejects.toThrow();
  expect(await store.read(owner, 'source')).toEqual(original);
  await store.discardRecovery!(original, current);
  expect(await store.read(owner, 'source')).toBeUndefined();
});

it.each(['prepared', 'unfinalized', 'missing-request'] as const)('keeps %s work instead of treating it as unsent text', async kind => {
  const store = createIndexedDbCheckpoints(), value = checkpoint();
  if (kind === 'prepared') {
    const session = DataSession.restore(value.checkpoint); value.prepared = session.prepare('prepared-operation', owner)!;
    value.checkpoint = session.checkpoint();
  } else if (kind === 'unfinalized') value.unfinalized = ['unfinalized-operation'];
  else value.checkpoint.pending['missing-request'] = { generation: 1, value: copy(value.checkpoint.draft!) };
  // The missing-reference control models a persisted legacy row without authorizing a new bad write.
  disk.rows.set(JSON.stringify(['checkpoint', owner, value.editorId]), copy(value));
  await expect(store.discardRecovery!(value, current)).rejects.toMatchObject({ code: 'pending-delivery-first' });
  expect(await store.read(owner, value.editorId)).toEqual(value);
});

it('keeps a captured request which has not yet appeared in its checkpoint projection', async () => {
  const store = createIndexedDbCheckpoints(); await store.put(checkpoint());
  const chosen = (await store.read(owner, 'source'))!;
  await createIndexedDbCommitStore().create(request());
  await expect(store.discardRecovery!(chosen, current)).rejects.toMatchObject({ code: 'pending-delivery-first' });
  expect(await store.read(owner, 'source')).toEqual(chosen);
});

it('keeps selected manual words behind a queued predecessor and preserves the request', async () => {
  const store = createIndexedDbManualScopes(), queued = await createIndexedDbCommitStore().create(request('form'));
  const value = manual(); value.record.predecessor = { id: queued.id, owner, resource, value: queued.value!, predecessorId: null };
  value.record.savedSelection = [{ exists: true, value: 'Saved words' }]; value.record.savedGeneration = 1; value.record.generation = 2;
  value.commitReferences = [queued.id]; await store.create(value);
  const chosen = (await store.list(owner))[0];
  await expect(store.discardRecovery!(chosen, current)).rejects.toMatchObject({ code: 'pending-delivery-first' });
  expect((await store.list(owner))[0]).toEqual(chosen);
  expect((await createIndexedDbCommitStore().list(owner))[0]?.state).toBe('queued');
});

it('marks only the selected manual copy as removed and refuses delayed writes even at a higher generation', async () => {
  const store = createIndexedDbManualScopes(); await store.create(manual()); await store.create(manual('unrelated'));
  const chosen = (await store.list(owner)).find(value => value.scopeId === 'form')!;
  await store.discardRecovery!(chosen, current);
  expect((await store.read(owner, 'form'))).toMatchObject({ record: null, discarded: true, commitReferences: [],
    watermark: { generation: chosen.record.generation } });
  const late = copy(chosen); late.record.generation += 10; late.record.stage[0] = { exists: true, value: 'Delayed old writer' };
  await expect(store.put(late)).rejects.toMatchObject({ code: 'decision-changed' });
  expect((await store.list(owner)).map(value => value.scopeId)).toEqual(['unrelated']);
});

it('refuses manual deletion after a storage version change and rolls back a refused local write', async () => {
  const store = createIndexedDbManualScopes(); await store.create(manual());
  const stale = (await store.list(owner))[0], newer = copy(stale);
  newer.record.stage[0] = { exists: true, value: 'Later words' }; await store.put(newer);
  await expect(store.discardRecovery!(stale, current)).rejects.toMatchObject({ code: 'decision-changed' });
  const chosen = (await store.list(owner))[0]; disk.writeFailure = true;
  await expect(store.discardRecovery!(chosen, current)).rejects.toThrow('disk full'); disk.writeFailure = false;
  expect((await store.list(owner))[0]).toEqual(chosen);
});

it('removes a stage with verified settled provenance and releases only its own retained reference', async () => {
  const store = createIndexedDbManualScopes(), commits = createIndexedDbCommitStore();
  const queued = await commits.create(request('form')), value = manual();
  value.record.predecessor = { id: queued.id, owner, resource, value: queued.value!, predecessorId: null };
  value.record.savedSelection = [{ exists: true, value: 'Saved words' }]; value.record.savedGeneration = 1; value.record.generation = 2; value.commitReferences = [queued.id];
  await store.create(value);
  await commits.compareAndSet(queued, { ...queued, state: 'acknowledged', result: { kind: 'acknowledged', operationId: queued.id, snapshot: { ...baseline, value: queued.value } } });
  await store.discardRecovery!((await store.list(owner))[0], current);
  expect(await store.list(owner)).toEqual([]);
  expect((await commits.list(owner))[0]?.state).toBe('acknowledged');
  await commits.releaseProjection!(owner, [queued.id]);
  expect(await commits.list(owner)).toEqual([]);
});

it('closes only an unchanged unsent membership scope and rejects stale CAS continuation', async () => {
  const store = createIndexedDbMembershipScopes();
  const chosen = await store.persist(membership(), null), other = await store.persist(membership('other'), null);
  await store.discardRecovery!(chosen, current);
  expect(await store.read(owner, chosen.scopeId)).toBeUndefined();
  expect(await store.completion(owner, chosen.scopeId)).toBe('cancelled');
  await expect(store.persist({ ...chosen, generation: chosen.generation + 1 }, chosen.revision)).rejects.toThrow('changed');
  expect(await store.read(owner, other.scopeId)).toEqual(other);
});

it('preserves newer membership words and refuses a frozen Save regardless of its empty request list', async () => {
  const store = createIndexedDbMembershipScopes(), stale = await store.persist(membership(), null);
  const newer = await store.persist({ ...stale, generation: stale.generation + 1 }, stale.revision);
  await expect(store.discardRecovery!(stale, current)).rejects.toMatchObject({ code: 'decision-changed' });
  const saving = await store.persist({ ...newer, phase: 'saving' }, newer.revision);
  await expect(store.discardRecovery!(saving, current)).rejects.toMatchObject({ code: 'pending-delivery-first' });
  expect(await store.read(owner, saving.scopeId)).toEqual(saving);
});

it('fences owner/session changes inside the native transaction before any deletion', async () => {
  const store = createIndexedDbCheckpoints(); await store.put(checkpoint());
  const chosen = (await store.read(owner, 'source'))!;
  let checks = 0;
  await expect(store.discardRecovery!(chosen, () => ++checks < 2)).rejects.toMatchObject({ code: 'decision-changed' });
  expect(checks).toBe(2);
  expect(await store.read(owner, 'source')).toEqual(chosen);
});


function engineFixture(held: boolean | null = false) {
  const checkpoints = createIndexedDbCheckpoints(), manualScopes = createIndexedDbManualScopes(), commits = createIndexedDbCommitStore();
  let sequence = 0;
  const transport = { read: jest.fn(async () => copy(baseline)), send: jest.fn(async () => { throw new Error('Offline test must not send'); }) };
  const engine = new DataEngine({ transport, checkpoints, manualScopes, commits,
    snapshots: { read: async () => copy(baseline), put: async () => undefined },
    observer: new ResourceObserver({ transport, source: { listen: () => () => undefined } }),
    runtime: new DataEngineRuntime({ transport, journal: { list: async () => [], put: async () => undefined, remove: async () => undefined } }),
    recoveryPresence: { held: async () => held, hold: () => () => undefined }, operationId: () => `discard-test-${++sequence}` });
  engine.setOnline(false); engine.setOwner(owner);
  return { engine, checkpoints, manualScopes, commits, transport };
}

it.each([true, null])('refuses destructive recovery when closed presence is %s', async held => {
  const s = engineFixture(held); await s.checkpoints.put(checkpoint());
  const chosen = (await s.engine.listRecoverable(resource))[0];
  await expect(s.engine.discardRecovery(chosen)).rejects.toMatchObject({ code: held ? 'draft-open' : 'draft-presence-unknown' });
  expect(await s.checkpoints.read(owner, 'source')).toBeDefined();
  expect(s.transport.send).not.toHaveBeenCalled(); s.engine.dispose();
});

it('removes the exact closed choice through the public engine and refuses a foreign owner', async () => {
  const s = engineFixture(); await s.checkpoints.put(checkpoint());
  const chosen = (await s.engine.listRecoveryChoices(resource))[0];
  s.engine.setOwner('different-owner');
  await expect(s.engine.discardRecovery(chosen)).rejects.toThrow();
  expect(await s.checkpoints.read(owner, 'source')).toBeDefined();
  s.engine.setOwner(owner); await s.engine.discardRecovery(chosen);
  expect(await s.engine.listRecoveryChoices(resource)).toEqual([]);
  expect(s.transport.send).not.toHaveBeenCalled(); s.engine.dispose();
});

it('starts a new manual identity after a discarded old form without resurrecting its stage', async () => {
  const sourceId = JSON.stringify(['old-parent', 'manual', 'title']);
  const s = engineFixture(), original = manual(sourceId); original.parentEditorId = 'old-parent';
  await s.manualScopes.create(original);
  const source = (await s.manualScopes.list(owner))[0];
  const consumer = await s.engine.openEditor(resource, 'consumer'), form = consumer.form('title', [['title']]);
  await form.begin(); await form.discardRecovery(source);
  expect(await s.manualScopes.read(owner, sourceId)).toMatchObject({ record: null, discarded: true });
  const reopened = await s.engine.openEditor(resource, 'old-parent'), fresh = reopened.form('title', [['title']]);
  await fresh.begin();
  expect(fresh.getState()?.record.scopeId).not.toBe(sourceId);
  expect(fresh.getState()?.record.stage).toEqual([{ exists: true, value: 'Confirmed words' }]);
  await fresh.update(value => ({ ...value, title: 'New deliberate words' }));
  await fresh.save();
  expect((await s.commits.list(owner)).some(request => request.editorId !== sourceId && request.value?.title === 'New deliberate words')).toBe(true);
  expect(await s.manualScopes.read(owner, sourceId)).toMatchObject({ record: null, discarded: true });
  expect(s.transport.send).not.toHaveBeenCalled(); consumer.dispose(); reopened.dispose(); s.engine.dispose();
});

it.each(['missing-snapshot', 'wrong-resource', 'wrong-owner'] as const)('preserves words when terminal evidence has %s', async kind => {
  const store = createIndexedDbManualScopes(), commits = createIndexedDbCommitStore(), queued = await commits.create(request('form'));
  const value = manual(); value.record.predecessor = { id: queued.id, owner, resource, value: queued.value!, predecessorId: null };
  value.record.savedSelection = [{ exists: true, value: 'Saved words' }]; value.record.savedGeneration = 1; value.record.generation = 2;
  value.commitReferences = [queued.id]; await store.create(value);
  const snapshot = kind === 'missing-snapshot' ? undefined : { ...baseline,
    resource: kind === 'wrong-resource' ? { ...resource, id: 'other' } : resource,
    value: { ...queued.value!, ...(kind === 'wrong-owner' ? { userId: 'different-owner' } : {}) } };
  const malformed = { ...queued, state: 'acknowledged', result: { kind: 'acknowledged', operationId: queued.id, snapshot } } as CommitRequest;
  await commits.compareAndSet(queued, malformed);
  const chosen = (await store.list(owner))[0];
  await expect(store.discardRecovery!(chosen, current)).rejects.toMatchObject({ code: 'pending-delivery-first' });
  expect((await store.list(owner))[0]).toEqual(chosen);
});

it('removes the exact raw legacy source after read-only ACK projection preserves later unsent words', async () => {
  const s = engineFixture(), queued = await s.commits.create(request('source'));
  const session = new DataSession(baseline);
  session.edit(queued.value); session.prepare(queued.id, owner);
  session.edit({ ...queued.value!, title: 'Later unsent words' });
  const legacy: EditorRecord = { owner, editorId: 'source', checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
  disk.rows.set(JSON.stringify(['checkpoint', owner, 'source']), copy(legacy));
  await s.commits.compareAndSet(queued, { ...queued, state: 'acknowledged', result: { kind: 'acknowledged', operationId: queued.id, snapshot: { ...baseline, value: queued.value } } });
  const chosen = (await s.engine.listRecoveryChoices(resource))[0];
  expect(chosen.record.checkpoint.draft?.title).toBe('Later unsent words');
  expect(chosen.record.checkpoint.pending).toEqual({});
  await s.engine.discardRecovery(chosen);
  expect(await s.checkpoints.read(owner, 'source')).toBeUndefined();
  s.engine.dispose();
});
