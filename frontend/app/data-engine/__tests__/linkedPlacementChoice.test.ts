import { replaceSermonOutline } from '@/utils/sermonThoughtEdits';
import { normalizeStructureTag } from '@/utils/structureTags';
import type { Sermon, SermonOutline } from '@/models/models';
import { EditorController } from '../controller';
import { DataEngineRuntime } from '../runtime';
import { applyCommand } from '../protocol';
import { DataSession } from '../session';

import type { DocumentData, Json, JournalEntry, ResourceSnapshot } from '../types';
import type { EditorRecord } from '../controller';

const owner = 'linked-choice-owner';
const point = (id: string, subPoints: Json[] = [], extra: DocumentData = {}): DocumentData => ({ id, text: id, subPoints, ...extra });
const thought = (id: string, extra: DocumentData = {}): DocumentData => ({ id, text: `${id} words`, tags: [], date: '2026-11-01', ...extra });
const outline = (introduction: Json[] = [], main: Json[] = [], conclusion: Json[] = []): DocumentData => ({ introduction, main, conclusion });
const placement = (section: string, ids = ['T']): DocumentData => Object.fromEntries(
  ['introduction', 'main', 'conclusion', 'ambiguous'].map(key => [key, key === section ? ids : []]),
);
const sermon = (extra: DocumentData): DocumentData => ({
  userId: owner, title: 'Linked choice fixture', verse: 'John 3:16', date: '2026-11-01', thoughts: [thought('T')], ...extra,
});
const snapshot = (value: DocumentData, revision = 1, collection = 'sermons'): ResourceSnapshot => ({
  resource: { collection, id: 'linked-placement' }, value,
  metadata: { protocol: 1, generation: 'linked-generation', revision, deleted: false },
});

/** The local and saved alternatives must each be valid before exercising a real refused/conflicting retry. */
function openChoice(base: DocumentData, mine: DocumentData, theirs: DocumentData, collection = 'sermons'): DataSession {
  const session = new DataSession(snapshot(base, 1, collection));
  session.edit(mine);
  session.observe(snapshot(theirs, 2, collection), { source: 'server' });
  const first = session.prepare('original-move', owner)!;
  expect(first).not.toBeNull();
  expect(applyCommand(first, snapshot(base, 1, collection)).kind).toBe('acknowledged');
  const remote = new DataSession(snapshot(base, 1, collection));
  remote.edit(theirs);
  expect(applyCommand(remote.prepare('remote-move', owner)!, snapshot(base, 1, collection)).kind).toBe('acknowledged');
  const result = applyCommand(first, snapshot(theirs, 2, collection));
  expect(['conflict', 'refused']).toContain(result.kind);
  if (result.kind === 'refused') expect(result.code).toBe('invalid-document');
  if (result.kind === 'conflict') expect(result.conflicts.length).toBeGreaterThan(0);
  session.accept(result);
  session.release(first.operationId);
  return session;
}
function chooseAndRetry(base: DocumentData, mine: DocumentData, theirs: DocumentData, collection = 'sermons'): DocumentData {
  const session = DataSession.restore(openChoice(base, mine, theirs, collection).checkpoint());
  session.keepLocal();
  const restored = DataSession.restore(session.checkpoint());
  const retry = restored.prepare('chosen-move', owner)!;
  expect(retry).not.toBeNull();
  const result = applyCommand(retry, snapshot(theirs, 2, collection));
  expect(result.kind).toBe('acknowledged');
  if (result.kind !== 'acknowledged') throw new Error(`The explicit local choice was ${result.kind}`);
  restored.accept(result);
  expect(restored.getState().dirty).toBe(false);
  return result.snapshot.value!;
}
const thoughtsOf = (value: DocumentData) => value.thoughts as DocumentData[];
const namedThought = (value: DocumentData, id = 'T') => thoughtsOf(value).find(item => item.id === id)!;
const copiesIn = (value: DocumentData, field: string, id: string) => Object.values(value[field] as DocumentData)
  .flatMap(list => Array.isArray(list) ? list : []).filter(item => item === id).length;
const outlineNodes = (value: DocumentData, field = 'outline'): DocumentData[] => {
  const groups = value[field] as DocumentData;
  return Object.values(groups).flatMap(list => (list as DocumentData[]).flatMap(item => [item, ...(item.subPoints as DocumentData[] ?? [])]));
};
const linked = (section: string, target: string, text = 'T words'): DocumentData => sermon({
  thoughts: [thought('T', { text, outlinePointId: target })],
  outline: outline([point('A')], [point('B')], [point('C')]),
  structure: placement(section), thoughtsBySection: placement(section),
});

