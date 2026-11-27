/** @jest-environment node */
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { installWorldFirestore } from '@test-utils/deviceWorld/firestore';

import { ACTION_SLOT } from '../editorIdentity';
import { processCommand, readDocument } from '../server';

import type { DataCommand, DocumentData, ResourceSnapshot } from '../types';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() }, FieldValue: { increment: (amount: number) => ({ __testIncrement: amount }) } }));
jest.mock('@/data-engine/activation', () => ({ ...jest.requireActual('@/data-engine/activation'), isCollectionServed: () => true }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const owner = 'owner';
const resource = { collection: 'hardQuestionThemes', id: 'theme-bases' };
const date = '2026-11-25T00:00:00.000Z';
const initialBasis = { id: 'b1', title: 'Basis', text: 'Original words', scriptureRefs: ['John 3:16', 'John 3:17'] };
const basisTwo = { id: 'b2', title: 'Other basis', scriptureRefs: ['John 3:18'] };
const basisThree = { id: 'b3', title: 'Third basis', scriptureRefs: ['John 3:19'] };
const opening = { userId: owner, title: 'Theme', rank: 1000, createdAt: date, updatedAt: date, bases: [initialBasis, basisTwo] };
const metadata = { protocol: 1, generation: 'g', revision: 1, deleted: false } as const;
const snapshot: ResourceSnapshot = { resource, value: opening, metadata };

function overwriteBases(operationId: string, after: DocumentData[], before: DocumentData[] = opening.bases): Promise<unknown> {
  const command: DataCommand = { protocol: 1, owner, resource, operationId, dependsOn: [], generation: metadata.generation,
    kind: 'update', changes: [{ path: ['bases'], before: { exists: true, value: before }, after: { exists: true, value: after } }] };
  return processCommand(owner, command);
}

it.each([
  ['local', 'John 3:16', false], ['remote', 'John 3:17', false],
  ['local', 'John 3:16', true], ['remote', 'John 3:17', true],
] as const)('keeps one valid place and the requested words when choosing %s (%s, competing text %s)', async (side, reference, textConflict) => {
    const db = installWorldFirestore(() => 1_800_000_000_000);
    db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
    const h = documentEngineHarness(snapshot, { apply: command => processCommand(owner, command) });
    let browser = h.createBrowser();
    browser.engine.setOwner(owner);
    try {
      const parent = await browser.engine.openEditor(resource, browser.editorId(resource));
      const form = parent.form('basis-b1', [['bases', { id: 'b1' }, 'scriptureRefs'], ['bases', { id: 'b1' }, 'text']]);
      await form.begin();
      await form.update(current => ({ ...current,
        bases: [{ ...initialBasis, text: 'My edited words', scriptureRefs: ['John 3:16'] }, basisTwo] }));
      const computer = [{ ...initialBasis, scriptureRefs: ['John 3:17'],
        ...(textConflict && { text: 'Computer words under review' }) }, { ...basisTwo, text: 'Edited other basis' }];
      expect(await overwriteBases('computer-places', computer)).toMatchObject({ kind: 'acknowledged' });

      await form.save();
      await browser.engine.retry();
      await settleEngine();
      const comparison = form.getState()?.comparison;
      expect(comparison).toMatchObject({ conflictPaths: expect.arrayContaining([['bases', 'id:b1', 'scriptureRefs']]) });
      if (textConflict) expect(comparison?.basisScripture).toMatchObject({
        otherFields: [{ field: 'text', mine: 'My edited words', stored: 'Computer words under review' }],
      });
      expect((await readDocument(owner, resource)).value?.bases).toEqual(computer);
      browser.engine.setOnline(false);
      await form.resolve(side, { expectedComparison: comparison });
      browser.dispose();
      await settleEngine();
      browser = h.createBrowser();
      browser.engine.setOwner(owner);
      browser.engine.setOnline(true);
      await browser.engine.retry();
      await settleEngine();
      expect((await readDocument(owner, resource)).value?.bases).toEqual([
        { ...initialBasis, text: textConflict && side === 'remote' ? 'Computer words under review' : 'My edited words',
          scriptureRefs: [reference] }, computer[1],
      ]);
    } finally {
      browser.dispose();
      await settleEngine();
    }
  },
);

it.each(['local', 'remote'] as const)('persists a %s order choice without undoing independent row words', async side => {
  const originals = [...opening.bases, basisThree];
  const latestTwo = { ...basisTwo, legacyExplanation: 'Keep the unknown field' };
  const initial = { ...opening, bases: originals };
  const db = installWorldFirestore(() => 1_800_000_000_000);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...initial, _dataEngine: metadata });
  const h = documentEngineHarness({ ...snapshot, value: initial }, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    browser.engine.setOnline(false);
    const action = await browser.engine.openEditor(resource, browser.editorId(resource, ACTION_SLOT));
    const amended = { ...basisThree, text: 'Local wording of a different row' };
    await action.commit(current => ({ ...current!, bases: [amended, initialBasis, basisTwo] }));
    await action.close({ flush: false });
    const computer = [latestTwo, { ...initialBasis, text: 'New words on the computer' }, basisThree];
    expect(await overwriteBases('computer-reordered', computer, originals)).toMatchObject({ kind: 'acknowledged' });
    browser.engine.setOnline(true);
    await browser.engine.retry();
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    await settleEngine();
    expect(editor.getState().checkpoint.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['bases'] })]));
    if (side === 'local') await editor.keepLocal();
    else await editor.acceptRemote();
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value?.bases).toEqual(
      side === 'local' ? [amended, computer[1], latestTwo] : [latestTwo, computer[1], amended],
    );
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('keeps the saved row and holds the local words when an order also has disputed row contents', async () => {
  const originals = [...opening.bases, basisThree];
  const initial = { ...opening, bases: originals };
  const db = installWorldFirestore(() => 1_800_000_000_000);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...initial, _dataEngine: metadata });
  const h = documentEngineHarness({ ...snapshot, value: initial }, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    await editor.edit({ ...initial, bases: [basisThree, { ...initialBasis, text: 'Phone words' }, basisTwo] });
    const computer = [basisTwo, { ...initialBasis, text: 'Computer words' }, basisThree];
    expect(await overwriteBases('computer-order-and-text', computer, originals)).toMatchObject({ kind: 'acknowledged' });
    await editor.save();
    await browser.engine.retry();
    await settleEngine();
    expect(editor.getState().checkpoint.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['bases'] }), expect.objectContaining({ path: ['bases', 'id:b1', 'text'] }),
    ]));
    await expect(editor.keepLocal()).rejects.toMatchObject({ code: 'other-changes-first' });
    expect((await readDocument(owner, resource)).value?.bases).toEqual(computer);
    expect(editor.getState().checkpoint.draft?.bases).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Phone words' })]));
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('requires a fresh choice when an open comparison learns that the basis is gone', async () => {
  const db = installWorldFirestore(() => 1_800_000_000_000);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...opening, _dataEngine: metadata });
  const h = documentEngineHarness(snapshot, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    const form = editor.form('basis:b1', [['bases', { id: 'b1' }, 'scriptureRefs'], ['bases', { id: 'b1' }, 'text']]);
    await form.begin();
    await form.update(current => ({ ...current, bases: [{ ...initialBasis, text: 'Phone words under review', scriptureRefs: ['John 3:16'] }, basisTwo] }));
    const computer = [{ ...initialBasis, scriptureRefs: ['John 3:17'] }, basisTwo];
    expect(await overwriteBases('computer-places', computer)).toMatchObject({ kind: 'acknowledged' });
    h.silentRemote({ bases: computer });
    await form.save();
    await browser.engine.retry();
    await settleEngine();
    const compared = form.getState()?.comparison;
    expect(compared?.basisScripture).toMatchObject({ mine: ['John 3:16'], stored: ['John 3:17'] });

    const latest = [{ ...computer[0], text: 'Computer words added after the answer' }, basisTwo];
    expect(await overwriteBases('computer-new-words', latest, computer)).toMatchObject({ kind: 'acknowledged' });
    h.silentRemote({ bases: latest });
    await h.refreshObservedResource();
    expect(form.getState()?.comparison?.basisScripture?.otherFields).toEqual([
      { field: 'text', mine: 'Phone words under review', stored: 'Computer words added after the answer' },
    ]);

    expect(await overwriteBases('computer-removed-basis', [basisTwo], latest)).toMatchObject({ kind: 'acknowledged' });
    h.silentRemote({ bases: [basisTwo] });
    await h.refreshObservedResource();
    const changed = form.getState()?.comparison;
    expect(changed?.basisScripture).toMatchObject({ removed: true, mine: ['John 3:16'],
      otherFields: expect.arrayContaining([{ field: 'text', mine: 'Phone words under review', stored: '' }]),
    });
    await expect(form.resolve('local', { expectedComparison: compared })).rejects.toMatchObject({ code: 'decision-changed' });
    await expect(form.resolve('local', { expectedComparison: changed })).rejects.toMatchObject({ code: 'decision-changed' });
    await form.resolve('remote', { expectedComparison: changed });
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value?.bases).toEqual([basisTwo]);
    expect(form.getState()?.comparison).toBeUndefined();
    expect(form.getState()?.record.active).toBe(false);
    expect(form.getState()?.value.bases).toEqual([basisTwo]);
  } finally {
    browser.dispose();
    await settleEngine();
  }
});
