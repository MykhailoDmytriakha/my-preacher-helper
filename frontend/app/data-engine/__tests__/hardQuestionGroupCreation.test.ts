/** @jest-environment node */
import { installWorldFirestore } from '@test-utils/deviceWorld/firestore';

import { processCommand, readDocument } from '../server';

import type { DataCommand, DocumentData } from '../types';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() }, FieldValue: { increment: (amount: number) => ({ __testIncrement: amount }) } }));
jest.mock('@/data-engine/activation', () => ({ ...jest.requireActual('@/data-engine/activation'), isCollectionServed: () => true }));

const owner = 'owner';
const theme = { collection: 'hardQuestionThemes', id: 'theme-a' };
const question = { collection: 'hardQuestions', id: 'new-question' };
const timestamps = { createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z' };
const heading = { userId: owner, title: 'Theme', rank: 1000, ...timestamps };
const group = { id: 'new-group', title: 'New group' };
const parallel = { id: 'independent-group', title: 'A different first group' };
const words = { userId: owner, title: 'A question to keep', themeId: theme.id, groupId: group.id, rank: 1000, ...timestamps };
const metadata = { protocol: 1, generation: 'theme-generation', revision: 1, deleted: false } as const;
const seed = (value: DocumentData | null = heading) => {
  const db = installWorldFirestore(() => 1_800_000_000_000);
  if (value) db.documents.set(`${theme.collection}/${theme.id}`, { ...value, _dataEngine: metadata });
  return db;
};

function createTogether(operationId = 'create-question-and-group', value: DocumentData = words): Extract<DataCommand, { relation: 'hard-question-group-create' }> {
  return { protocol: 1, kind: 'relation', relation: 'hard-question-group-create', owner, resource: question,
    operationId, generation: null, dependsOn: [], value, theme: { resource: theme, generation: metadata.generation }, group };
}

it('adds the question and its group together relative to the current groups of a legacy theme', async () => {
  seed();
  expect(await processCommand(owner, {
    protocol: 1, owner, kind: 'update', resource: theme, operationId: 'independent-first-group',
    generation: metadata.generation, dependsOn: [],
    changes: [{ path: ['groups'], before: { exists: false }, after: { exists: true, value: [parallel] } }],
  })).toMatchObject({ kind: 'acknowledged' });
  const command = createTogether();
  const result = await processCommand(owner, command);
  expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: words.title, groupId: group.id, themeId: theme.id, rank: 1000 } },
    affected: [{ resource: theme, metadata: { operationId: command.operationId } }] });
  expect((await readDocument(owner, theme)).value?.groups).toEqual([parallel, group]);
  expect((await readDocument(owner, question)).value).toMatchObject({ title: words.title, groupId: group.id, themeId: theme.id, rank: 1000 });
  expect(await processCommand(owner, command)).toMatchObject({ kind: 'acknowledged',
    snapshot: { metadata: { revision: 1 } }, affected: [{ resource: theme, metadata: { revision: 3 } }] });
  expect((await readDocument(owner, theme)).value?.groups).toEqual([parallel, group]);
});

it('does not create a question when its theme and new group cannot be saved', async () => {
  seed(null);
  const result = await processCommand(owner, createTogether());
  expect(result).toMatchObject({ kind: 'refused', code: 'referenced-document-deleted' });
  expect((await readDocument(owner, theme)).value).toBeNull();
  expect((await readDocument(owner, question)).value).toBeNull();
});

it('does not leave a new group when the question ID is already occupied', async () => {
  const db = seed();
  db.documents.set(`${question.collection}/${question.id}`, { ...words, title: 'Existing question', _dataEngine: metadata });
  const result = await processCommand(owner, createTogether());
  expect(result).toMatchObject({ kind: 'refused' });
  expect((await readDocument(owner, theme)).value?.groups).toBeUndefined();
  expect((await readDocument(owner, question)).value?.title).toBe('Existing question');
});

it('never brings back an existing group the owner removed after selecting it on another device', async () => {
  seed({ ...heading, groups: [parallel] });
  const result = await processCommand(owner, { ...createTogether(), existing: true });
  expect(result).toMatchObject({ kind: 'refused', code: 'decision-changed' });
  expect((await readDocument(owner, question)).value).toBeNull();
  expect((await readDocument(owner, theme)).value?.groups).toEqual([parallel]);
});

it('reuses a stable group ID after a separate title change and returns both participant receipts', async () => {
  const latest = { ...group, title: 'New name on the other device' };
  seed({ ...heading, groups: [parallel, latest] });
  const result = await processCommand(owner, { ...createTogether(), existing: true });
  expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { groupId: group.id } },
    affected: [{ resource: theme, metadata: { revision: 2 } }] });
  expect((await readDocument(owner, theme)).value?.groups).toEqual([parallel, latest]);
});

it('keeps an unknown legacy generation separate from a live generation learned by another device', async () => {
  seed({ ...heading, groups: [parallel] });
  const command = createTogether();
  const result = await processCommand(owner, { ...command, theme: { resource: theme, generation: null } });
  expect(result).toMatchObject({ kind: 'refused', code: 'generation-mismatch' });
  expect((await readDocument(owner, theme)).value?.groups).toEqual([parallel]);
  expect((await readDocument(owner, question)).value).toBeNull();
});
