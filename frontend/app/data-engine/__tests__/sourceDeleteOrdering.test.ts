import { membershipEngineHarness } from '@test-utils/membershipEngineHarness';
import { settleEngine } from '@test-utils/documentEngineHarness';

import type { DataCommand, DocumentData, ResourceRef, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const source: ResourceRef = { collection: 'studyNotes', id: 'accepted-order-source' };
const newSermon: ResourceRef = { collection: 'sermons', id: 'created-before-source-delete' };
const existingSermon: ResourceRef = { collection: 'sermons', id: 'updated-before-source-delete' };
const unrelated: ResourceRef = { collection: 'studyMaterials', id: 'unrelated-saved-write' };
const sourceValue: DocumentData = {
  userId: 'owner', title: 'Accepted note', content: 'Copied before removal', scriptureRefs: [], tags: [], isDraft: false,
  createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z', type: 'note',
};
const linkedSermon: DocumentData = {
  userId: 'owner', title: 'Saved sermon', verse: 'John 3:16', date: '2026-10-31', thoughts: [], sourceNoteIds: [source.id],
  scratch: [{ id: 'copied-before-removal', text: 'Words copied while source was live', createdAt: '2026-10-31',
    source: { noteId: source.id, heading: 'Accepted note' } }],
};
const liveSource: ResourceSnapshot = { resource: source, value: sourceValue,
  metadata: { protocol: 1, generation: 'accepted-note-generation', revision: 1, deleted: false } };
const existingSermonSnapshot: ResourceSnapshot = { resource: existingSermon,
  value: { userId: 'owner', title: 'Existing sermon', verse: 'John 3:16', date: '2026-10-30', thoughts: [], sourceNoteIds: [],
    scratch: [] },
  metadata: { protocol: 1, generation: 'existing-sermon-generation', revision: 1, deleted: false } };
const unrelatedSnapshot: ResourceSnapshot = { resource: unrelated,
  value: { userId: 'owner', title: 'Unrelated study', type: 'study', noteIds: [], createdAt: '2026-10-30', updatedAt: '2026-10-30' },
  metadata: { protocol: 1, generation: 'unrelated-generation', revision: 1, deleted: false } };

function holdConsumerSend(h: ReturnType<typeof membershipEngineHarness>, resource: ResourceRef, kind: 'create' | 'update') {
  const send = jest.mocked(h.transport.send);
  const realSend = send.getMockImplementation()!;
  let command: DataCommand | undefined;
  let sendResult: Awaited<ReturnType<typeof realSend>> | undefined;
  let enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let finish!: (result: Awaited<ReturnType<typeof realSend>>) => void;
  const response = new Promise<Awaited<ReturnType<typeof realSend>>>(resolve => { finish = resolve; });
  let released = false;
  send.mockImplementation(async current => {
    if (!command && current.kind === kind && current.resource.collection === resource.collection && current.resource.id === resource.id) {
      command = current;
      enter();
      return response;
    }
    return realSend(current);
  });
  return {
    get command() { return command; },
    get result() { return sendResult; },
    entered,
    async release() {
      if (!command || released) return;
      released = true;
      const result = await realSend(command);
      sendResult = result;
      finish(result);
      await settleEngine();
    },
  };
}

function sendOrder(h: ReturnType<typeof membershipEngineHarness>) {
  return jest.mocked(h.transport.send).mock.calls.map(([command]) => [command.kind, command.resource.collection, command.resource.id] as const);
}

async function deliveredResult(h: ReturnType<typeof membershipEngineHarness>, kind: DataCommand['kind'], resource: ResourceRef) {
  const send = jest.mocked(h.transport.send);
  const index = send.mock.calls.findIndex(([command]) => command.kind === kind
    && command.resource.collection === resource.collection && command.resource.id === resource.id);
  return index < 0 ? undefined : await send.mock.results[index].value;
}

function retainsCopiedSourceWords(value: DocumentData | null): boolean {
  const sourceIds = value?.sourceNoteIds;
  const scratch = value?.scratch;
  return Array.isArray(sourceIds) && sourceIds.includes(source.id) && Array.isArray(scratch)
    && scratch.some(item => item !== null && typeof item === 'object' && !Array.isArray(item)
      && item.id === 'copied-before-removal' && item.text === 'Words copied while source was live');
}

async function prepareScenario(kind: 'create' | 'update', includeUnrelatedWrite = false) {
  const h = membershipEngineHarness(kind === 'create' ? [liveSource, unrelatedSnapshot] : [liveSource, existingSermonSnapshot, unrelatedSnapshot]);
  const browser = h.createBrowser(), engine = browser.engine;
  engine.setOnline(false);
  engine.setOwner('owner');
  const sourceEditor = await engine.openEditor(source, 'remove-after-saved-consumer');
  const consumer = kind === 'create'
    ? await engine.createEditor(newSermon, 'create-before-source-remove')
    : await engine.openEditor(existingSermon, 'update-before-source-remove');
  const consumerRef = kind === 'create' ? newSermon : existingSermon;
  if (kind === 'create') await consumer.commit(() => linkedSermon);
  else await consumer.commit(current => ({ ...current!, sourceNoteIds: [source.id], scratch: linkedSermon.scratch }));
  await engine.retry(); await settleEngine();
  const consumerRequest = (await h.commits.list('owner')).find(request => request.baseline.resource.id === consumerRef.id)!;
  const studyEditor = includeUnrelatedWrite ? await engine.openEditor(unrelated, 'unrelated-save') : undefined;
  if (studyEditor) await studyEditor.commit(current => ({ ...current!, title: 'Unrelated write progresses' }));
  await sourceEditor.remove();
  await engine.retry(); await settleEngine();
  const deleteRequest = (await h.commits.list('owner')).find(request => request.baseline.resource.id === source.id)!;
  return { h, browser, engine, sourceEditor, consumer, consumerRef, consumerRequest, deleteRequest, studyEditor };
}

describe('Earlier saved source-note use and later explicit deletion', () => {
  it.each(['create', 'update'] as const)('delivers a saved sermon %s before the later source delete', async kind => {
    const s = await prepareScenario(kind);
    const hold = holdConsumerSend(s.h, s.consumerRef, kind);
    let draining: Promise<void> | undefined;
    try {
      s.engine.setOnline(true);
      draining = s.engine.retry();
      void draining.catch(() => undefined);
      await hold.entered;
      await settleEngine();

      const prepared = await s.h.commits.list('owner');
      const preparedConsumer = prepared.find(request => request.id === s.consumerRequest.id);
      const preparedDelete = prepared.find(request => request.id === s.deleteRequest.id);
      expect(preparedConsumer).toMatchObject({
        id: s.consumerRequest.id, owner: 'owner', baseline: s.consumerRequest.baseline,
        value: s.consumerRequest.value, intended: s.consumerRequest.intended,
      });
      expect(preparedDelete).toMatchObject({
        id: s.deleteRequest.id, owner: 'owner', baseline: { resource: source, value: sourceValue, metadata: { deleted: false } },
        value: null, intended: null,
      });
      const heldSendOrder = sendOrder(s.h);
      const consumerOperationId = hold.command?.operationId;
      const sourceDeleteSentWhileConsumerHeld = heldSendOrder.some(item => item[0] === 'delete' && item[1] === source.collection && item[2] === source.id);
      const sourceWasLiveWhileConsumerHeld = s.h.read(source).value !== null;
      await hold.release();
      await draining;
      await s.engine.retry();
      await settleEngine();

      const consumerResult = hold.result;
      const deleteResult = await deliveredResult(s.h, 'delete', source);
      const finalOrder = sendOrder(s.h);
      const consumerIndex = finalOrder.findIndex(item => item[1] === s.consumerRef.collection && item[2] === s.consumerRef.id);
      const deleteIndex = finalOrder.findIndex(item => item[0] === 'delete' && item[1] === source.collection && item[2] === source.id);
      const requests = await s.h.commits.list('owner');
      const finalConsumer = requests.find(request => request.id === s.consumerRequest.id);
      const _finalDelete = requests.find(request => request.id === s.deleteRequest.id);
      const sentDelete = jest.mocked(s.h.transport.send).mock.calls.map(([command]) => command)
        .find(command => command.kind === 'delete' && command.resource.collection === source.collection && command.resource.id === source.id);
      const accepted = consumerResult?.kind === 'acknowledged' ? consumerResult.snapshot.value : null;
      expect({
        heldConsumer: hold.command && { kind: hold.command.kind, resource: hold.command.resource },
        sourceDeleteSentWhileConsumerHeld,
        sourceWasLiveWhileConsumerHeld,
        consumerBeforeDelete: consumerIndex >= 0 && deleteIndex >= 0 && consumerIndex < deleteIndex,
        sourceRemainsDeleted: s.h.read(source).value === null && s.h.read(source).metadata?.deleted === true,
        consumerAcceptedWithCopiedWords: consumerResult?.kind === 'acknowledged' && retainsCopiedSourceWords(accepted)
          && consumerResult.operationId === consumerOperationId && s.h.read(s.consumerRef).metadata?.operationId === consumerOperationId,
        consumerRecordSettled: !finalConsumer || finalConsumer.state === 'acknowledged',
        deleteAcknowledgedWithStableIdentity: Boolean(deleteResult && (deleteResult.kind === 'deleted' || deleteResult.kind === 'acknowledged')
          && deleteResult.operationId === sentDelete?.operationId && s.h.read(source).metadata?.operationId === sentDelete?.operationId),
      }).toEqual({
        heldConsumer: { kind, resource: s.consumerRef },
        sourceDeleteSentWhileConsumerHeld: false,
        sourceWasLiveWhileConsumerHeld: true,
        consumerBeforeDelete: true,
        sourceRemainsDeleted: true,
        consumerAcceptedWithCopiedWords: true,
        consumerRecordSettled: true,
        deleteAcknowledgedWithStableIdentity: true,
      });
    } finally {
      await hold.release();
      await draining?.catch(() => undefined);
      s.browser.dispose();
    }
  });

  it('lets an unrelated saved resource progress while a sermon send is held', async () => {
    const s = await prepareScenario('create', true);
    const hold = holdConsumerSend(s.h, newSermon, 'create');
    let draining: Promise<void> | undefined;
    try {
      s.engine.setOnline(true);
      draining = s.engine.retry();
      void draining.catch(() => undefined);
      await hold.entered;
      await settleEngine();

      const heldSendOrder = sendOrder(s.h);
      expect({
        consumerHeld: hold.command?.resource,
        unrelatedWriteSent: heldSendOrder.some(item => item[0] === 'update' && item[1] === unrelated.collection && item[2] === unrelated.id),
      }).toEqual({ consumerHeld: newSermon, unrelatedWriteSent: true });
    } finally {
      await hold.release();
      await draining?.catch(() => undefined);
      s.browser.dispose();
    }
  });

  it('preserves consumer-before-delete ordering across restart before first delivery', async () => {
    const s = await prepareScenario('create');
    const hold = holdConsumerSend(s.h, newSermon, 'create');
    let restarted: ReturnType<typeof s.h.createBrowser> | undefined;
    let draining: Promise<void> | undefined;
    try {
      s.browser.dispose();
      restarted = s.h.createBrowser();
      restarted.engine.setOwner('owner');
      restarted.engine.setOnline(true);
      draining = restarted.engine.retry();
      void draining.catch(() => undefined);
      await hold.entered;
      await settleEngine();

      const heldSendOrder = sendOrder(s.h);
      const consumerOperationId = hold.command?.operationId;
      const sourceDeleteSentWhileConsumerHeld = heldSendOrder.some(item => item[0] === 'delete' && item[1] === source.collection && item[2] === source.id);
      const heldConsumer = hold.command && { kind: hold.command.kind, resource: hold.command.resource };
      await hold.release();
      await draining;
      await restarted.engine.retry();
      await settleEngine();

      const finalOrder = sendOrder(s.h);
      const consumerIndex = finalOrder.findIndex(item => item[1] === newSermon.collection && item[2] === newSermon.id);
      const deleteIndex = finalOrder.findIndex(item => item[0] === 'delete' && item[1] === source.collection && item[2] === source.id);
      const requests = await s.h.commits.list('owner');
      const finalConsumer = requests.find(request => request.id === s.consumerRequest.id);
      const _finalDelete = requests.find(request => request.id === s.deleteRequest.id);
      const sentDelete = jest.mocked(s.h.transport.send).mock.calls.map(([command]) => command)
        .find(command => command.kind === 'delete' && command.resource.collection === source.collection && command.resource.id === source.id);
      const consumerResult = hold.result;
      const deleteResult = await deliveredResult(s.h, 'delete', source);
      const accepted = consumerResult?.kind === 'acknowledged' ? consumerResult.snapshot.value : null;
      expect({
        heldConsumer,
        sourceDeleteSentWhileConsumerHeld,
        consumerBeforeDelete: consumerIndex >= 0 && deleteIndex >= 0 && consumerIndex < deleteIndex,
        sourceRemainsDeleted: s.h.read(source).value === null && s.h.read(source).metadata?.deleted === true,
        consumerAcceptedWithCopiedWords: consumerResult?.kind === 'acknowledged' && retainsCopiedSourceWords(accepted)
          && consumerResult.operationId === consumerOperationId && s.h.read(s.consumerRef).metadata?.operationId === consumerOperationId,
        consumerRecordSettled: !finalConsumer || finalConsumer.state === 'acknowledged',
        deleteAcknowledgedWithStableIdentity: Boolean(deleteResult && (deleteResult.kind === 'deleted' || deleteResult.kind === 'acknowledged')
          && deleteResult.operationId === sentDelete?.operationId && s.h.read(source).metadata?.operationId === sentDelete?.operationId),
      }).toEqual({
        heldConsumer: { kind: 'create', resource: newSermon },
        sourceDeleteSentWhileConsumerHeld: false,
        consumerBeforeDelete: true,
        sourceRemainsDeleted: true,
        consumerAcceptedWithCopiedWords: true,
        consumerRecordSettled: true,
        deleteAcknowledgedWithStableIdentity: true,
      });
    } finally {
      await hold.release();
      await draining?.catch(() => undefined);
      restarted?.dispose();
      s.browser.dispose();
    }
  });

  it('refuses a new link when the source was already deleted before the save', async () => {
    const h = membershipEngineHarness([liveSource]);
    const browser = h.createBrowser(), engine = browser.engine;
    try {
      engine.setOwner('owner');
      const note = await engine.openEditor(source, 'delete-before-new-link');
      await note.remove();
      await engine.retry(); await settleEngine();
      const deleted = h.read(source);
      expect(deleted).toMatchObject({ value: null, metadata: { deleted: true } });

      const sermon = await engine.createEditor(newSermon, 'new-link-after-delete');
      await sermon.commit(() => linkedSermon);
      await engine.retry(); await settleEngine();
      expect(h.read(newSermon).value).toBeNull();
      expect((await h.commits.list('owner')).find(request => request.baseline.resource.id === newSermon.id))
        .toMatchObject({ state: 'refused', intended: linkedSermon, result: { kind: 'refused', code: 'referenced-document-deleted' } });
      expect(h.read(source)).toMatchObject({ value: null, metadata: { deleted: true } });
    } finally { browser.dispose(); }
  });

  it('keeps an unchanged historical source link when the source is deleted', async () => {
    const historical: ResourceSnapshot = { resource: existingSermon,
      value: { ...linkedSermon, title: 'Historical source use' },
      metadata: { protocol: 1, generation: 'historical-sermon-generation', revision: 1, deleted: false } };
    const h = membershipEngineHarness([liveSource, historical]);
    const browser = h.createBrowser(), engine = browser.engine;
    try {
      engine.setOnline(false); engine.setOwner('owner');
      const note = await engine.openEditor(source, 'remove-source-with-historical-sermon');
      await note.remove();
      await engine.retry(); await settleEngine();
      engine.setOnline(true); await engine.retry(); await settleEngine();

      expect(h.read(source)).toMatchObject({ value: null, metadata: { deleted: true } });
      expect(h.read(existingSermon).value).toMatchObject({
        sourceNoteIds: [source.id],
        scratch: [{ text: 'Words copied while source was live', source: { noteId: source.id } }],
      });
      expect(sendOrder(h)).toEqual([['delete', source.collection, source.id]]);
    } finally { browser.dispose(); }
  });
});
