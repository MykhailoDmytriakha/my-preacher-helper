/** @jest-environment node */
import { createHash } from 'node:crypto';

import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { installWorldFirestore } from '@test-utils/deviceWorld/firestore';

import { editorIdentity, editorSlot, manualScopeIdentity, readManualScopeIdentity } from '../editorIdentity';
import { exactManualRequest } from '../manualChoice';
import { recoverManualScopeRecord } from '../manualScope';
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

describe.each([
  ['alternates', 'How could I ask it?', 'How would we approach it?'],
  ['scriptureRefs', 'John 3:16', 'John 3:17'],
  ['basisIds', 'basis-one', 'basis-two'],
] as const)('independent entries in %s', (field, first, second) => {
  it.each(['first additions', 'late clearing', 'previous clearing'] as const)('merges %s through the actual form queue', async scenario => {
    const noEntries = scenario === 'first additions';
    const phone = scenario === 'late clearing' ? [] : noEntries ? [first] : [first, second];
    const computer = scenario === 'previous clearing' ? [] : noEntries ? [second] : [first, second];
    const initial = { ...opening, themeId: 'test-theme', ...(!noEntries && { [field]: [first] }) };
    const db = installWorldFirestore(() => origin + 250);
    db.documents.set(`${resource.collection}/${resource.id}`, { ...initial, _dataEngine: snapshot.metadata });
    const h = documentEngineHarness({ ...snapshot, value: initial }, { apply: command => processCommand(owner, command) });
    const browser = h.createBrowser();
    browser.engine.setOwner(owner);
    browser.engine.setOnline(false);
    const words = (list: string[]) => list.length ? { exists: true, value: list } : { exists: false };
    try {
      const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
      const form = editor.form('question-words', [[field]]);
      await form.begin();
      await form.update(current => {
        const next = { ...current };
        if (phone.length) next[field] = phone;
        else delete next[field];
        return next;
      });
      await form.save(undefined, { documentMetadata: { time: clock(20) } });
      expect(await processCommand(owner, { protocol: 1, owner, resource, operationId: 'computer-list', dependsOn: [],
        generation: 'g', kind: 'update', changes: [
          { path: [field], before: words(noEntries ? [] : [first]), after: words(computer) },
        ],
      })).toMatchObject({ kind: 'acknowledged' });
      browser.engine.setOnline(true);
      await browser.engine.retry();
      await settleEngine();
      const result = await readDocument(owner, resource);
      expect(result).toMatchObject({ metadata: { revision: 3 }, value: { [field]: noEntries ? [second, first] : [second] } });
      expect(editor.getState().checkpoint.conflicts).toEqual([]);
    } finally {
      browser.dispose();
      await settleEngine();
    }
  });
});

const exactWords = (values: string[]) => values.length ? { exists: true, value: values } as const : { exists: false } as const;

function writeAlternates(operationId: string, observedRevision: number, before: string[], after: string[], offset: number | null) {
  return processCommand(owner, { protocol: 1, owner, resource, operationId, dependsOn: [], generation: 'g', kind: 'update',
    changes: [{ path: ['alternates'], before: exactWords(before), after: exactWords(after) }],
    hardQuestionFieldActions: { alternates: { observedRevision, time: offset === null ? null : clock(offset) } },
  });
}

it.each(['added', 'removed'] as const)('remembers an item %s on a later Save when the same result is already stored', async kind => {
  const db = installWorldFirestore(() => origin + 250);
  const item = ['A different wording'];
  const before = kind === 'added' ? [] : item;
  const after = kind === 'added' ? item : [];
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, ...(before.length && { alternates: before }), _dataEngine: snapshot.metadata });
  expect(await writeAlternates('first', 1, before, after, 20)).toMatchObject({ kind: 'acknowledged' });
  expect(await writeAlternates('later-same', 1, before, after, 90)).toMatchObject({ kind: 'acknowledged' });
  expect(await writeAlternates('delayed-reverse', 2, after, before, 50)).toMatchObject({ kind: 'acknowledged' });
  const final = await readDocument(owner, resource);
  expect(final.value?.alternates ?? []).toEqual(after);
});

