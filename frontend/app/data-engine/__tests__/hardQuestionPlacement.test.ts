/** @jest-environment node */
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { installWorldFirestore } from '@test-utils/deviceWorld/firestore';

import { projectHardQuestionPlace } from '../hardQuestionPlacement';
import { readHardQuestionPlacementReview } from '../hardQuestionPlacementChoice';
import { processCommand, readDocument } from '../server';

import type { DataCommand, DocumentData, FieldValue } from '../types';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() }, FieldValue: { increment: (amount: number) => ({ __testIncrement: amount }) } }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/data-engine/activation', () => ({ ...jest.requireActual('@/data-engine/activation'), isCollectionServed: () => true }));

const epoch = 1_800_000_000_000;
const clock = (offset: number) => ({ earliestMs: epoch + offset, latestMs: epoch + offset + 5 });
const owner = 'owner';
const resource = { collection: 'hardQuestions', id: 'question-placement' };
const metadata = { protocol: 1, generation: 'opening-generation', revision: 1, deleted: false } as const;
const dates = { createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z' };
const opening = { userId: owner, title: 'Question', detail: 'Original answer', themeId: 'theme-a', rank: 1000, ...dates };
const before = { themeId: 'theme-a', groupId: null, rank: 1000 };
const themeB = { themeId: 'theme-b', groupId: null, rank: 3000 };
const groupA = { themeId: 'theme-a', groupId: 'group-a', rank: 3000 };

const value = (item: string | number | null): FieldValue => item === null ? { exists: false } : { exists: true, value: item };

function place(operationId: string, after: typeof before | typeof groupA, time: number | null, timed = true) {
  const changes = (['themeId', 'groupId', 'rank'] as const).filter(field => before[field] !== after[field]).map(field => (
    { path: [field], before: value(before[field]), after: value(after[field]) }
  ));
  const command: Extract<DataCommand, { kind: 'update' }> = {
    protocol: 1, owner, resource, operationId, dependsOn: [], generation: metadata.generation, kind: 'update', changes,
  };
  return processCommand(owner, { ...command, ...(timed && {
    hardQuestionPlacement: { before, after, observedRevision: 1, time: time === null ? null : clock(time) },
  }) });
}

function seed(question: DocumentData = opening) {
  const db = installWorldFirestore(() => epoch + 300);
  const themes = [
    { id: 'theme-a', title: 'Theme A', groups: [{ id: 'group-a', title: 'First group in A' }, { id: 'another-group-a', title: 'Second group in A' }],
      bases: [{ id: 'reason-a', title: 'Reason A', scriptureRefs: ['John 3:16'] }] },
    { id: 'theme-b', title: 'Theme B', groups: [{ id: 'group-b', title: 'Group in B' }] },
  ];
  for (const { id, ...theme } of themes) {
    db.documents.set('hardQuestionThemes/' + id, { ...theme, userId: owner, rank: 1000, ...dates,
      _dataEngine: { ...metadata, generation: id + '-opening' } });
  }
  db.documents.set(`${resource.collection}/${resource.id}`, { ...question, _dataEngine: metadata });
}

it.each([['older', 25], ['later', 125]] as const)('takes one complete destination when the %s move arrives second with the same rank', async (order, time) => {
  seed();
  expect(await place('to-theme-b', themeB, 75)).toMatchObject({ kind: 'acknowledged' });
  expect(await place('to-group-in-theme-a', groupA, time)).toMatchObject({ kind: 'acknowledged' });
  const stored = (await readDocument(owner, resource)).value!;
  expect({ themeId: stored.themeId, groupId: stored.groupId ?? null, rank: stored.rank }).toEqual(order === 'later' ? groupA : themeB);
  expect(stored.detail).toBe(opening.detail);
});

it('holds two entire destinations for a choice when it cannot order the two moves', async () => {
  seed();
  expect(await place('known-theme-b', themeB, 75)).toMatchObject({ kind: 'acknowledged' });
  expect(await place('unknown-group-a', groupA, null)).toMatchObject({ kind: 'conflict', conflicts: [
    expect.objectContaining({
      path: ['themeId'],
      base: { exists: true, value: before },
      mine: { exists: true, value: groupA },
      theirs: { exists: true, value: themeB },
    }),
  ] });
  const stored = (await readDocument(owner, resource)).value!;
  expect({ themeId: stored.themeId, groupId: stored.groupId ?? null, rank: stored.rank }).toEqual(themeB);
});

it('keeps a legacy move from installing a group belonging to the previous theme', async () => {
  seed();
  expect(await place('new-theme-b', themeB, 75)).toMatchObject({ kind: 'acknowledged' });
  expect(await place('legacy-group-a', groupA, null, false)).toMatchObject({ kind: 'conflict' });
  const stored = (await readDocument(owner, resource)).value!;
  expect({ themeId: stored.themeId, groupId: stored.groupId ?? null, rank: stored.rank }).toEqual(themeB);
});

it.each(['local', 'remote'] as const)('keeps the exact %s place chosen in the document editor', async side => {
  seed();
  const h = documentEngineHarness({ resource, value: opening, metadata }, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    browser.engine.setOnline(false);
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    await editor.commit(current => projectHardQuestionPlace(current!, groupA), { kind: 'document-metadata', time: null });
    const competing = await place('stored-theme-b', themeB, 70);
    if (competing.kind !== 'acknowledged' || !competing.snapshot.value) throw new Error('Expected a saved competing destination');
    jest.mocked(h.transport.read).mockImplementation(() => readDocument(owner, resource));
    browser.engine.setOnline(true);
    await browser.engine.retry();
    await settleEngine();
    expect(jest.mocked(h.transport.send).mock.calls[0]?.[0]).toMatchObject({
      hardQuestionPlacement: { before, after: groupA, observedRevision: 1, time: null },
    });
    const compared = editor.getState().checkpoint;
    const review = readHardQuestionPlacementReview(compared);
    if (!review || !editor.applyHardQuestionPlacementReview) throw new Error('Expected the document to own the placement choice');
    expect(review).toMatchObject({ mine: groupA, saved: themeB });
    await expect(editor.acceptRemote()).rejects.toMatchObject({ code: 'decision-changed' });
    await expect(browser.engine.takeStoredVersion(resource)).rejects.toMatchObject({ code: 'decision-changed' });
    await editor.applyHardQuestionPlacementReview(compared, review.identity, side, clock(180));
    await browser.engine.retry();
    await settleEngine();
    const target = side === 'local' ? groupA : themeB;
    expect(jest.mocked(h.transport.send).mock.calls[1]?.[0]).toMatchObject({
      hardQuestionPlacement: { before: themeB, after: target, observedRevision: 2, time: clock(180), reviewed: true },
    });
    const stored = (await readDocument(owner, resource)).value!;
    expect({ themeId: stored.themeId, groupId: stored.groupId ?? null, rank: stored.rank }).toEqual(target);
    expect(stored.detail).toBe(opening.detail);
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('offers the saved place when the requested group was deleted before delivery', async () => {
  seed();
  const theme = { collection: 'hardQuestionThemes', id: 'theme-a' };
  const document = await readDocument(owner, theme);
  expect(await processCommand(owner, { protocol: 1, owner, resource: theme, operationId: 'remove-destination-group', dependsOn: [],
    kind: 'update', generation: document.metadata?.generation ?? null,
    changes: [{ path: ['groups'], before: { exists: true, value: document.value?.groups ?? [] }, after: { exists: true, value: [] } }],
  })).toMatchObject({ kind: 'acknowledged' });
  expect(await place('unavailable-destination', groupA, 50)).toMatchObject({ kind: 'conflict', conflicts: [
    expect.objectContaining({ code: 'hard-question-placement-unavailable', theirs: { exists: true, value: before } }),
  ] });
  expect((await readDocument(owner, resource)).value).toEqual(opening);
});

it('accepts an observed unchanged place after a separate answer Save', async () => {
  seed();
  expect(await processCommand(owner, { protocol: 1, owner, resource, operationId: 'words-only', dependsOn: [],
    kind: 'update', generation: metadata.generation,
    changes: [{ path: ['detail'], before: value(opening.detail), after: value('New words already saved') }],
  })).toMatchObject({ kind: 'acknowledged' });
  expect(await place('older-device-changes-place-only', groupA, null)).toMatchObject({ kind: 'acknowledged' });
  expect((await readDocument(owner, resource)).value).toMatchObject({ themeId: 'theme-a', groupId: 'group-a', detail: 'New words already saved' });
});

it('allows rank changes for an existing orphaned placement without reattaching the question', async () => {
  seed({ ...opening, themeId: 'retired-theme', groupId: 'retired-group' });
  expect(await processCommand(owner, { protocol: 1, owner, resource, operationId: 'rank-in-orphan-list', dependsOn: [],
    kind: 'update', generation: metadata.generation, changes: [{ path: ['rank'], before: value(1000), after: value(2500) }],
  })).toMatchObject({ kind: 'acknowledged' });
  expect((await readDocument(owner, resource)).value).toMatchObject({ themeId: 'retired-theme', groupId: 'retired-group', rank: 2500 });
});

it('keeps the old visible opening when the queue already reads the newer place', async () => {
  seed();
  const later = { ...groupA, groupId: 'another-group-a', rank: 4000 };
  expect(await place('newer-competing-group', later, 130)).toMatchObject({ kind: 'acknowledged' });
  const refreshed = await readDocument(owner, resource);
  const h = documentEngineHarness(refreshed, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    await editor.commit(current => projectHardQuestionPlace(current!, groupA), {
      kind: 'document-metadata', time: clock(40), hardQuestionPlacementOpening: { place: before, observedRevision: 1 },
    });
    await browser.engine.retry();
    await settleEngine();
    expect(jest.mocked(h.transport.send).mock.calls[0]?.[0]).toMatchObject({
      hardQuestionPlacement: { before, after: groupA, observedRevision: 1, time: clock(40) },
    });
    expect((await readDocument(owner, resource)).value).toMatchObject(later);
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('accepts a legacy move to a group of the current theme after opening a different theme', async () => {
  seed();
  expect(await place('to-new-theme', themeB, 100)).toMatchObject({ kind: 'acknowledged' });
  expect(await processCommand(owner, { protocol: 1, owner, resource, operationId: 'legacy-new-theme-group', dependsOn: [],
    kind: 'update', generation: metadata.generation,
    changes: [{ path: ['groupId'], before: value(null), after: value('group-b') }],
  })).toMatchObject({ kind: 'acknowledged' });
  expect((await readDocument(owner, resource)).value).toMatchObject({ ...themeB, groupId: 'group-b' });
});

it('holds a legacy move after the current location has changed and returned', async () => {
  seed();
  expect(await place('out-to-group', groupA, 60)).toMatchObject({ kind: 'acknowledged' });
  expect(await processCommand(owner, { protocol: 1, owner, resource, operationId: 'return-to-opening', dependsOn: [], kind: 'update',
    generation: metadata.generation, changes: [
      { path: ['groupId'], before: value(groupA.groupId), after: value(null) },
      { path: ['rank'], before: value(groupA.rank), after: value(before.rank) },
    ], hardQuestionPlacement: { before: groupA, after: before, time: clock(135), observedRevision: 2 },
  })).toMatchObject({ kind: 'acknowledged' });
  expect(await place('old-unstamped-move', { ...groupA, groupId: 'another-group-a' }, null, false)).toMatchObject({ kind: 'conflict' });
  const stored = (await readDocument(owner, resource)).value!;
  expect({ themeId: stored.themeId, groupId: stored.groupId ?? null, rank: stored.rank }).toEqual(before);
});

it('carries basis links in the same theme and does not retime separately saved words when choosing a place', async () => {
  seed();
  const h = documentEngineHarness({ resource, value: opening, metadata }, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    browser.engine.setOnline(false);
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    await editor.commit(current => projectHardQuestionPlace(current!, groupA), { kind: 'document-metadata', time: null });
    const form = editor.form('question-fields', [['basisIds'], ['detail']]);
    await form.begin();
    await form.update(draft => ({ ...draft, basisIds: ['reason-a'], detail: 'Separately saved text' }));
    await form.save(undefined, { documentMetadata: { time: clock(35) } });
    const other = { ...groupA, groupId: 'another-group-a', rank: 4000 };
    expect(await place('other-group-without-new-text', other, 90)).toMatchObject({ kind: 'acknowledged' });
    jest.mocked(h.transport.read).mockImplementation(() => readDocument(owner, resource));
    browser.engine.setOnline(true);
    await browser.engine.retry();
    await settleEngine();
    const compared = editor.getState().checkpoint;
    const review = readHardQuestionPlacementReview(compared);
    if (!review || !editor.applyHardQuestionPlacementReview) throw new Error('Expected the placement choice after the separate Save');
    await editor.applyHardQuestionPlacementReview(compared, review.identity, 'local', clock(185));
    await browser.engine.retry();
    await settleEngine();
    const sent = jest.mocked(h.transport.send).mock.calls.map(([command]) => command);
    expect(sent[1]).toMatchObject({ hardQuestionFieldActions: { detail: { time: clock(35) }, basisIds: { time: clock(35), basisTheme: 'theme-a' } } });
    expect(sent[2]).toMatchObject({ hardQuestionPlacement: { after: groupA, time: clock(185) } });
    expect(sent[2]).not.toHaveProperty('hardQuestionFieldActions');
    expect((await readDocument(owner, resource)).value).toMatchObject({ ...groupA, basisIds: ['reason-a'], detail: 'Separately saved text' });
  } finally {
    browser.dispose();
    await settleEngine();
  }
});
