import { membershipEngineHarness } from '@test-utils/membershipEngineHarness';
import { settleEngine } from '@test-utils/documentEngineHarness';

import type { DataCommand, DocumentData, ResourceRef, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const note: ResourceRef = { collection: 'studyNotes', id: 'material-before-note-delete' };
const material: ResourceRef = { collection: 'studyMaterials', id: 'created-before-note-delete' };
const sermon: ResourceRef = { collection: 'sermons', id: 'series-member-before-delete' };
const series: ResourceRef = { collection: 'series', id: 'created-before-member-delete' };

const noteValue: DocumentData = {
  userId: 'owner', title: 'Source note', content: 'Source content', scriptureRefs: [], tags: [], isDraft: false,
  materialIds: [], createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z', type: 'note',
};
const sermonValue: DocumentData = {
  userId: 'owner', title: 'Series sermon', verse: 'Romans 8:1', date: '2026-10-31', thoughts: [], sourceNoteIds: [], scratch: [],
};
const materialValue: DocumentData = {
  userId: 'owner', title: 'Saved study', type: 'study', noteIds: [note.id],
  sections: [{ id: 'section-one', title: 'Opening', noteIds: [note.id], connector: 'main' }],
  createdAt: '2026-10-31', updatedAt: '2026-10-31',
};
const seriesValue: DocumentData = {
  userId: 'owner', title: 'Saved series', theme: 'Hope', bookOrTopic: 'Romans', status: 'draft',
  items: [{ id: 'sermon-item', type: 'sermon', refId: sermon.id, position: 1 }],
  sermonIds: [sermon.id], seriesKind: 'sermon', createdAt: '2026-10-31', updatedAt: '2026-10-31',
};
const liveNote: ResourceSnapshot = { resource: note, value: noteValue,
  metadata: { protocol: 1, generation: 'material-note-generation', revision: 1, deleted: false } };
const liveSermon: ResourceSnapshot = { resource: sermon, value: sermonValue,
  metadata: { protocol: 1, generation: 'series-sermon-generation', revision: 1, deleted: false } };

function holdCreateSend(h: ReturnType<typeof membershipEngineHarness>, resource: ResourceRef) {
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
    if (!command && current.kind === 'create' && current.resource.collection === resource.collection && current.resource.id === resource.id) {
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
      sendResult = await realSend(command);
      finish(sendResult);
      await settleEngine();
    },
  };
}

async function deliveredDeleteResult(h: ReturnType<typeof membershipEngineHarness>, resource: ResourceRef) {
  const send = jest.mocked(h.transport.send);
  const index = send.mock.calls.findIndex(([command]) => command.kind === 'delete'
    && command.resource.collection === resource.collection && command.resource.id === resource.id);
  return index < 0 ? undefined : await send.mock.results[index].value;
}

function sendOrder(h: ReturnType<typeof membershipEngineHarness>) {
  return jest.mocked(h.transport.send).mock.calls.map(([command]) => [command.kind, command.resource.collection, command.resource.id] as const);
}

