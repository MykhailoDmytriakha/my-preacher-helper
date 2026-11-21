/** @jest-environment node */
import { DeviceWorld } from '@test-utils/deviceWorld';
import { DataSession } from '../../session';
import { describeSync } from '../../status';
import type { ResourceSnapshot } from '../../types';

const resource = { collection: 'groups', id: 'benign-arrival' };
const date = '2026-11-17';
const baseline = { userId: 'owner', title: 'Initial title', description: 'Initial words',
  status: 'draft', templates: [], flow: [], createdAt: date, updatedAt: date };

describe('Independent and equal snapshots in a dirty group editor', () => {
  let world: DeviceWorld;
  afterEach(() => world?.dispose());

  async function open(timed = false) {
    world = new DeviceWorld();
    await world.seed(resource, baseline);
    const desktop = await world.device('desktop');
    const phone = await world.device('phone');
    const editor = await desktop.open(resource);
    await phone.open(resource);
    const shown = editor.getState().checkpoint;
    const local = { ...shown.draft, description: 'Words typed locally' };
    await desktop.run(() => editor.edit(local, shown, { field: 'description', time: timed ? desktop.clock.capture('owner') ?? null : null }));
    const receive = async (field: 'description' | 'title', words: string) => {
      await phone.save(resource, value => ({ ...value, [field]: words }));
      await desktop.refresh(resource);
      return desktop.shown(resource);
    };
    return { desktop, editor, receive };
  }

  it('does not ask when the saved description is exactly the unsent local description', async () => {
    const { receive } = await open();
    const current = await receive('description', 'Words typed locally');
    expect(current.status).toMatchObject({ canKeepLocal: false, canAcceptRemote: false });
    expect(current.confirmed.value?.description).toBe('Words typed locally');
    expect(await world.questions()).toEqual([]);
  });
  it('does not ask when the other device edits only the group name', async () => {
    const { receive, desktop, editor } = await open();
    const captured = editor.getState().checkpoint.groupDescriptionDraft;
    const current = await receive('title', 'Name from phone');
    expect(captured).toBeDefined();
    expect(editor.getState().checkpoint.groupDescriptionDraft).toEqual(captured);
    expect(current.status).toMatchObject({ canKeepLocal: false, canAcceptRemote: false });
    expect(current.draft).toMatchObject({ title: 'Name from phone', description: 'Words typed locally' });
    await desktop.save(resource);
    expect((await world.snapshot(resource)).value).toMatchObject({ title: 'Name from phone', description: 'Words typed locally' });
  });
  it('accepts the third version after an equal arrival and no further local typing', async () => {
    const { receive, editor } = await open();
    await receive('description', 'Words typed locally');
    expect(editor.getState().checkpoint).toMatchObject({ dirty: false, pending: {}, remoteCandidate: null });
    expect(editor.getState().checkpoint.groupDescriptionDraft).toBeUndefined();
    const newest = await receive('description', 'Words typed later on the phone');
    expect(newest.status).toMatchObject({ canKeepLocal: false, canAcceptRemote: false });
    expect(newest.draft?.description).toBe('Words typed later on the phone');
  });
  it('retires only the matching edit while keeping the original opening of a second local field', async () => {
    const { receive, desktop, editor } = await open();
    const shown = editor.getState().checkpoint;
    await desktop.run(() => editor.edit({ ...shown.draft, title: 'Local name' }, shown, {
      field: 'title', time: desktop.clock.capture('owner') ?? null,
    }));
    const title = editor.getState().checkpoint.groupTitleDraft;
    expect(title).toBeDefined();
    await receive('description', 'Words typed locally');
    const later = await receive('description', 'Words typed later on the phone');
    expect(later.draft).toMatchObject({ title: 'Local name', description: 'Words typed later on the phone' });
    expect(later.status).toMatchObject({ phase: 'draft', canKeepLocal: false, canAcceptRemote: false });
    expect(editor.getState().checkpoint.groupTitleDraft).toEqual(title);
    expect(editor.getState().checkpoint.groupDescriptionDraft).toBeUndefined();
  });

  it('uses the matching stored words as the opening for a subsequent undo', async () => {
    const { desktop, editor, receive } = await open(true);
    await receive('description', 'Words typed locally');
    const equal = editor.getState().checkpoint;
    const originalTime = equal.groupDescriptionDraft?.action.time;
    expect(originalTime).toBeTruthy();
    await world.advance(2000);
    const time = desktop.clock.capture('owner') ?? null;
    await desktop.run(() => editor.edit({ ...equal.draft, description: baseline.description }, equal, { field: 'description', time }));
    expect(editor.getState().checkpoint.groupDescriptionDraft?.action).toMatchObject({
      before: { exists: true, value: 'Words typed locally' }, after: { exists: true, value: baseline.description },
      observedRevision: equal.confirmed.metadata!.revision, time,
    });
    await desktop.save(resource);
    expect((await world.snapshot(resource)).value?.description).toBe(baseline.description);
  });

  it('keeps the proven time of matching words against an earlier delayed edit', async () => {
    world = new DeviceWorld();
    await world.seed(resource, baseline);
    const first = await world.device('first');
    const delayed = await world.device('delayed');
    const desktop = await world.device('desktop');
    const words = 'The words chosen again on desktop';
    async function typeOn(device: typeof first, description: string) {
      const editor = await device.open(resource);
      const shown = editor.getState().checkpoint;
      const time = device.clock.capture('owner');
      expect(time).toBeDefined();
      await device.run(() => editor.edit({ ...shown.draft, description }, shown, { field: 'description', time: time ?? null }));
      return editor;
    }
    await typeOn(first, words);
    await world.advance(2000);
    await typeOn(delayed, 'Older different words');
    delayed.goOffline();
    await delayed.save(resource);
    await world.advance(2000);
    const editor = await typeOn(desktop, words);
    const localTime = editor.getState().checkpoint.groupDescriptionDraft?.action.time;
    await first.save(resource);
    await desktop.refresh(resource);
    expect(desktop.shown(resource).status.canKeepLocal).toBe(false);
    expect(editor.getState().checkpoint.groupDescriptionDraft?.action.time).toEqual(localTime);
    await desktop.save(resource);
    expect(editor.getState().checkpoint).toMatchObject({ dirty: false, pending: {}, conflicts: [] });
    await delayed.goOnline();
    expect((await world.snapshot(resource)).value?.description).toBe(words);
    expect(localTime).toBeDefined();
    expect(await world.questions()).toEqual([]);
  });

  it('waits quietly for chronology when a genuinely later edit arrives before the matching write is sent', async () => {
    const { desktop, editor, receive } = await open(true);
    await receive('description', 'Words typed locally');
    const matched = editor.getState().checkpoint.groupDescriptionDraft;
    expect(matched?.action.time).toBeTruthy();
    await world.advance(2000);

    const later = await world.device('later');
    const laterEditor = await later.open(resource);
    const opening = laterEditor.getState().checkpoint;
    const description = 'Words chosen later';
    const time = later.clock.capture('owner');
    expect(time).toBeDefined();
    await later.run(() => laterEditor.edit({ ...opening.draft, description }, opening, { field: 'description', time: time ?? null }));
    await later.save(resource);
    await desktop.refresh(resource);
    expect(desktop.shown(resource).status).toMatchObject({ phase: 'draft', canSave: true, canKeepLocal: false, canAcceptRemote: false });
    expect(editor.getState().checkpoint.groupDescriptionDraft).toEqual(matched);

    await desktop.save(resource);
    expect(desktop.shown(resource).draft?.description).toBe(description);
    expect(editor.getState().checkpoint).toMatchObject({ dirty: false, pending: {}, conflicts: [] });
    expect(await world.questions()).toEqual([]);
  });

  it('offers both choices for actually different versions of the same description', async () => {
    const { receive } = await open();
    const current = await receive('description', 'Competing phone words');
    expect(current.status).toMatchObject({ phase: 'remoteChanged', canKeepLocal: true, canAcceptRemote: true });
    expect(current.draft?.description).toBe('Words typed locally');
    expect(current.remote?.value?.description).toBe('Competing phone words');
  });
});

