import { inMemoryRelationReader } from '@test-utils/inMemoryRelationReader';

/** @jest-environment node */
import { planDataCommand } from '@/data-engine/serverRelations';

import type { DataCommand, DocumentData, FieldChange, ResourceSnapshot } from '@/data-engine/types';
import type { RelationReader } from '@/data-engine/serverRelations';

const owner = 'owner';
const records = new Map<string, ResourceSnapshot>();
const reads: string[] = [];
const key = (collection: string, id: string) => `${collection}/${id}`;
const put = (id: string, verse: number, extra: DocumentData = {}): ResourceSnapshot => {
  const resource = { collection: 'studyNotes', id };
  const value: DocumentData = {
    userId: owner, type: 'analysis', title: `Title ${id}`, content: `Content ${id}`, tags: ['original'], isDraft: false,
    createdAt: 'created', updatedAt: 'old-updated', scriptureRefs: [{ id: `${id}-ref`, bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: verse, toVerse: verse }],
    analysis: { bible: 'rst', words: 4, cuts: [2], links: {}, relations: {} }, ...extra,
  };
  const snapshot: ResourceSnapshot = { resource, value, metadata: { protocol: 1, generation: `gen-${id}`, revision: 4, deleted: false } };
  records.set(key(resource.collection, id), snapshot);
  return snapshot;
};
const reader: RelationReader = inMemoryRelationReader(owner, resource => {
  reads.push(key(resource.collection, resource.id));
  return records.get(key(resource.collection, resource.id)) ?? { resource, value: null, metadata: null };
}, () => records.values());
const change = (field: string, before: unknown, after: unknown): FieldChange => ({
  path: [field], before: { exists: true, value: before as never }, after: { exists: true, value: after as never },
});
const frame = (snapshot: ResourceSnapshot, verse: number, content = `Reshaped ${snapshot.resource.id}`) => ({
  analysis: { bible: 'rst', words: 4, cuts: [], links: {}, relations: {} }, content,
  scriptureRefs: [{ ...(snapshot.value!.scriptureRefs as DocumentData[])[0], fromVerse: verse, toVerse: verse }],
});
const edit = (snapshot: ResourceSnapshot, verse: number, extras: FieldChange[] = []) => {
  const next = frame(snapshot, verse);
  return { resource: snapshot.resource, generation: snapshot.metadata?.generation ?? null, changes: [
    change('analysis', snapshot.value!.analysis, next.analysis), change('content', snapshot.value!.content, next.content),
    change('scriptureRefs', snapshot.value!.scriptureRefs, next.scriptureRefs), ...extras,
  ] };
};
const command = (source: ResourceSnapshot, edits: Array<Record<string, unknown>>): DataCommand => ({
  protocol: 1, operationId: 'reshape-op', owner, resource: source.resource, generation: source.metadata?.generation ?? null,
  dependsOn: [], kind: 'relation', relation: 'analysis-reshape', edits,
} as unknown as DataCommand);
const created = (): DocumentData => ({ userId: owner, type: 'analysis', title: 'New note', content: 'New text', tags: [], isDraft: false,
  createdAt: 'created', updatedAt: 'created', scriptureRefs: [{ id: 'new-ref', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 4, toVerse: 4 }],
  analysis: { bible: 'rst', words: 4, cuts: [], links: {}, relations: {} } });
const output = (plan: { writes: ResourceSnapshot[] }, id: string) => plan.writes.find(write => write.resource.id === id)!;

beforeEach(() => { records.clear(); reads.length = 0; });

