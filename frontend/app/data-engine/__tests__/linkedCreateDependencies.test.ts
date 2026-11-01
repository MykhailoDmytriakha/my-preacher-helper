import { membershipEngineHarness } from '@test-utils/membershipEngineHarness';
import { settleEngine } from '@test-utils/documentEngineHarness';

import type { DataCommand, DocumentData, ResourceRef, ResourceSnapshot } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const source: ResourceRef = { collection: 'studyNotes', id: 'offline-source-note' };
const sermon: ResourceRef = { collection: 'sermons', id: 'offline-linked-sermon' };
const material: ResourceRef = { collection: 'studyMaterials', id: 'offline-linked-material' };
const existingSermon: ResourceRef = { collection: 'sermons', id: 'existing-sermon' };
const targetSeries: ResourceRef = { collection: 'series', id: 'target-series' };
const sourceValue: DocumentData = {
  userId: 'owner', title: 'Offline source', content: 'Words authored in the source note', scriptureRefs: [], tags: [], isDraft: false,
  createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z', type: 'note',
};
const existingMaterial: ResourceRef = { collection: 'studyMaterials', id: 'existing-material' };
const existingMaterialValue: DocumentData = { userId: 'owner', title: 'Existing study', type: 'study', noteIds: [], createdAt: '2026-10-30', updatedAt: '2026-10-30' };
const sermonValue: DocumentData = {
  userId: 'owner', title: 'Offline sermon', verse: 'John 3:16', date: '2026-10-31', thoughts: [], sourceNoteIds: [source.id],
  scratch: [{ id: 'source-scratch', text: 'Words copied from the source', createdAt: '2026-10-31', source: { noteId: source.id, heading: 'Offline source' } }],
};
const existingValue: DocumentData = { userId: 'owner', title: 'Existing sermon', verse: 'John 3:16', date: '2026-10-30', thoughts: [], sourceNoteIds: [] };
const prepPath = ['preparation', 'mainIdea', 'contextIdea'] as const;

function holdSourceCreate(h: ReturnType<typeof membershipEngineHarness>) {
  return holdCreateFor(h, source);
}

function holdCreateFor(h: ReturnType<typeof membershipEngineHarness>, resource: ResourceRef) {
  return holdCommandFor(h, resource, 'create');
}

function holdUpdateFor(h: ReturnType<typeof membershipEngineHarness>, resource: ResourceRef) {
  return holdCommandFor(h, resource, 'update');
}

function holdCommandFor(h: ReturnType<typeof membershipEngineHarness>, resource: ResourceRef, kind: 'create' | 'update') {
  const send = jest.mocked(h.transport.send);
  const realSend = send.getMockImplementation()!;
  let command: DataCommand | undefined;
  let finish!: (result: Awaited<ReturnType<typeof realSend>>) => void;
  const response = new Promise<Awaited<ReturnType<typeof realSend>>>(resolve => { finish = resolve; });
  let released = false;
  send.mockImplementation(async current => {
    if (current.kind === kind && current.resource.collection === resource.collection && current.resource.id === resource.id) {
      command = current;
      return response;
    }
    return realSend(current);
  });
  return {
    get command() { return command; },
    get released() { return released; },
    async release() {
      if (!command || released) return;
      const result = await realSend(command);
      released = true;
      finish(result);
      await settleEngine();
    },
  };
}

function liveSeries(): ResourceSnapshot {
  return { resource: targetSeries, value: { userId: 'owner', title: 'Target series', theme: 'Theme', bookOrTopic: 'Romans', status: 'draft', items: [], sermonIds: [], seriesKind: 'sermon', createdAt: '2026-10-31', updatedAt: '2026-10-31' },
    metadata: { protocol: 1, generation: 'target-series-generation', revision: 1, deleted: false } };
}