describe('Observations while a saved group request is still in flight', () => {
  const snapshot = (revision: number, value = baseline): ResourceSnapshot => ({
    resource, value, metadata: { protocol: 1, generation: 'group', revision, deleted: false },
  });
  const local = { ...baseline, description: 'Saved on desktop' };
  const start = () => {
    const editor = new DataSession(snapshot(1));
    editor.edit(local);
    expect(editor.prepare('desktop-save', 'owner')).not.toBeNull();
    return editor;
  };
  const status = (editor: DataSession, received: ResourceSnapshot) => describeSync({
    checkpoint: editor.checkpoint(), durable: true, error: null, result: null,
  }, { snapshot: received, source: 'server', readiness: 'server', checking: false, error: false }, []);

  it.each([local, { ...baseline, title: 'Name from phone' }])(
    'keeps waiting for the actual receipt when a compatible version arrives ($title, $description)', value => {
      const editor = start();
      const submitted = editor.checkpoint().pending;
      const received = snapshot(2, value);
      editor.observe(received, { source: 'server' });
      expect(status(editor, received)).toMatchObject({ phase: 'queued', hasForeignChange: false, canAcceptRemote: false, canKeepLocal: false });
      expect(editor.checkpoint().pending).toEqual(submitted);
      const newest = snapshot(4, { ...local, title: 'Later phone name' });
      editor.observe(newest, { source: 'server' });
      editor.accept({ kind: 'acknowledged', operationId: 'desktop-save', snapshot: snapshot(3, local) });
      expect(editor.checkpoint()).toMatchObject({ confirmed: newest, draft: newest.value, dirty: false, pending: {}, conflicts: [] });
    },
  );

  it('retains an undo made after queuing the original edit across an independent arrival', () => {
    const editor = start();
    editor.edit(baseline);
    const received = snapshot(2, { ...baseline, title: 'Name from phone' });
    editor.observe(received, { source: 'server' });
    expect(status(editor, received)).toMatchObject({ phase: 'queued', hasForeignChange: false });
    const saved = snapshot(3, { ...local, title: 'Name from phone' });
    editor.accept({ kind: 'acknowledged', operationId: 'desktop-save', snapshot: saved });
    expect(editor.checkpoint()).toMatchObject({
      confirmed: saved, draft: { ...baseline, title: 'Name from phone' }, dirty: true, pending: {}, conflicts: [],
    });
  });

  it('keeps a competing update visible while waiting for the saved request', () => {
    const editor = start();
    const received = snapshot(2, { ...baseline, description: 'Different words on phone' });
    editor.observe(received, { source: 'server' });
    expect(status(editor, received)).toMatchObject({ phase: 'remoteChanged', hasForeignChange: true });
    expect(editor.checkpoint().remoteCandidate).toEqual(received);
  });
});

