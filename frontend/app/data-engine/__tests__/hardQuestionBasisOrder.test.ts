/** @jest-environment node */
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { installWorldFirestore } from '@test-utils/deviceWorld/firestore';

import { processCommand, readDocument } from '../server';

import type { HardQuestionBasisActions } from '../hardQuestionBasisFields';
import type { DataCommand, DocumentData, ResourceSnapshot } from '../types';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() }, FieldValue: { increment: (amount: number) => ({ __testIncrement: amount }) } }));
jest.mock('@/data-engine/activation', () => ({ ...jest.requireActual('@/data-engine/activation'), isCollectionServed: () => true }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const epoch = 1_800_000_000_000;
const clock = (offset: number) => ({ earliestMs: epoch + offset, latestMs: epoch + offset + 5 });
const owner = 'owner';
const resource = { collection: 'hardQuestionThemes', id: 'theme-chronology' };
const metadata = { protocol: 1, generation: 'theme-generation', revision: 1, deleted: false } as const;
const basis = { id: 'basis-a', title: 'First basis', label: 'Previous label', text: 'Opening words', scriptureRefs: ['John 3:16', 'John 3:17'] };
const otherBasis = { id: 'basis-b', title: 'Second basis', scriptureRefs: ['John 3:18'] };
const opening = { userId: owner, title: 'Theme', rank: 1000, createdAt: '2026-11-25T00:00:00.000Z',
  updatedAt: '2026-11-25T00:00:00.000Z', bases: [basis, otherBasis] };
const snapshot: ResourceSnapshot = { resource, value: opening, metadata };
const field = (value: DocumentData[]) => ({ exists: true as const, value });

function saveBasis(operationId: string, before: DocumentData[], after: DocumentData[], changes: HardQuestionBasisActions) {
  const command: Extract<DataCommand, { kind: 'update' }> = { protocol: 1, owner, resource, operationId, dependsOn: [], generation: metadata.generation,
    kind: 'update', changes: [{ path: ['bases'], before: field(before), after: field(after) }] };
  return processCommand(owner, { ...command, hardQuestionBasisFieldActions: changes });
}

function authored<Value extends string | null | string[]>(from: Value, to: Value, madeAt: number, observedRevision = 1) {
  return { rowId: basis.id, rowCreatedAt: basis.id, before: from, after: to, observedRevision, time: clock(madeAt) };
}

it.each([['newer', 130], ['older', 30]] as const)('orders the %s Save of a basis by the action time and leaves another basis intact', async (order, phoneTime) => {
  const db = installWorldFirestore(() => epoch + 300);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
  const h = documentEngineHarness(snapshot, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const parent = await browser.engine.openEditor(resource, browser.editorId(resource));
    const selection = (['title', 'label', 'text', 'scriptureRefs'] as const).map(part => ['bases', { id: basis.id }, part]);
    const form = parent.form('basis:' + basis.id, selection);
    await form.begin();
    await form.update(current => ({ ...current, bases: [{ ...basis, title: 'Phone heading', text: 'Phone wording' }, otherBasis] }));
    const computer = { ...basis, title: 'Computer heading', text: 'Computer wording' };
    const unaffected = { ...otherBasis, text: 'Independent words on the second basis' };
    expect(await saveBasis('computer-basis', opening.bases, [unaffected, computer], {
      title: authored(basis.title, computer.title, 90), text: authored(basis.text, computer.text, 90),
    })).toMatchObject({ kind: 'acknowledged' });
    await form.save(undefined, { documentMetadata: { time: clock(phoneTime) } });
    await browser.engine.retry();
    await settleEngine();
    const sent = jest.mocked(h.transport.send).mock.calls[0]?.[0];
    expect(sent).toMatchObject({ kind: 'update', hardQuestionBasisFieldActions: {
      title: authored(basis.title, 'Phone heading', phoneTime), text: authored(basis.text, 'Phone wording', phoneTime),
    } });
    expect((await readDocument(owner, resource)).value?.bases).toEqual([
      unaffected, order === 'newer' ? { ...basis, title: 'Phone heading', text: 'Phone wording' } : computer,
    ]);
    expect(form.getState()?.comparison).toBeUndefined();
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('does not resurrect a retired label after a later deliberate clearing', async () => {
  const db = installWorldFirestore(() => epoch + 300);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
  const { label: _, ...clean } = basis;
  expect(await saveBasis('clear-label', opening.bases, [clean, otherBasis], {
    label: authored<string | null>(basis.label, null, 120),
  })).toMatchObject({ kind: 'acknowledged' });
  expect(await saveBasis('old-label', opening.bases, [{ ...basis, label: 'Delayed label' }, otherBasis], {
    label: authored<string | null>(basis.label, 'Delayed label', 40),
  })).toMatchObject({ kind: 'acknowledged' });
  expect((await readDocument(owner, resource)).value?.bases).toEqual([clean, otherBasis]);
});

it('keeps the later valid reference list when combining two edits would remove the last place', async () => {
  const db = installWorldFirestore(() => epoch + 300);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
  const phone = { ...basis, scriptureRefs: ['John 3:17'] };
  const computer = { ...basis, scriptureRefs: ['John 3:16'] };
  expect(await saveBasis('computer-ref', opening.bases, [computer, otherBasis], {
    scriptureRefs: authored(basis.scriptureRefs, computer.scriptureRefs, 100),
  })).toMatchObject({ kind: 'acknowledged' });
  expect(await saveBasis('phone-ref', opening.bases, [phone, otherBasis], {
    scriptureRefs: authored(basis.scriptureRefs, phone.scriptureRefs, 160),
  })).toMatchObject({ kind: 'acknowledged' });
  expect((await readDocument(owner, resource)).value?.bases).toEqual([phone, otherBasis]);
});

it('combines separately added references when the resulting basis still has a valid place', async () => {
  const db = installWorldFirestore(() => epoch + 300);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
  const phone = { ...basis, scriptureRefs: [...basis.scriptureRefs, 'John 3:20'] };
  const computer = { ...basis, scriptureRefs: [...basis.scriptureRefs, 'John 3:19'] };
  expect(await saveBasis('computer-add-ref', opening.bases, [computer, otherBasis], {
    scriptureRefs: authored(basis.scriptureRefs, computer.scriptureRefs, 120),
  })).toMatchObject({ kind: 'acknowledged' });
  expect(await saveBasis('older-independently-added-ref', opening.bases, [phone, otherBasis], {
    scriptureRefs: authored(basis.scriptureRefs, phone.scriptureRefs, 40),
  })).toMatchObject({ kind: 'acknowledged' });
  const stored = (await readDocument(owner, resource)).value?.bases as DocumentData[];
  expect(stored[0].scriptureRefs).toEqual(expect.arrayContaining([...basis.scriptureRefs, 'John 3:19', 'John 3:20']));
  expect(stored[1]).toEqual(otherBasis);
});

it.each([['earlier heading', 80], ['later heading', 150]] as const)(
  'asks only about the overlapping words and keeps the proved %s after choice', async (timing, phoneTime) => {
    const db = installWorldFirestore(() => epoch + 300);
    db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
    const h = documentEngineHarness(snapshot, { apply: command => processCommand(owner, command) });
    const browser = h.createBrowser();
    browser.engine.setOwner(owner);
    try {
      const parent = await browser.engine.openEditor(resource, browser.editorId(resource));
      const form = parent.form('basis:' + basis.id, [['bases', { id: basis.id }, 'title'], ['bases', { id: basis.id }, 'text']]);
      await form.begin();
      await form.update(current => ({ ...current, bases: [{ ...basis, title: 'Phone heading', text: 'Phone wording' }, otherBasis] }));
      const computer = { ...basis, title: 'Computer heading', text: 'Computer wording' };
      expect(await saveBasis('computer-words', opening.bases, [computer, otherBasis], {
        title: authored(basis.title, computer.title, 100),
        text: { ...authored(basis.text, computer.text, 100), time: null },
      })).toMatchObject({ kind: 'acknowledged' });
      await form.save(undefined, { documentMetadata: { time: clock(phoneTime) } });
      await browser.engine.retry();
      await settleEngine();
      const comparison = form.getState()?.comparison;
      expect(comparison?.basisScripture).toMatchObject({ refsUnderReview: false,
        otherFields: [{ field: 'text', mine: 'Phone wording', stored: 'Computer wording' }],
      });
      await form.resolve('local', { expectedComparison: comparison, metadataTime: clock(200) });
      await browser.engine.retry();
      await settleEngine();
      expect((await readDocument(owner, resource)).value?.bases).toEqual([
        { ...basis, title: timing === 'later heading' ? 'Phone heading' : 'Computer heading', text: 'Phone wording' }, otherBasis,
      ]);
    } finally {
      browser.dispose();
      await settleEngine();
    }
  },
);

it('asks again when a reviewed choice meets a new version and retains the next explicit confirmation', async () => {
  const db = installWorldFirestore(() => epoch + 300);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
  const computer = { ...basis, text: 'First computer version' };
  const newest = { ...computer, text: 'New computer version' };
  let intervened = false;
  const h = documentEngineHarness(snapshot, { apply: async command => {
    if (!intervened && command.kind === 'update' && command.hardQuestionBasisFieldActions?.text?.reviewed) {
      intervened = true;
      expect(await saveBasis('newest-before-review-arrives', [computer, otherBasis], [newest, otherBasis], {
        text: authored(computer.text, newest.text, 180, 2),
      })).toMatchObject({ kind: 'acknowledged' });
    }
    return processCommand(owner, command);
  } });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('basis:' + basis.id, [['bases', { id: basis.id }, 'text']]);
    await form.begin();
    await form.update(current => ({ ...current, bases: [{ ...basis, text: 'Phone wording' }, otherBasis] }));
    expect(await saveBasis('original-computer', opening.bases, [computer, otherBasis], {
      text: { ...authored(basis.text, computer.text, 100), time: null },
    })).toMatchObject({ kind: 'acknowledged' });
    await form.save(undefined, { documentMetadata: { time: clock(90) } });
    await browser.engine.retry();
    await settleEngine();
    const comparison = form.getState()?.comparison;
    expect(comparison?.basisScripture?.otherFields).toEqual([{ field: 'text', mine: 'Phone wording', stored: computer.text }]);
    await form.resolve('local', { expectedComparison: comparison, metadataTime: clock(210) });
    await browser.engine.retry();
    await settleEngine();
    const renewed = form.getState()?.comparison;
    expect(renewed?.basisScripture?.otherFields).toEqual([{ field: 'text', mine: 'Phone wording', stored: newest.text }]);
    expect((await readDocument(owner, resource)).value?.bases).toEqual([newest, otherBasis]);
    const requestId = renewed?.requestId;
    if (!requestId) throw new Error('Expected the renewed comparison');
    await expect(browser.engine.takeStoredVersion(resource, [requestId])).rejects.toMatchObject({ code: 'decision-changed' });
    await form.resolve('remote', { expectedComparison: renewed, metadataTime: clock(260) });
    await browser.engine.retry();
    await settleEngine();
    expect(jest.mocked(h.transport.send).mock.calls[2]?.[0]).toMatchObject({ hardQuestionBasisFieldActions: {
      text: { ...authored(newest.text, newest.text, 260, 3), reviewed: true },
    } });
    expect(await saveBasis('old-write-after-latest-choice', [newest, otherBasis], [{ ...newest, text: 'Delayed phone words' }, otherBasis], {
      text: authored(newest.text, 'Delayed phone words', 225, 3),
    })).toMatchObject({ kind: 'acknowledged' });
    expect((await readDocument(owner, resource)).value?.bases).toEqual([newest, otherBasis]);
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('does not silently take an old unstamped heading after the stored heading has changed and returned', async () => {
  const db = installWorldFirestore(() => epoch + 300);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
  const changed = { ...basis, title: 'Temporary heading' };
  expect(await saveBasis('change-heading', opening.bases, [changed, otherBasis], {
    title: authored(basis.title, changed.title, 70),
  })).toMatchObject({ kind: 'acknowledged' });
  expect(await saveBasis('restore-heading', [changed, otherBasis], opening.bases, {
    title: authored(changed.title, basis.title, 120, 2),
  })).toMatchObject({ kind: 'acknowledged' });
  expect(await saveBasis('old-unstamped-heading', opening.bases, [{ ...basis, title: 'Old title' }, otherBasis], {}))
    .toMatchObject({ kind: 'conflict', conflicts: [expect.objectContaining({ path: ['bases', 'id:basis-a', 'title'] })] });
  expect((await readDocument(owner, resource)).value?.bases).toEqual(opening.bases);
});

it('keeps a later restored reference when another reference was independently added at the same time', async () => {
  const db = installWorldFirestore(() => epoch + 300);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
  const reduced = { ...basis, scriptureRefs: ['John 3:16'] };
  const restored = { ...basis, scriptureRefs: ['John 3:16', 'John 3:17', 'John 3:19'] };
  expect(await saveBasis('remove-17', opening.bases, [reduced, otherBasis], {
    scriptureRefs: authored(basis.scriptureRefs, reduced.scriptureRefs, 70),
  })).toMatchObject({ kind: 'acknowledged' });
  expect(await saveBasis('restore-17-and-add-19', [reduced, otherBasis], [restored, otherBasis], {
    scriptureRefs: authored(reduced.scriptureRefs, restored.scriptureRefs, 120, 2),
  })).toMatchObject({ kind: 'acknowledged' });
  expect(await saveBasis('old-remove-17', opening.bases, [reduced, otherBasis], {
    scriptureRefs: authored(basis.scriptureRefs, reduced.scriptureRefs, 20),
  })).toMatchObject({ kind: 'acknowledged' });
  expect((await readDocument(owner, resource)).value?.bases).toEqual([restored, otherBasis]);
});

it.each(['local', 'remote'] as const)('keeps independent references in the %s choice when only one returned item is uncertain', async side => {
  const db = installWorldFirestore(() => epoch + 300);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
  const h = documentEngineHarness(snapshot, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('basis:' + basis.id, [['bases', { id: basis.id }, 'scriptureRefs']]);
    await form.begin();
    const phone = { ...basis, scriptureRefs: ['John 3:16', 'John 3:20'] };
    await form.update(current => ({ ...current, bases: [phone, otherBasis] }));
    const reduced = { ...basis, scriptureRefs: ['John 3:16'] };
    const restored = { ...basis, scriptureRefs: ['John 3:16', 'John 3:17', 'John 3:19'] };
    expect(await saveBasis('remove-then-return-17', opening.bases, [reduced, otherBasis], {
      scriptureRefs: authored(basis.scriptureRefs, reduced.scriptureRefs, 60),
    })).toMatchObject({ kind: 'acknowledged' });
    expect(await saveBasis('restore-unknown-and-add-19', [reduced, otherBasis], [restored, otherBasis], {
      scriptureRefs: { ...authored(reduced.scriptureRefs, restored.scriptureRefs, 115, 2), time: null },
    })).toMatchObject({ kind: 'acknowledged' });
    await form.save(undefined, { documentMetadata: { time: clock(20) } });
    await browser.engine.retry();
    await settleEngine();
    const comparison = form.getState()?.comparison;
    const local = ['John 3:16', 'John 3:19', 'John 3:20'];
    const remote = ['John 3:16', 'John 3:17', 'John 3:19', 'John 3:20'];
    expect(comparison?.basisScripture).toMatchObject({ mine: local, stored: remote, referenceItems: ['John 3:17'] });
    await form.resolve(side, { expectedComparison: comparison, metadataTime: clock(230) });
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value?.bases).toEqual([{ ...basis, scriptureRefs: side === 'local' ? local : remote }, otherBasis]);
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('keeps a proved restored reference through an unrelated text choice', async () => {
  const db = installWorldFirestore(() => epoch + 300);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
  const h = documentEngineHarness(snapshot, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const parent = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = parent.form('basis:' + basis.id, [['bases', { id: basis.id }, 'scriptureRefs'], ['bases', { id: basis.id }, 'text']]);
    await form.begin();
    const reduced = { ...basis, scriptureRefs: ['John 3:16'] };
    const withPhoneRef = { ...reduced, scriptureRefs: ['John 3:16', 'John 3:20'], text: 'Phone text' };
    await form.update(current => ({ ...current, bases: [withPhoneRef, otherBasis] }));
    const restored = { ...basis, scriptureRefs: ['John 3:16', 'John 3:17', 'John 3:19'], text: 'Computer text' };
    expect(await saveBasis('temporarily-removed-ref', opening.bases, [reduced, otherBasis], {
      scriptureRefs: authored(basis.scriptureRefs, reduced.scriptureRefs, 60),
    })).toMatchObject({ kind: 'acknowledged' });
    expect(await saveBasis('reference-restored', [reduced, otherBasis], [restored, otherBasis], {
      scriptureRefs: authored(reduced.scriptureRefs, restored.scriptureRefs, 120, 2),
      text: { ...authored(basis.text, restored.text, 125, 2), time: null },
    })).toMatchObject({ kind: 'acknowledged' });
    await form.save(undefined, { documentMetadata: { time: clock(20) } });
    await browser.engine.retry();
    await settleEngine();
    const comparison = form.getState()?.comparison;
    expect(comparison?.basisScripture).toMatchObject({ refsUnderReview: false,
      otherFields: [{ field: 'text', mine: 'Phone text', stored: 'Computer text' }] });
    await form.resolve('local', { expectedComparison: comparison, metadataTime: clock(230) });
    await browser.engine.retry();
    await settleEngine();
    const expected = { ...restored, text: 'Phone text', scriptureRefs: [...restored.scriptureRefs, 'John 3:20'] };
    expect((await readDocument(owner, resource)).value?.bases).toEqual([expected, otherBasis]);
    expect(jest.mocked(h.transport.send).mock.calls[1]?.[0]).toMatchObject({ hardQuestionBasisFieldActions: {
      scriptureRefs: { time: clock(20), observedRevision: 1 },
    } });
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('reopens a reference choice after a later reaffirmation leaves the same reference visible', async () => {
  const db = installWorldFirestore(() => epoch + 300);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
  const reduced = { ...basis, scriptureRefs: ['John 3:16'] };
  let intervened = false;
  const h = documentEngineHarness(snapshot, { apply: async command => {
    if (!intervened && command.kind === 'update' && command.hardQuestionBasisFieldActions?.scriptureRefs?.reviewed) {
      intervened = true;
      expect(await saveBasis('reaffirm-unchanged-17', [reduced, otherBasis], opening.bases, {
        scriptureRefs: authored(reduced.scriptureRefs, basis.scriptureRefs, 220, 2),
      })).toMatchObject({ kind: 'acknowledged' });
    }
    return processCommand(owner, command);
  } });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const parent = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = parent.form('basis:' + basis.id, [['bases', { id: basis.id }, 'scriptureRefs']]);
    await form.begin();
    await form.update(current => ({ ...current, bases: [reduced, otherBasis] }));
    expect(await saveBasis('basis-refs-reduced', opening.bases, [reduced, otherBasis], {
      scriptureRefs: authored(basis.scriptureRefs, reduced.scriptureRefs, 70),
    })).toMatchObject({ kind: 'acknowledged' });
    expect(await saveBasis('basis-refs-restored-without-time', [reduced, otherBasis], opening.bases, {
      scriptureRefs: { ...authored(reduced.scriptureRefs, basis.scriptureRefs, 120, 2), time: null },
    })).toMatchObject({ kind: 'acknowledged' });
    await form.save(undefined, { documentMetadata: { time: clock(20) } });
    await browser.engine.retry();
    await settleEngine();
    const comparison = form.getState()?.comparison;
    expect(comparison?.basisScripture).toMatchObject({ mine: reduced.scriptureRefs, stored: basis.scriptureRefs });
    await form.resolve('local', { expectedComparison: comparison, metadataTime: clock(190) });
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value?.bases).toEqual(opening.bases);
    expect(form.getState()?.comparison?.basisScripture).toMatchObject({ mine: reduced.scriptureRefs, stored: basis.scriptureRefs });
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('does not restamp a compatible reference after a later removal visible before confirming a different item', async () => {
  const db = installWorldFirestore(() => epoch + 300);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
  const h = documentEngineHarness(snapshot, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('basis:' + basis.id, [['bases', { id: basis.id }, 'scriptureRefs']]);
    await form.begin();
    const phone = { ...basis, scriptureRefs: ['John 3:16', 'John 3:20'] };
    await form.update(current => ({ ...current, bases: [phone, otherBasis] }));
    const reduced = { ...basis, scriptureRefs: ['John 3:16'] };
    const saved = { ...basis, scriptureRefs: ['John 3:16', 'John 3:17', 'John 3:19'] };
    expect(await saveBasis('remove-17-for-review', opening.bases, [reduced, otherBasis], {
      scriptureRefs: authored(basis.scriptureRefs, reduced.scriptureRefs, 60),
    })).toMatchObject({ kind: 'acknowledged' });
    expect(await saveBasis('restore-17-and-add-19-for-review', [reduced, otherBasis], [saved, otherBasis], {
      scriptureRefs: { ...authored(reduced.scriptureRefs, saved.scriptureRefs, 115, 2), time: null },
    })).toMatchObject({ kind: 'acknowledged' });
    await form.save(undefined, { documentMetadata: { time: clock(20) } });
    await browser.engine.retry();
    await settleEngine();
    const earlier = form.getState()?.comparison;
    expect(earlier?.basisScripture?.referenceItems).toEqual(['John 3:17']);
    const withOldRef = { ...saved, scriptureRefs: [...saved.scriptureRefs, 'John 3:20'] };
    expect(await saveBasis('later-remove-20-before-choice', [withOldRef, otherBasis], [saved, otherBasis], {
      scriptureRefs: authored(withOldRef.scriptureRefs, saved.scriptureRefs, 175, 3),
    })).toMatchObject({ kind: 'acknowledged' });
    while (h.server.metadata!.revision < 4) h.silentRemote({ bases: [saved, otherBasis] });
    await h.refreshObservedResource();
    const comparison = form.getState()?.comparison;
    expect(comparison?.stored.metadata?.revision).toBe(4);
    expect(comparison?.basisScripture?.referenceItems).toEqual(['John 3:17']);
    await form.resolve('local', { expectedComparison: comparison, metadataTime: clock(230) });
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value?.bases).toEqual([
      { ...saved, scriptureRefs: ['John 3:16', 'John 3:19'] }, otherBasis,
    ]);
  } finally {
    browser.dispose();
    await settleEngine();
  }
});