describe('analysis reshape server planning', () => {
  it('plans existing source and recipient together, preserving independent later title and tag changes', async () => {
    const source = put('source', 1);
    const target = put('target', 3);
    const targetNext = edit(target, 2, [change('title', 'Title target', 'Chosen title')]);
    const sourceEdit = edit(source, 1);
    const expected = command(source, [sourceEdit, targetNext]);
    source.value!.title = 'Remote source title';
    source.value!.tags = ['remote source tag'];
    target.value!.tags = ['remote target tag'];

    const planned = await planDataCommand(expected, source, reader);

    expect(planned.result.kind).toBe('acknowledged');
    expect(planned.writes).toHaveLength(2);
    expect(output(planned, 'source').value).toMatchObject({ title: 'Remote source title', tags: ['remote source tag'], content: 'Reshaped source' });
    expect(output(planned, 'target').value).toMatchObject({ title: 'Chosen title', tags: ['remote target tag'], content: 'Reshaped target' });
    expect(planned.result).toMatchObject({ affected: [{ resource: target.resource, metadata: { operationId: 'reshape-op', revision: 5 } }] });
    expect(output(planned, 'source').metadata).toMatchObject({ operationId: 'reshape-op', revision: 5 });
  });

  it('plans three participants, including an absent new recipient, with proof for every write', async () => {
    const source = put('source', 1);
    const front = put('front', 2);
    const fresh: ResourceSnapshot = { resource: { collection: 'studyNotes', id: 'new-recipient' }, value: null, metadata: null };
    const wire = command(source, [edit(source, 2), edit(front, 3), {
      resource: fresh.resource, generation: null, changes: [], create: created(),
    }]);

    const planned = await planDataCommand(wire, source, reader);

    expect(planned.result.kind).toBe('acknowledged');
    expect(planned.writes.map(write => write.resource.id).sort()).toEqual(['front', 'new-recipient', 'source']);
    expect(output(planned, 'new-recipient')).toMatchObject({ value: { userId: owner, title: 'New note', type: 'analysis' }, metadata: { operationId: 'reshape-op', revision: 1 } });
    if (planned.result.kind !== 'acknowledged') throw new Error('Expected an acknowledgement');
    expect(planned.result.affected).toEqual(expect.arrayContaining([
      { resource: front.resource, metadata: expect.objectContaining({ operationId: 'reshape-op' }) },
      { resource: fresh.resource, metadata: expect.objectContaining({ operationId: 'reshape-op' }) },
    ]));
  });

  it('returns one conflict and no writes when a later participant frame changed', async () => {
    const source = put('source', 1);
    const target = put('target', 3);
    const wire = command(source, [edit(source, 2), edit(target, 2)]);
    target.value!.scriptureRefs = [{ id: 'target-ref', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 4, toVerse: 4 }];

    expect(await planDataCommand(wire, source, reader)).toMatchObject({ result: { kind: 'conflict', conflicts: expect.arrayContaining([expect.objectContaining({ path: ['target', 'scriptureRefs'] })]) }, writes: [] });
  });

  it('normalizes a recipient title conflict to the primary snapshot and exposes no earlier candidate write', async () => {
    const source = put('source', 1);
    const target = put('target', 3);
    const wire = command(source, [edit(source, 2), edit(target, 2, [change('title', 'Title target', 'Chosen title')])]);
    target.value!.title = 'Remote title';

    const planned = await planDataCommand(wire, source, reader);

    expect(planned).toMatchObject({
      result: { kind: 'conflict', snapshot: { resource: source.resource }, conflicts: [expect.objectContaining({ path: ['target', 'title'] })] },
      writes: [],
    });
  });

  it.each(['foreign', 'deleted', 'wrong-generation'])('rejects a %s participant before exposing any write', async variant => {
    const source = put('source', 1);
    const target = put('target', 3);
    const edits = [edit(source, 2), edit(target, 2)];
    if (variant === 'foreign') target.value!.userId = 'another-owner';
    if (variant === 'deleted') target.metadata = { protocol: 1, generation: 'gen-target', revision: 4, deleted: true };
    if (variant === 'wrong-generation') edits[1].generation = 'stale';

    const planned = await planDataCommand(command(source, edits), source, reader);
    expect(planned.result.kind).toBe('refused');
    expect(planned.writes).toEqual([]);
  });

  it('reads every secondary participant before returning any planned write', async () => {
    const source = put('source', 1);
    const one = put('one', 2);
    const two = put('two', 3);
    await planDataCommand(command(source, [edit(source, 2), edit(one, 3), edit(two, 4)]), source, reader);
    expect(reads).toEqual(['studyNotes/one', 'studyNotes/two']);
  });

  it('keeps an ordinary study-note update on the existing single-document path', async () => {
    const ordinary = put('ordinary', 1);
    ordinary.value!.type = 'note';
    delete ordinary.value!.analysis;
    const update: DataCommand = {
      protocol: 1, operationId: 'ordinary-op', owner, resource: ordinary.resource, generation: ordinary.metadata?.generation ?? null,
      dependsOn: [], kind: 'update', changes: [change('content', ordinary.value!.content, 'Ordinary new words')],
    };

    const planned = await planDataCommand(update, ordinary, reader);

    expect(planned.result.kind).toBe('acknowledged');
    expect(planned.writes).toHaveLength(1);
    expect(planned.writes[0].value).toMatchObject({ type: 'note', content: 'Ordinary new words' });
  });
});
