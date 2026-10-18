/** @jest-environment node */
import { carriedCopy } from '@/data-engine/councilCarryContent';
import { planDataCommand } from '@/data-engine/serverRelations';

import type { RelationReader } from '@/data-engine/serverRelations';
import type { DataCommand, DocumentData, ResourceSnapshot } from '@/data-engine/types';

const owner = 'owner';
const records = new Map<string, ResourceSnapshot>();
const reads: string[] = [];
const key = (collection: string, id: string) => `${collection}/${id}`;
const put = (collection: string, id: string, value: DocumentData): ResourceSnapshot => {
  const snapshot = { resource: { collection, id }, value: { userId: owner, ...value }, metadata: null };
  records.set(key(collection, id), snapshot);
  return snapshot;
};
const reader: RelationReader = {
  get: async resource => {
    reads.push(key(resource.collection, resource.id));
    return records.get(key(resource.collection, resource.id)) ?? { resource, value: null, metadata: null };
  },
  list: async (collection, limit, filter, select?: (snapshot: ResourceSnapshot) => boolean) => [...records.values()]
    .filter(snapshot => snapshot.resource.collection === collection && snapshot.value?.[collection === 'studyNoteShareLinks' ? 'ownerId' : 'userId'] === owner)
    .filter(snapshot => !filter || (filter.operator === 'array-contains' ? Array.isArray(snapshot.value?.[filter.field]) && (snapshot.value![filter.field] as string[]).includes(filter.value) : snapshot.value?.[filter.field] === filter.value))
    .filter(snapshot => !select || select(snapshot))
    .slice(0, limit),
};
const commandBase = (snapshot: ResourceSnapshot) => ({ protocol: 1 as const, owner, operationId: 'operation', resource: snapshot.resource, generation: snapshot.metadata?.generation ?? null, dependsOn: [] });
const remove = (snapshot: ResourceSnapshot): DataCommand => ({ ...commandBase(snapshot), kind: 'delete', baseline: snapshot.value! });
const item = (id = 'sermon', extra: DocumentData = {}): DocumentData => ({ id: `item-${id}`, type: 'sermon', refId: id, position: 1, ...extra });
const series = (id: string, items: DocumentData[]) => put('series', id, { title: 'Keep title', items, sermonIds: items.filter(item => item.type === 'sermon').map(item => item.refId), seriesKind: 'sermon' });
const materialCommand = (material: ResourceSnapshot, before: string[], after: string[]): DataCommand => ({ ...commandBase(material), kind: 'relation', relation: 'material-notes', beforeNoteIds: before, afterNoteIds: after, targets: [...new Set([...before, ...after])].map(id => ({ id, generation: null })) });
const changed = (writes: ResourceSnapshot[], collection: string, id: string) => writes.find(write => write.resource.collection === collection && write.resource.id === id)!;

beforeEach(() => { records.clear(); reads.length = 0; });