it.each([
  ['removal', 20, ['Stored words', 'Other phone words']],
  ['removal', 120, ['Stored words', 'The shared wording', 'Other phone words']],
  ['addition', 20, ['The shared wording', 'Stored words', 'Other phone words']],
  ['addition', 120, ['Stored words', 'Other phone words']],
] as const)('keeps the latest %s when a queued edit arrives (time %s)', async (kind, offset, expected) => {
  const db = installWorldFirestore(() => origin + 250);
  const shared = 'The shared wording', stored = 'Stored words', phone = 'Other phone words';
  const removed = kind === 'removal';
  const base = removed ? [] : [shared];
  const next = removed ? [shared] : [];
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, ...(base.length && { alternates: base }), _dataEngine: snapshot.metadata });
  expect(await writeAlternates('computer-first', 1, base, next, 60)).toMatchObject({ kind: 'acknowledged' });
  expect(await writeAlternates('computer-final', 2, next, [...base, stored], 90)).toMatchObject({ kind: 'acknowledged' });
  expect(await writeAlternates('pending-phone', 1, base, [...next, phone], offset)).toMatchObject({ kind: 'acknowledged' });
  expect((await readDocument(owner, resource)).value?.alternates).toEqual(expected);
});

it.each(['local', 'remote'] as const)('preserves the original time of a proven list addition when choosing %s wording', async side => {
  const db = installWorldFirestore(() => origin + 250);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: snapshot.metadata });
  const h = documentEngineHarness(snapshot, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('question-words', [['alternates'], ['detail']]);
    await form.begin();
    await form.update(record => ({ ...record, alternates: ['Phone alternative'], detail: 'Phone detail' }));
    expect(await processCommand(owner, { protocol: 1, owner, resource, operationId: 'computer-detail-and-list',
      dependsOn: [], generation: 'g', kind: 'update', changes: [
        { path: ['detail'], before: { exists: true, value: opening.detail }, after: { exists: true, value: 'Computer detail' } },
        { path: ['alternates'], before: exactWords([]), after: exactWords(['Computer alternative']) },
      ],
    })).toMatchObject({ kind: 'acknowledged' });
    await form.save(undefined, { documentMetadata: { time: clock(20) } });
    await browser.engine.retry();
    await settleEngine();
    const compared = form.getState()?.comparison;
    expect(compared).toMatchObject({ hardQuestionFields: ['detail'], conflictPaths: [['detail']] });
    await form.resolve(side, { expectedComparison: compared, metadataTime: clock(110) });
    await browser.engine.retry();
    await settleEngine();
    const answer = await readDocument(owner, resource);
    expect(answer.value).toMatchObject({ detail: side === 'local' ? 'Phone detail' : 'Computer detail',
      alternates: ['Computer alternative', 'Phone alternative'] });
    expect(jest.mocked(h.transport.send).mock.calls.at(-1)?.[0]).toMatchObject({
      hardQuestionFieldActions: { alternates: { observedRevision: 1, time: clock(20) } },
    });
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('asks about an unstamped request that might undo an observed return of one element', async () => {
  const db = installWorldFirestore(() => origin + 250);
  const item = ['Old alternative'];
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, alternates: item, _dataEngine: snapshot.metadata });
  expect(await writeAlternates('remove', 1, item, [], 40)).toMatchObject({ kind: 'acknowledged' });
  expect(await writeAlternates('readd', 2, [], [...item, 'Second alternative'], 60)).toMatchObject({ kind: 'acknowledged' });
  const result = await processCommand(owner, { protocol: 1, owner, resource, operationId: 'old-no-stamp', generation: 'g',
    dependsOn: [], kind: 'update', changes: [{ path: ['alternates'], before: exactWords(item), after: exactWords([]) }],
  });
  expect(result).toMatchObject({ kind: 'conflict', conflicts: [expect.objectContaining({ path: ['alternates'] })] });
  expect((await readDocument(owner, resource)).value?.alternates).toEqual([...item, 'Second alternative']);
});

