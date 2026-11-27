/** @jest-environment node */
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { installWorldFirestore } from '@test-utils/deviceWorld/firestore';

import { ACTION_SLOT } from '../editorIdentity';
import { readHardQuestionThemeOrderReview } from '../hardQuestionThemeOrderReview';
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
    const compared = editor.getState().checkpoint;
    const review = readHardQuestionThemeOrderReview(compared)!;
    const finalWords = { ...computer[1], text: 'Later computer words' };
    expect(await overwriteBases('computer-edited-again', [basisTwo, finalWords, basisThree], computer)).toMatchObject({ kind: 'acknowledged' });
    jest.mocked(h.transport.read).mockImplementation(async () => readDocument(owner, resource));
    const choices = { [review.fields[0].id]: 'local', [review.fields[1].id]: 'remote' } as const;
    await expect(editor.applyHardQuestionThemeOrderReview!(compared, review.identity, choices))
      .rejects.toMatchObject({ code: 'decision-changed' });
    const updated = editor.getState().checkpoint;
    expect(Object.keys(updated.pending)).toEqual(Object.keys(compared.pending));
    const revised = readHardQuestionThemeOrderReview(updated)!;
    expect(revised.fields[1].theirs).toMatchObject({ value: 'Later computer words' });
    await editor.applyHardQuestionThemeOrderReview!(updated, revised.identity, choices);
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value?.bases).toEqual([basisThree, finalWords, basisTwo]);
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