describe('registered transactional relation planning', () => {
  it('changes material membership and both reverse links while preserving independent note text', async () => {
    const material = put('studyMaterials', 'm', { noteIds: ['n1'], sections: [{ id: 'section', title: 'Keep section', noteIds: ['n1'], connector: 'Keep words' }] });
    put('studyNotes', 'n1', { content: 'First text', materialIds: ['m', 'other'] });
    put('studyNotes', 'n2', { content: 'Second text', materialIds: ['elsewhere'] });
    const plan = await planDataCommand(materialCommand(material, ['n1'], ['n2']), material, reader);
    expect(plan.result.kind).toBe('acknowledged');
    expect(plan.writes).toHaveLength(3);
    expect(changed(plan.writes, 'studyMaterials', 'm').value).toMatchObject({ noteIds: ['n2'], sections: [{ id: 'section', title: 'Keep section', noteIds: [], connector: 'Keep words' }] });
    expect(changed(plan.writes, 'studyNotes', 'n1').value).toMatchObject({ content: 'First text', materialIds: ['other'], rev: { note: 1 } });
    expect(changed(plan.writes, 'studyNotes', 'n2').value).toMatchObject({ content: 'Second text', materialIds: ['elsewhere', 'm'] });
    expect(plan.result).toMatchObject({ affected: expect.arrayContaining([{ resource: { collection: 'studyNotes', id: 'n1' }, metadata: expect.objectContaining({ operationId: 'operation', revision: 1 }) }]) });
  });

  it('preserves a concurrent untouched material member instead of replacing a stale array', async () => {
    const material = put('studyMaterials', 'm', { noteIds: ['n1', 'remote'] });
    put('studyNotes', 'n1', { materialIds: ['m'] });
    put('studyNotes', 'n2', { materialIds: [] });
    put('studyNotes', 'remote', { materialIds: ['m'] });
    const plan = await planDataCommand(materialCommand(material, ['n1'], ['n2']), material, reader);
    expect(plan.result.kind).toBe('acknowledged');
    expect(changed(plan.writes, 'studyMaterials', 'm').value?.noteIds).toEqual(expect.arrayContaining(['n2', 'remote']));
    expect(plan.writes.some(write => write.resource.id === 'remote')).toBe(false);
  });

  it('refuses undeclared generations, foreign targets, and deleted targets without partial effects', async () => {
    const material = put('studyMaterials', 'm', { noteIds: [] });
    const command = materialCommand(material, [], ['n']);
    put('studyNotes', 'n', { materialIds: [] });
    const missing = { ...command, targets: [] } as DataCommand;
    expect(await planDataCommand(missing, material, reader)).toMatchObject({ result: { kind: 'refused', code: 'missing-target-generation' }, writes: [] });
    put('studyNotes', 'n', { userId: 'victim', content: 'Secret', materialIds: [] });
    expect(await planDataCommand(command, material, reader)).toMatchObject({ result: { kind: 'refused', code: 'permission-denied' }, writes: [] });
    records.set('studyNotes/n', { resource: { collection: 'studyNotes', id: 'n' }, value: null, metadata: { protocol: 1, generation: 'old', revision: 2, deleted: true } });
    expect(await planDataCommand(command, material, reader)).toMatchObject({ result: { kind: 'refused', code: 'referenced-document-deleted' }, writes: [] });
  });

  it('atomically moves a series member and reads its target before allowing an attachment', async () => {
    const first = series('first', [item()]);
    const second = series('second', []);
    put('sermons', 'sermon', { title: 'Target' });
    const command: DataCommand = { ...commandBase(first), kind: 'relation', relation: 'series-membership', edits: [
      { resource: first.resource, generation: null, beforeItems: [item()], afterItems: [] },
      { resource: second.resource, generation: null, beforeItems: [], afterItems: [item()] },
    ] };
    const plan = await planDataCommand(command, first, reader);
    expect(plan.result.kind).toBe('acknowledged');
    expect(plan.writes).toHaveLength(2);
    expect(changed(plan.writes, 'series', 'first').value).toMatchObject({ items: [], sermonIds: [], title: 'Keep title', rev: { items: 1 } });
    expect(changed(plan.writes, 'series', 'second').value).toMatchObject({ items: [item()], sermonIds: ['sermon'], title: 'Keep title' });
    expect(reads).toContain('sermons/sermon');
  });

  it('returns one conflict without an earlier participant effect when a later series conflicts', async () => {
    const first = series('first', []);
    const second = series('second', [item('target', { plannedDate: 'remote' })]);
    put('sermons', 'added', {});
    const command: DataCommand = { ...commandBase(first), kind: 'relation', relation: 'series-membership', edits: [
      { resource: first.resource, generation: null, beforeItems: [], afterItems: [item('added')] },
      { resource: second.resource, generation: null, beforeItems: [item('target', { plannedDate: 'before' })], afterItems: [item('target', { plannedDate: 'mine' })] },
    ] };
    expect(await planDataCommand(command, first, reader)).toMatchObject({ result: { kind: 'conflict' }, writes: [] });
    expect(records.get('series/first')?.value?.items).toEqual([]);
  });

  it('refuses stale participant generations and duplicate reference identities', async () => {
    const first = series('first', []);
    const command: DataCommand = { ...commandBase(first), kind: 'relation', relation: 'series-membership', edits: [{ resource: first.resource, generation: 'stale', beforeItems: [], afterItems: [item()] }] };
    expect(await planDataCommand(command, first, reader)).toMatchObject({ result: { code: 'generation-mismatch' }, writes: [] });
    command.edits[0].generation = null;
    command.edits[0].afterItems = [item(), item('sermon', { id: 'another-id' })];
    expect(await planDataCommand(command, first, reader)).toMatchObject({ result: { code: 'duplicate-membership' }, writes: [] });
  });

  it('creates a material and its initial reverse links in one plan', async () => {
    const primary: ResourceSnapshot = { resource: { collection: 'studyMaterials', id: 'm' }, value: null, metadata: null };
    put('studyNotes', 'n', { materialIds: [] });
    const command: DataCommand = { ...commandBase(primary), kind: 'create', value: { title: 'Material', type: 'study', noteIds: ['n'], createdAt: 'now', updatedAt: 'now' } };
    const plan = await planDataCommand(command, primary, reader);
    expect(plan.result.kind).toBe('acknowledged');
    expect(plan.writes).toHaveLength(2);
    expect(changed(plan.writes, 'studyNotes', 'n').value?.materialIds).toEqual(['m']);
  });

  it('derives initial series mirrors from validated member references', async () => {
    const primary: ResourceSnapshot = { resource: { collection: 'series', id: 'new' }, value: null, metadata: null };
    put('sermons', 'sermon', {});
    const command: DataCommand = { ...commandBase(primary), kind: 'create', value: { theme: '', bookOrTopic: '', status: 'draft', createdAt: 'now', updatedAt: 'now', items: [item()] } };
    const plan = await planDataCommand(command, primary, reader);
    expect(plan.result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { sermonIds: ['sermon'], seriesKind: 'sermon' } } });
    expect(reads).toContain('sermons/sermon');
  });

  it.each([['series', 'items'], ['series', 'sermonIds'], ['studyMaterials', 'noteIds'], ['studyNotes', 'materialIds'], ['studyNotes', 'isDraft'], ['sermons', 'seriesId'], ['groups', 'seriesPosition']])('refuses generic writes of derived %s.%s', async (collection, field) => {
    const primary = put(collection, 'p', {});
    const command: DataCommand = { ...commandBase(primary), kind: 'update', changes: [{ path: [field], before: { exists: false }, after: { exists: true, value: [] } }] };
    expect(await planDataCommand(command, primary, reader)).toMatchObject({ result: { code: 'relation-command-required' }, writes: [] });
  });

  it('derives draft state from the accepted note tags and references', async () => {
    const primary = put('studyNotes', 'n', { tags: [], scriptureRefs: [{ id: 'ref', book: 'John' }], isDraft: true });
    const command: DataCommand = { ...commandBase(primary), kind: 'update', changes: [{ path: ['tags'], before: { exists: true, value: [] }, after: { exists: true, value: ['tag'] } }] };
    const plan = await planDataCommand(command, primary, reader);
    expect(plan.result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { isDraft: false, rev: { note: 1 } }, metadata: { revision: 1 } } });
  });

  it.each(['sermons', 'groups'])('deletes %s and removes only that reference from current owner series', async collection => {
    const primary = put(collection, 'target', { title: 'Delete me' });
    const target = item('target', { type: collection === 'sermons' ? 'sermon' : 'group' });
    series('s', [target, item('keep', { position: 2 })]);
    put('series', 'foreign', { userId: 'victim', items: [target] });
    const plan = await planDataCommand(remove(primary), primary, reader);
    expect(plan.result).toMatchObject({ kind: 'acknowledged', snapshot: { value: null, metadata: { deleted: true } } });
    expect(changed(plan.writes, 'series', 's').value?.sermonIds).toEqual(['keep']);
    expect(plan.writes.some(write => write.resource.id === 'foreign')).toBe(false);
  });

  it('removes a deleted note from root and section memberships without changing section text', async () => {
    const primary = put('studyNotes', 'n', { content: 'Delete' });
    put('studyMaterials', 'm', { noteIds: ['n', 'keep'], sections: [{ id: 's', title: 'Keep words', noteIds: ['n', 'keep'] }] });
    const plan = await planDataCommand(remove(primary), primary, reader);
    expect(plan.result.kind).toBe('acknowledged');
    expect(changed(plan.writes, 'studyMaterials', 'm').value).toMatchObject({ noteIds: ['keep'], sections: [{ title: 'Keep words', noteIds: ['keep'] }] });
  });

  it('removes a deleted material from owned note reverse references', async () => {
    const primary = put('studyMaterials', 'm', { noteIds: ['n'] });
    put('studyNotes', 'n', { content: 'Keep words', materialIds: ['m', 'other'] });
    const plan = await planDataCommand(remove(primary), primary, reader);
    expect(changed(plan.writes, 'studyNotes', 'n').value).toMatchObject({ content: 'Keep words', materialIds: ['other'] });
  });

  it('cleans historical reverse-only memberships when deleting a material', async () => {
    const primary = put('studyMaterials', 'm', { noteIds: [] });
    put('studyNotes', 'orphan', { materialIds: ['m', 'keep'] });
    const plan = await planDataCommand(remove(primary), primary, reader);
    expect(plan.result.kind).toBe('acknowledged');
    expect(changed(plan.writes, 'studyNotes', 'orphan').value?.materialIds).toEqual(['keep']);
  });

  it.each([
    ['studyNotes', { materialIds: ['m'] }], ['sermons', { seriesId: 's' }], ['groups', { seriesPosition: 1 }],
  ] as Array<[string, DocumentData]>)('refuses initial derived %s links outside their authoritative relation', async (collection, value) => {
    const primary: ResourceSnapshot = { resource: { collection, id: 'new' }, value: null, metadata: null };
    const command: DataCommand = { ...commandBase(primary), kind: 'create', value };
    expect(await planDataCommand(command, primary, reader)).toMatchObject({ result: { code: 'relation-command-required' }, writes: [] });
  });

  it('refuses invalid section references without writing a valid root membership', async () => {
    const primary = put('studyMaterials', 'm', { noteIds: [], sections: [{ id: 's', title: '', noteIds: ['not-a-member'] }] });
    expect(await planDataCommand(materialCommand(primary, [], []), primary, reader)).toMatchObject({ result: { code: 'invalid-material-section-membership' }, writes: [] });
  });

  it('keeps the generation of an unchanged relation while recording the new operation proof', async () => {
    const primary = put('studyMaterials', 'm', { noteIds: [] });
    primary.metadata = { protocol: 1, generation: 'old', revision: 4, deleted: false };
    const plan = await planDataCommand(materialCommand(primary, [], []), primary, reader);
    expect(plan.result).toMatchObject({ kind: 'acknowledged', snapshot: { metadata: { generation: 'old', revision: 5, operationId: 'operation' } } });
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].value?.noteIds).toEqual([]);
  });

  it('gives an unchanged legacy relation a durable generation and rejects a mismatched primary resource', async () => {
    const primary = put('studyMaterials', 'm', { noteIds: [] });
    const command = materialCommand(primary, [], []);
    expect(await planDataCommand(command, primary, reader)).toMatchObject({ result: { kind: 'acknowledged', snapshot: { metadata: { generation: 'operation' } } }, writes: [expect.anything()] });
    expect(await planDataCommand({ ...command, resource: { collection: 'studyMaterials', id: 'other' } }, primary, reader)).toMatchObject({ result: { code: 'resource-mismatch' }, writes: [] });
  });

  it('clears only legacy backreferences still pointing at the deleted series', async () => {
    const primary = series('s', []);
    put('sermons', 'same', { title: 'Sermon', seriesId: 's', seriesPosition: 1 });
    put('groups', 'same', { title: 'Group', seriesId: 's', seriesPosition: 2 });
    put('sermons', 'moved', { seriesId: 'another', seriesPosition: 4 });
    const plan = await planDataCommand(remove(primary), primary, reader);
    expect(plan.writes).toHaveLength(3);
    expect(changed(plan.writes, 'sermons', 'same').value).toMatchObject({ seriesId: null, seriesPosition: null });
    expect(plan.writes.some(write => write.resource.id === 'moved')).toBe(false);
  });

  it('refuses oversized cascades entirely instead of deleting with partial cleanup', async () => {
    const primary = put('groups', 'g', {});
    for (let index = 0; index < 101; index++) series(`series-${index}`, [item('g', { type: 'group' })]);
    expect(await planDataCommand(remove(primary), primary, reader)).toMatchObject({ result: { code: 'relation-scope-too-large' }, writes: [] });
  });

  it('retires share links with the deleted note while retaining only tombstone metadata', async () => {
    const primary = put('studyNotes', 'n', { content: 'Shared' });
    put('studyNoteShareLinks', 'link', { ownerId: owner, noteId: 'n', token: 'Public token' });
    put('studyNoteShareLinks', 'foreign', { ownerId: 'victim', noteId: 'n', token: 'Private token' });
    const plan = await planDataCommand(remove(primary), primary, reader);
    expect(plan.result.kind).toBe('acknowledged');
    expect(changed(plan.writes, 'studyNoteShareLinks', 'link')).toMatchObject({ value: null, metadata: { deleted: true, operationId: 'operation' } });
    expect(plan.writes.some(write => write.resource.id === 'foreign')).toBe(false);
  });

  it('deletes a custom tag in its own transaction; the thoughts are cleaned after the commit', async () => {
    const tag = put('tags', 't', { name: 'Remove', required: false });
    put('sermons', 's', { thoughts: [{ id: 'thought', text: 'Words', date: 'now', tags: ['Remove', 'keep'] }], title: 'Keep title' });
    const plan = await planDataCommand(remove(tag), tag, reader);
    expect(plan.result.kind).toBe('acknowledged');
    // Only the tag: removeTagFromSermons (serverEdit.server.ts) cleans the sermons afterwards.
    expect(plan.writes.map(write => write.resource)).toEqual([{ collection: 'tags', id: 't' }]);
  });

  it.each([{ name: 'Custom', required: true }, { name: 'Main part', required: false }, { name: 'Основна частина', required: false }])('refuses deleting required structure tag %j', async value => {
    const tag = put('tags', 't', value);
    expect(await planDataCommand(remove(tag), tag, reader)).toMatchObject({ result: { code: 'required-tag' }, writes: [] });
  });

  it('deletes a tag however many sermons the owner has', async () => {
    const tag = put('tags', 't', { name: 'Remove', required: false });
    for (let index = 0; index < 300; index++) put('sermons', `s-${index}`, { thoughts: [] });
    expect(await planDataCommand(remove(tag), tag, reader)).toMatchObject({ result: { kind: 'acknowledged' } });
  });

  it('requires the delete baseline even when a registered cascade would otherwise succeed', async () => {
    const primary = put('sermons', 's', { title: 'New text' });
    const command: DataCommand = { ...remove(primary), kind: 'delete', baseline: { userId: owner, title: 'Old text' } };
    expect(await planDataCommand(command, primary, reader)).toMatchObject({ result: { kind: 'conflict' }, writes: [] });
  });

  it('validates ownership and liveness of newly assigned sermon provenance in the transaction', async () => {
    const primary = put('sermons', 's', { sourceNoteIds: [] });
    const command: DataCommand = { ...commandBase(primary), kind: 'update', changes: [{ path: ['sourceNoteIds'], before: { exists: true, value: [] }, after: { exists: true, value: ['n'] } }] };
    expect(await planDataCommand(command, primary, reader)).toMatchObject({ result: { code: 'referenced-document-deleted' }, writes: [] });
    put('studyNotes', 'n', { userId: 'victim', title: 'Private' });
    expect(await planDataCommand(command, primary, reader)).toMatchObject({ result: { code: 'permission-denied' }, writes: [] });
    put('studyNotes', 'n', { content: 'Owned' });
    expect(await planDataCommand(command, primary, reader)).toMatchObject({ result: { kind: 'acknowledged' } });
    expect(reads).toContain('studyNotes/n');
  });

  it('retains unavailable historical provenance while changing its copied text', async () => {
    const scratch = [{ id: 'copy', text: 'Before', createdAt: 'now', source: { noteId: 'deleted', heading: 'Historical title' } }];
    const primary = put('sermons', 's', { sourceNoteIds: ['deleted'], scratch });
    const command: DataCommand = { ...commandBase(primary), kind: 'update', changes: [{ path: ['scratch'], before: { exists: true, value: scratch }, after: { exists: true, value: [{ ...scratch[0], text: 'After' }] } }] };
    expect(await planDataCommand(command, primary, reader)).toMatchObject({ result: { kind: 'acknowledged' } });
    expect(reads).toEqual([]);
  });

  it('rejects new scratch provenance outside verified sermon sources', async () => {
    const primary = put('sermons', 's', { sourceNoteIds: [], scratch: [] });
    const command: DataCommand = { ...commandBase(primary), kind: 'update', changes: [{ path: ['scratch'], before: { exists: true, value: [] }, after: { exists: true, value: [{ id: 'copy', text: 'Text', createdAt: 'now', source: { noteId: 'n', heading: 'Title' } }] } }] };
    expect(await planDataCommand(command, primary, reader)).toMatchObject({ result: { code: 'invalid-scratch-provenance' }, writes: [] });
  });
});