it.each(['local', 'remote'] as const)('keeps independent additions when choosing the %s membership', async side => {
  const shared = 'Contested alternative', remote = 'Computer alternative', local = 'Phone alternative';
  const initial = { ...opening, alternates: [shared] };
  const db = installWorldFirestore(() => origin + 250);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...initial, _dataEngine: snapshot.metadata });
  const h = documentEngineHarness({ ...snapshot, value: initial }, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  browser.engine.setOnline(false);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('question-words', [['alternates']]);
    await form.begin();
    await form.update(record => ({ ...record, alternates: [local] }));
    await form.save(undefined, { documentMetadata: { time: null } });
    expect(await writeAlternates('remove', 1, [shared], [], 40)).toMatchObject({ kind: 'acknowledged' });
    expect(await writeAlternates('readd-and-append', 2, [], [shared, remote], 60)).toMatchObject({ kind: 'acknowledged' });
    browser.engine.setOnline(true);
    await browser.engine.retry();
    await settleEngine();
    const compared = form.getState()?.comparison;
    expect(compared).toMatchObject({
      hardQuestionFields: ['alternates'], conflictPaths: [['alternates']],
      mine: { alternates: [remote, local] }, remotePreview: { alternates: [shared, remote, local] },
    });
    await form.resolve(side, { expectedComparison: compared, metadataTime: clock(110) });
    await browser.engine.retry();
    await settleEngine();
    const answer = await readDocument(owner, resource);
    expect(answer.value?.alternates).toEqual(side === 'local' ? [remote, local] : [shared, remote, local]);
    const raw = db.documents.get(`${resource.collection}/${resource.id}`)?._dataEngine as Record<string, unknown>;
    const proof = raw['hardQuestion-alternates'] as { memberships: { changes: { item: string; time: unknown }[] } };
    const key = (value: string) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
    const history = new Map(proof.memberships.changes.map(entry => [entry.item, entry.time]));
    expect(history.get(key(local))).toBeNull();
    expect(history.get(key(shared))).toEqual(clock(110));
    if (side === 'remote') {
      expect(await writeAlternates('older-removal-after-choice', 3, [shared, remote], [remote], 85)).toMatchObject({ kind: 'acknowledged' });
      expect((await readDocument(owner, resource)).value?.alternates).toEqual([shared, remote, local]);
    }
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('replays two offline Saves against an independently added first list entry', async () => {
  const db = installWorldFirestore(() => origin + 250);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: snapshot.metadata });
  const h = documentEngineHarness(snapshot, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  browser.engine.setOnline(false);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('question-words', [['alternates']]);
    await form.begin();
    await form.update(value => ({ ...value, alternates: ['First local wording'] }));
    await form.save(undefined, { documentMetadata: { time: clock(20) } });
    await form.begin();
    await form.update(value => ({ ...value, alternates: ['First local wording', 'Second local wording'] }));
    await form.save(undefined, { documentMetadata: { time: clock(40) } });
    expect(await writeAlternates('computer-add', 1, [], ['Computer wording'], 60)).toMatchObject({ kind: 'acknowledged' });
    browser.engine.setOnline(true);
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value?.alternates).toEqual([
      'Computer wording', 'First local wording', 'Second local wording',
    ]);
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
    const sent = jest.mocked(h.transport.send).mock.calls.map(([command]) => command);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ hardQuestionFieldActions: { alternates: { time: clock(40) } } });
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('does not merge old basis links into a question now in a different theme', async () => {
  const db = installWorldFirestore(() => origin + 250);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, themeId: 'old-theme', _dataEngine: snapshot.metadata });
  db.documents.set('hardQuestionThemes/new-theme', { userId: owner, title: 'New theme', rank: 1000,
    createdAt: opening.createdAt, updatedAt: opening.updatedAt,
    bases: [{ id: 'new-basis', title: 'Basis of the new theme', scriptureRefs: ['John 3:16'] }], _dataEngine: snapshot.metadata });
  const update = { protocol: 1, owner, resource, generation: 'g', dependsOn: [], kind: 'update' } as const;
  expect(await processCommand(owner, { ...update, dependsOn: [], operationId: 'new-theme', changes: [
    { path: ['themeId'], before: { exists: true, value: 'old-theme' }, after: { exists: true, value: 'new-theme' } },
  ] })).toMatchObject({ kind: 'acknowledged' });
  expect(await processCommand(owner, { ...update, operationId: 'link-new-basis', changes: [
    { path: ['basisIds'], before: exactWords([]), after: exactWords(['new-basis']) },
  ] })).toMatchObject({ kind: 'acknowledged' });
  expect(await processCommand(owner, { ...update, dependsOn: [], operationId: 'old-basis', changes:
    [{ path: ['basisIds'], before: exactWords([]), after: exactWords(['old-basis']) }],
    hardQuestionFieldActions: { basisIds: { observedRevision: 1, time: clock(20), basisTheme: 'old-theme' } },
  })).toMatchObject({ kind: 'conflict', conflicts: [expect.objectContaining({ path: ['basisIds'] })] });
  expect((await readDocument(owner, resource)).value).toMatchObject({ themeId: 'new-theme', basisIds: ['new-basis'] });
});

