/** @jest-environment node */
import { installWorldFirestore } from '@test-utils/deviceWorld/firestore';

import { hardQuestionRankOpening } from '../hardQuestionRankOrder';
import { processCommand, readDocument } from '../server';

import type { DataCommand, DocumentData, ResourceRef } from '../types';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() }, FieldValue: { increment: (amount: number) => ({ __testIncrement: amount }) } }));
jest.mock('@/data-engine/activation', () => ({ ...jest.requireActual('@/data-engine/activation'), isCollectionServed: () => true }));

const owner = 'owner';
const theme: ResourceRef = { collection: 'hardQuestionThemes', id: 'theme' };
const group = { id: 'group', title: 'This group' };
const row = (id: string): ResourceRef => ({ collection: 'hardQuestions', id });
const timestamps = { createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z' };
const rows = (rank: number, title = 'Original question'): DocumentData => ({ userId: owner, title, rank, themeId: theme.id, groupId: group.id, ...timestamps });
const themeFields = { userId: owner, title: 'Category', rank: 1000, groups: [group], ...timestamps };
const meta = (id: string, revision = 1) => ({ protocol: 1, generation: id + '-generation', revision, deleted: false });
const key = (resource: ResourceRef) => resource.collection + '/' + resource.id;
const opening = { a: 1000, b: 1000, c: 3000, d: 4000 } as const;

function setup(values: Partial<Record<keyof typeof opening, DocumentData>> = {}, themeValue: DocumentData = themeFields) {
  const db = installWorldFirestore(() => 1_800_000_000_000);
  db.documents.set(key(theme), { ...themeValue, _dataEngine: meta(theme.id) });
  for (const [id, rank] of Object.entries(opening)) db.documents.set(key(row(id)),
    { ...rows(rank), ...values[id as keyof typeof opening], _dataEngine: meta(id) });
}

function createOrder(): Extract<DataCommand, { relation: 'hard-question-reorder' }> {
  const groupOpening = (id: keyof typeof opening) => ({
    id, generation: meta(id).generation, opening: hardQuestionRankOpening(rows(opening[id])),
  });
  return { protocol: 1, owner, operationId: 'move-d-between-a-and-b', resource: row('d'), generation: meta('d').generation,
    dependsOn: [], kind: 'relation', relation: 'hard-question-reorder', scope: { themeId: theme.id, groupId: group.id },
    edits: [{ ...groupOpening('d'), rank: 2000 }, { ...groupOpening('b'), rank: 3000 }, { ...groupOpening('c'), rank: 4000 }],
    witnesses: [groupOpening('a')],
  };
}

async function order() {
  const results = await Promise.all(Object.keys(opening).map(id => readDocument(owner, row(id))));
  return results.map(({ resource, value, metadata }) => [resource.id, value?.rank, metadata?.revision]);
}

it('commits every changed rank together and leaves a verified unchanged neighbor alone', async () => {
  setup({ b: rows(1000, 'Title changed separately') });
  const command = createOrder();
  const result = await processCommand(owner, command);
  expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { metadata: { operationId: command.operationId }, value: { rank: 2000 } },
    affected: expect.arrayContaining([expect.objectContaining({ resource: row('b') }), expect.objectContaining({ resource: row('c') })]) });
  expect(await order()).toEqual([['a', 1000, 1], ['b', 3000, 2], ['c', 4000, 2], ['d', 2000, 2]]);
  expect((await readDocument(owner, row('b'))).value?.title).toBe('Title changed separately');
  expect(await processCommand(owner, command)).toMatchObject({ kind: 'acknowledged' });
  expect(await order()).toEqual([['a', 1000, 1], ['b', 3000, 2], ['c', 4000, 2], ['d', 2000, 2]]);
});

it.each(['a', 'b'] as const)('rejects the entire action when row %s changed its rank before delivery', async id => {
  setup({ [id]: rows(2500) });
  expect(await processCommand(owner, createOrder())).toMatchObject({ kind: 'refused', code: 'hard-question-order-changed' });
  expect(await order()).toEqual([['a', id === 'a' ? 2500 : 1000, 1], ['b', id === 'b' ? 2500 : 1000, 1], ['c', 3000, 1], ['d', 4000, 1]]);
});

it('rejects a move from a removed group even though the questions retain the original group IDs', async () => {
  setup({}, { ...themeFields, groups: [] });
  expect(await processCommand(owner, createOrder())).toMatchObject({ kind: 'refused', code: 'hard-question-order-changed' });
  expect(await order()).toEqual([['a', 1000, 1], ['b', 1000, 1], ['c', 3000, 1], ['d', 4000, 1]]);
});

it('does not move the neighbor of the dragged question after that question moved away', async () => {
  setup({ c: { ...rows(2000), groupId: 'elsewhere' } });
  const command = createOrder();
  expect(await processCommand(owner, { ...command, resource: row('b'), generation: meta('b').generation, edits: [command.edits[1]],
    witnesses: [...command.witnesses, { id: 'c', generation: meta('c').generation, opening: hardQuestionRankOpening(rows(2000)) }],
  })).toMatchObject({ kind: 'refused', code: 'hard-question-order-changed' });
  expect(await order()).toEqual([['a', 1000, 1], ['b', 1000, 1], ['c', 2000, 1], ['d', 4000, 1]]);
});