/**
 * CARRYING A SECTION TO THE NEXT COUNCIL.
 *
 * Two councils change together or neither does: the section is marked as carried in the source
 * only because it landed in the destination. Two independent writes cannot promise that.
 */
describe('council carry', () => {
  const topic = (id: string, extra: DocumentData = {}): DocumentData => ({ id, title: `Topic ${id}`, questions: [], options: [], ...extra });
  const council = (id: string, topics: DocumentData[], extra: DocumentData = {}) =>
    put('councils', id, { title: `Council ${id}`, status: 'preparing', topics, createdAt: 'now', updatedAt: 'now', ...extra });
  const carry = (source: ResourceSnapshot, edits: Array<{ resource: ResourceSnapshot; before: DocumentData[]; after: DocumentData[] }>): DataCommand =>
    ({ ...commandBase(source), kind: 'relation', relation: 'council-carry', edits: edits.map(edit => ({
      resource: edit.resource.resource, generation: edit.resource.metadata?.generation ?? null, beforeTopics: edit.before, afterTopics: edit.after,
    })) } as unknown as DataCommand);

  it('marks the source and fills the destination in one commit', async () => {
    const moved = topic('t1');
    const source = council('source', [moved, topic('t2')]);
    const target = council('target', []);
    const plan = await planDataCommand(carry(source, [
      { resource: source, before: [moved, topic('t2')], after: [{ ...moved, carriedToCouncilId: 'target' }, topic('t2')] },
      { resource: target, before: [], after: [{ ...moved, id: 'copy' }] },
    ]), source, reader);

    expect(plan.result.kind).toBe('acknowledged');
    expect(plan.writes).toHaveLength(2);
    const written = Object.fromEntries(plan.writes.map(write => [write.resource.id, write.value?.topics as DocumentData[]]));
    expect(written.source[0]).toMatchObject({ id: 't1', carriedToCouncilId: 'target' });
    expect(written.target).toEqual([{ ...moved, id: 'copy' }]);
  });

  it.each(['missing-mark', 'wrong-words', 'deleted-existing-topic', 'copied-outcome'])
    ('refuses inconsistent existing-council carry %s without partial writes', async variant => {
      const moved = topic('t1', { summary: 'Keep these words' }), existing = topic('existing');
      const source = council('source', [moved]), target = council('target', [existing]);
      const copied = { ...moved, id: 'copy', ...(variant === 'wrong-words' ? { summary: 'Different words' } : {}),
        ...(variant === 'copied-outcome' ? { discussed: true } : {}) };
      const plan = await planDataCommand(carry(source, [
        { resource: source, before: [moved], after: variant === 'missing-mark' ? [moved] : [{ ...moved, carriedToCouncilId: 'target' }] },
        { resource: target, before: [existing], after: variant === 'deleted-existing-topic' ? [copied] : [existing, copied] },
      ]), source, reader);
      expect(plan.result.kind).toBe('refused');
      expect(plan.writes).toEqual([]);
    });

  it('creates a preparing destination and marks the source in the same carry', async () => {
    const moved = topic('t1', { summary: 'Keep these words' });
    const source = council('source', [moved], { status: 'held', heldAt: 'then' });
    const created = { userId: 'owner', title: 'Next council', status: 'preparing',
      topics: [{ ...moved, id: 'copy' }], createdAt: 'now', updatedAt: 'now' };
    const command = { ...commandBase(source), kind: 'relation', relation: 'council-carry', edits: [
      { resource: source.resource, generation: source.metadata?.generation ?? null,
        beforeTopics: [moved], afterTopics: [{ ...moved, carriedToCouncilId: 'new-target' }] },
      { resource: { collection: 'councils', id: 'new-target' }, generation: null,
        beforeTopics: [], afterTopics: created.topics, create: created },
    ] } as unknown as DataCommand;
    const plan = await planDataCommand(command, source, reader);

    expect(plan.result.kind).toBe('acknowledged');
    expect(plan.writes).toHaveLength(2);
    expect(changed(plan.writes, 'councils', 'source').value?.topics).toEqual([
      { ...moved, carriedToCouncilId: 'new-target' },
    ]);
    expect(changed(plan.writes, 'councils', 'new-target').value).toMatchObject(created);
    expect(changed(plan.writes, 'councils', 'new-target').value).not.toHaveProperty('date');
  });

  it.each(['foreign-owner', 'existing-live', 'tombstone', 'bad-schema', 'missing-mark', 'copied-outcome', 'wrong-words', 'create-on-source'])
    ('refuses unsafe new-council carry %s without exposing any partial write', async variant => {
      const moved = topic('t1', { summary: 'Keep these words' });
      const source = council('source', [moved], { status: 'held', heldAt: 'then' });
      const created: DocumentData = { userId: 'owner', title: 'Next council', status: 'preparing',
        topics: [{ ...moved, id: 'copy' }], createdAt: 'now', updatedAt: 'now' };
      const after = [{ ...moved, carriedToCouncilId: 'new-target' }];
      if (variant === 'foreign-owner') created.userId = 'another';
      if (variant === 'bad-schema') created.title = 42;
      if (variant === 'copied-outcome') (created.topics as DocumentData[])[0].discussed = true;
      if (variant === 'wrong-words') (created.topics as DocumentData[])[0].summary = 'Different words';
      if (variant === 'existing-live') council('new-target', []);
      if (variant === 'tombstone') records.set('councils/new-target', { resource: { collection: 'councils', id: 'new-target' }, value: null,
        metadata: { protocol: 1, generation: 'deleted', revision: 2, deleted: true } });
      const edits = [
        { resource: source.resource, generation: source.metadata?.generation ?? null, beforeTopics: [moved],
          afterTopics: variant === 'missing-mark' ? [moved] : after, ...(variant === 'create-on-source' ? { create: created } : {}) },
        { resource: { collection: 'councils', id: 'new-target' }, generation: null, beforeTopics: [], afterTopics: created.topics, create: created },
      ];
      const command = { ...commandBase(source), kind: 'relation', relation: 'council-carry', edits } as unknown as DataCommand;
      const plan = await planDataCommand(command, source, reader);
      expect(plan.result.kind).toBe('refused');
      expect(plan.writes).toEqual([]);
      expect(source.value?.topics).toEqual([moved]);
    });

  it('keeps a section another device added to the destination while this carry flew', async () => {
    const moved = topic('t1');
    const source = council('source', [moved]);
    const target = council('target', [topic('remote')]);
    const plan = await planDataCommand(carry(source, [
      { resource: source, before: [moved], after: [{ ...moved, carriedToCouncilId: 'target' }] },
      // This device never saw "remote": its own before is the empty destination it read.
      { resource: target, before: [], after: [{ ...moved, id: 'copy' }] },
    ]), source, reader);

    expect(plan.result.kind).toBe('acknowledged');
    const written = Object.fromEntries(plan.writes.map(write => [write.resource.id, write.value?.topics as DocumentData[]]));
    expect(written.target.map(item => item.id).sort()).toEqual(['copy', 'remote']);
  });

  it('refuses a stale generation on either side rather than overwriting it', async () => {
    const moved = topic('t1');
    const source = council('source', [moved]);
    const target = council('target', []);
    const command = carry(source, [
      { resource: source, before: [moved], after: [{ ...moved, carriedToCouncilId: 'target' }] },
      { resource: target, before: [], after: [{ ...moved, id: 'copy' }] },
    ]) as Extract<DataCommand, { relation: 'council-carry' }>;
    const stale = { ...command, edits: [command.edits[0], { ...command.edits[1], generation: 'stale' }] } as unknown as DataCommand;
    // Whole-command refusal, exactly as series membership answers: no partial write reaches
    // either council, so the section is neither duplicated nor lost.
    expect(await planDataCommand(stale, source, reader)).toMatchObject({ result: { kind: 'refused', code: 'generation-mismatch' }, writes: [] });
  });

  it('refuses a carry aimed at a collection that is not councils', async () => {
    const source = council('source', [topic('t1')]);
    const foreign = put('sermons', 'sermon', { title: 'Not a council' });
    const command = carry(source, [
      { resource: source, before: [topic('t1')], after: [topic('t1')] },
      { resource: foreign, before: [], after: [topic('t1')] },
    ]);
    expect(await planDataCommand(command, source, reader)).toMatchObject({ result: { code: 'invalid-document' }, writes: [] });
  });

  it('refuses only the carry mark through an ordinary update, not ordinary editing', async () => {
    const source = council('source', [topic('t1')]);
    const claim: DataCommand = { ...commandBase(source), kind: 'update', changes: [
      { path: ['topics'], before: { exists: true, value: [topic('t1')] },
        after: { exists: true, value: [{ ...topic('t1'), carriedToCouncilId: 'target' }] } },
    ] };
    expect(await planDataCommand(claim, source, reader)).toMatchObject({ result: { code: 'relation-command-required' }, writes: [] });

    // Typing in a section is not a claim about another council and must stay an ordinary update.
    const typing: DataCommand = { ...commandBase(source), kind: 'update', changes: [
      { path: ['topics'], before: { exists: true, value: [topic('t1')] },
        after: { exists: true, value: [{ ...topic('t1'), title: 'Reworded', decision: 'Agreed' }] } },
    ] };
    expect(await planDataCommand(typing, source, reader)).toMatchObject({ result: { kind: 'acknowledged' } });

    // Adding and removing sections claims nothing about another council either. The screen adds
    // an empty section and the person names it afterwards; refusing that stops all editing.
    const added: DataCommand = { ...commandBase(source), kind: 'update', changes: [
      { path: ['topics'], before: { exists: true, value: [topic('t1')] },
        after: { exists: true, value: [topic('t1'), { id: 'fresh', title: '', questions: [], options: [] }] } },
    ] };
    expect(await planDataCommand(added, source, reader)).toMatchObject({ result: { kind: 'acknowledged' } });

    const removed: DataCommand = { ...commandBase(source), kind: 'update', changes: [
      { path: ['topics'], before: { exists: true, value: [topic('t1')] }, after: { exists: true, value: [] } },
    ] };
    expect(await planDataCommand(removed, source, reader)).toMatchObject({ result: { kind: 'acknowledged' } });
  });
});