describe('Earlier relation creates and later member deletion', () => {
  it('accepts a saved material before deleting its note and prunes root and section links', async () => {
    const h = membershipEngineHarness([liveNote]);
    const browser = h.createBrowser(), engine = browser.engine;
    let hold: ReturnType<typeof holdCreateSend> | undefined;
    let draining: Promise<void> | undefined;
    try {
    engine.setOnline(false); engine.setOwner('owner');
    const editor = await engine.createEditor(material, 'material-before-note-delete');
    await editor.commit(() => materialValue);
    await engine.retry(); await settleEngine();
    const materialRequest = (await h.commits.list('owner')).find(request => request.baseline.resource.id === material.id)!;
    const noteEditor = await engine.openEditor(note, 'delete-material-source-note');
    await noteEditor.remove();
    await engine.retry(); await settleEngine();
    const deleteRequest = (await h.commits.list('owner')).find(request => request.baseline.resource.id === note.id)!;
    expect(materialRequest).toMatchObject({ id: expect.any(String), owner: 'owner',
      baseline: { resource: material, value: null, metadata: null }, value: materialValue, intended: materialValue });
    expect(deleteRequest).toMatchObject({ id: expect.any(String), owner: 'owner',
      baseline: { resource: note, value: noteValue, metadata: { deleted: false } }, value: null, intended: null });

    const activeHold = holdCreateSend(h, material);
    hold = activeHold;
      engine.setOnline(true);
      draining = engine.retry(); void draining.catch(() => undefined);
      await activeHold.entered; await settleEngine();
      const heldOrder = sendOrder(h);
      const deleteSentWhileMaterialHeld = heldOrder.some(item => item[0] === 'delete' && item[1] === note.collection && item[2] === note.id);
      const noteStillLiveWhileHeld = h.read(note).value !== null;
      await activeHold.release();
      await draining; await engine.retry(); await settleEngine();

      const deleteResult = await deliveredDeleteResult(h, note);
      const deleteCommand = jest.mocked(h.transport.send).mock.calls.map(([command]) => command)
        .find(command => command.kind === 'delete' && command.resource.collection === note.collection && command.resource.id === note.id);
      const createResult = activeHold.result;
      const materialSnapshot = h.read(material);
      const section = Array.isArray(materialSnapshot.value?.sections) ? materialSnapshot.value.sections[0] as DocumentData : null;
      expect({
        deleteSentWhileMaterialHeld,
        noteStillLiveWhileHeld,
        materialCreateAccepted: createResult?.kind === 'acknowledged' && createResult.operationId === activeHold.command?.operationId
          && JSON.stringify(createResult.snapshot.value?.noteIds) === JSON.stringify([note.id])
          && Array.isArray(createResult.snapshot.value?.sections)
          && JSON.stringify((createResult.snapshot.value.sections[0] as DocumentData | undefined)?.noteIds) === JSON.stringify([note.id]),
        savedMaterialSurvives: materialSnapshot.value?.title === materialValue.title,
        rootLinkPruned: JSON.stringify(materialSnapshot.value?.noteIds) === '[]',
        sectionLinkPruned: JSON.stringify(section?.noteIds) === '[]',
        noteRemainsDeleted: h.read(note).value === null && h.read(note).metadata?.deleted === true,
        deleteAcceptedWithSameIdentity: Boolean(deleteResult && (deleteResult.kind === 'deleted' || deleteResult.kind === 'acknowledged')
          && deleteResult.operationId === deleteCommand?.operationId && h.read(note).metadata?.operationId === deleteCommand?.operationId),
        finalMaterialRequestIsAckOrCollected: !(await h.commits.list('owner')).some(request => request.id === materialRequest.id)
          || (await h.commits.list('owner')).find(request => request.id === materialRequest.id)?.state === 'acknowledged',
        finalDeleteRequestIsAckOrCollected: !(await h.commits.list('owner')).some(request => request.id === deleteRequest.id)
          || (await h.commits.list('owner')).find(request => request.id === deleteRequest.id)?.state === 'acknowledged',
      }).toEqual({
        deleteSentWhileMaterialHeld: false,
        noteStillLiveWhileHeld: true,
        materialCreateAccepted: true,
        savedMaterialSurvives: true,
        rootLinkPruned: true,
        sectionLinkPruned: true,
        noteRemainsDeleted: true,
        deleteAcceptedWithSameIdentity: true,
        finalMaterialRequestIsAckOrCollected: true,
        finalDeleteRequestIsAckOrCollected: true,
      });
    } finally {
      await hold?.release();
      await draining?.catch(() => undefined);
      browser.dispose();
    }
  });

  it('accepts a saved series before deleting its sermon and prunes the series membership', async () => {
    const h = membershipEngineHarness([liveSermon]);
    const browser = h.createBrowser(), engine = browser.engine;
    let hold: ReturnType<typeof holdCreateSend> | undefined;
    let draining: Promise<void> | undefined;
    try {
    engine.setOnline(false); engine.setOwner('owner');
    const editor = await engine.createEditor(series, 'series-before-member-delete');
    await editor.commit(() => seriesValue);
    await engine.retry(); await settleEngine();
    const seriesRequest = (await h.commits.list('owner')).find(request => request.baseline.resource.id === series.id)!;
    const sermonEditor = await engine.openEditor(sermon, 'delete-series-member-sermon');
    await sermonEditor.remove();
    await engine.retry(); await settleEngine();
    const deleteRequest = (await h.commits.list('owner')).find(request => request.baseline.resource.id === sermon.id)!;
    expect(seriesRequest).toMatchObject({ id: expect.any(String), owner: 'owner',
      baseline: { resource: series, value: null, metadata: null }, value: seriesValue, intended: seriesValue });
    expect(deleteRequest).toMatchObject({ id: expect.any(String), owner: 'owner',
      baseline: { resource: sermon, value: sermonValue, metadata: { deleted: false } }, value: null, intended: null });

    const activeHold = holdCreateSend(h, series);
    hold = activeHold;
      engine.setOnline(true);
      draining = engine.retry(); void draining.catch(() => undefined);
      await activeHold.entered; await settleEngine();
      const heldOrder = sendOrder(h);
      const memberDeleteSentWhileSeriesHeld = heldOrder.some(item => item[0] === 'delete' && item[1] === sermon.collection && item[2] === sermon.id);
      const memberStillLiveWhileHeld = h.read(sermon).value !== null;
      await activeHold.release();
      await draining; await engine.retry(); await settleEngine();

      const deleteResult = await deliveredDeleteResult(h, sermon);
      const deleteCommand = jest.mocked(h.transport.send).mock.calls.map(([command]) => command)
        .find(command => command.kind === 'delete' && command.resource.collection === sermon.collection && command.resource.id === sermon.id);
      const createResult = activeHold.result;
      const seriesSnapshot = h.read(series);
      expect({
        memberDeleteSentWhileSeriesHeld,
        memberStillLiveWhileHeld,
        seriesCreateAccepted: createResult?.kind === 'acknowledged' && createResult.operationId === activeHold.command?.operationId
          && JSON.stringify(createResult.snapshot.value?.sermonIds) === JSON.stringify([sermon.id])
          && Array.isArray(createResult.snapshot.value?.items)
          && (createResult.snapshot.value.items as DocumentData[]).some(item => item.refId === sermon.id && item.type === 'sermon'),
        seriesSurvives: seriesSnapshot.value?.title === seriesValue.title,
        itemMembershipPruned: JSON.stringify(seriesSnapshot.value?.items) === '[]',
        sermonIdMirrorPruned: JSON.stringify(seriesSnapshot.value?.sermonIds) === '[]',
        deletedMemberStaysDeleted: h.read(sermon).value === null && h.read(sermon).metadata?.deleted === true,
        deleteAcceptedWithSameIdentity: Boolean(deleteResult && (deleteResult.kind === 'deleted' || deleteResult.kind === 'acknowledged')
          && deleteResult.operationId === deleteCommand?.operationId && h.read(sermon).metadata?.operationId === deleteCommand?.operationId),
        finalSeriesRequestIsAckOrCollected: !(await h.commits.list('owner')).some(request => request.id === seriesRequest.id)
          || (await h.commits.list('owner')).find(request => request.id === seriesRequest.id)?.state === 'acknowledged',
        finalDeleteRequestIsAckOrCollected: !(await h.commits.list('owner')).some(request => request.id === deleteRequest.id)
          || (await h.commits.list('owner')).find(request => request.id === deleteRequest.id)?.state === 'acknowledged',
      }).toEqual({
        memberDeleteSentWhileSeriesHeld: false,
        memberStillLiveWhileHeld: true,
        seriesCreateAccepted: true,
        seriesSurvives: true,
        itemMembershipPruned: true,
        sermonIdMirrorPruned: true,
        deletedMemberStaysDeleted: true,
        deleteAcceptedWithSameIdentity: true,
        finalSeriesRequestIsAckOrCollected: true,
        finalDeleteRequestIsAckOrCollected: true,
      });
    } finally {
      await hold?.release();
      await draining?.catch(() => undefined);
      browser.dispose();
    }
  });
});