const pendingGroup: ResourceRef = { collection: 'groups', id: 'pending-group' };
const pendingGroupValue: DocumentData = { userId: 'owner', title: 'Pending group', status: 'draft', templates: [], flow: [], createdAt: '2026-10-31', updatedAt: '2026-10-31' };
const pendingSermon: ResourceRef = { collection: 'sermons', id: 'pending-series-sermon' };
const pendingSermonValue: DocumentData = { userId: 'owner', title: 'Pending sermon', verse: 'Romans 1', date: '2026-10-31', thoughts: [] };
const seriesWithMember = (resource: ResourceRef, type: 'sermon' | 'group', position = 1): DocumentData => ({
  userId: 'owner', title: 'Series with pending member', theme: 'Theme', bookOrTopic: 'Romans', status: 'draft',
  items: [{ id: `${type}-${resource.id}`, type, refId: resource.id, position }],
  sermonIds: type === 'sermon' ? [resource.id] : [], seriesKind: type, createdAt: '2026-10-31', updatedAt: '2026-10-31',
});

async function offlineSourceAndSermon() {
  const h = membershipEngineHarness([]);
  const browser = h.createBrowser();
  const engine = browser.engine;
  engine.setOnline(false); engine.setOwner('owner');
  const sourceEditor = await engine.createEditor(source, 'offline-source');
  await sourceEditor.commit(() => sourceValue);
  const sermonEditor = await engine.createEditor(sermon, 'offline-sermon');
  await sermonEditor.commit(() => sermonValue);
  const form = sermonEditor.form('prep-mainIdea-contextIdea', [prepPath]);
  await form.begin();
  await form.update(current => ({ ...current, preparation: { mainIdea: { contextIdea: 'Words saved by the later manual preparation action' } } }));
  await form.save();
  await engine.retry(); await settleEngine();
  return { h, browser, engine, sourceEditor, sermonEditor, form };
}