it('keeps the later local edit queued behind an order comparison when applying the shown versions', async () => {
  const originals = [...opening.bases, basisThree];
  const initial = { ...opening, bases: originals, intro: 'Opening words' };
  installWorldFirestore(() => 1_800_000_000_000);
  expect(await processCommand(owner, { protocol: 1, owner, resource, operationId: metadata.generation, dependsOn: [],
    kind: 'create', generation: null, value: initial })).toMatchObject({ kind: 'acknowledged' });
  const time = { earliestMs: 1_799_999_999_900, latestMs: 1_799_999_999_910 };
  const h = documentEngineHarness({ ...snapshot, value: initial }, { apply: command => processCommand(owner, command) });
  let browser = h.createBrowser();
  browser.engine.setOwner(owner);
  browser.engine.setOnline(false);
  try {
    const originEditorId = browser.editorId(resource, ACTION_SLOT);
    const action = await browser.engine.openEditor(resource, originEditorId);
    await action.commit(current => ({ ...current!, bases: [basisThree, { ...initialBasis, text: 'Phone words' }, basisTwo] }));
    await action.commit(current => ({ ...current!, intro: 'A later edit made without a connection' }),
      { kind: 'document-metadata', time });
    await action.close({ flush: false });
    const computer = [basisTwo, { ...initialBasis, text: 'Computer words' }, basisThree];
    expect(await overwriteBases('computer-order-and-text', computer, originals)).toMatchObject({ kind: 'acknowledged' });
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    browser.engine.setOnline(true);
    await browser.engine.retry();
    await settleEngine();
    const compared = editor.getState().checkpoint;
    expect(Object.keys(compared.pending)).toHaveLength(2);
    expect(compared.draft?.intro).toBe('A later edit made without a connection');
    const review = readHardQuestionThemeOrderReview(compared)!;
    jest.mocked(h.transport.read).mockImplementation(async () => readDocument(owner, resource));
    await editor.applyHardQuestionThemeOrderReview!(compared, review.identity, {
      [review.fields[0].id]: 'local', [review.fields[1].id]: 'remote',
    });
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value).toMatchObject({
      bases: [basisThree, computer[1], basisTwo], intro: 'A later edit made without a connection',
    });
    expect(jest.mocked(h.transport.send).mock.calls.at(-1)?.[0]).toMatchObject({
      hardQuestionFieldActions: { intro: { time, observedRevision: 1 } },
    });
    browser.dispose();
    await settleEngine();
    browser = h.createBrowser();
    browser.engine.setOwner(owner);
    await browser.engine.retry();
    await settleEngine();
    const recovery = await browser.engine.listRecoveryChoices(resource);
    expect(JSON.stringify(recovery)).not.toContain('Phone words');
    const originating = await browser.engine.openEditor(resource, originEditorId);
    expect(originating.getState().checkpoint.draft?.bases).toEqual([basisThree, computer[1], basisTwo]);
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it.each([
  ['older', -80, undefined, 'Computer opening words', false, false, false],
  ['later', -10, undefined, 'Phone opening words', false, false, false],
  ['ambiguous, choose local', null, 'local', 'Phone opening words', false, false, false],
  ['ambiguous, choose stored', null, 'remote', 'Computer opening words', false, false, false],
  ['later without a row dispute', -10, undefined, 'Phone opening words', true, false, false],
  ['ambiguous without a row dispute', null, 'local', 'Phone opening words', true, false, false],
  ['ambiguous after an undo', null, 'local', 'Phone opening words', false, true, false],
  ['ambiguous after a stale choice', null, 'local', 'Phone opening words', false, false, 'retry'],
  ['ambiguous after a stale choice and another Save', null, 'local', 'Phone opening words', false, false, 'with-later-save'],
] as const)('applies the disputed list choices with %s opening words', async (scenario, offset, textChoice, finalIntro, onlyOrder, undo, retry) => {
  const serverMs = 1_800_000_000_000;
  const time = (ms: number) => ({ earliestMs: serverMs + ms, latestMs: serverMs + ms + 5 });
  const originals = [...opening.bases, basisThree];
  const initial = { ...opening, intro: 'Opening words', bases: originals };
  const db = installWorldFirestore(() => serverMs);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...initial, _dataEngine: metadata });
  const overwriteIntro = (operationId: string, before: string, after: string, revision: number, offsetMs: number) =>
    processCommand(owner, { protocol: 1, owner, resource, operationId, dependsOn: [], generation: metadata.generation,
      kind: 'update', changes: [{ path: ['intro'], before: { exists: true, value: before }, after: { exists: true, value: after } }],
      hardQuestionFieldActions: { intro: { observedRevision: revision, time: time(offsetMs) } } });
  let intervened = false;
  let saveLaterEdit: (() => Promise<void>) | undefined;
  const h = documentEngineHarness({ ...snapshot, value: initial }, { apply: async command => {
    if (retry && !intervened && command.kind === 'update' && command.hardQuestionFieldActions?.intro?.reviewed) {
      intervened = true;
      await saveLaterEdit?.();
      await overwriteIntro('after-choice-new-intro', 'Computer opening words', 'Temporary words at the computer', 2, -18);
      await overwriteIntro('after-choice-undo-intro', 'Temporary words at the computer', 'Computer opening words', 3, -9);
    }
    return processCommand(owner, command);
  } });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  browser.engine.setOnline(false);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    const title = 'A separate title saved while the earlier choice was sending';
    if (retry === 'with-later-save') saveLaterEdit = async () => {
      await editor.commit(current => ({ ...current!, title }), { kind: 'document-metadata', time: time(-2) });
    };
    await editor.commit(current => ({ ...current!, intro: 'Phone opening words',
      bases: [basisThree, onlyOrder ? initialBasis : { ...initialBasis, text: 'Phone basis text' }, basisTwo] }),
    { kind: 'document-metadata', time: offset === null ? null : time(offset) });
    const computer = [basisTwo, { ...initialBasis, text: 'Computer basis text' }, basisThree];
    expect(await processCommand(owner, { protocol: 1, owner, resource, operationId: 'computer-list-and-intro',
      dependsOn: [], generation: metadata.generation, kind: 'update', changes: [
        { path: ['bases'], before: { exists: true, value: originals }, after: { exists: true, value: computer } },
        { path: ['intro'], before: { exists: true, value: initial.intro }, after: { exists: true, value: 'Computer opening words' } },
      ], hardQuestionFieldActions: { intro: { observedRevision: 1, time: time(-40) } },
    })).toMatchObject({ kind: 'acknowledged' });
    if (undo) {
      expect(await overwriteIntro('computer-undo-intro', 'Computer opening words', initial.intro, 2, -20))
        .toMatchObject({ kind: 'acknowledged' });
    }
    browser.engine.setOnline(true);
    await browser.engine.retry();
    await settleEngine();
    const compared = editor.getState().checkpoint;
    expect(compared.conflicts.find(({ path }) => path[0] === 'intro')).toMatchObject({
      path: ['intro'],
      ...(offset !== null && { code: scenario === 'older' ? 'hard-question-field-settled' : 'hard-question-field-queued' }),
    });
    const review = readHardQuestionThemeOrderReview(compared);
    expect(review?.fields.map(field => field.path)).toEqual(expect.arrayContaining([
      ['bases'], ...(onlyOrder ? [] : [['bases', 'id:b1', 'text']]), ...(textChoice ? [['intro']] : []),
    ]));
    expect(review?.fields).toHaveLength(1 + Number(!onlyOrder) + Number(Boolean(textChoice)));
    if (!review) throw new Error('Expected combined theme comparison');
    jest.mocked(h.transport.read).mockImplementation(async () => readDocument(owner, resource));
    await editor.applyHardQuestionThemeOrderReview!(compared, review.identity, {
      '["bases"]': 'local', ...(!onlyOrder && { '["bases","id:b1","text"]': 'remote' }),
      ...(textChoice && { '["intro"]': textChoice }),
    }, time(-1));
    await browser.engine.retry();
    await settleEngine();
    if (retry) {
      expect((await readDocument(owner, resource)).value).toMatchObject({ intro: 'Computer opening words', bases: computer });
      const updated = editor.getState().checkpoint;
      expect(Object.keys(updated.pending)).toHaveLength(retry === 'with-later-save' ? 2 : 1);
      expect(updated.conflicts).toMatchObject([{ path: ['intro'], code: 'hard-question-field-review-changed' }]);
      const updatedReview = readHardQuestionThemeOrderReview(updated);
      expect(updatedReview?.fields.map(field => field.path)).toEqual([['intro']]);
      if (!updatedReview) throw new Error('Expected the new intro-only comparison');
      await editor.applyHardQuestionThemeOrderReview!(updated, updatedReview.identity, { '["intro"]': 'local' }, time(-1));
      await browser.engine.retry();
      await settleEngine();
    }
    const result = await readDocument(owner, resource);
    expect(result.metadata?.revision).toBe(retry ? 5 : undo ? 4 : 3);
    expect(result.value).toMatchObject({ intro: finalIntro, bases: [basisThree, computer[1], basisTwo],
      title: retry === 'with-later-save' ? title : initial.title });
    const replacement = jest.mocked(h.transport.send).mock.calls.at(-1)?.[0];
    if (replacement?.kind !== 'update') throw new Error('Expected a replacement update');
    if (offset === -10) expect(replacement.hardQuestionFieldActions?.intro).toMatchObject({ time: time(-10), observedRevision: 1 });
    if (textChoice === 'local') expect(replacement.hardQuestionFieldActions?.intro).toMatchObject({ reviewed: true, time: time(-1), observedRevision: retry ? 4 : undo ? 3 : 2 });
    if (finalIntro === 'Computer opening words') expect(replacement.hardQuestionFieldActions?.intro).toBeUndefined();
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it.each([['local', false], ['remote', false], ['local', true]] as const)(
  'keeps timestamps of separately saved bases when choosing %s disputed words (renew: %s)', async (side, renew) => {
    const serverMs = 1_800_000_000_000;
    const time = (offset: number) => ({ earliestMs: serverMs + offset, latestMs: serverMs + offset + 5 });
    const originals = [...opening.bases, basisThree];
    const initial = { ...opening, bases: originals };
    installWorldFirestore(() => serverMs);
    expect(await processCommand(owner, { protocol: 1, owner, resource, operationId: metadata.generation,
      dependsOn: [], kind: 'create', generation: null, value: initial })).toMatchObject({ kind: 'acknowledged' });
    const computer = { ...initialBasis, text: 'Disputed server words' };
    let intervened = false;
    const h = documentEngineHarness({ ...snapshot, value: initial }, { apply: async command => {
      if (renew && !intervened && command.kind === 'update' && command.hardQuestionBasisRowActions?.text?.some(action => action.reviewed)) {
        intervened = true;
        const revise = (operationId: string, before: string, after: string, observedRevision: number) => processCommand(owner, {
          protocol: 1, owner, resource, operationId, dependsOn: [], generation: metadata.generation, kind: 'update',
          changes: [{ path: ['bases'], before: { exists: true, value: [basisTwo, { ...computer, text: before }, basisThree] },
            after: { exists: true, value: [basisTwo, { ...computer, text: after }, basisThree] } }],
          hardQuestionBasisFieldActions: { text: { rowId: computer.id, rowCreatedAt: computer.id, before, after, time: null, observedRevision } },
        });
        expect(await revise('change-shown-basis', computer.text, 'Temporary wording after the choice', 2)).toMatchObject({ kind: 'acknowledged' });
        expect(await revise('return-shown-basis', 'Temporary wording after the choice', computer.text, 3)).toMatchObject({ kind: 'acknowledged' });
      }
      return processCommand(owner, command);
    } });
    const browser = h.createBrowser();
    browser.engine.setOwner(owner);
    browser.engine.setOnline(false);
    try {
      const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
      const phone = { ...initialBasis, text: 'Disputed phone words' };
      const independent = { ...basisTwo, text: 'Separately saved earlier words' };
      const later = { ...basisThree, text: 'Separately saved later words' };
      await editor.commit(current => ({ ...current!, bases: [basisThree, phone, basisTwo] }));
      const stage = (basis: typeof independent | typeof later, offset: number) => editor.commit(current => ({
        ...current!, bases: (current!.bases as DocumentData[]).map(item => item.id === basis.id ? { ...item, text: basis.text } : item),
      }), { kind: 'document-metadata', time: time(offset) });
      await stage(independent, -60);
      await stage(later, -20);
      expect(await overwriteBases('computer-order-and-basis-text', [basisTwo, computer, basisThree], originals))
        .toMatchObject({ kind: 'acknowledged' });
      browser.engine.setOnline(true);
      await browser.engine.retry();
      await settleEngine();
      const compared = editor.getState().checkpoint;
      expect(Object.keys(compared.pending)).toHaveLength(3);
      const review = readHardQuestionThemeOrderReview(compared)!;
      expect(review.fields.map(({ path }) => path)).toEqual([['bases'], ['bases', 'id:b1', 'text']]);
      jest.mocked(h.transport.read).mockImplementation(async () => readDocument(owner, resource));
      await editor.applyHardQuestionThemeOrderReview!(compared, review.identity, {
        [review.fields[0].id]: 'local', [review.fields[1].id]: side,
      }, time(-1));
      await browser.engine.retry();
      await settleEngine();
      if (renew) {
        const current = editor.getState().checkpoint;
        expect(current.conflicts).toMatchObject([{ path: ['bases', 'id:b1', 'text'], code: 'hard-question-basis-field-review' }]);
        const again = readHardQuestionThemeOrderReview(current);
        expect(again?.fields.map(({ path }) => path)).toEqual([['bases', 'id:b1', 'text']]);
        await editor.applyHardQuestionThemeOrderReview!(current, again!.identity, { [again!.fields[0].id]: 'local' }, time(0));
        await browser.engine.retry();
        await settleEngine();
      }
      expect((await readDocument(owner, resource)).value?.bases).toEqual([later, side === 'local' ? phone : computer, independent]);
      const command = jest.mocked(h.transport.send).mock.calls.at(-1)?.[0];
      expect(command).toMatchObject({ kind: 'update', hardQuestionBasisRowActions: {
        text: expect.arrayContaining([
          expect.objectContaining({ rowId: independent.id, time: time(-60), observedRevision: 1 }),
          expect.objectContaining({ rowId: later.id, time: time(-20), observedRevision: 1 }),
          ...(side === 'local' ? [expect.objectContaining({ rowId: phone.id, time: time(renew ? 0 : -1), observedRevision: renew ? 4 : 2, reviewed: true })] : []),
        ]),
      } });
      const delayed = { ...basisTwo, text: 'Arrived late but typed before both saved actions' };
      const newest = { ...basisThree, text: 'Actually typed after both saved actions' };
      const answer = await processCommand(owner, { protocol: 1, owner, resource, operationId: 'delayed-basis-edits',
        dependsOn: [], generation: metadata.generation, kind: 'update',
        changes: [{ path: ['bases'], before: { exists: true, value: originals }, after: { exists: true, value: [initialBasis, delayed, newest] } }],
        hardQuestionBasisRowActions: { text: [
          { rowId: independent.id, rowCreatedAt: independent.id, before: null, after: delayed.text, time: time(-90), observedRevision: 1 },
          { rowId: later.id, rowCreatedAt: later.id, before: null, after: newest.text, time: time(-10), observedRevision: 1 },
        ] },
      });
      if (answer.kind !== 'acknowledged') throw new Error(JSON.stringify(answer));
      expect((await readDocument(owner, resource)).value?.bases).toEqual([newest, side === 'local' ? phone : computer, independent]);
    } finally {
      browser.dispose();
      await settleEngine();
    }
  });

it('rechecks a previously confirmed basis when a different basis has already needed a second choice', async () => {
  const serverMs = 1_800_000_000_000;
  const time = (offset: number) => ({ earliestMs: serverMs + offset, latestMs: serverMs + offset + 5 });
  const originals = [...opening.bases, basisThree];
  const initial = { ...opening, bases: originals };
  const one = { ...initialBasis, text: 'Mine on the first basis' };
  const two = { ...basisTwo, text: 'Mine on the second basis' };
  const deskOne = { ...initialBasis, text: 'Saved on the first basis' };
  const deskTwo = { ...basisTwo, text: 'Saved on the second basis' };
  installWorldFirestore(() => serverMs);
  expect(await processCommand(owner, { protocol: 1, owner, resource, operationId: metadata.generation,
    dependsOn: [], kind: 'create', generation: null, value: initial })).toMatchObject({ kind: 'acknowledged' });
  let sentChoices = 0;
  const h = documentEngineHarness({ ...snapshot, value: initial }, { apply: async command => {
    if (command.kind !== 'update' || !command.hardQuestionBasisRowActions?.text?.some(action => action.reviewed)) return processCommand(owner, command);
    sentChoices += 1;
    if (sentChoices === 2) expect(command.hardQuestionBasisRowActions.text).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowId: one.id, observedRevision: 2, time: time(-3), reviewed: true }),
      expect.objectContaining({ rowId: two.id, observedRevision: 4, time: time(-2), reviewed: true }),
    ]));
    if (sentChoices <= 2) {
      const shown = sentChoices === 1 ? deskTwo : deskOne;
      const latest = await readDocument(owner, resource);
      const rows = latest.value!.bases as DocumentData[];
      const modified = rows.map(row => row.id === shown.id ? { ...row, text: 'Temporary change on ' + shown.id } : row);
      const revise = (suffix: string, from: DocumentData[], to: DocumentData[], before: string, after: string, revision: number) =>
        processCommand(owner, { protocol: 1, owner, resource, operationId: 'other-device-' + shown.id + '-' + suffix,
          dependsOn: [], generation: metadata.generation, kind: 'update',
          changes: [{ path: ['bases'], before: { exists: true, value: from }, after: { exists: true, value: to } }],
          hardQuestionBasisFieldActions: { text: { rowId: shown.id, rowCreatedAt: shown.id, before, after, observedRevision: revision, time: null } },
        });
      const temp = 'Temporary change on ' + shown.id;
      const revision = latest.metadata!.revision;
      expect(await revise('new', rows, modified, shown.text, temp, revision)).toMatchObject({ kind: 'acknowledged' });
      expect(await revise('return', modified, rows, temp, shown.text, revision + 1)).toMatchObject({ kind: 'acknowledged' });
    }
    return processCommand(owner, command);
  } });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  browser.engine.setOnline(false);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    await editor.commit(current => ({ ...current!, bases: [basisThree, one, basisTwo] }));
    await editor.commit(current => ({ ...current!, bases: [basisThree, one, two] }),
      { kind: 'document-metadata', time: time(-40) });
    await overwriteBases('desk-order-and-both-words', [deskTwo, deskOne, basisThree], originals);
    browser.engine.setOnline(true);
    await browser.engine.retry();
    await settleEngine();
    jest.mocked(h.transport.read).mockImplementation(async () => readDocument(owner, resource));
    const choose = async (paths: string[][], offset: number) => {
      const compared = editor.getState().checkpoint;
      const review = readHardQuestionThemeOrderReview(compared);
      expect(review?.fields.map(field => field.path)).toEqual(paths);
      await editor.applyHardQuestionThemeOrderReview!(compared, review!.identity,
        Object.fromEntries(review!.fields.map(field => [field.id, 'local'])), time(offset));
      await browser.engine.retry();
      await settleEngine();
    };
    await choose([['bases'], ['bases', 'id:b1', 'text'], ['bases', 'id:b2', 'text']], -3);
    await choose([['bases', 'id:b2', 'text']], -2);
    await choose([['bases', 'id:b1', 'text']], -1);
    expect(sentChoices).toBe(3);
    expect(await readDocument(owner, resource)).toMatchObject({ metadata: { revision: 7 }, value: { bases: [basisThree, one, two] } });
  } finally {
    browser.dispose();
    await settleEngine();
  }
});