describe('exclusive series membership across documents', () => {
  const attach = (target: ResourceSnapshot, member = item('group', { type: 'group' })): DataCommand => ({
    ...commandBase(target), kind: 'relation', relation: 'series-membership', edits: [
      { resource: target.resource, generation: target.metadata?.generation ?? null, beforeItems: [], afterItems: [member] },
    ],
  });
  it('refuses a second offline assignment to another series without silently moving or duplicating it', async () => {
    put('groups', 'group', {});
    const first = series('first', []), second = series('second', []);
    const accepted = await planDataCommand(attach(first), first, reader);
    expect(accepted.result.kind).toBe('acknowledged');
    accepted.writes.forEach(write => records.set(key(write.resource.collection, write.resource.id), write));
    const competing = await planDataCommand(attach(second), second, reader);
    expect(competing.result).toMatchObject({ kind: 'refused', code: 'membership-already-assigned' });
    expect(competing.writes).toEqual([]);
    expect(records.get('series/first')?.value?.items).toEqual([item('group', { type: 'group' })]);
  });
  it('also guards initial members in a newly created series', async () => {
    put('sermons', 'sermon', {}); series('existing', [item()]);
    const target = { resource: { collection: 'series', id: 'new' }, value: null, metadata: null };
    const command: DataCommand = { ...commandBase(target), kind: 'create', value: {
      userId: owner, theme: 'New', bookOrTopic: '', status: 'draft', createdAt: 'now', updatedAt: 'now', items: [item()],
    } };
    expect(await planDataCommand(command, target, reader)).toMatchObject({ result: { kind: 'refused', code: 'membership-already-assigned' }, writes: [] });
  });
  it('ignores unrelated series while retaining already-read participants', async () => {
    put('groups', 'group', {});
    const target = series('first', []);
    for (let index = 0; index < 101; index++) series(`later-${index}`, []);
    expect(await planDataCommand(attach(target), target, reader)).toMatchObject({ result: { kind: 'acknowledged' } });
  });
  it('distinguishes group and sermon identity and tolerates unrelated historical duplicates', async () => {
    put('groups', 'group', {});
    series('legacy-one', [item('old')]); series('legacy-two', [item('old')]);
    series('same-id-sermon', [item('group')]);
    const target = series('target', []);
    expect((await planDataCommand(attach(target), target, reader)).result.kind).toBe('acknowledged');
  });
  it('allows removing a legacy duplicate without an unrelated ownership sweep', async () => {
    const target = series('first', [item()]); series('second', [item()]);
    const command: DataCommand = { ...commandBase(target), kind: 'relation', relation: 'series-membership', edits: [
      { resource: target.resource, generation: null, beforeItems: [item()], afterItems: [] },
    ] };
    const noScan: RelationReader = { ...reader, list: async () => { throw new Error('Removal does not need a global scan'); } };
    expect((await planDataCommand(command, target, noScan)).result.kind).toBe('acknowledged');
  });

  it('checks accepted server additions even when a supplied ancestor changes the item ID', async () => {
    put('groups', 'group', {}); series('existing', [item('group', { type: 'group' })]);
    const target = series('target', []);
    const command = attach(target) as Extract<DataCommand, { relation: 'series-membership' }>;
    command.edits[0].beforeItems = [item('group', { type: 'group', id: 'older-item' })];
    expect(await planDataCommand(command, target, reader)).toMatchObject({ result: { code: 'membership-already-assigned' }, writes: [] });
  });

});


