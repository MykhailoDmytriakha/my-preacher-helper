import { prepareDomainCommand, requiredDomainTargets } from '../domainPolicy';
import { DataSession } from '../session';

import type { DocumentData, ResourceSnapshot } from '../types';

const snap = (collection: string, id: string, value: DocumentData | null, generation: string | null = 'g'): ResourceSnapshot => ({ resource: { collection, id }, value, metadata: generation ? { protocol: 1, generation, revision: 3, deleted: value === null } : null });
const material = () => snap('studyMaterials', 'm', { userId: 'owner', title: 'Original title', noteIds: ['a'], sections: [{ id: 's', title: 'Section', noteIds: ['a'] }] });
const note = (id: string, generation = `generation-${id}`) => snap('studyNotes', id, { userId: 'owner', content: id }, generation);
const item = { id: 'sermon-a', type: 'sermon', refId: 'a', position: 1 };

describe('Domain command preparation', () => {
  it('keeps create/update/delete envelopes and the exact delete baseline inside the engine', () => {
    const absent = snap('studyNotes', 'n', null, null);
    expect(prepareDomainCommand('owner', 'create', absent, { content: 'new' }).command).toMatchObject({ kind: 'create', generation: null, value: { content: 'new' } });
    const initial = note('n');
    expect(prepareDomainCommand('owner', 'update', initial, { ...initial.value, content: 'edit' }).command).toMatchObject({ kind: 'update', changes: [{ before: { value: 'n' }, after: { value: 'edit' } }] });
    const deletion = prepareDomainCommand('owner', 'delete', initial, null);
    expect(deletion.command).toMatchObject({ kind: 'delete', generation: 'generation-n', baseline: initial.value });
    expect(deletion.submittedValue).toBeNull();
    expect(() => prepareDomainCommand('owner', 'recreate', snap('studyNotes', 'n', null), { content: 'new' })).toThrow('new copy');
  });

  it('derives exact material generations and projects only membership so its ACK retains unsent text and server section cleanup', () => {
    const initial = material(), draft = { ...initial.value!, title: 'Unsent title', noteIds: ['b'] };
    expect(requiredDomainTargets(initial, draft)).toEqual([{ collection: 'studyNotes', id: 'a' }, { collection: 'studyNotes', id: 'b' }]);
    const session = new DataSession(initial); session.edit(draft);
    const command = session.prepare('membership', 'owner', [note('a'), note('b')]);
    expect(command).toMatchObject({ kind: 'relation', relation: 'material-notes', beforeNoteIds: ['a'], afterNoteIds: ['b'], targets: [{ id: 'a', generation: 'generation-a' }, { id: 'b', generation: 'generation-b' }] });
    expect(session.checkpoint().pending.membership.value).toEqual({ ...initial.value, noteIds: ['b'] });
    session.accept({ kind: 'acknowledged', operationId: 'membership', snapshot: { ...initial, value: { ...initial.value, noteIds: ['b'], sections: [{ id: 's', title: 'Section', noteIds: [] }] }, metadata: { ...initial.metadata!, revision: 4 } } });
    expect(session.checkpoint()).toMatchObject({ dirty: true, draft: { title: 'Unsent title', noteIds: ['b'], sections: [{ id: 's', noteIds: [] }] } });
    expect(session.prepare('text', 'owner')).toMatchObject({ kind: 'update', changes: [{ path: ['title'], before: { value: 'Original title' }, after: { value: 'Unsent title' } }] });
  });

  it('rejects missing, deleted or foreign targets and permits an explicitly confirmed legacy generation', () => {
    const initial = material(), draft = { ...initial.value!, noteIds: [] };
    expect(() => prepareDomainCommand('owner', 'op', initial, draft)).toThrow('confirmed target');
    expect(() => prepareDomainCommand('owner', 'op', initial, draft, [snap('studyNotes', 'a', null)])).toThrow('deleted');
    expect(() => prepareDomainCommand('owner', 'op', initial, draft, [snap('studyNotes', 'a', { userId: 'other' })])).toThrow('another owner');
    const prepared = prepareDomainCommand('owner', 'op', initial, draft, [{ ...note('a'), metadata: null }]);
    expect(prepared.command).toMatchObject({ targets: [{ id: 'a', generation: null }] });
    expect(requiredDomainTargets(initial, initial.value)).toEqual([]);
    expect(requiredDomainTargets(initial, null)).toEqual([]);
    expect(() => requiredDomainTargets(initial, { noteIds: 'bad' })).toThrow('Invalid membership');
  });

  it('routes series items through membership, preserves unsent metadata, and lets an explicit empty list clear a legacy mirror', () => {
    const initial = snap('series', 's', { userId: 'owner', title: 'Original', items: [], sermonIds: ['a'], seriesKind: 'sermon' });
    const session = new DataSession(initial); session.edit({ ...initial.value!, title: 'Unsent', items: [item] });
    const command = session.prepare('items', 'owner');
    expect(command).toMatchObject({ kind: 'relation', relation: 'series-membership', edits: [{ generation: 'g', beforeItems: [item], afterItems: [item] }] });
    expect(session.checkpoint().pending.items.value?.title).toBe('Original');
    const populated = { ...initial, value: { ...initial.value!, items: [item] } };
    expect(prepareDomainCommand('owner', 'clear', populated, { ...populated.value, items: [] }).command).toMatchObject({ edits: [{ beforeItems: [item], afterItems: [] }] });
    const noItems: DocumentData = { ...populated.value }; delete noItems.items;
    expect(prepareDomainCommand('owner', 'remove-field', populated, noItems).command).toMatchObject({ edits: [{ afterItems: [] }] });
  });

  it('does not independently write derived or reverse fields and excludes isDraft from an ordinary note change', () => {
    for (const [collection, field] of [['studyNotes', 'materialIds'], ['sermons', 'seriesId'], ['groups', 'seriesPosition']]) {
      const initial = snap(collection, 'id', { [field]: null });
      expect(() => prepareDomainCommand('owner', 'op', initial, { [field]: 'changed' })).toThrow('membership');
    }
    for (const field of ['sermonIds', 'seriesKind']) expect(() => prepareDomainCommand('owner', 'op', snap('series', 's', {}), { [field]: [] })).toThrow('derived');
    expect(() => prepareDomainCommand('owner', 'op', note('a'), { ...note('a').value, isDraft: true })).toThrow('derived');
    expect(prepareDomainCommand('owner', 'op', note('a'), { ...note('a').value, content: 'new', isDraft: true }).command).toMatchObject({ changes: [{ path: ['content'] }] });
    for (const [collection, value] of [['studyNotes', { materialIds: ['m'] }], ['sermons', { seriesId: 's' }], ['groups', { seriesPosition: 1 }]] as [string, DocumentData][]) {
      expect(() => prepareDomainCommand('owner', 'op', snap(collection, 'new', null, null), value)).toThrow('membership');
    }
  });

  it('validates malformed list inputs and does not prepare over a changed confirmed baseline', () => {
    const initial = snap('series', 's', { sermonIds: ['a'] });
    expect(() => prepareDomainCommand('owner', 'op', initial, { items: 'bad' })).toThrow('Invalid series items');
    const session = new DataSession(note('a')); session.edit({ ...note('a').value, content: 'draft' }); const captured = session.checkpoint();
    captured.confirmed.metadata!.revision = 1;
    expect(() => session.prepare('op', 'owner', [], captured)).toThrow('baseline changed');
    expect(session.checkpoint().pending).toEqual({});
  });
});
