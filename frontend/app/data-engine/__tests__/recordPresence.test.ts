import { collectionDocumentViews } from '../collectionView';
import { collectionRecordPresence, documentRecordPresence } from '../recordPresence';

import type { CollectionState } from '../collections';
import type { CommitRequest } from '../commits';
import type { Observation } from '../observer';
import type { ResourceSnapshot } from '../types';

const resource = { collection: 'groups', id: 'group-1' };
const absent: ResourceSnapshot = { resource, value: null, metadata: null };
const live: ResourceSnapshot = { resource, value: { userId: 'owner', title: 'Kept title' },
  metadata: { protocol: 1, generation: 'generation', revision: 1, deleted: false } };
const observed = (snapshot = absent, source: 'cache' | 'server' = 'server'): Observation => ({
  snapshot, source, readiness: source, checking: false, error: false,
});
const listed = (overrides: Partial<CollectionState> = {}): CollectionState => ({
  snapshots: [], complete: true, freshness: 'server', version: 1, checking: false, error: null, ...overrides,
});
const request = (baseline = absent, value = live.value): CommitRequest => ({
  id: 'request', owner: 'owner', editorId: 'editor', editGeneration: 1, baseline, value,
  predecessor: null, revision: 1, initialized: false, working: baseline, intended: value,
  command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [],
});

it('uses the server observation own snapshot even while an editor still holds cached absence', () => {
  const oldEditorSnapshot = absent;
  const answer = documentRecordPresence(resource, observed(live));
  expect(oldEditorSnapshot.value).toBeNull();
  expect(answer).toMatchObject({ kind: 'present', source: 'server', snapshot: live });
  expect(answer.snapshot).toBe(live);
});

it.each(['cache', 'unknown'] as const)('does not turn %s document absence into a deletion', readiness => {
  expect(documentRecordPresence(resource, { ...observed(), source: 'cache', readiness })).toMatchObject({ kind: 'unknown' });
});

it('accepts actual server absence and refuses a failed or different-resource answer', () => {
  expect(documentRecordPresence(resource, observed())).toMatchObject({ kind: 'absent', source: 'server', snapshot: absent });
  expect(documentRecordPresence(resource, { ...observed(), error: true }).kind).toBe('unknown');
  expect(documentRecordPresence(resource, observed({ ...absent, resource: { ...resource, id: 'another' } })).kind).toBe('unknown');
});

it.each([
  { freshness: 'cache' as const },
  { complete: false },
  { complete: false, snapshots: [absent] },
  { error: 'unreachable' },
])('requires a complete successful server list for an absent collection identity: %j', partial => {
  expect(collectionRecordPresence(resource, listed(partial)).kind).toBe('unknown');
});

it('recognizes a complete server miss but keeps a cached existing record readable', () => {
  expect(collectionRecordPresence(resource, listed())).toMatchObject({ kind: 'absent', source: 'server', snapshot: absent });
  expect(collectionRecordPresence(resource, listed({ snapshots: [live], freshness: 'cache', complete: false })))
    .toMatchObject({ kind: 'present', source: 'cache', snapshot: live });
});

it('uses real held creation intent without calling a discarded creation deletion elsewhere', () => {
  const create = request();
  const documents = collectionDocumentViews('owner', resource.collection, [], [create]);
  expect(collectionRecordPresence(resource, listed({ documents })).kind).toBe('creating');
  const discarded = collectionDocumentViews('owner', resource.collection, [], [{ ...create, state: 'cancelled' }]);
  expect(collectionRecordPresence(resource, listed({ documents: discarded }))).toMatchObject({ kind: 'absent', snapshot: absent });
  expect(collectionDocumentViews('another-owner', resource.collection, [], [create])).toEqual([]);
});

it('retains a pending update separately from a confirmed deletion', () => {
  const tombstone = { ...absent, metadata: { ...live.metadata!, revision: 2, deleted: true } };
  const update = request(live, { userId: 'owner', title: 'Unsent words' });
  const documents = collectionDocumentViews('owner', resource.collection, [tombstone], [update]);
  expect(documents[0].value?.title).toBe('Unsent words');
  expect(collectionRecordPresence(resource, listed({ snapshots: [tombstone], documents })))
    .toMatchObject({ kind: 'absent', source: 'server', snapshot: tombstone });
});

it('keeps an own pending deletion distinguishable while its stored record still exists', () => {
  const documents = collectionDocumentViews('owner', resource.collection, [live], [request(live, null)]);
  expect(documents[0].value).toEqual(live.value);
  expect(collectionRecordPresence(resource, listed({ snapshots: [live], documents }))).toMatchObject({ kind: 'deleting', source: 'local' });
});


it('uses an acknowledged creation before the collection feed catches up, without reviving a newer tombstone', () => {
  const created: CommitRequest = { ...request(), state: 'acknowledged', result: {
    kind: 'acknowledged', operationId: 'accepted-create', snapshot: live,
  } };
  const documents = collectionDocumentViews('owner', resource.collection, [], [created]);
  expect(collectionRecordPresence(resource, listed({ documents }))).toMatchObject({ kind: 'present', source: 'server', snapshot: live });
  const tombstone = { ...absent, metadata: { ...live.metadata!, revision: 2, deleted: true } };
  const afterDeletion = collectionDocumentViews('owner', resource.collection, [tombstone], [created]);
  expect(collectionRecordPresence(resource, listed({ snapshots: [tombstone], documents: afterDeletion })))
    .toMatchObject({ kind: 'absent', snapshot: tombstone });
});


it('uses the exact acknowledged document until its observer catches up, but follows a newer deletion', () => {
  expect(documentRecordPresence(resource, observed(), undefined, [live]))
    .toMatchObject({ kind: 'present', source: 'server', snapshot: live });
  const tombstone = { ...absent, metadata: { ...live.metadata!, revision: 2, deleted: true } };
  expect(documentRecordPresence(resource, observed(tombstone), undefined, [live]))
    .toMatchObject({ kind: 'absent', source: 'server', snapshot: tombstone });
});
