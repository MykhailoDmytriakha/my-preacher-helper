import { collectionDocumentViews } from '../collectionView';
import type { CommitRequest } from '../commits';
import type { ResourceSnapshot } from '../types';

const resource = { collection: 'groups', id: 'g' };
const snapshot = (revision = 1, title = 'Confirmed'): ResourceSnapshot => ({ resource,
  value: { userId: 'owner', title }, metadata: { protocol: 1, generation: 'gen', revision, deleted: false } });
const request = (id = 'save'): CommitRequest => ({ id, owner: 'owner', editorId: id, editGeneration: 1,
  baseline: snapshot(), value: { userId: 'owner', title: id }, predecessor: null, revision: 1,
  initialized: false, working: snapshot(), intended: { userId: 'owner', title: id },
  command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [] });
const views = (requests: CommitRequest[], snapshots = [snapshot()]) => collectionDocumentViews('owner', 'groups', snapshots, requests);

it('presents submitted creation and updates without changing confirmed snapshots', () => {
  const saved = request(), absent = { resource, value: null, metadata: null };
  expect(views([{ ...saved, baseline: absent, working: absent }], [])).toEqual([
    { resource, value: saved.value, pending: true, needsAttention: false, deleting: false, creating: true },
  ]);
  const confirmed = [snapshot()], frozen = JSON.stringify(confirmed);
  expect(views([saved], confirmed)[0].value?.title).toBe('save');
  expect(JSON.stringify(confirmed)).toBe(frozen);
});
it('bridges ACK-before-feed delivery and lets a newer server revision win', () => {
  const saved: CommitRequest = { ...request(), state: 'acknowledged', result: {
    kind: 'acknowledged', operationId: 'save', snapshot: snapshot(2, 'Accepted'),
  } };
  expect(views([saved])[0]).toMatchObject({ value: { title: 'Accepted' }, pending: false });
  expect(views([saved], [snapshot(3, 'New remote')])[0].value?.title).toBe('New remote');
});
it('keeps remote siblings accepted by an ancestor while showing the later submitted edit', () => {
  const first: CommitRequest = { ...request('a'), state: 'acknowledged', result: {
    kind: 'acknowledged', operationId: 'a', snapshot: { ...snapshot(2, 'a'), value: { userId: 'owner', title: 'a', description: 'Remote sibling' } },
  } };
  const second: CommitRequest = { ...request('b'), predecessor: 'a' };
  expect(views([first, second])[0].value).toMatchObject({ title: 'b', description: 'Remote sibling' });
});
it('keeps pending and refused deletions addressable until confirmed', () => {
  const deletion: CommitRequest = { ...request(), value: null, intended: null };
  expect(views([deletion])[0]).toMatchObject({ value: { title: 'Confirmed' }, pending: true, deleting: true });
  expect(views([{ ...deletion, state: 'refused' }])[0]).toMatchObject({ value: { title: 'Confirmed' }, needsAttention: true });
  const tombstone = { ...snapshot(2), value: null, metadata: { ...snapshot(2).metadata!, deleted: true } };
  expect(views([{ ...deletion, state: 'acknowledged', result: { kind: 'acknowledged', operationId: 'save', snapshot: tombstone } }])[0])
    .toMatchObject({ value: null, pending: false, deleting: false });
});
it('preserves refused edits and exposes competing branches without inventing a winner', () => {
  expect(views([{ ...request(), state: 'refused' }])[0]).toMatchObject({ value: { title: 'save' }, needsAttention: true });
  expect(views([request('a'), request('b')])[0]).toMatchObject({ value: { title: 'Confirmed' }, pending: true, needsAttention: true });
});
it('ignores cancelled work, other owners and other collections', () => {
  expect(views([{ ...request(), state: 'cancelled' }, { ...request('foreign'), owner: 'other' },
    { ...request('elsewhere'), baseline: { ...snapshot(), resource: { collection: 'councils', id: 'g' } } }])[0])
    .toMatchObject({ value: { title: 'Confirmed' }, pending: false });
});

it('presents journal-owned capability ACKs and secondary aliases without altering the listed cache', () => {
  const link: ResourceSnapshot = { resource: { collection: 'studyNoteShareLinks', id: 'link' },
    value: { ownerId: 'owner', noteId: 'note', token: 'token' }, metadata: { protocol: 1, generation: 'link-create', revision: 1, deleted: false } };
  const alias: ResourceSnapshot = { resource: { collection: 'studyNoteShareLinks', id: 'alias' }, value: null,
    metadata: { protocol: 1, generation: 'alias-create', revision: 1, deleted: true } };
  const journal: import('../types').JournalEntry[] = [{ command: { protocol: 1, owner: 'owner', operationId: 'alias-create', resource: alias.resource,
    generation: null, dependsOn: [], kind: 'relation', relation: 'share-link-create', note: { id: 'note', generation: null }, authorLanguage: 'en' },
    state: 'acknowledged', createdAt: 1, attempts: 1, result: { kind: 'acknowledged', operationId: 'alias-create', snapshot: alias,
      relatedSnapshots: [link], affected: [{ resource: link.resource, metadata: link.metadata! }] } }];
  const listed: ResourceSnapshot[] = [];
  const presented = collectionDocumentViews('owner', 'studyNoteShareLinks', listed, [], journal);
  expect(presented.find(row => row.resource.id === 'link')).toMatchObject({ value: { token: 'token' }, pending: false });
  expect(presented.find(row => row.resource.id === 'alias')).toMatchObject({ value: null });
  expect(listed).toEqual([]);
  expect(collectionDocumentViews('another-owner', 'studyNoteShareLinks', [], [], journal)).toEqual([]);
  const tombstone = { ...link, value: null, metadata: { ...link.metadata!, revision: 3, deleted: true } };
  expect(collectionDocumentViews('owner', 'studyNoteShareLinks', [tombstone], [], journal).find(row => row.resource.id === 'link')?.value).toBeNull();
  expect(collectionDocumentViews('owner', 'studyNoteShareLinks', [], [], [{ ...journal[0], state: 'unknown', result: undefined }])).toEqual([]);
});