describe('legacy child defects in relation projections', () => {
  it('carries a clean topic while another source topic holds old duplicate questions', async () => {
    const clean = { id: 'clean', title: 'Carry these words', questions: [], options: [] };
    const legacy = { id: 'legacy', title: 'Keep this topic', questions: [{ id: 'old', question: 'First words' }, { id: 'old', question: 'Second words' }], options: [] };
    const source = put('councils', 'source', { title: 'Source', status: 'preparing', topics: [clean, legacy], createdAt: 'now', updatedAt: 'now' });
    const target = put('councils', 'target', { title: 'Target', status: 'preparing', topics: [], createdAt: 'now', updatedAt: 'now' });
    const command = { ...commandBase(source), kind: 'relation', relation: 'council-carry', edits: [
      { resource: source.resource, generation: null, beforeTopics: [clean, legacy], afterTopics: [{ ...clean, carriedToCouncilId: 'target' }, legacy] },
      { resource: target.resource, generation: null, beforeTopics: [], afterTopics: [{ ...clean, id: 'copy' }] },
    ] } as DataCommand;
    const plan = await planDataCommand(command, source, reader);
    expect(plan.result.kind).toBe('acknowledged');
    expect(changed(plan.writes, 'councils', 'source').value?.topics).toEqual([{ ...clean, carriedToCouncilId: 'target' }, legacy]);
    expect(changed(plan.writes, 'councils', 'target').value?.topics).toEqual([{ ...clean, id: 'copy' }]);
  });

  it('unlinks a note while preserving both old duplicate material sections and their words', async () => {
    const sections = [{ id: 'old', title: 'First section', noteIds: ['note'], connector: 'First words' },
      { id: 'old', title: 'Second section', noteIds: ['note'], connector: 'Second words' }];
    const material = put('studyMaterials', 'material', { title: 'Material', type: 'study', noteIds: ['note'], sections });
    put('studyNotes', 'note', { content: 'Retained note words', materialIds: ['material'] });
    const plan = await planDataCommand(materialCommand(material, ['note'], []), material, reader);
    expect(plan.result.kind).toBe('acknowledged');
    expect(changed(plan.writes, 'studyMaterials', 'material').value).toMatchObject({ noteIds: [], sections: sections.map(section => ({ ...section, noteIds: [] })) });
    expect(changed(plan.writes, 'studyNotes', 'note').value).toMatchObject({ content: 'Retained note words', materialIds: [] });
  });
});


