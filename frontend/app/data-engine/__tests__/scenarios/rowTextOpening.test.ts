/** @jest-environment node */
import { DeviceWorld } from '@test-utils/deviceWorld';

import type { RowFieldStamp } from '../../rowFieldAutosave';
import type { DocumentData } from '../../types';

const beginning = 'Opening words';
const arrived = 'Words added on the phone';
const typed = 'Words typed in the editor';
const day = '2026-11-12';
const shared = { userId: 'owner', title: 'Example', createdAt: day, updatedAt: day };
type Surface = {
  name: string;
  collection: string;
  root: 'templates' | 'topics' | 'flow';
  leaf: 'content' | 'summary' | 'instanceNotes';
  action: RowFieldStamp['field'];
  value: DocumentData;
};
const surfaces: Surface[] = [
  { name: 'group block content', collection: 'groups', root: 'templates', leaf: 'content', action: 'group-block-content',
    value: { ...shared, status: 'draft', templates: [{ id: 'target', type: 'topic', title: 'Block', status: 'draft',
      content: beginning, createdAt: day, updatedAt: day }], flow: [] } },
  { name: 'group step notes', collection: 'groups', root: 'flow', leaf: 'instanceNotes', action: 'group-step-notes',
    value: { ...shared, status: 'draft', templates: [{ id: 'block', type: 'topic', title: 'Block', status: 'draft',
      content: 'Independent block content', createdAt: day, updatedAt: day }],
    flow: [{ id: 'target', templateId: 'block', order: 1, durationMin: 10, instanceNotes: beginning }] } },
  { name: 'council topic summary', collection: 'councils', root: 'topics', leaf: 'summary', action: 'council-topic-summary',
    value: { ...shared, status: 'preparing', date: day, topics: [{ id: 'target', title: 'Topic', summary: beginning, questions: [], options: [] }] } },
];

