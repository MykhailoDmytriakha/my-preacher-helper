import { knownCollectionRemovals } from '../collectionPresentation';
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

it('keeps a tombstone authoritative when later private words are still recoverable', () => {
  const removed = { ...snapshot(3), value: null, metadata: { ...snapshot(3).metadata!, deleted: true } };
  const privateWords = { resource, value: { userId: 'owner', title: 'Words to recover' },
    pending: true, needsAttention: true, deleting: false };
  expect(knownCollectionRemovals({ snapshots: [removed], documents: [privateWords],
    complete: true, freshness: 'cache', checking: false, version: 3, error: null })).toEqual(new Set(['g']));
  expect(privateWords.value.title).toBe('Words to recover');
});


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
it.each(['timed', 'untimed', 'already acknowledged'] as const)('uses the correct service-title basis through an intervening step edit: %s', scenario => {
  const order = { collection: 'serviceOrders', id: 'order' };
  const initial: ResourceSnapshot = { ...snapshot(), resource: order, value: { userId: 'owner', title: 'Opening', rank: 100,
    steps: [{ id: 'step', title: 'Step', body: 'Opening words' }] } };
  const renamed = { ...initial.value, title: 'First title' };
  const stepsEdited = { ...renamed, steps: [{ id: 'step', title: 'Step', body: 'Interleaved words' }] };
  const first: CommitRequest = { ...request('first-title'), baseline: initial, working: initial, value: renamed, intended: renamed,
    ...(scenario !== 'untimed' && { serviceOrderTitleAction: { before: 'Opening', after: 'First title', observedRevision: 1,
      time: { earliestMs: 1_800_000_000_000, latestMs: 1_800_000_000_010 } } }),
  };
  const second: CommitRequest = { ...request('step-edit'), baseline: initial, working: initial, value: stepsEdited, intended: stepsEdited,
    predecessor: first.id };
  const accepted: ResourceSnapshot = { ...initial, value: renamed, metadata: { ...initial.metadata!, revision: 2, operationId: first.id } };
  const acknowledged: CommitRequest = { ...first, state: 'acknowledged', result: {
    kind: 'acknowledged', operationId: first.id, snapshot: accepted,
  } };
  const [view] = collectionDocumentViews('owner', 'serviceOrders', [initial], [scenario === 'already acknowledged' ? acknowledged : first, second]);
  expect(view).toMatchObject({ value: stepsEdited, needsAttention: false });
  if (scenario === 'already acknowledged') {
    expect(view.acknowledged).toEqual(accepted);
    expect(view.submittedTitle).toBeUndefined();
  } else {
    expect(view.submittedTitle).toEqual({ title: 'First title', revision: 1, generation: 'gen', requestId: first.id });
  }
});

it('keeps pending and refused deletions addressable until confirmed', () => {
  const deletion: CommitRequest = { ...request(), value: null, intended: null };
  expect(views([deletion])[0]).toMatchObject({ value: { title: 'Confirmed' }, pending: true, deleting: true });
  expect(views([{ ...deletion, state: 'refused' }])[0]).toMatchObject({ value: { title: 'Confirmed' }, needsAttention: true });
  const tombstone = { ...snapshot(2), value: null, metadata: { ...snapshot(2).metadata!, deleted: true } };
  expect(views([{ ...deletion, state: 'acknowledged', result: { kind: 'acknowledged', operationId: 'save', snapshot: tombstone } }])[0])
    .toMatchObject({ value: null, pending: false, deleting: false });
});
it('keeps an independently listed place visible after the acknowledged create has been compacted', () => {
  const target = { collection: 'occasionPlaces', id: 'own-place' };
  const absent = { resource: target, value: null, metadata: null };
  const created: ResourceSnapshot = { resource: target, value: { userId: 'owner', occasionId: 'original-topic' },
    metadata: { protocol: 1, generation: 'local-create', revision: 1, deleted: false, operationId: 'local-create' } };
  const independent: ResourceSnapshot = { resource: target, value: { userId: 'owner', occasionId: 'another-topic' },
    metadata: { protocol: 1, generation: 'independent-create', revision: 1, deleted: false, operationId: 'independent-create' } };
  const removal: CommitRequest = { ...request('remove'), predecessor: 'local-create', initialized: true,
    baseline: absent, working: created, value: null, intended: null, deleteAfter: [] };
  expect(collectionDocumentViews('owner', target.collection, [independent], [removal])[0])
    .toMatchObject({ value: independent.value, pending: true, needsAttention: false, deleting: false });
  expect(collectionDocumentViews('owner', target.collection, [created], [removal])[0])
    .toMatchObject({ pending: true, needsAttention: false, deleting: true });
  expect(collectionDocumentViews('owner', target.collection, [created], [{ ...removal, baseline: created }])[0])
    .toMatchObject({ pending: true, needsAttention: false, deleting: true });
});

it('preserves refused edits and exposes competing branches without inventing a winner', () => {
  expect(views([{ ...request(), state: 'refused' }])[0]).toMatchObject({ value: { title: 'save' }, needsAttention: true });
  expect(views([request('a'), request('b')])[0]).toMatchObject({ value: { title: 'Confirmed' }, pending: true, needsAttention: true });
});
it.each(['listed', 'working', 'newer', 'deleted'] as const)('shows the confirmed comment after the rejected kind change (%s)', source => {
  const target = { collection: 'studyNotes', id: 'comment' };
  const place = { id: 'verse', book: 'John', chapter: 3, fromVerse: 17 };
  const opening = { ...snapshot(), resource: target, value: {
    userId: 'owner', type: 'comment', content: 'Opening words', paragraph: false, scriptureRefs: [place],
  } };
  const stored = { ...opening, metadata: { ...opening.metadata!, revision: 2 }, value: {
    ...opening.value, content: 'Stored words', scriptureRefs: [{ ...place, fromVerse: 18 }],
  } };
  const newer = { ...stored, metadata: { ...stored.metadata, revision: 3 }, value: { ...stored.value, content: 'Latest words' } };
  const deleted = { ...newer, value: null, metadata: { ...newer.metadata, deleted: true } };
  const draft = { ...stored.value, content: 'Local words', paragraph: true };
  const rejected: CommitRequest = { ...request('switch-kind'), baseline: opening, working: stored, initialized: true, value: draft,
    intended: draft, state: 'refused', result: { kind: 'refused', operationId: 'switch-kind', code: 'comment-kind-place-changed' } };
  const expected = source === 'newer' ? newer : source === 'deleted' ? deleted : stored;
  const listed = source === 'working' ? [opening] : [expected];

  const [view] = collectionDocumentViews('owner', 'studyNotes', listed, [rejected]);

  expect(view).toMatchObject({ value: expected.value, needsAttention: true, pending: true, deleting: false });
  expect(rejected.value).toEqual(draft);
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
