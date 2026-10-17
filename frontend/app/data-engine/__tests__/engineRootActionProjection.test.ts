import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import { DataSession } from '../session';
import { describeSync } from '../status';

import type { CommitRequest } from '../commits';
import type { DocumentData, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const resource = { collection: 'councils', id: 'root-action-council' };
const value: DocumentData = { userId: 'owner', title: 'Original words', status: 'preparing', topics: [],
  createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z' };
const snapshot: ResourceSnapshot = { resource, value, metadata: { protocol: 1, generation: 'g', revision: 2, deleted: false } };
async function setup() {
  const harness = documentEngineHarness(snapshot);
  const browser = harness.createBrowser();
  browser.engine.setOwner('owner'); browser.engine.setOnline(false);
  const reader = await browser.engine.openEditor(resource, 'reader');
  const capture = async () => {
    const action = await browser.engine.openEditor(resource, browser.editorId(resource, 'action'));
    await action.commit(current => ({ ...current, status: 'held', heldAt: '2026-10-17T00:01:00.000Z' }));
    action.close({ flush: false }); await settleEngine();
    const requests = await harness.commits.list('owner');
    expect(requests).toHaveLength(1); expect(requests[0].predecessor).toBeNull();
    return requests[0];
  };
  return { harness, browser, reader, capture };
}

it('shows a durable root action over the exact confirmed baseline before delivery', async () => {
  const { harness, browser, reader, capture } = await setup();
  try {
    const request = await capture();
    expect(reader.getState().checkpoint.draft?.status).toBe('held');
    expect(reader.getState().checkpoint.confirmed).toEqual(snapshot);
    expect(Object.keys(reader.getState().checkpoint.pending)).toEqual([request.id]);
    expect(describeSync(reader.getState(), reader.getObservation(), reader.getDelivery()).canSave).toBe(false);
    expect(harness.transport.send).not.toHaveBeenCalled();
  } finally { browser.dispose(); }
});

it('preserves private sibling words and their separate autosave when adopting a root action', async () => {
  const { harness, browser, reader, capture } = await setup();
  try {
    await reader.edit({ ...value, title: 'Private unsent words' });
    const request = await capture();
    expect(reader.getState().checkpoint.draft).toMatchObject({ title: 'Private unsent words', status: 'held' });
    expect(request.value?.title).toBe('Original words');
    expect(describeSync(reader.getState(), reader.getObservation(), reader.getDelivery()).canSave).toBe(true);
    browser.engine.setOnline(true); await browser.engine.retry(); await settleEngine();
    expect(harness.server.value).toMatchObject({ title: 'Original words', status: 'held' });
    await reader.save(); await browser.engine.retry(); await settleEngine();
    expect(harness.server.value).toMatchObject({ title: 'Private unsent words', status: 'held' });
  } finally { browser.dispose(); }
});

it('keeps a competing private field separate from the root action', async () => {
  const { browser, reader, capture } = await setup();
  try {
    await reader.edit({ ...value, status: 'conducting' }); await capture();
    expect(reader.getState().checkpoint.draft?.status).toBe('conducting');
    expect(reader.getState().checkpoint.pending).toEqual({});
    expect(reader.getState().checkpoint.remoteCandidate).toBeNull();
  } finally { browser.dispose(); }
});

it('rejects a root based on an unobserved revision or an unknown predecessor', async () => {
  const { browser, capture } = await setup();
  try {
    const request = await capture();
    const older = new DataSession({ ...snapshot, metadata: { ...snapshot.metadata!, revision: 1 } });
    expect(older.adoptSubmittedSuccessor(request)).toBe(false);
    const current = new DataSession(snapshot);
    expect(current.adoptSubmittedSuccessor({ ...request, predecessor: 'unobserved-parent' })).toBe(false);
    expect(older.checkpoint().draft).toEqual(value);
    expect(current.checkpoint().draft).toEqual(value);
  } finally { browser.dispose(); }
});


it('excludes manual scopes, retained stages, relation commands and unseen working copies', async () => {
  const { browser, capture } = await setup();
  try {
    const request = await capture();
    const rejected: CommitRequest[] = [
      { ...request, editorId: 'manual-scope-id' },
      { ...request, retentionScope: 'retained-stage' },
      { ...request, initialized: true, working: { ...snapshot, metadata: { ...snapshot.metadata!, revision: 3 } } },
      { ...request, baseline: { ...snapshot, value: { ...value, title: 'Unobserved baseline words' } } },
      { ...request, state: 'prepared', command: { protocol: 1, operationId: 'legacy-relation', owner: 'owner', resource,
        generation: 'g', dependsOn: [], kind: 'relation', relation: 'council-carry', edits: [
          { resource, generation: 'g', beforeTopics: [], afterTopics: [] },
        ] } },
    ];
    for (const candidate of rejected) {
      const session = new DataSession(snapshot);
      expect(session.adoptSubmittedSuccessor(candidate)).toBe(false);
      expect(session.checkpoint().draft).toEqual(value);
      expect(session.checkpoint().pending).toEqual({});
    }
  } finally { browser.dispose(); }
});

it('keeps root creation and deletion outside ordinary update projection', async () => {
  const { browser, capture } = await setup();
  try {
    const request = await capture();
    const absent = { resource, value: null, metadata: null };
    const creation = new DataSession(absent);
    expect(creation.adoptSubmittedSuccessor({ ...request, baseline: absent, working: absent })).toBe(false);
    expect(creation.checkpoint().draft).toBeNull();
    const existing = new DataSession(snapshot);
    expect(existing.adoptSubmittedSuccessor({ ...request, value: null, intended: null })).toBe(false);
    expect(existing.checkpoint().draft).toEqual(value);
  } finally { browser.dispose(); }
});


it('does not borrow another ordinary screen editor root as an action', async () => {
  const { browser, capture } = await setup();
  try {
    const request = await capture();
    const session = new DataSession(snapshot);
    const otherScreen = { ...request, editorId: browser.editorId(resource, 'screen') };
    expect(session.adoptSubmittedSuccessor(otherScreen)).toBe(false);
    expect(session.checkpoint().draft).toEqual(value);
    expect(session.checkpoint().pending).toEqual({});
  } finally { browser.dispose(); }
});