it('includes a later captured form save and keeps its newer unsent words separate', async () => {
  const originals = [...opening.bases, basisThree];
  const initial = { ...opening, bases: originals };
  const db = installWorldFirestore(() => 1_800_000_000_000);
  db.documents.set(`${resource.collection}/${resource.id}`, { ...initial, _dataEngine: metadata });
  const h = documentEngineHarness({ ...snapshot, value: initial }, { apply: command => processCommand(owner, command) });
  const browser = h.createBrowser();
  browser.engine.setOwner(owner);
  browser.engine.setOnline(false);
  try {
    const editor = await browser.engine.openEditor(resource, browser.editorId(resource));
    await editor.commit(current => ({ ...current!, bases: [basisThree, { ...initialBasis, text: 'Phone words' }, basisTwo] }));
    const form = editor.form('basis:b1', [['bases', { id: 'b1' }, 'text']]);
    const words = (text: string) => (doc: DocumentData) => ({ ...doc,
      bases: (doc.bases as DocumentData[]).map(row => row.id === 'b1' ? { ...row, text } : row),
    });
    await form.begin();
    await form.update(words('Saved basis words'));
    await form.save();
    await form.begin();
    await form.update(words('Unsent words still in the form'));
    const computer = [basisTwo, { ...initialBasis, text: 'Computer words' }, basisThree];
    expect(await overwriteBases('computer-order-and-text', computer, originals)).toMatchObject({ kind: 'acknowledged' });
    browser.engine.setOnline(true);
    await browser.engine.retry();
    await settleEngine();
    const compared = editor.getState().checkpoint;
    expect(Object.keys(compared.pending)).toHaveLength(2);
    expect(compared.draft?.bases).toEqual([basisThree, { ...initialBasis, text: 'Saved basis words' }, basisTwo]);
    const review = readHardQuestionThemeOrderReview(compared)!;
    jest.mocked(h.transport.read).mockImplementation(async () => readDocument(owner, resource));
    await editor.applyHardQuestionThemeOrderReview!(compared, review.identity, {
      [review.fields[0].id]: 'local', [review.fields[1].id]: 'local',
    });
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value).toMatchObject({
      bases: [basisThree, { ...initialBasis, text: 'Saved basis words' }, basisTwo],
    });
    expect(form.getState()).toMatchObject({ dirty: true, value: {
      bases: expect.arrayContaining([expect.objectContaining({ id: 'b1', text: 'Unsent words still in the form' })]),
    } });
    expect(form.getState()?.choiceRequired).toBeUndefined();
    await form.save();
    await browser.engine.retry();
    await settleEngine();
    expect((await readDocument(owner, resource)).value?.bases).toEqual([
      basisThree, { ...initialBasis, text: 'Unsent words still in the form' }, basisTwo,
    ]);
  } finally {
    browser.dispose();
    await settleEngine();
  }
});
