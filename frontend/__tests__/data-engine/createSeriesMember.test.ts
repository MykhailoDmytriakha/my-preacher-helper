/** @jest-environment node */
import { validateCommand } from '@/data-engine/protocol';
import { planDataCommand } from '@/data-engine/serverRelations';

import type { DataCommand, DocumentData, ResourceSnapshot } from '@/data-engine/types';

const item = (id: string, type = 'sermon', position = 1) => ({ id: `${type}-${id}`, type, refId: id, position });
const target: ResourceSnapshot = { resource: { collection: 'series', id: 'target' }, metadata: null,
  value: { userId: 'owner', title: 'Series', theme: 'Series', bookOrTopic: '', status: 'draft', items: [], sermonIds: [], seriesKind: 'sermon' } };
const creation = (collection = 'sermons'): Extract<DataCommand, { relation: 'series-member-create' }> => ({
  protocol: 1, owner: 'owner', operationId: 'create-and-link', resource: { collection, id: 'new' }, generation: null, dependsOn: [],
  kind: 'relation', relation: 'series-member-create', value: collection === 'sermons'
    ? { userId: 'owner', title: 'New sermon', verse: 'Romans 1', date: 'now', thoughts: [] }
    : { userId: 'owner', title: 'New group', status: 'draft', templates: [], flow: [], createdAt: 'now', updatedAt: 'now' },
  edit: { resource: target.resource, generation: null, beforeItems: [], afterItems: [item('new', collection === 'sermons' ? 'sermon' : 'group')] },
});
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function setup(command = creation()) {
  const records = new Map<string, ResourceSnapshot>([['series/target', clone(target)]]);
  const primary = { resource: command.resource, value: null, metadata: null };
  const read = async (resource: ResourceSnapshot['resource']) => records.get(`${resource.collection}/${resource.id}`) ?? { resource, value: null, metadata: null };
  return { command, records, primary, plan: () => planDataCommand(validateCommand(command), records.get(`${command.resource.collection}/new`) ?? primary,
    { get: read, list: async (collection, limit) => [...records.values()].filter(row => row.resource.collection === collection).slice(0, limit) }) };
}

it.each(['sermons', 'groups'])('creates %s and its series membership as one plan with proof for both effects', async collection => {
  const t = setup(creation(collection)), result = await t.plan();
  expect(result.result).toMatchObject({ kind: 'acknowledged', snapshot: { resource: t.command.resource, metadata: { operationId: 'create-and-link', revision: 1 } },
    affected: [{ resource: target.resource, metadata: { operationId: 'create-and-link', revision: 1 } }] });
  expect(result.writes).toHaveLength(2);
  expect(result.writes.find(row => row.resource.collection === 'series')?.value?.items).toEqual(t.command.edit.afterItems);
  expect(t.records.has(`${collection}/new`)).toBe(false);
});

it.each(['deleted', 'generation', 'foreign', 'existing', 'invalid', 'source'])('refuses %s without exposing either write', async mode => {
  const t = setup();
  if (mode === 'deleted') t.records.set('series/target', { resource: target.resource, value: null, metadata: { protocol: 1, generation: 'old', revision: 2, deleted: true } });
  if (mode === 'generation') t.command.edit.generation = 'obsolete';
  if (mode === 'foreign') t.records.set('series/target', { ...clone(target), value: { ...target.value, userId: 'other' } });
  if (mode === 'existing') t.records.set('sermons/new', { resource: t.command.resource, metadata: null, value: { ...t.command.value, title: 'Existing' } });
  if (mode === 'invalid') delete t.command.value.title;
  if (mode === 'source') t.command.value.sourceNoteIds = ['absent'];
  const result = await t.plan();
  expect(result.result.kind).toBe('refused'); expect(result.writes).toEqual([]);
});

it('merges an unrelated remote membership without replacing it', async () => {
  const t = setup();
  t.records.set('sermons/remote', { resource: { collection: 'sermons', id: 'remote' }, metadata: null, value: { userId: 'owner' } });
  t.records.set('series/target', { ...clone(target), value: { ...target.value, items: [item('remote')], sermonIds: ['remote'] } });
  const result = await t.plan(); expect(result.result.kind).toBe('acknowledged');
  expect((result.writes.find(row => row.resource.collection === 'series')?.value?.items as DocumentData[]).map(row => row.refId)).toEqual(expect.arrayContaining(['new', 'remote']));
});

it('refuses a duplicate membership elsewhere without creating the member', async () => {
  const t = setup();
  t.records.set('series/other', { ...clone(target), resource: { collection: 'series', id: 'other' }, value: { ...target.value, items: [item('new')], sermonIds: ['new'] } });
  expect(await t.plan()).toMatchObject({ result: { kind: 'refused', code: 'membership-already-assigned' }, writes: [] });
});

it('requires exactly the new typed member and preserves the other membership payloads', () => {
  const good = creation();
  for (const change of [
    { resource: { collection: 'studyNotes', id: 'new' } }, { generation: 'existing' }, { edit: {} },
    { edit: { ...good.edit, afterItems: [item('new', 'group')] } },
    { edit: { ...good.edit, afterItems: [item('new'), item('unrelated')] } },
    { edit: { ...good.edit, beforeItems: [item('old')], afterItems: [item('new')] } },
    { edit: { ...good.edit, beforeItems: [item('new')] } },
    { edit: { ...good.edit, beforeItems: [item('a'), item('b', 'sermon', 2)],
      afterItems: [item('a', 'sermon', 9), item('b', 'sermon', 2), item('new', 'sermon', 3)] } },
  ]) expect(() => validateCommand({ ...good, ...change })).toThrow();
  expect(validateCommand({ ...good, edit: { ...good.edit, beforeItems: [item('old', 'sermon', 9)],
    afterItems: [item('new'), item('old', 'sermon', 2)] } })).toBeDefined();
});