describe.each(surfaces)('$name and a received version ahead of the editor', surface => {
  let world: DeviceWorld;
  afterEach(() => world?.dispose());
  const resource = { collection: surface.collection, id: 'shown-text' };
  const path = [surface.root, 'id:target', surface.leaf];
  const words = (value: DocumentData | null) => (value?.[surface.root] as DocumentData[] | undefined)?.[0]?.[surface.leaf];
  const update = (value: DocumentData | null, text: string): DocumentData => ({
    ...value, [surface.root]: (value?.[surface.root] as DocumentData[]).map(row =>
      row.id === 'target' ? { ...row, [surface.leaf]: text } : row),
  });

  async function open(incoming = arrived, seed = surface.value) {
    world = new DeviceWorld();
    await world.seed(resource, seed);
    const phone = await world.device('phone');
    const desktop = await world.device('desktop');
    const phoneEditor = await phone.open(resource);
    const editor = await desktop.open(resource);
    const displayed = editor.getState().checkpoint;

    const saveOnPhone = async (text: string) => {
      const opening = phoneEditor.getState().checkpoint;
      const time = phone.clock.capture('owner');
      expect(time).toBeDefined();
      await phone.run(() => phoneEditor.edit({ ...update(opening.draft, text), title: 'Title from the phone' },
        opening, { field: surface.action, rowId: 'target', time: time ?? null }));
      await phone.save(resource);
    };
    await saveOnPhone(incoming);
    expect(words((await world.snapshot(resource)).value)).toBe(incoming);
    await world.advance(1_000);
    const refresh = () => desktop.refresh(resource);
    const edit = (text: string, shown = displayed) => desktop.run(() => editor.edit(
      update(editor.getState().checkpoint.draft, text), shown, { field: surface.action, rowId: 'target', time: desktop.clock.capture('owner')! }));
    const save = () => desktop.save(resource);
    return { editor, desktop, refresh, edit, save, displayed, saveOnPhone };
  }

  it('does not use a later keypress to overwrite words received but never shown', async () => {
    const { editor, refresh, edit, save, displayed } = await open();
    await refresh();
    expect(words(editor.getState().checkpoint.confirmed.value)).toBe(arrived);
    expect(words(displayed.draft)).toBe(beginning);
    await edit(typed);
    await save();
    expect(words((await world.snapshot(resource)).value)).toBe(arrived);
    expect(words(editor.getState().checkpoint.draft)).toBe(typed);
    expect(editor.getState().checkpoint.conflicts).toEqual([expect.objectContaining({ path,
      base: { exists: true, value: beginning }, mine: { exists: true, value: typed }, theirs: { exists: true, value: arrived },
    })]);
  });

  it('drops only a local edit undone before the first save', async () => {
    const { editor, refresh, edit, save } = await open();
    await refresh();
    await edit(typed);
    await edit(beginning, editor.getState().checkpoint);
    await save();
    expect(words((await world.snapshot(resource)).value)).toBe(arrived);
    expect(words(editor.getState().checkpoint.draft)).toBe(arrived);
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
  });

  it('keeps the arrival when undoing typing that happened to match it', async () => {
    const { editor, refresh, edit, save } = await open();
    await refresh();
    await edit(arrived);
    await edit(beginning, editor.getState().checkpoint);
    await save();
    expect(words((await world.snapshot(resource)).value)).toBe(arrived);
    expect(words(editor.getState().checkpoint.draft)).toBe(arrived);
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
  });

  it('keeps a newer field when the editor emits its unchanged opening', async () => {
    const { editor, refresh, edit, save } = await open();
    await refresh();
    await edit(beginning);
    await save();
    expect(words((await world.snapshot(resource)).value)).toBe(arrived);
    expect(words(editor.getState().checkpoint.draft)).toBe(arrived);
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
  });

  it('keeps the whole local draft when typing continues before the first save', async () => {
    const { editor, refresh, edit, save } = await open();
    await refresh();
    await edit(typed);
    const latest = typed + ' and continued';
    await edit(latest, editor.getState().checkpoint);
    await save();
    expect(words((await world.snapshot(resource)).value)).toBe(arrived);
    expect(editor.getState().checkpoint.conflicts).toEqual([expect.objectContaining({ path,
      mine: { exists: true, value: latest }, theirs: { exists: true, value: arrived },
    })]);
  });

  it('keeps the newer stored edit when delivery of the older keypress is delayed', async () => {
    const { editor, desktop, refresh, edit, save, saveOnPhone } = await open();
    await refresh();
    desktop.goOffline();
    await edit(typed);
    await save();
    await world.advance(1_000);
    const newer = 'A third version written after the keypress';
    await saveOnPhone(newer);
    await desktop.goOnline();
    expect(words((await world.snapshot(resource)).value)).toBe(newer);
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
  });

  it('keeps the displayed opening when a different local field was edited meanwhile', async () => {
    const { editor, desktop, refresh, edit, save } = await open();
    await refresh();
    const received = editor.getState().checkpoint;
    await desktop.run(() => editor.edit({ ...received.draft, title: 'Independent desktop title' }, received));
    await edit(typed);
    await save();
    expect(words((await world.snapshot(resource)).value)).toBe(arrived);
    expect(editor.getState().checkpoint.draft?.title).toBe('Independent desktop title');
    expect(editor.getState().checkpoint.conflicts).toEqual([expect.objectContaining({ path })]);
  });

  it('saves with no comparison if the phone changed only the title', async () => {
    const { editor, refresh, edit, save } = await open(beginning);
    await refresh();
    await edit(typed);
    await save();
    expect((await world.snapshot(resource)).value).toMatchObject({
      title: 'Title from the phone', [surface.root]: [expect.objectContaining({ [surface.leaf]: typed })],
    });
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
  });

  it('does not compare two identical outcomes', async () => {
    const { editor, refresh, edit, save } = await open();
    await refresh();
    await edit(arrived);
    await save();
    expect(words((await world.snapshot(resource)).value)).toBe(arrived);
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
  });

  it('recovers the original opening, incoming revision and real time after closing and reopening', async () => {
    const { editor, desktop, refresh, edit, displayed } = await open();
    await refresh();
    const revision = editor.getState().checkpoint.confirmed.metadata?.revision;
    await edit(typed);
    await desktop.leave(resource, false);
    await desktop.reload();
    const candidates = await desktop.run(() => desktop.engine.listRecoverable(resource));
    const checkpoint = candidates.find(candidate => words(candidate.record.checkpoint.draft) === typed)?.record.checkpoint;
    const action = (checkpoint?.groupBlockContentDrafts ?? checkpoint?.groupStepNotesDrafts ?? checkpoint?.councilTopicSummaryDrafts)?.target.action;
    expect(action).toMatchObject({ before: beginning, after: typed, unseenRevision: revision,
      observedRevision: displayed.confirmed.metadata?.revision, time: { earliestMs: expect.any(Number), latestMs: expect.any(Number) } });
    expect(words((await world.snapshot(resource)).value)).toBe(arrived);
  });

  if (surface.leaf === 'summary') {
    it('keeps typing uninterrupted when an absent summary becomes an empty string', async () => {
      const seed = { ...surface.value, topics: [{ id: 'target', title: 'Topic', questions: [], options: [] }] };
      const { editor, refresh, edit, save } = await open('', seed);
      await refresh();
      await edit(typed);
      await save();
      expect(words((await world.snapshot(resource)).value)).toBe(typed);
      expect(editor.getState().checkpoint.conflicts).toEqual([]);
    });
  }

  it('continues to accept a chronologically later edit when no new copy had arrived on this device', async () => {
    const { editor, edit, save } = await open();
    expect(words(editor.getState().checkpoint.confirmed.value)).toBe(beginning);
    await edit(typed);
    await save();
    expect(words((await world.snapshot(resource)).value)).toBe(typed);
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
  });
});
