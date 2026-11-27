/** @jest-environment node */
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { installWorldFirestore } from '@test-utils/deviceWorld/firestore';

import { processCommand, readDocument } from '../server';

import type { DataCommand, DocumentData, ResourceSnapshot } from '../types';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() }, FieldValue: { increment: (amount: number) => ({ __testIncrement: amount }) } }));
jest.mock('@/data-engine/activation', () => ({ ...jest.requireActual('@/data-engine/activation'), isCollectionServed: () => true }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const origin = 1_800_000_000_000;
const clock = (offset: number) => ({ earliestMs: origin + offset, latestMs: origin + offset + 5 });
const owner = 'owner';
const resource = { collection: 'hardQuestions', id: 'question-versions' };
const opening = { userId: owner, title: 'Question', rank: 1000, short: 'Original summary', detail: 'Original detail',
  createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z' };
const snapshot: ResourceSnapshot = { resource, value: opening, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };

function edit(operationId: string, from: DocumentData, short: string, detail: string): DataCommand {
  return { protocol: 1, owner, resource, operationId, dependsOn: [], generation: 'g', kind: 'update',
    changes: [
      { path: ['short'], before: { exists: true, value: from.short }, after: { exists: true, value: short } },
      { path: ['detail'], before: { exists: true, value: from.detail }, after: { exists: true, value: detail } },
    ],
    hardQuestionFieldActions: { short: { observedRevision: 1, time: clock(40) }, detail: { observedRevision: 1, time: null } },
  };
}

async function comparedQuestion(browser: ReturnType<ReturnType<typeof documentEngineHarness>['createBrowser']>,
  h: ReturnType<typeof documentEngineHarness>, offset: number) {
  const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
  const form = editor.form('question-words', [['short'], ['detail']]);
  await form.begin();
  await form.update(record => ({ ...record, short: 'Phone summary', detail: 'Phone detail' }));
  expect((await processCommand(owner, edit('computer', opening, 'Computer summary', 'Computer detail'))).kind).toBe('acknowledged');
  await form.save(undefined, { documentMetadata: { time: clock(offset) } });
  await browser.engine.retry();
  await settleEngine();
  const comparison = form.getState()?.comparison;
  expect(comparison).toMatchObject({ conflictPaths: [['detail']], hardQuestionFields: ['detail'] });
  const competing = (await h.commits.list(owner)).find(request => request.state === 'conflict');
  expect(competing).toBeDefined();
  return { editor, form, comparison, competing };
}

it.each([
  [20, 'local', 'Computer summary', 'Phone detail'],
  [20, 'remote', 'Computer summary', 'Computer detail'],
  [90, 'local', 'Phone summary', 'Phone detail'],
  [90, 'remote', 'Phone summary', 'Computer detail'],
] as const)('preserves the decided summary and the explicit %s %s detail after restart', async (offset, choice, short, detail) => {
  const db = installWorldFirestore(() => origin + 250);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: snapshot.metadata });
  const h = documentEngineHarness(snapshot, { apply: command => processCommand(owner, command) });
  let browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const { form, comparison, competing } = await comparedQuestion(browser, h, offset);
    browser.engine.setOnline(false);
    await form.resolve(choice, { expectedComparison: comparison, metadataTime: clock(110) });
    const queued = (await h.commits.list(owner)).filter(request => request.state === 'queued' || request.state === 'prepared');
    if (offset === 20 && choice === 'remote') expect(queued).toHaveLength(0);
    else {
      expect(queued).toHaveLength(1);
      expect(queued[0].value).toMatchObject({ short, detail });
      expect(queued[0].hardQuestionFieldActions?.short).toEqual(offset === 90 ? competing?.hardQuestionFieldActions?.short : undefined);
      const chosenDetail = queued[0].hardQuestionFieldActions?.detail;
      if (choice === 'local') expect(chosenDetail).toMatchObject({ reviewed: true, time: clock(110), observedRevision: 2 });
      else expect(chosenDetail).toBeUndefined();
    }
    expect((await readDocument(owner, resource)).value).toMatchObject({ short: 'Computer summary', detail: 'Computer detail' });
    browser.dispose();
    await settleEngine();
    browser = h.createBrowser();
    browser.engine.setOwner(owner);
    browser.engine.setOnline(true);
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value).toMatchObject({ title: 'Question', short, detail });
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('leaves an ordered form comparison for the form that captured it', async () => {
  const db = installWorldFirestore(() => origin + 250);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: snapshot.metadata });
  const h = documentEngineHarness(snapshot, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const { editor, form, comparison } = await comparedQuestion(browser, h, 90);
    await expect(editor.keepLocal()).rejects.toMatchObject({ code: 'pending-delivery-first' });
    await expect(editor.acceptRemote()).rejects.toMatchObject({ code: 'pending-delivery-first' });
    await form.resolve('remote', { expectedComparison: comparison });
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value).toMatchObject({ short: 'Phone summary', detail: 'Computer detail' });
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('asks again when the reviewed answer changes after the first choice and preserves the timed sibling', async () => {
  const db = installWorldFirestore(() => origin + 250);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: snapshot.metadata });
  const h = documentEngineHarness(snapshot, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const { form, comparison } = await comparedQuestion(browser, h, 90);
    browser.engine.setOnline(false);
    await form.resolve('local', { expectedComparison: comparison, metadataTime: clock(110) });
    expect((await processCommand(owner, { protocol: 1, owner, resource, operationId: 'new-computer-detail', dependsOn: [], generation: 'g', kind: 'update',
      changes: [{ path: ['detail'], before: { exists: true, value: 'Computer detail' }, after: { exists: true, value: 'Latest computer detail' } }],
      hardQuestionFieldActions: { detail: { observedRevision: 2, time: clock(120) } },
    })).kind).toBe('acknowledged');
    browser.engine.setOnline(true);
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value).toMatchObject({ short: 'Computer summary', detail: 'Latest computer detail' });
    const newer = form.getState()?.comparison;
    expect(newer).toMatchObject({ hardQuestionFields: ['detail'], conflictPaths: [['detail']],
      stored: { value: { detail: 'Latest computer detail' } }, mine: { detail: 'Phone detail' } });
    await form.resolve('local', { expectedComparison: newer, metadataTime: clock(150) });
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value).toMatchObject({ short: 'Phone summary', detail: 'Phone detail' });
  } finally {
    browser.dispose();
    await settleEngine();
  }
});