describe('an explicit linked placement choice through a real engine retry', () => {
  it('keeps one section for a legacy thought move without creating a missing alias', () => {
    const base = sermon({ structure: placement('introduction') });
    const mine = sermon({ structure: placement('main') });
    const theirs = sermon({ structure: placement('conclusion') });
    const accepted = chooseAndRetry(base, mine, theirs);
    expect((accepted.structure as DocumentData).main).toEqual(['T']);
    expect(copiesIn(accepted, 'structure', 'T')).toBe(1);
    expect(accepted).not.toHaveProperty('thoughtsBySection');
  });

  it('keeps the chosen point and equal placement aliases without replacing remote thought words', () => {
    const accepted = chooseAndRetry(linked('introduction', 'A'), linked('main', 'B'), linked('conclusion', 'C', 'Remote saved words'));
    expect(namedThought(accepted)).toMatchObject({ outlinePointId: 'B', text: 'Remote saved words' });
    expect(accepted.structure).toEqual(placement('main'));
    expect(accepted.thoughtsBySection).toEqual(accepted.structure);
    expect(copiesIn(accepted, 'structure', 'T')).toBe(1);
  });

  it('keeps a same-section point change coherent when the saved copy moved to a different section', () => {
    const shape = outline([point('A'), point('B')], [], [point('C')]);
    const base = { ...linked('introduction', 'A'), outline: shape };
    const mine = { ...linked('introduction', 'B', 'Local chosen words'), outline: shape };
    const theirs = { ...linked('conclusion', 'C', 'Remote competing words'), outline: shape };
    const accepted = chooseAndRetry(base, mine, theirs);
    expect(namedThought(accepted)).toMatchObject({ outlinePointId: 'B', text: 'Local chosen words' });
    expect(accepted.structure).toEqual(placement('introduction'));
    expect(accepted.thoughtsBySection).toEqual(accepted.structure);
  });

  it.each(['sermons', 'planTemplates'])('keeps a moved subpoint once in %s while retaining its remotely edited words', collection => {
    const sub = { id: 'S', text: 'Opening subpoint', position: 1 };
    const shapes = [outline([point('A', [sub])], [point('B')]),
      outline([point('A')], [point('B', [sub])]),
      outline([point('A'), point('S', [], { text: 'Remote subpoint words' })], [point('B')])];
    const documents = shapes.map(shape => collection === 'sermons' ? sermon({ thoughts: [], outline: shape })
      : { userId: owner, name: 'Plan template', structure: shape });
    const accepted = chooseAndRetry(documents[0], documents[1], documents[2], collection);
    const field = collection === 'sermons' ? 'outline' : 'structure';
    expect(outlineNodes(accepted, field).filter(item => item.id === 'S')).toHaveLength(1);
    const main = (accepted[field] as DocumentData).main as DocumentData[];
    expect((main.find(item => item.id === 'B')!.subPoints as DocumentData[])[0]).toMatchObject({ id: 'S', text: 'Remote subpoint words' });
  });

  it('retains a promoted destination and clears its old subpoint link while keeping remote words', () => {
    const sub = { id: 'S', text: 'Opening destination', position: 1 };
    const base = sermon({ thoughts: [thought('T', { outlinePointId: 'P' })], outline: outline([point('P', [sub])], [], [point('Q')]),
      structure: placement('introduction'), thoughtsBySection: placement('introduction') });
    const mine = sermon({ thoughts: [thought('T', { outlinePointId: 'S', subPointId: null })], outline: outline([point('P')], [], [point('Q'), point('S', [], { text: sub.text })]),
      structure: placement('conclusion'), thoughtsBySection: placement('conclusion') });
    const theirs = sermon({ thoughts: [thought('T', { outlinePointId: 'P', text: 'Remote thought words' })],
      outline: outline([point('P')], [], [point('Q', [{ ...sub, text: 'Remote destination words' }])]),
      structure: placement('introduction'), thoughtsBySection: placement('introduction') });
    const accepted = chooseAndRetry(base, mine, theirs);
    expect(outlineNodes(accepted).filter(item => item.id === 'S')).toHaveLength(1);
    expect(((accepted.outline as DocumentData).conclusion as DocumentData[]).find(item => item.id === 'S')?.text).toBe('Remote destination words');
    expect(namedThought(accepted)).toMatchObject({ outlinePointId: 'S', text: 'Remote thought words' });
    expect(namedThought(accepted).subPointId ?? null).toBeNull();
    expect(accepted.structure).toEqual(placement('conclusion'));
    expect(accepted.thoughtsBySection).toEqual(accepted.structure);
  });

  it('retains the full chosen destination and consumes the selected source while keeping independent new notes', () => {
    const sub = { id: 'Q', text: 'Required child', position: 1 };
    const source = { id: 'N', text: 'Source v0', createdAt: '2026-11-01' };
    const base = sermon({ outline: outline([], [point('P', [sub])]), scratch: [source],
      structure: placement('main'), thoughtsBySection: placement('main') });
    const mine = sermon({ outline: outline([], [point('P', [sub]), point('W', [], { note: 'Source v0' })]), scratch: [],
      thoughts: [thought('T', { outlinePointId: 'P', subPointId: 'Q' })], structure: placement('main'), thoughtsBySection: placement('main') });
    const independent = { id: 'N2', text: 'Independent new source', createdAt: '2026-11-01' };
    const theirs = sermon({ outline: outline(), scratch: [{ ...source, text: 'Source v1' }, independent],
      thoughts: [thought('T', { text: 'Remote thought words' })], structure: placement('main'), thoughtsBySection: placement('main') });
    const accepted = chooseAndRetry(base, mine, theirs);
    expect(outlineNodes(accepted).map(item => item.id).sort()).toEqual(['P', 'Q', 'W']);
    expect(namedThought(accepted)).toMatchObject({ outlinePointId: 'P', subPointId: 'Q', text: 'Remote thought words' });
    expect(accepted.scratch).toEqual([independent]);
    expect(accepted.structure).toEqual(placement('main'));
    expect(accepted.thoughtsBySection).toEqual(accepted.structure);
  });

  it('retains independently added thoughts and words outside the chosen placement', () => {
    const base = linked('introduction', 'A');
    const mine = linked('main', 'B');
    const theirs = linked('conclusion', 'C', 'Remote moving words');
    theirs.thoughts = [...thoughtsOf(theirs), thought('U', { text: 'Remote independent thought' })];
    (theirs.structure as DocumentData).introduction = ['U'];
    (theirs.thoughtsBySection as DocumentData).introduction = ['U'];
    const accepted = chooseAndRetry(base, mine, theirs);
    expect(namedThought(accepted)).toMatchObject({ outlinePointId: 'B', text: 'Remote moving words' });
    expect(namedThought(accepted, 'U').text).toBe('Remote independent thought');
    expect((accepted.structure as DocumentData).introduction).toEqual(['U']);
    expect((accepted.structure as DocumentData).main).toEqual(['T']);
    expect(accepted.thoughtsBySection).toEqual(accepted.structure);
  });

  it('still permits taking the saved alternative without sending the rejected movement', () => {
    const theirs = linked('conclusion', 'C', 'Remote saved words');
    const session = DataSession.restore(openChoice(linked('introduction', 'A'), linked('main', 'B'), theirs).checkpoint());
    session.acceptRemote();
    expect(session.getState().draft).toEqual(theirs);
    expect(session.getState().dirty).toBe(false);
    expect(session.prepare('nothing-to-send', owner)).toBeNull();
  });
  it('keeps an explicit outline removal instead of resurrecting the edited saved outline', () => {
    const base = sermon({ thoughts: [], outline: outline([], [point('P')]) });
    const mine = sermon({ thoughts: [] });
    const theirs = sermon({ thoughts: [], outline: outline([], [point('P', [], { text: 'Remote point words' })]) });
    const accepted = chooseAndRetry(base, mine, theirs);
    expect(accepted).not.toHaveProperty('outline');
  });

  it('keeps an explicit thought deletion and clears both placement aliases', () => {
    const base = linked('introduction', 'A');
    const mine = { ...base, thoughts: [], structure: placement('main', []), thoughtsBySection: placement('main', []) };
    const accepted = chooseAndRetry(base, mine, linked('conclusion', 'C', 'Remote moving words'));
    expect(accepted.thoughts).toEqual([]);
    expect(accepted.structure).toEqual(placement('main', []));
    expect(accepted.thoughtsBySection).toEqual(accepted.structure);
  });

  it('does not let the earlier choice overwrite an unknown later move', () => {
    const theirs = linked('conclusion', 'C', 'Remote saved words');
    const session = openChoice(linked('introduction', 'A'), linked('main', 'B'), theirs);
    session.keepLocal();
    const retry = session.prepare('chosen-before-later-move', owner)!;
    expect(retry).not.toBeNull();
    const later = linked('introduction', 'A', 'Later saved words');
    const result = applyCommand(retry, snapshot(later, 3));
    expect(result.kind).toBe('conflict');
    if (result.kind === 'conflict') expect(result.snapshot.value).toEqual(later);
  });

  it('keeps an amended form placement coherent through the durable controller and actual retry', async () => {
    const base = linked('introduction', 'A');
    const parentMine = linked('introduction', 'A', 'Parent chosen words');
    const remote = linked('conclusion', 'C', 'Remote competing words');
    let server = snapshot(remote, 2);
    let record: EditorRecord = { owner, editorId: 'amended-linked-form',
      checkpoint: openChoice(base, parentMine, remote).checkpoint(), prepared: null, unfinalized: [] };
    const entries = new Map<string, JournalEntry>();
    const runtime = new DataEngineRuntime({
      journal: {
        list: async () => [...entries.values()],
        put: async entry => { entries.set(entry.command.operationId, JSON.parse(JSON.stringify(entry))); },
        remove: async (_owner, id) => { entries.delete(id); },
      },
      transport: {
        read: async () => server,
        send: async command => { const result = applyCommand(command, server); if (result.kind === 'acknowledged') server = result.snapshot; return result; },
      },
    });
    runtime.setOwner(owner);
    const editor = await EditorController.open({ owner, editorId: record.editorId, snapshot: snapshot(base), runtime,
      store: { read: async () => record, put: async value => { record = JSON.parse(JSON.stringify(value)); } },
      operationId: () => 'amended-placement-save', isCurrentOwner: candidate => candidate === owner });
    try {
      const selection = [['thoughts'], ['structure'], ['thoughtsBySection'], ['outline']];
      await editor.keepLocal(selection, { base, value: linked('main', 'B', 'Stage chosen words') });
      await editor.save(undefined, selection);
      await runtime.drain(); await editor.settled();
      expect(editor.getState().result?.kind).toBe('acknowledged');
      expect(namedThought(server.value!)).toMatchObject({ outlinePointId: 'B', text: 'Stage chosen words' });
      expect(server.value!.structure).toEqual(placement('main'));
      expect(server.value!.thoughtsBySection).toEqual(server.value!.structure);
      expect(record.checkpoint.dirty).toBe(false);
    } finally { editor.dispose(); runtime.setOwner(null); }
  });

  it('does not treat a reordered neighbor as a local move when only the other device moved it', () => {
    const shape = outline([point('A')], [point('B')], [point('C')]);
    const t = thought('T', { outlinePointId: 'A', position: 1 });
    const u = thought('U', { outlinePointId: 'A', position: 2 });
    const base = sermon({ thoughts: [t, u], outline: shape,
      structure: placement('introduction', ['T', 'U']), thoughtsBySection: placement('introduction', ['T', 'U']) });
    const mine = sermon({ thoughts: [{ ...t, text: 'Local T words', position: 3 }, u], outline: shape,
      structure: placement('introduction', ['U', 'T']), thoughtsBySection: placement('introduction', ['U', 'T']) });
    const savedPlacement = { ...placement('introduction'), conclusion: ['U'] };
    const theirs = sermon({ thoughts: [{ ...t, text: 'Remote T words' }, { ...u, outlinePointId: 'C', position: 1000, text: 'Remote U words' }],
      outline: shape, structure: savedPlacement, thoughtsBySection: savedPlacement });
    const accepted = chooseAndRetry(base, mine, theirs);
    expect(namedThought(accepted)).toMatchObject({ outlinePointId: 'A', position: 3, text: 'Local T words' });
    expect(namedThought(accepted, 'U')).toMatchObject({ outlinePointId: 'C', position: 1000, text: 'Remote U words' });
    expect(accepted.structure).toEqual(savedPlacement);
    expect(accepted.thoughtsBySection).toEqual(accepted.structure);
  });

  it('keeps one legacy section marker beside independently edited custom tags after an outline move', () => {
    const base = sermon({ thoughts: [thought('T', { outlinePointId: 'P', tags: ['intro', 'custom'] })],
      outline: outline([point('P')]), structure: placement('introduction'), thoughtsBySection: placement('introduction') });
    const mine = replaceSermonOutline(base as unknown as Sermon,
      outline([], [point('P')]) as unknown as SermonOutline) as unknown as DocumentData;
    const remoteBase = { ...base, thoughts: [thought('T', { outlinePointId: 'P', tags: ['intro', 'custom', 'remoteCustom'] })] };
    const theirs = replaceSermonOutline(remoteBase as unknown as Sermon,
      outline([], [], [point('P')]) as unknown as SermonOutline) as unknown as DocumentData;
    const accepted = chooseAndRetry(base, mine, theirs);
    const tags = namedThought(accepted).tags as string[];
    expect(tags.filter(tag => normalizeStructureTag(tag))).toEqual(['main']);
    expect(tags).toEqual(expect.arrayContaining(['custom', 'remoteCustom']));
    expect(accepted.structure).toEqual(placement('main'));
    expect(accepted.thoughtsBySection).toEqual(accepted.structure);
  });

});