describe('council carry addresses topics but preserves legacy question words', () => {
  it('carries all words from old duplicate questions into fresh question identities', async () => {
    const topic = { id: 'topic', title: 'Keep both questions', questions: [{ id: 'old', question: 'First words' }, { id: 'old', question: 'Second words' }], options: [] };
    const source = put('councils', 'source', { title: 'Source', status: 'preparing', topics: [topic], createdAt: 'now', updatedAt: 'now' });
    const target = put('councils', 'target', { title: 'Target', status: 'preparing', topics: [], createdAt: 'now', updatedAt: 'now' });
    const copy = carriedCopy(topic, 'operation');
    const command = { ...commandBase(source), kind: 'relation', relation: 'council-carry', edits: [
      { resource: source.resource, generation: null, beforeTopics: [topic], afterTopics: [{ ...topic, carriedToCouncilId: 'target' }] },
      { resource: target.resource, generation: null, beforeTopics: [], afterTopics: [copy] },
    ] } as DataCommand;
    const plan = await planDataCommand(command, source, reader);
    expect(plan.result.kind).toBe('acknowledged');
    expect((changed(plan.writes, 'councils', 'source').value?.topics as DocumentData[])[0]).toMatchObject({ questions: topic.questions });
    const questions = (changed(plan.writes, 'councils', 'target').value?.topics as DocumentData[])[0].questions as DocumentData[];
    expect(questions.map(question => question.question)).toEqual(['First words', 'Second words']);
    expect(new Set(questions.map(question => question.id)).size).toBe(2);
  });

  it('still refuses ambiguous topic identities before making any relation write', async () => {
    const first = { id: 'same', title: 'First', questions: [], options: [] }, second = { ...first, title: 'Second' };
    const source = put('councils', 'source', { title: 'Source', status: 'preparing', topics: [first, second], createdAt: 'now', updatedAt: 'now' });
    const target = put('councils', 'target', { title: 'Target', status: 'preparing', topics: [], createdAt: 'now', updatedAt: 'now' });
    const command = { ...commandBase(source), kind: 'relation', relation: 'council-carry', edits: [
      { resource: source.resource, generation: null, beforeTopics: [first, second], afterTopics: [{ ...first, carriedToCouncilId: 'target' }, second] },
      { resource: target.resource, generation: null, beforeTopics: [], afterTopics: [carriedCopy(first, 'operation')] },
    ] } as DataCommand;
    const plan = await planDataCommand(command, source, reader);
    expect(plan.result).toMatchObject({ kind: 'refused', code: 'invalid-document' });
    expect(plan.writes).toHaveLength(0);
  });
});