it('makes a fresh comparison when an unchanged item was explicitly reaffirmed after the choice opened', async () => {
  const db = installWorldFirestore(() => origin + 250);
  const item = ['Contested alternative'];
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, alternates: item, _dataEngine: snapshot.metadata });
  expect(await writeAlternates('remove', 1, item, [], 40)).toMatchObject({ kind: 'acknowledged' });
  expect(await writeAlternates('restore', 2, [], item, 60)).toMatchObject({ kind: 'acknowledged' });
  expect(await writeAlternates('reaffirm', 2, [], item, 120)).toMatchObject({ kind: 'acknowledged' });
  const stale = await processCommand(owner, { protocol: 1, owner, resource, generation: 'g', dependsOn: [],
    operationId: 'choosing-from-revision-3', kind: 'update', changes: [{ path: ['alternates'], before: exactWords(item), after: exactWords([]) }],
    hardQuestionFieldActions: { alternates: { observedRevision: 3, time: clock(110), reviewed: true } },
  });
  expect(stale).toMatchObject({ kind: 'conflict', conflicts: [expect.objectContaining({ path: ['alternates'] })] });
  expect((await readDocument(owner, resource)).value?.alternates).toEqual(item);
});

it('records an explicit choice of the saved membership even when no visible field changes', async () => {
  const shared = 'Contested alternative';
  const initial = { ...opening, alternates: [shared] };
  const db = installWorldFirestore(() => origin + 250);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...initial, _dataEngine: snapshot.metadata });
  const h = documentEngineHarness({ ...snapshot, value: initial }, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('question-words', [['alternates']]);
    await form.begin();
    await form.update(({ alternates: _alternates, ...record }) => record);
    expect(await writeAlternates('remove', 1, [shared], [], 40)).toMatchObject({ kind: 'acknowledged' });
    expect(await writeAlternates('restore', 2, [], [shared], 60)).toMatchObject({ kind: 'acknowledged' });
    await form.save(undefined, { documentMetadata: { time: null } });
    await browser.engine.retry();
    await settleEngine();
    const compared = form.getState()?.comparison;
    expect(compared?.hardQuestionListItems).toEqual({ alternates: [shared] });
    await form.resolve('remote', { expectedComparison: compared, metadataTime: clock(110) });
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).metadata?.revision).toBe(4);
    expect(await writeAlternates('late-old-removal', 3, [shared], [], 85)).toMatchObject({ kind: 'acknowledged' });
    expect((await readDocument(owner, resource)).value?.alternates).toEqual([shared]);
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it.each(['same membership', 'another item'] as const)('keeps the independently added words if a reviewed choice meets %s', async intervening => {
  const shared = 'Contested alternative', phone = 'Phone alternative', computer = 'Computer alternative', newWord = 'Later computer item';
  const initial = { ...opening, alternates: [shared] };
  const db = installWorldFirestore(() => origin + 250);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...initial, _dataEngine: snapshot.metadata });
  let injected = false;
  const h = documentEngineHarness({ ...snapshot, value: initial }, { apply: async command => {
    if (!injected && command.kind === 'update' && command.hardQuestionFieldActions?.alternates?.reviewed) {
      injected = true;
      const stored = [shared, computer];
      if (intervening === 'same membership') {
        await writeAlternates('computer-new-approval', 2, [], stored, 120);
      } else {
        await writeAlternates('computer-adds-an-item', 3, stored, [...stored, newWord], 120);
      }
    }
    return processCommand(owner, command);
  } });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('question-words', [['alternates']]);
    await form.begin();
    await form.update(record => ({ ...record, alternates: [phone] }));
    expect(await writeAlternates('remove', 1, [shared], [], 40)).toMatchObject({ kind: 'acknowledged' });
    expect(await writeAlternates('restore-and-add', 2, [], [shared, computer], null)).toMatchObject({ kind: 'acknowledged' });
    await form.save(undefined, { documentMetadata: { time: clock(20) } });
    await browser.engine.retry();
    await settleEngine();
    const initialChoice = form.getState()?.comparison;
    expect(initialChoice?.hardQuestionListItems).toEqual({ alternates: [shared] });
    await form.resolve('local', { expectedComparison: initialChoice, metadataTime: clock(110) });
    await browser.engine.retry();
    await settleEngine();
    const common = intervening === 'same membership' ? [computer, phone] : [computer, newWord, phone];
    const nextChoice = form.getState()?.comparison;
    expect(nextChoice).toMatchObject({ mine: { alternates: common }, remotePreview: { alternates: [shared, ...common] } });
    const storedRequests = await h.commits.list(owner);
    const request = storedRequests.find(entry => entry.id === nextChoice?.requestId);
    const scope = request?.retentionScope && readManualScopeIdentity(request.retentionScope);
    const stage = form.getState();
    if (!scope || !request?.retentionScope || !stage) throw new Error('Expected the original form scope');
    const anotherTab = editorIdentity('different-tab', resource, editorSlot(scope.parentEditorId) ?? 'question', 'another-opening');
    const reopened = recoverManualScopeRecord(stage.record, manualScopeIdentity(anotherTab, scope.slot),
      { id: request.retentionScope, version: null });
    expect(exactManualRequest({ ...stage, record: reopened }, editor.getState().checkpoint,
      new Map(storedRequests.map(commit => [commit.id, commit])))?.id).toBe(request.id);
    const blocked = await browser.engine.takeStoredVersion(resource, [request.id]).then(
      taken => ({ taken, state: 'resolved' }),
      (error: { code?: string }) => ({ code: error.code, state: 'protected' }),
    );
    expect(blocked).toEqual({ code: 'decision-changed', state: 'protected' });
    expect(await h.commits.list(owner)).toContainEqual(expect.objectContaining({ id: request.id, state: 'conflict' }));
    await form.resolve('remote', { expectedComparison: nextChoice, metadataTime: clock(150) });
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value?.alternates).toEqual([shared, ...common]);
    const raw = db.documents.get(`${resource.collection}/${resource.id}`)?._dataEngine as Record<string, unknown>;
    const proof = raw['hardQuestion-alternates'] as { memberships: { changes: { item: string; time: unknown }[] } };
    expect(proof.memberships.changes).toContainEqual(expect.objectContaining({
      item: createHash('sha256').update(JSON.stringify(phone)).digest('base64url'), time: clock(20),
    }));
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it.each(['reaffirms the same item', 'adds another item'] as const)('finishes the remote choice if a second device %s while it sends', async intervening => {
  const shared = 'Contested alternative', phone = 'Phone alternative', other = 'Later computer item';
  const initial = { ...opening, alternates: [shared] };
  const db = installWorldFirestore(() => origin + 250);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...initial, _dataEngine: snapshot.metadata });
  const adds = intervening === 'adds another item';
  let changed = false;
  const h = documentEngineHarness({ ...snapshot, value: initial }, { apply: async command => {
    if (!changed && command.kind === 'update' && command.hardQuestionFieldActions?.alternates?.confirmedItems?.length) {
      changed = true;
      await writeAlternates('intervening', adds ? 3 : 2, adds ? [shared] : [], adds ? [shared, other] : [shared], 120);
    }
    return processCommand(owner, command);
  } });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('question-words', [['alternates']]);
    await form.begin();
    await form.update(({ alternates: _words, ...record }) => ({ ...record, ...(adds && { alternates: [phone] }) }));
    expect(await writeAlternates('remove', 1, [shared], [], 40)).toMatchObject({ kind: 'acknowledged' });
    expect(await writeAlternates('restore', 2, [], [shared], adds ? null : 60)).toMatchObject({ kind: 'acknowledged' });
    await form.save(undefined, { documentMetadata: { time: adds ? clock(20) : null } });
    await browser.engine.retry();
    await settleEngine();
    const compared = form.getState()?.comparison;
    expect(compared?.hardQuestionListItems).toEqual({ alternates: [shared] });
    await form.resolve('remote', { expectedComparison: compared, metadataTime: clock(110) });
    await browser.engine.retry();
    await settleEngine();
    const final = await readDocument(owner, resource);
    expect(final.metadata?.revision).toBe(5);
    expect(final.value?.alternates).toEqual(adds ? [shared, other, phone] : [shared]);
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
    const raw = db.documents.get(`${resource.collection}/${resource.id}`)?._dataEngine as Record<string, unknown>;
    const proof = raw['hardQuestion-alternates'] as { memberships: { changes: { item: string; time: unknown }[] } };
    const key = (value: string) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
    const times = new Map(proof.memberships.changes.map(entry => [entry.item, entry.time]));
    expect(times.get(key(shared))).toEqual(clock(adds ? 110 : 120));
    if (adds) expect(times.get(key(phone))).toEqual(clock(20));
  } finally {
    browser.dispose();
    await settleEngine();
  }
});