it('does not move a captured edit to a replacement group block with the same ID', () => {
  const block = { id: 'lesson', createdAt: '2026-11-16T00:00:00.000Z', title: 'Original lesson', content: '', status: 'draft' };
  const value = { ...baseline, templates: [block] };
  const snapshot: ResourceSnapshot = { resource, value, metadata: { protocol: 1, generation: 'group', revision: 1, deleted: false } };
  const editor = new DataSession(snapshot);
  const local = { ...block, title: 'Edited lesson' };
  editor.edit({ ...value, templates: [local] }, editor.checkpoint(), { field: 'group-block-title', rowId: block.id, time: null });
  const capture = editor.checkpoint().groupBlockTitleDrafts;
  expect(capture).toBeDefined();
  const stored: ResourceSnapshot = { ...snapshot, metadata: { ...snapshot.metadata!, revision: 2 },
    value: { ...value, templates: [{ ...block, createdAt: '2026-11-20T00:00:00.000Z' }] } };
  editor.observe(stored, { source: 'server' });
  expect(editor.checkpoint()).toMatchObject({ confirmed: snapshot, remoteCandidate: stored, draft: { templates: [local] } });
  expect(editor.checkpoint().groupBlockTitleDrafts).toEqual(capture);
});

it('preserves a real conflict when recording a sermon meets clearing the same preaching day', () => {
  const date = { id: 'date', createdAt: '2026-11-08T00:00:00.000Z', date: '2026-12-13', status: 'planned' };
  const base: ResourceSnapshot = { resource: { collection: 'sermons', id: 'one' },
    value: { userId: 'owner', title: 'Opening', isPreached: false, preachDates: [date] },
    metadata: { protocol: 1, generation: 'sermon', revision: 1, deleted: false } };
  const stored: ResourceSnapshot = { ...base, metadata: { ...base.metadata!, revision: 2 },
    value: { ...base.value, isPreached: true, preachDates: [{ ...date, status: 'preached' }] } };
  const editor = new DataSession(base);
  const draft = { ...base.value, preachDates: [{ ...date, date: '' }] };
  editor.edit(draft);
  editor.observe(stored, { source: 'server' });
  expect(editor.checkpoint()).toMatchObject({ confirmed: base, draft, remoteCandidate: stored });
});