describe('Offline linked creates', () => {
  it('waits for the authored source create before delivering a sermon create and later manual preparation save', async () => {
    const s = await offlineSourceAndSermon();
    const hold = holdSourceCreate(s.h);
    let draining: Promise<void> | undefined;
    try {
      const saved = await s.h.commits.list('owner');
      expect(saved.filter(request => request.state === 'queued' || request.state === 'prepared')).toHaveLength(3);
      expect(s.h.transport.send).not.toHaveBeenCalled();

      s.engine.setOnline(true);
      draining = s.engine.retry(); void draining.catch(() => undefined); await settleEngine();
      expect(hold.command).toMatchObject({ kind: 'create', resource: source });
      expect(jest.mocked(s.h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([source]);
      expect(s.h.read(source).value).toBeNull();
      expect(s.h.read(sermon).value).toBeNull();

      await hold.release();
      await s.engine.retry(); await settleEngine();
      expect(s.h.read(source).value).toMatchObject({ content: 'Words authored in the source note' });
      expect(s.h.read(sermon).value).toMatchObject({
        sourceNoteIds: [source.id],
        scratch: [{ id: 'source-scratch', source: { noteId: source.id }, text: 'Words copied from the source' }],
        preparation: { mainIdea: { contextIdea: 'Words saved by the later manual preparation action' } },
      });
      expect(jest.mocked(s.h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create', 'create', 'update']);
      expect((await s.h.commits.list('owner')).filter(request => request.state !== 'acknowledged')).toEqual([]);
    } finally {
      await hold.release();
      await draining?.catch(() => undefined);
      s.browser.dispose();
    }
  });

  it('waits before creating study material that names a pending source note', async () => {
    const h = membershipEngineHarness([]);
    const browser = h.createBrowser(), engine = browser.engine;
    const hold = holdSourceCreate(h);
    let draining: Promise<void> | undefined;
    try {
      engine.setOnline(false); engine.setOwner('owner');
      const note = await engine.createEditor(source, 'material-source'); await note.commit(() => sourceValue);
      const doc = await engine.createEditor(material, 'material');
      await doc.commit(() => ({ userId: 'owner', title: 'Linked material', type: 'study', noteIds: [source.id], createdAt: '2026-10-31', updatedAt: '2026-10-31' }));
      await engine.retry(); await settleEngine();
      expect((await h.commits.list('owner')).filter(request => ['queued', 'prepared'].includes(request.state))).toHaveLength(2);

      engine.setOnline(true); draining = engine.retry(); void draining.catch(() => undefined); await settleEngine();
      expect(hold.command).toMatchObject({ kind: 'create', resource: source });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([source]);
      expect(h.read(material).value).toBeNull();

      await hold.release(); await engine.retry(); await settleEngine();
      expect(h.read(material).value).toMatchObject({ noteIds: [source.id] });
      expect(h.read(source).value).toMatchObject({ materialIds: [material.id] });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create', 'create']);
    } finally { await hold.release(); await draining?.catch(() => undefined); browser.dispose(); }
  });

  it('keeps an existing material noteIds update pending until the separately created note is accepted', async () => {
    const h = membershipEngineHarness([
      { resource: existingMaterial, value: existingMaterialValue, metadata: { protocol: 1, generation: 'existing-material', revision: 1, deleted: false } },
    ]);
    const browser = h.createBrowser(), engine = browser.engine;
    const hold = holdSourceCreate(h);
    let draining: Promise<void> | undefined;
    try {
      engine.setOnline(false); engine.setOwner('owner');
      const note = await engine.createEditor(source, 'existing-material-source'); await note.commit(() => sourceValue);
      const editor = await engine.openEditor(existingMaterial, 'existing-material-editor');
      await editor.commit(current => ({ ...current!, noteIds: [source.id] }));
      await engine.retry().catch(() => undefined); await settleEngine();
      const offlineRequest = (await h.commits.list('owner')).find(request => request.baseline.resource.id === existingMaterial.id)!;
      expect(offlineRequest.state).toEqual(expect.stringMatching(/^(queued|prepared)$/));

      engine.setOnline(true); draining = engine.retry(); void draining.catch(() => undefined); await settleEngine();
      expect(hold.command).toMatchObject({ kind: 'create', resource: source });
      const materialRequest = (await h.commits.list('owner')).find(request => request.baseline.resource.id === existingMaterial.id)!;
      expect(materialRequest.state).toEqual(expect.stringMatching(/^(queued|prepared)$/));
      expect(materialRequest.result).toBeNull();
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([source]);
      expect(h.read(existingMaterial).value).toEqual(existingMaterialValue);

      await hold.release(); await draining; await engine.retry(); await settleEngine();
      expect(h.read(existingMaterial).value).toMatchObject({ noteIds: [source.id] });
      expect(h.read(source).value).toMatchObject({ materialIds: [existingMaterial.id] });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create', 'relation']);
    } finally { await hold.release(); await draining?.catch(() => undefined); browser.dispose(); }
  });

  it('waits before linking an existing sermon to a pending source note', async () => {
    const h = membershipEngineHarness([{ resource: existingSermon, value: existingValue, metadata: { protocol: 1, generation: 'existing-sermon', revision: 1, deleted: false } }]);
    const browser = h.createBrowser(), engine = browser.engine;
    const hold = holdSourceCreate(h);
    let draining: Promise<void> | undefined;
    try {
      engine.setOnline(false); engine.setOwner('owner');
      const note = await engine.createEditor(source, 'existing-sermon-source'); await note.commit(() => sourceValue);
      const editor = await engine.openEditor(existingSermon, 'existing-sermon-editor');
      await editor.commit(current => ({ ...current!, sourceNoteIds: [source.id], scratch: [{ id: 'linked-scratch', text: 'Existing sermon source words', createdAt: '2026-10-31', source: { noteId: source.id, heading: 'Offline source' } }] }));
      await engine.retry(); await settleEngine();
      engine.setOnline(true); draining = engine.retry(); void draining.catch(() => undefined); await settleEngine();
      expect(hold.command).toMatchObject({ kind: 'create', resource: source });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([source]);
      expect(h.read(existingSermon).value).toEqual(existingValue);

      await hold.release(); await engine.retry(); await settleEngine();
      expect(h.read(existingSermon).value).toMatchObject({ sourceNoteIds: [source.id], scratch: [{ source: { noteId: source.id } }] });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create', 'update']);
    } finally { await hold.release(); await draining?.catch(() => undefined); browser.dispose(); }
  });

  it('replays source and linked sermon creates in dependency order after browser replacement', async () => {
    const h = membershipEngineHarness([]);
    let browser = h.createBrowser();
    const hold = holdSourceCreate(h);
    let draining: Promise<void> | undefined;
    try {
      browser.engine.setOnline(false); browser.engine.setOwner('owner');
      const note = await browser.engine.createEditor(source, 'restart-source'); await note.commit(() => sourceValue);
      const doc = await browser.engine.createEditor(sermon, 'restart-sermon'); await doc.commit(() => sermonValue);
      await browser.engine.retry(); await settleEngine();
      browser.dispose(); await settleEngine();
      browser = h.createBrowser(); browser.engine.setOnline(false); browser.engine.setOwner('owner');
      await browser.engine.openEditor(source, 'reopened-source');
      await browser.engine.openEditor(sermon, 'reopened-sermon');
      await browser.engine.retry(); await settleEngine();
      browser.engine.setOnline(true); draining = browser.engine.retry(); void draining.catch(() => undefined); await settleEngine();
      expect(hold.command).toMatchObject({ kind: 'create', resource: source });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([source]);
      await hold.release(); await browser.engine.retry(); await settleEngine();
      expect(h.read(sermon).value).toMatchObject({ sourceNoteIds: [source.id], scratch: [{ source: { noteId: source.id } }] });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create', 'create']);
    } finally { await hold.release(); await draining?.catch(() => undefined); browser.dispose(); }
  });

  it.each([
    { resource: pendingSermon, type: 'sermon' as const, value: pendingSermonValue },
    { resource: pendingGroup, type: 'group' as const, value: pendingGroupValue },
  ])('waits to create a series that initially includes a separately pending $type', async ({ resource, type, value }) => {
    const h = membershipEngineHarness([]);
    const browser = h.createBrowser(), engine = browser.engine;
    const hold = holdCreateFor(h, resource);
    let draining: Promise<void> | undefined;
    try {
      engine.setOnline(false); engine.setOwner('owner');
      const member = await engine.createEditor(resource, `${type}-before-series`); await member.commit(() => value);
      const createdSeries = await engine.createEditor(targetSeries, 'series-initial-members');
      await createdSeries.commit(() => seriesWithMember(resource, type));
      await engine.retry(); await settleEngine();
      expect((await h.commits.list('owner')).filter(request => ['queued', 'prepared'].includes(request.state))).toHaveLength(2);

      engine.setOnline(true); draining = engine.retry(); void draining.catch(() => undefined); await settleEngine();
      expect(hold.command).toMatchObject({ kind: 'create', resource });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([resource]);
      expect(h.read(targetSeries).value).toBeNull();

      await hold.release(); await draining; await engine.retry(); await settleEngine();
      expect(h.read(targetSeries).value).toMatchObject({ items: [{ type, refId: resource.id }] });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create', 'create']);
    } finally { await hold.release(); await draining?.catch(() => undefined); browser.dispose(); }
  });

  it.each([
    { resource: pendingSermon, type: 'sermon' as const, value: pendingSermonValue },
    { resource: pendingGroup, type: 'group' as const, value: pendingGroupValue },
  ])('waits to update series membership for a separately pending $type', async ({ resource, type, value }) => {
    const h = membershipEngineHarness([liveSeries()]);
    const browser = h.createBrowser(), engine = browser.engine;
    const hold = holdCreateFor(h, resource);
    let draining: Promise<void> | undefined;
    try {
      engine.setOwner('owner');
      const selection = await engine.beginMembership();
      engine.setOnline(false);
      const member = await engine.createEditor(resource, `${type}-before-series-link`); await member.commit(() => value);
      await selection.update({ kind: 'assign', targetId: targetSeries.id, refs: [{ type, refId: resource.id }] });
      expect(await selection.save()).toHaveLength(1);
      await engine.retry(); await settleEngine();
      expect((await h.commits.list('owner')).filter(request => ['queued', 'prepared'].includes(request.state))).toHaveLength(2);

      engine.setOnline(true); draining = engine.retry(); void draining.catch(() => undefined); await settleEngine();
      expect(hold.command).toMatchObject({ kind: 'create', resource });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([resource]);
      expect(h.read(targetSeries).value?.items).toEqual([]);

      await hold.release(); await draining; await engine.retry(); await settleEngine();
      expect(h.read(targetSeries).value).toMatchObject({ items: [{ type, refId: resource.id }] });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create', 'relation']);
    } finally { await hold.release(); await draining?.catch(() => undefined); browser.dispose(); }
  });

  it('waits before atomic series member creation when its sermon cites a separately pending note', async () => {
    const h = membershipEngineHarness([liveSeries()]);
    const browser = h.createBrowser(), engine = browser.engine;
    const hold = holdSourceCreate(h);
    let draining: Promise<void> | undefined;
    try {
      engine.setOwner('owner');
      const note = await engine.createEditor(source, 'atomic-member-source'); await note.commit(() => sourceValue);
      const draft = { ...pendingSermonValue, sourceNoteIds: [source.id], scratch: [{ id: 'atomic-source-scratch', text: 'Atomic sermon source words', createdAt: '2026-10-31', source: { noteId: source.id, heading: 'Offline source' } }] };
      const creation = await engine.beginMemberCreation('sermons', draft);
      await engine.openCreationSeries(creation.getState().record.scopeId);
      engine.setOnline(false);
      await creation.update({ kind: 'assign', targetId: targetSeries.id, refs: [{ type: 'sermon', refId: creation.getState().record.creation!.resource.id }] });
      expect(await creation.save()).toHaveLength(2);
      await engine.retry(); await settleEngine();
      expect((await h.commits.list('owner')).filter(request => ['queued', 'prepared'].includes(request.state))).toHaveLength(3);

      engine.setOnline(true); draining = engine.retry(); void draining.catch(() => undefined); await settleEngine();
      expect(hold.command).toMatchObject({ kind: 'create', resource: source });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([source]);

      await hold.release(); await draining; await engine.retry(); await settleEngine();
      const created = creation.getState().record.creation!.resource;
      expect(h.read(created).value).toMatchObject({ sourceNoteIds: [source.id], scratch: [{ source: { noteId: source.id } }] });
      expect(h.read(targetSeries).value).toMatchObject({ items: [{ type: 'sermon', refId: created.id }] });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.kind)).toEqual(['create', 'relation']);
    } finally { await hold.release(); await draining?.catch(() => undefined); browser.dispose(); }
  });

  it('does not wait when a newly created sermon links an already accepted live source', async () => {
    const h = membershipEngineHarness([{ resource: source, value: sourceValue, metadata: { protocol: 1, generation: 'accepted-source', revision: 1, deleted: false } }]);
    const browser = h.createBrowser(), engine = browser.engine;
    try {
      engine.setOnline(false); engine.setOwner('owner');
      const editor = await engine.createEditor(sermon, 'live-source-sermon'); await editor.commit(() => sermonValue);
      engine.setOnline(true); await engine.retry(); await settleEngine();
      expect(h.read(sermon).value).toMatchObject({ sourceNoteIds: [source.id] });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([sermon]);
      expect((await h.commits.list('owner')).filter(request => request.state !== 'acknowledged')).toEqual([]);
    } finally { browser.dispose(); }
  });

  it('still refuses a genuinely missing source note', async () => {
    const h = membershipEngineHarness([]);
    const browser = h.createBrowser(), engine = browser.engine;
    try {
      engine.setOwner('owner');
      const editor = await engine.createEditor(sermon, 'missing-source-sermon');
      await editor.commit(() => ({ ...sermonValue, sourceNoteIds: ['actually-missing'], scratch: [{ id: 'missing-scratch', text: 'Retain the honest refusal', createdAt: '2026-10-31', source: { noteId: 'actually-missing', heading: 'Missing' } }] }));
      engine.setOnline(true); await engine.retry(); await settleEngine();
      const [request] = await h.commits.list('owner');
      expect(request.state).toBe('refused');
      expect(request.result).toMatchObject({ kind: 'refused', code: 'referenced-document-deleted' });
      expect(h.read(sermon).value).toBeNull();
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([sermon]);
    } finally { browser.dispose(); }
  });

  it('does not block a new linked sermon or unrelated sermon update behind a pending ordinary source-note update', async () => {
    const initialNote: ResourceSnapshot = { resource: source, value: sourceValue,
      metadata: { protocol: 1, generation: 'accepted-source', revision: 1, deleted: false } };
    const initialSermon: ResourceSnapshot = { resource: existingSermon, value: { ...existingValue, sourceNoteIds: [source.id] },
      metadata: { protocol: 1, generation: 'accepted-sermon', revision: 1, deleted: false } };
    const h = membershipEngineHarness([initialNote, initialSermon]);
    const browser = h.createBrowser(), engine = browser.engine;
    const hold = holdUpdateFor(h, source);
    let draining: Promise<void> | undefined;
    try {
      engine.setOnline(false); engine.setOwner('owner');
      const note = await engine.openEditor(source, 'ordinary-source-update');
      await note.commit(current => ({ ...current!, content: 'An ordinary source update is still pending' }));
      const doc = await engine.openEditor(existingSermon, 'independent-sermon-update');
      await doc.commit(current => ({ ...current!, title: 'Independent sermon edit' }));
      const newDoc = await engine.createEditor(sermon, 'linked-sermon-during-source-update');
      await newDoc.commit(() => sermonValue);
      await engine.retry(); await settleEngine();

      engine.setOnline(true); draining = engine.retry(); void draining.catch(() => undefined); await settleEngine();
      expect(hold.command).toMatchObject({ kind: 'update', resource: source });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([source, existingSermon, sermon]);
      expect(h.read(source).value?.content).toBe(sourceValue.content);
      expect(h.read(existingSermon).value?.title).toBe('Independent sermon edit');
      expect(h.read(sermon).value).toMatchObject({ sourceNoteIds: [source.id] });

      await hold.release(); await draining; await engine.retry(); await settleEngine();
      expect(h.read(source).value?.content).toBe('An ordinary source update is still pending');
    } finally { await hold.release(); await draining?.catch(() => undefined); browser.dispose(); }
  });

  it('does not treat the same ID in another collection as a pending note dependency', async () => {
    const wrongCollection = { collection: 'studyMaterials', id: source.id };
    const h = membershipEngineHarness([]);
    const browser = h.createBrowser(), engine = browser.engine;
    const hold = holdCreateFor(h, wrongCollection);
    let draining: Promise<void> | undefined;
    try {
      engine.setOnline(false); engine.setOwner('owner');
      const unrelated = await engine.createEditor(wrongCollection, 'same-id-wrong-collection');
      await unrelated.commit(() => ({ userId: 'owner', title: 'Same ID, other collection', type: 'study', noteIds: [], createdAt: '2026-10-31', updatedAt: '2026-10-31' }));
      const doc = await engine.createEditor(sermon, 'same-id-note-reference');
      await doc.commit(() => ({ ...sermonValue, sourceNoteIds: [source.id], scratch: [{ id: 'wrong-collection-scratch', text: 'The note itself is missing', createdAt: '2026-10-31', source: { noteId: source.id, heading: 'Missing note' } }] }));
      await engine.retry(); await settleEngine();

      engine.setOnline(true); draining = engine.retry(); void draining.catch(() => undefined); await settleEngine();
      expect(hold.command).toMatchObject({ kind: 'create', resource: wrongCollection });
      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([wrongCollection, sermon]);
      await hold.release(); await draining; await engine.retry(); await settleEngine();
      const sermonRequest = (await h.commits.list('owner')).find(request => request.baseline.resource.id === sermon.id)!;
      expect(sermonRequest.result).toMatchObject({ kind: 'refused', code: 'referenced-document-deleted' });
    } finally { await hold.release(); await draining?.catch(() => undefined); browser.dispose(); }
  });

  it('does not treat another owner’s pending note create as this owner’s dependency', async () => {
    const h = membershipEngineHarness([]);
    const browser = h.createBrowser(), engine = browser.engine;
    try {
      engine.setOnline(false); engine.setOwner('other-owner');
      const foreign = await engine.createEditor(source, 'foreign-pending-note');
      await foreign.commit(() => ({ ...sourceValue, userId: 'other-owner' }));
      await engine.retry(); await settleEngine();

      engine.setOwner('owner');
      const doc = await engine.createEditor(sermon, 'other-owner-note-reference');
      await doc.commit(() => ({ ...sermonValue, sourceNoteIds: [source.id], scratch: [{ id: 'foreign-note-scratch', text: 'Other owner note', createdAt: '2026-10-31', source: { noteId: source.id, heading: 'Foreign note' } }] }));
      await engine.retry(); await settleEngine();
      engine.setOnline(true); await engine.retry(); await settleEngine();

      expect(jest.mocked(h.transport.send).mock.calls.map(([command]) => command.resource)).toEqual([sermon]);
      const requests = await h.commits.list('owner');
      expect(requests.find(request => request.baseline.resource.id === sermon.id)?.result)
        .toMatchObject({ kind: 'refused', code: 'referenced-document-deleted' });
      expect(h.read(source).value).toBeNull();
    } finally { browser.dispose(); }
  });
});

it('waits for every pending source while unrelated saved documents continue independently', async () => {
  const secondSource: ResourceRef = { collection: 'studyNotes', id: 'second-offline-source' };
  const unrelated: ResourceRef = { collection: 'studyNotes', id: 'unrelated-offline-note' };
  const h = membershipEngineHarness([]), browser = h.createBrowser(), engine = browser.engine;
  const hold = holdCreateFor(h, secondSource);
  let draining: Promise<void> | undefined;
  engine.setOnline(false); engine.setOwner('owner');
  try {
    for (const resource of [source, secondSource, unrelated]) {
      const editor = await engine.createEditor(resource, `multi-source-${resource.id}`);
      await editor.commit(() => ({ ...sourceValue, title: resource.id }));
    }
    const editor = await engine.createEditor(sermon, 'two-source-consumer');
    await editor.commit(() => ({ ...sermonValue, sourceNoteIds: [source.id, secondSource.id], scratch: [
      ...(sermonValue.scratch as DocumentData[]), { id: 'second-copy', text: 'Second source words', createdAt: 'now', source: { noteId: secondSource.id, heading: 'Second source' } },
    ] }));
    await engine.retry(); await settleEngine();
    engine.setOnline(true); draining = engine.retry(); void draining.catch(() => undefined);
    for (let turn = 0; turn < 100 && (!h.read(source).value || !h.read(unrelated).value); turn += 1) await settleEngine();
    expect(hold.command).toMatchObject({ kind: 'create', resource: secondSource });
    expect(h.read(source).value?.title).toBe(source.id);
    expect(h.read(unrelated).value?.title).toBe(unrelated.id);
    expect(h.read(secondSource).value).toBeNull();
    expect(h.read(sermon).value).toBeNull();
    expect(jest.mocked(h.transport.send).mock.calls.some(([command]) => command.resource.id === sermon.id)).toBe(false);
    await hold.release(); await draining; await engine.retry(); await settleEngine();
    expect(h.read(sermon).value).toMatchObject({ sourceNoteIds: [source.id, secondSource.id] });
    expect(jest.mocked(h.transport.send).mock.calls.filter(([command]) => command.resource.id === sermon.id)).toHaveLength(1);
    expect((await h.commits.list('owner')).every(request => request.state === 'acknowledged')).toBe(true);
  } finally { await hold.release(); await draining?.catch(() => undefined); browser.dispose(); }
});
