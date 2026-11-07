import { waitFor } from '@testing-library/react';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { editorIdentity, manualScopeIdentity, recoveryEditorIdentity } from '@/data-engine/editorIdentity';
import { liveSubmittedWork } from '@/data-engine/liveSubmittedWork';
import { recoveryHeldOpen } from '@/data-engine/openDocumentAnswers';
import { DataSession } from '@/data-engine/session';
import { describeManualSync, describeSync } from '@/data-engine/status';

import type { StoredManualScope } from '@/data-engine/manualScopes.client';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const resource = { collection: 'groups', id: 'offline-group-279' };
const original = { userId: 'owner', title: 'Opening group', status: 'draft', templates: [], flow: [], createdAt: 'now', updatedAt: 'now' };
const setup = async (recoveredSource = false) => {
  const h = documentEngineHarness({ resource, value: original, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  const a = h.createBrowser().engine, b = h.createBrowser().engine;
  a.setOnline(false); a.setOwner('owner'); b.setOnline(false); b.setOwner('owner');
  const aId = editorIdentity('tab-A', resource, 'group', 'opening-A');
  const inA = await a.openEditor(resource, recoveredSource ? recoveryEditorIdentity(aId, 'recovered-source') : aId);
  const inB = await b.openEditor(resource, editorIdentity('tab-B', resource, 'group', 'opening-B'));
  return { h, a, b, inA, inB };
};

it('shows the saved offline title in an already-open clean second editor after returning', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    await settleEngine(); await settleEngine();
    const fresh = await b.openEditor(resource, editorIdentity('tab-B', resource, 'group', 'fresh-readback'));
    expect(fresh.getState().checkpoint.draft?.title).toBe('Saved locally in A');
    expect(h.server.value?.title).toBe('Opening group');
    b.setVisible(true); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Saved locally in A');
  } finally { a.dispose(); b.dispose(); }
});

it.each(['conflict', 'refused'] as const)('offers an ordinary %s in the already-open clean second editor', async outcome => {
  const { h, a, b, inA, inB } = await setup();
  const localTitle = 'Saved in the first tab';
  const remoteTitle = 'Newer server words';
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: localTitle }));
    const [captured] = await h.commits.list('owner');
    if (outcome === 'conflict') h.silentRemote({ title: remoteTitle });
    else jest.mocked(h.transport.send).mockResolvedValueOnce({
      kind: 'refused', operationId: captured.id, code: 'permission-denied',
    });
    a.setOnline(true);
    await a.retry();
    await waitFor(() => expect(inA.getState().result).toMatchObject({ kind: outcome, operationId: captured.id }));

    b.setVisible(true);
    await waitFor(() => expect(inB.getState().result).toMatchObject({ kind: outcome, operationId: captured.id }));
    expect(inB.getState().checkpoint.draft?.title).toBe(localTitle);
    expect(inB.getState().savedIntentReplaceable).toBe(true);
    await inB.acceptRemote();
    expect(inB.getState().checkpoint.draft?.title).toBe(outcome === 'conflict' ? remoteTitle : original.title);
    expect(inB.getState().checkpoint.pending).toEqual({});
    expect(h.transport.send).toHaveBeenCalledTimes(1);
  } finally { a.dispose(); b.dispose(); }
});

it.each(['return take stored', 'return keep mine', 'source take stored', 'source keep mine', 'outside the editor'] as const)(
  'settles an early ordinary refusal and preserves the later Save: %s', async choice => {
    const { h, a, b, inA, inB } = await setup();
    const early = 'First title refused by the server', later = 'Description saved after the first title';
    try {
      b.setVisible(false);
      await inA.commit(current => ({ ...current!, title: early }));
      await inA.commit(current => ({ ...current!, description: later }));
      const [first, second] = await h.commits.list('owner');
      expect(second.predecessor).toBe(first.id);
      const refusal = { kind: 'refused', operationId: first.id, code: 'receipt-too-large' } as const;
      jest.mocked(h.transport.send).mockResolvedValueOnce(refusal);
      a.setOnline(true);
      await a.retry();
      await waitFor(() => expect(inA.getState().result).toEqual(refusal));
      expect((await h.commits.list('owner')).map(request => request.state)).toEqual(['refused', 'queued']);

      const returning = choice.startsWith('return');
      const outside = choice === 'outside the editor';
      const keep = choice.endsWith('keep mine');
      if (returning || outside) inA.dispose();
      const deciding = returning ? inB : inA;
      if (returning) {
        b.setVisible(true);
        await waitFor(() => expect(deciding.getState().result).toEqual(refusal));
        expect(deciding.getState().checkpoint.draft).toMatchObject({ title: early });
        expect(deciding.getState().checkpoint.draft?.description).toBeUndefined();
        expect(deciding.getState().savedIntentReplaceable).toBe(true);
      }
      if (outside) expect(await b.takeStoredVersion(resource, [first.id])).toBe(1);
      else if (keep) {
        await deciding.keepLocal();
        expect(deciding.getState().checkpoint.draft?.description).toBeUndefined();
        await deciding.save();
        const engine = returning ? b : a;
        engine.setOnline(true);
        await engine.retry();
      } else {
        await deciding.acceptRemote();
        expect(deciding.getState().checkpoint.draft).toEqual(original);
      }
      const selected = keep ? early : original.title;
      await waitFor(() => expect(h.server.value?.title).toBe(selected));
      expect(h.server.value?.description).toBeUndefined();
      const copies = await b.listRecoverable(resource);
      expect(copies.map(copy => copy.record.checkpoint.draft)).toContainEqual(expect.objectContaining({
        title: selected, description: later,
      }));
    } finally { a.dispose(); b.dispose(); }
  },
);

it.each(['source takes stored', 'new editor keeps mine', 'new editor takes newer stored', 'notice takes stored'] as const)(
  'settles a common refusal while preserving both separately saved continuations: %s', async choice => {
    const { h, a, b, inA, inB } = await setup();
    const firstTitle = 'Common title refused by the server';
    const branchTitles = ['First separately saved title', 'Second separately saved title'];
    try {
      b.setVisible(false);
      await inA.commit(current => ({ ...current!, title: firstTitle }));
      const [first] = await h.commits.list('owner');
      b.setVisible(true);
      await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe(firstTitle));
      await inB.edit({ ...inB.getState().checkpoint.draft!, title: branchTitles[1] });
      b.setVisible(false);
      await inA.commit(current => ({ ...current!, title: branchTitles[0] }));
      b.setVisible(true);
      await settleEngine();
      expect(inB.getState().checkpoint.draft?.title).toBe(branchTitles[1]);
      await inB.save();
      const captured = await h.commits.list('owner');
      expect(captured.filter(request => request.predecessor === first.id).map(request => request.value?.title))
        .toEqual(branchTitles);
      const refusal = { kind: 'refused', operationId: first.id, code: 'receipt-too-large' } as const;
      jest.mocked(h.transport.send).mockResolvedValueOnce(refusal);
      a.setOnline(true);
      await a.retry();
      await waitFor(() => expect(inA.getState().result).toEqual(refusal));
      expect(h.transport.send).toHaveBeenCalledTimes(1);
      inB.dispose();
      if (choice.startsWith('new editor')) {
        h.silentRemote({ title: 'Newer title already on this device', description: 'Independent stored words' });
        await a.retry(resource);
        await waitFor(async () => expect(await b.peekCached(resource)).toEqual(h.server));
      }

      if (choice === 'source takes stored') {
        await inA.acceptRemote();
        expect(inA.getState().checkpoint.draft).toEqual(original);
      } else {
        inA.dispose();
        if (choice === 'notice takes stored') expect(await b.takeStoredVersion(resource, [first.id])).toBe(1);
        else {
          const delayed = choice === 'new editor takes newer stored';
          let release!: () => void;
          const cacheRead = new Promise<void>(resolve => { release = resolve; });
          const reader = delayed ? h.createBrowser({ beforeSnapshotRead: () => cacheRead }).engine : b;
          try {
            if (delayed) { reader.setOnline(false); reader.setOwner('owner'); }
            const fresh = await reader.openEditor(resource, editorIdentity('tab-B', resource, 'group', 'branch-choice'));
            expect(fresh.getState().result).toEqual(refusal);
            expect(Object.keys(fresh.getState().checkpoint.pending)).toEqual([first.id]);
            expect(fresh.getState().checkpoint.draft?.title).toBe(firstTitle);
            if (delayed) {
              expect(fresh.getState().savedIntentReplaceable).toBe(false);
              await expect(fresh.acceptRemote()).rejects.toMatchObject({ code: 'fresh-read-required' });
              expect((await h.commits.list('owner')).find(request => request.id === first.id)?.state).toBe('refused');
            }
            release();
            await waitFor(() => expect(fresh.getState().checkpoint.remoteCandidate).toEqual(h.server));
            await waitFor(() => expect(fresh.getState().savedIntentReplaceable).toBe(true));
            if (choice === 'new editor keeps mine') {
              await fresh.keepLocal();
              expect(fresh.getState().checkpoint.draft).toMatchObject({ title: firstTitle, description: 'Independent stored words' });
            } else {
              await fresh.acceptRemote();
              expect(fresh.getState().checkpoint.draft).toEqual(h.server.value);
            }
          } finally { release(); if (delayed) reader.dispose(); }
        }
      }
      const retained = (await b.listRecoverable(resource)).filter(({ record }) => record.retainedManualChoice);
      expect(retained.map(({ record }) => record.checkpoint.draft?.title).sort()).toEqual([...branchTitles].sort());
      expect((await h.commits.list('owner')).some(request => request.state !== 'cancelled')).toBe(false);
    } finally { a.dispose(); b.dispose(); }
  },
);

it.each(['local', 'remote', 'local after a manual continuation', 'local after an unproven manual leaf'] as const)('keeps a branched ordinary flow answer out of the conduct form: %s', async choice => {
  const { h, a, b, inA, inB } = await setup();
  const flow = (durationMin: number) => [{ id: 'block', templateId: 'template', order: 0, durationMin }];
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, flow: flow(20) }));
    const [first] = await h.commits.list('owner');
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.flow).toEqual(flow(20)));
    await inB.edit({ ...inB.getState().checkpoint.draft!, flow: flow(40) });
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, flow: flow(30) }));
    b.setVisible(true);
    await inB.save();
    const queued = await h.commits.list('owner');
    expect(queued.filter(request => request.predecessor === first.id).map(request => request.value?.flow))
      .toEqual([flow(30), flow(40)]);
    h.silentRemote({ flow: flow(10) });
    a.setOnline(true);
    await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe('conflict'));
    inA.dispose(); inB.dispose();

    const fresh = await b.openEditor(resource, editorIdentity('tab-B', resource, 'group', 'conduct'));
    await waitFor(() => expect(fresh.getState().savedIntentReplaceable).toBe(true));
    const form = fresh.form('conduct-setup', [['flow']]);
    await form.begin();
    const mixed = choice.startsWith('local after');
    if (mixed) {
      // A Save admitted in a different form can arrive after this editor acquired the ordinary answer.
      const sibling = queued.find(request => request.predecessor === first.id)!;
      const value = { ...sibling.value!, flow: flow(50) };
      const editorId = manualScopeIdentity(editorIdentity('tab-C', resource, 'group', 'conduct-C'), 'conduct-setup');
      await h.commits.create({ ...sibling, id: 'manual-flow-branch', editorId, editGeneration: 1,
        predecessor: choice === 'local after an unproven manual leaf' ? first.id : sibling.id, value, intended: value });
    }
    await expect(form.resolve(choice === 'remote' ? 'remote' : 'local')).rejects.toMatchObject({ code: 'other-changes-first' });
    if (mixed) {
      await expect(fresh.acceptRemote()).rejects.toMatchObject({ code: 'decision-changed' });
      expect((await h.commits.list('owner')).map(request => request.state)).toEqual(['conflict', 'queued', 'queued', 'queued']);
      return;
    }
    const state = fresh.getState();
    const parentStatus = describeSync(state, fresh.getObservation(), fresh.getDelivery());
    expect(parentStatus).toMatchObject({ canKeepLocal: true, canAcceptRemote: true });
    expect(describeManualSync(form.getState(), state, parentStatus, null)).toMatchObject({ canKeepLocal: false, canAcceptRemote: false });
    expect((await h.commits.list('owner')).map(request => request.state)).toEqual(['conflict', 'queued', 'queued']);

    await fresh.acceptRemote();
    const retained = (await b.listRecoverable(resource)).filter(({ record }) => record.retainedManualChoice);
    expect(retained.map(({ record }) => record.checkpoint.draft?.flow)).toEqual(expect.arrayContaining([flow(30), flow(40)]));
    expect(retained).toHaveLength(2);
  } finally { a.dispose(); b.dispose(); }
});

it.each([
  'source takes stored', 'source keeps mine', 'fresh editor takes stored', 'notice takes stored',
  'source preserves later form typing', 'source keeps mine against matching stored form words', 'notice takes newer stored words',
  'source recovers a saved form after interrupted receipt',
] as const)(
  'settles an early ordinary answer without losing a separately saved manual continuation: %s', async choice => {
    const { h, a, b, inA, inB } = await setup();
    const flow = (durationMin: number) => [{ id: 'block', templateId: 'template', order: 0, durationMin }];
    try {
      b.setVisible(false);
      await inA.commit(current => ({ ...current!, flow: flow(20) }));
      const [first] = await h.commits.list('owner');
      b.setVisible(true);
      await waitFor(() => expect(inB.getState().checkpoint.draft?.flow).toEqual(flow(20)));
      const form = inB.form('conduct-setup', [['flow']]);
      await form.begin();
      await form.update(value => ({ ...value, flow: flow(40) }));
      const interrupted = choice === 'source recovers a saved form after interrupted receipt';
      const manualKey = JSON.stringify(['manual', 'owner', form.getState()?.record.scopeId]);
      const beforeReceipt = h.storage.rows.get(manualKey) as StoredManualScope;
      b.setVisible(false);
      await inA.commit(current => ({ ...current!, flow: flow(30),
        ...(choice === 'fresh editor takes stored' ? { description: 'Ordinary-only words' } : {}) }));
      await form.save();
      const saved = await h.commits.list('owner');
      const branches = saved.filter(request => request.predecessor === first.id);
      expect(branches.map(request => request.value)).toEqual([
        expect.objectContaining({ flow: flow(30) }),
        expect.objectContaining({ flow: flow(40) }),
      ]);
      const sourceScope = branches[1].editorId;
      expect(sourceScope).toBe(form.getState()?.record.scopeId);
      if (interrupted) {
        inB.dispose(); await settleEngine();
        expect(beforeReceipt.record.savedSelection).toEqual([{ exists: true, value: flow(20) }]);
        // The request transaction completed, but the separate form receipt was still pending.
        h.storage.rows.set(manualKey, beforeReceipt);
      }
      const laterTyping = choice === 'source preserves later form typing';
      if (laterTyping) {
        await form.begin();
        await form.update(value => ({ ...value, flow: flow(50) }));
      }

      const newerStored = choice === 'notice takes newer stored words';
      const storedDuration = choice === 'source keeps mine against matching stored form words' ? 40 : 10;
      h.silentRemote({ flow: flow(newerStored ? 40 : storedDuration) });
      a.setOnline(true);
      await a.retry();
      await waitFor(() => expect(inA.getState().result).toMatchObject({ kind: 'conflict', operationId: first.id }));
      expect((await h.commits.list('owner')).map(request => request.state)).toEqual(['conflict', 'queued', 'queued']);

      if (!laterTyping) inB.dispose();
      if (newerStored) {
        h.silentRemote({ flow: flow(storedDuration) });
        await a.retry(resource);
        await waitFor(async () => expect(await b.peekCached(resource)).toEqual(h.server));
      }
      let reopened;
      if (choice === 'source takes stored' || laterTyping || interrupted) {
        if (choice === 'source takes stored') {
          const before = await h.commits.list('owner');
          h.storage.writeFailureFor = key => Array.isArray(key) && key[0] === 'manual' && key[1] === 'owner' && key[2] !== sourceScope;
          await expect(inA.acceptRemote()).rejects.toThrow('disk full');
          h.storage.writeFailureFor = undefined;
          expect(await h.commits.list('owner')).toEqual(before);
          expect(inA.getState().result?.kind).toBe('conflict');
        }
        await expect(inA.acceptRemote()).resolves.toBeUndefined();
        expect(inA.getState().checkpoint.draft).toMatchObject({ flow: flow(10) });
        if (interrupted) {
          const receipt = h.storage.rows.get(manualKey) as StoredManualScope;
          expect(receipt.record.predecessor?.id).toBe(branches[1].id);
          expect(receipt.record.savedSelection).toEqual([{ exists: true, value: flow(40) }]);
        }
      } else if (choice === 'source keeps mine' || storedDuration === 40) {
        await expect(inA.keepLocal()).resolves.toBeUndefined();
        expect(inA.getState().checkpoint.draft).toMatchObject({ flow: flow(20) });
      } else {
        inA.dispose();
        if (choice === 'notice takes stored' || newerStored) {
          expect(await b.takeStoredVersion(resource, [first.id])).toBe(1);
        } else {
          reopened = await b.openEditor(resource, editorIdentity('tab-B', resource, 'group', 'conduct-return'));
          expect(reopened.getState().result).toMatchObject({ kind: 'conflict', operationId: first.id });
          await waitFor(() => expect(reopened!.getState().savedIntentReplaceable).toBe(true));
          await waitFor(() => expect(b.getOpenAnswerScopes()[0]?.laterSaves?.map(save => save.draft?.flow))
            .toEqual(expect.arrayContaining([flow(30), flow(40)])));
          const current = reopened.getState().checkpoint;
          const composed = { owner: 'owner', editorId: 'earlier-form-parent', prepared: null, unfinalized: [],
            checkpoint: { ...current, draft: { ...branches[0].value!, flow: flow(40) }, pending: {
              ...current.pending, ...Object.fromEntries(branches.map(branch => [branch.id, { generation: branch.editGeneration, value: branch.value }])),
            } } };
          const openAnswers = b.getOpenAnswerScopes();
          expect(recoveryHeldOpen([composed], openAnswers)).toBe(true);
          expect(recoveryHeldOpen([{ ...composed, checkpoint: { ...composed.checkpoint,
            draft: { ...composed.checkpoint.draft, title: 'Unseen private words' },
          } }], openAnswers)).toBe(false);
          await reopened.acceptRemote();
          expect(reopened.getState().checkpoint.draft).toMatchObject({ flow: flow(10) });
        }
      }
      if (laterTyping) {
        expect(form.getState()?.record.stage).toEqual([{ exists: true, value: flow(50) }]);
        inB.dispose();
      }
      expect((await b.listRecoverable(resource)).map(copy => copy.record.checkpoint.draft?.flow)).toContainEqual(flow(30));
      reopened ??= await b.openEditor(resource, editorIdentity('tab-B', resource, 'group', 'conduct-return'));
      const restoredForm = reopened.form('conduct-setup', [['flow']]);
      const choices = await restoredForm.listRecoverable();
      const retained = choices.find(candidate => candidate.scopeId !== sourceScope);
      expect(retained?.record.stage).toEqual([{ exists: true, value: flow(40) }]);
      if (laterTyping) expect(choices.find(candidate => candidate.scopeId === sourceScope)?.record.stage)
        .toEqual([{ exists: true, value: flow(50) }]);
      if (interrupted) {
        expect(choices.some(candidate => candidate.scopeId === sourceScope)).toBe(false);
        await expect(restoredForm.recover(sourceScope)).rejects.toMatchObject({ code: 'decision-changed' });
      }
      await restoredForm.recover(retained!.scopeId);
      expect(restoredForm.getState()?.value?.flow).toEqual(flow(40));
      expect(h.server.value?.flow).toEqual(flow(storedDuration));
      expect(h.transport.send).toHaveBeenCalledTimes(1);
    } finally { a.dispose(); b.dispose(); }
  },
);

it('rejects a field choice if another ordinary continuation lands during retirement', async () => {
  const { h, a, b, inA, inB } = await setup();
  const flow = (durationMin: number) => [{ id: 'block', templateId: 'template', order: 0, durationMin }];
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, flow: flow(20) }));
    await inA.commit(current => ({ ...current!, flow: flow(30) }));
    h.silentRemote({ flow: flow(10) });
    a.setOnline(true);
    await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe('conflict'));
    inA.dispose();
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().savedIntentReplaceable).toBe(true));
    const form = inB.form('conduct-setup', [['flow']]);
    await form.begin();
    const [first, second] = await h.commits.list('owner');
    expect(second.predecessor).toBe(first.id);
    const value = { ...second.value!, flow: flow(40) };
    const late = { ...second, id: 'second-flow-branch', editGeneration: 3, value, intended: value };
    const commit = h.commits.compareAndSetWithCheckpoint!.bind(h.commits);
    jest.spyOn(h.commits, 'compareAndSetWithCheckpoint').mockImplementationOnce(async (changes, project, target) => {
      await h.commits.create(late);
      return commit(changes, project, target);
    });
    await expect(form.resolve('remote')).rejects.toMatchObject({ code: 'commit-changed' });
    expect((await h.commits.list('owner')).map(request => [request.id, request.state]))
      .toEqual([[first.id, 'conflict'], [second.id, 'queued'], [late.id, 'queued']]);
  } finally { a.dispose(); b.dispose(); }
});

it('does not keep an early generation refusal on a later revision of the rejected generation', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setOnline(true);
    await h.remote({ title: 'Newer stored title of the same generation' });
    await waitFor(() => expect(inB.getState().checkpoint.confirmed).toEqual(h.server));
    b.setVisible(false);
    b.setOnline(false);
    await inA.commit(current => ({ ...current!, title: 'First title refused by the server' }));
    await inA.commit(current => ({ ...current!, description: 'Later saved description' }));
    const [first, second] = await h.commits.list('owner');
    const refusal = { kind: 'refused', operationId: first.id, code: 'generation-mismatch' } as const;
    jest.mocked(h.transport.send).mockResolvedValueOnce(refusal);
    a.setOnline(true);
    await a.retry();
    await waitFor(() => expect(inA.getState().result).toEqual(refusal));
    inA.dispose();

    b.setVisible(true);
    await waitFor(() => expect(inB.getState().result).toEqual(refusal));
    expect(inB.getState().checkpoint.remoteCandidate).toEqual(h.server);
    await expect(inB.keepLocal()).rejects.toMatchObject({ code: 'fresh-read-required' });
    expect((await h.commits.list('owner')).map(request => [request.id, request.state])).toEqual([
      [first.id, 'refused'], [second.id, 'queued'],
    ]);
  } finally { a.dispose(); b.dispose(); }
});

it.each(['remote', 'local', 'racing capture', 'private words'] as const)('settles the first conflict with %s and retains the later ordinary Save', async choice => {
  const { h, a, b, inA, inB } = await setup();
  const early = 'First saved title', later = 'Later saved title', stored = 'Stored server title';
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: early }));
    await inA.commit(current => ({ ...current!, title: later }));
    const [first, second] = await h.commits.list('owner');
    expect(second.predecessor).toBe(first.id);
    h.silentRemote({ title: stored, description: 'Independent server field' });
    a.setOnline(true);
    await a.retry();
    await waitFor(() => expect(inA.getState().result).toMatchObject({ kind: 'conflict', operationId: first.id }));
    inA.dispose();

    b.setVisible(true);
    await waitFor(() => expect(inB.getState().result).toMatchObject({ kind: 'conflict', operationId: first.id }));
    expect(inB.getState().checkpoint.draft?.title).toBe(early);
    expect(inB.getState().savedIntentReplaceable).toBe(true);
    if (choice === 'private words') {
      await inB.edit({ ...inB.getState().checkpoint.draft!, description: 'Private words typed in B' });
      await expect(inB.acceptRemote()).rejects.toMatchObject({ code: 'other-changes-first' });
      expect(inB.getState().checkpoint.draft?.description).toBe('Private words typed in B');
      expect((await h.commits.list('owner')).map(request => request.state)).toEqual(['conflict', 'queued']);
      return;
    }
    await waitFor(async () => {
      const drafts = (await b.listRecoverable(resource)).filter(item => item.answer === 'conflict').map(item => item.record);
      expect(drafts.some(draft => draft.checkpoint.draft?.title === later)).toBe(true);
      expect(recoveryHeldOpen(drafts, b.getOpenAnswerScopes())).toBe(true);
    });
    if (choice === 'racing capture') {
      const commit = h.commits.compareAndSetWithCheckpoint!.bind(h.commits);
      const value = { ...second.value!, title: 'Third save captured during the choice' };
      const late = { ...second, id: 'third-save', editGeneration: 3, predecessor: second.id,
        revision: 0, initialized: false, value, intended: value, command: null,
        submitted: null, state: 'queued' as const, result: null, unfinalized: [] };
      jest.spyOn(h.commits, 'compareAndSetWithCheckpoint').mockImplementationOnce(async (changes, project, target) => {
        await h.commits.create(late);
        return commit(changes, project, target);
      });
      await expect(inB.acceptRemote()).rejects.toMatchObject({ code: 'commit-changed' });
      const retained = await h.commits.list('owner');
      expect(retained.map(request => [request.id, request.state])).toEqual([
        [first.id, 'conflict'], [second.id, 'queued'], [late.id, 'queued'],
      ]);
      return;
    }
    if (choice === 'remote') await inB.acceptRemote();
    else { await inB.keepLocal(); await inB.save(); }
    b.setOnline(true);
    await b.retry();

    const selected = choice === 'remote' ? stored : early;
    await waitFor(() => expect(inB.getState().checkpoint.draft).toMatchObject({
      title: selected, description: 'Independent server field',
    }));
    const retained = await b.listRecoverable(resource);
    expect(retained.some(copy => copy.record.checkpoint.draft?.title === later)).toBe(true);
    expect(h.server.value?.title).toBe(selected);
  } finally { a.dispose(); b.dispose(); }
});

it('keeps only the answered Save even when the deciding editor holds the later Save', async () => {
  const { h, a, b, inA } = await setup();
  try {
    await inA.commit(current => ({ ...current!, title: 'First saved title' }));
    await inA.commit(current => ({ ...current!, title: 'Later saved title' }));
    h.silentRemote({ title: 'Stored server title', description: 'Independent server field' });
    a.setOnline(true);
    await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe('conflict'));

    await inA.keepLocal();
    await inA.save();
    await a.retry();
    await waitFor(() => expect(h.server.value).toMatchObject({
      title: 'First saved title', description: 'Independent server field',
    }));
    const retained = await a.listRecoverable(resource);
    expect(retained.some(copy => copy.record.checkpoint.draft?.title === 'Later saved title')).toBe(true);
  } finally { a.dispose(); b.dispose(); }
});

it('leaves a later Save untouched when it lands after a tip conflict was reviewed', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'First saved title' }));
    h.silentRemote({ title: 'Stored server title' });
    a.setOnline(true);
    await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe('conflict'));
    inA.dispose();
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().result?.kind).toBe('conflict'));
    const [first] = await h.commits.list('owner');
    const value = { ...first.value!, title: 'Later saved title' };
    const later = { ...first, id: 'later-save', editGeneration: 2, predecessor: first.id,
      revision: 0, initialized: false, value, intended: value, command: null,
      submitted: null, state: 'queued' as const, result: null, unfinalized: [] };
    const commit = h.commits.compareAndSetWithCheckpoint!.bind(h.commits);
    jest.spyOn(h.commits, 'compareAndSetWithCheckpoint').mockImplementationOnce(async (changes, project, target) => {
      await h.commits.create(later);
      return commit(changes, project, target);
    });
    await expect(inB.acceptRemote()).rejects.toMatchObject({ code: 'commit-changed' });
    expect((await h.commits.list('owner')).map(request => [request.id, request.state]))
      .toEqual([[first.id, 'conflict'], [later.id, 'queued']]);
  } finally { a.dispose(); b.dispose(); }
});

it('retains the later ordinary Save when taking the server version outside the original editor', async () => {
  const { h, a, b, inA } = await setup();
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'First saved title' }));
    await inA.commit(current => ({ ...current!, description: 'Later saved description' }));
    const [first, second] = await h.commits.list('owner');
    expect(second.predecessor).toBe(first.id);
    h.silentRemote({ title: 'Stored server title', description: 'Independent server field' });
    a.setOnline(true);
    await a.retry();
    await waitFor(() => expect(inA.getState().result).toMatchObject({ kind: 'conflict', operationId: first.id }));
    inA.dispose();

    expect(await b.takeStoredVersion(resource, [first.id])).toBe(1);
    const retained = await b.listRecoverable(resource);
    expect(retained.map(copy => copy.record.checkpoint.draft)).toContainEqual(expect.objectContaining({
      title: 'Stored server title', description: 'Later saved description',
    }));
    expect(h.server.value?.title).toBe('Stored server title');
  } finally { a.dispose(); b.dispose(); }
});

it('keeps independently updated fields when the returning editor already saw the conflict snapshot', async () => {
  const { h, a, b, inA } = await setup();
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Title changed locally' }));
    h.silentRemote({ title: 'Title changed remotely', description: 'Independent newer description' });
    a.setOnline(true);
    await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe('conflict'));
    const [captured] = await h.commits.list('owner');

    const recent = new DataSession(h.server).checkpoint();
    const returningId = editorIdentity('tab-B', resource, 'group', 'opening-B');
    const followed = liveSubmittedWork('owner', returningId, recent, [captured]);
    expect(followed?.answer).toMatchObject({ kind: 'conflict', operationId: captured.id });
    const choice = DataSession.restore(followed!.checkpoint);
    choice.release(captured.id);
    choice.keepLocal();
    expect(choice.getState().draft).toMatchObject({
      title: 'Title changed locally', description: 'Independent newer description',
    });
    expect(choice.getState().confirmed).toEqual(h.server);
  } finally { a.dispose(); b.dispose(); }
});

it('keeps unsent words in the second editor when returning after an ordinary conflict', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    await inB.edit({ ...original, title: 'Private words in the second tab' });
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Saved in the first tab' }));
    h.silentRemote({ title: 'Newer server words' });
    a.setOnline(true);
    await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe('conflict'));
    b.setVisible(true);
    await settleEngine(); await settleEngine();

    expect(inB.getState().checkpoint.draft?.title).toBe('Private words in the second tab');
    expect(inB.getState().checkpoint.pending).toEqual({});
    expect(inB.getState().result).toBeNull();
    expect(await h.commits.list('owner')).toEqual([expect.objectContaining({ state: 'conflict' })]);
    expect(h.transport.send).toHaveBeenCalledTimes(1);
  } finally { a.dispose(); b.dispose(); }
});

it.each(['acknowledged', 'conflict'] as const)('shows a durable deletion in the already-open second editor until it is %s', async outcome => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false);
    await inA.remove();
    const [captured] = await h.commits.list('owner');
    expect(captured).toMatchObject({ value: null, baseline: { value: original } });
    expect(h.transport.send).not.toHaveBeenCalled();
    expect(h.server.value).toEqual(original);

    b.setVisible(true);
    await waitFor(() => expect(inB.getPresence()).toMatchObject({ kind: 'deleting', snapshot: { value: original } }));
    expect(inB.getState().checkpoint).toMatchObject({ draft: null, pending: { [captured.id]: { value: null } } });
    if (outcome === 'conflict') h.silentRemote({ title: 'The council has newer words' });
    a.setVisible(false);
    b.setOnline(true);
    await b.retry();
    await waitFor(() => expect(inB.getState().result?.kind).toBe(outcome));
    if (outcome === 'acknowledged') {
      expect(inB.getPresence().kind).toBe('absent');
      expect(h.server.metadata?.deleted).toBe(true);
    } else {
      await inB.acceptRemote();
      expect(inB.getState().checkpoint.draft?.title).toBe('The council has newer words');
      expect(h.server.metadata?.deleted).toBe(false);
    }
    expect(h.transport.send).toHaveBeenCalledTimes(1);
  } finally { a.dispose(); b.dispose(); }
});

it('offers the exact failed deletion when first returning after its answer', async () => {
  const { h, a, b, inA, inB } = await setup(true);
  try {
    b.setVisible(false);
    await inA.remove();
    const [captured] = await h.commits.list('owner');
    h.silentRemote({ title: 'Newer server words' });
    a.setOnline(true);
    await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe('conflict'));

    b.setVisible(true);
    await waitFor(() => expect(inB.getState().result).toMatchObject({ kind: 'conflict', operationId: captured.id }));
    expect(inB.getState().savedIntentReplaceable).toBe(true);
    await inB.acceptRemote();
    expect(inB.getState().checkpoint.draft?.title).toBe('Newer server words');
    b.setOnline(true);
    await b.retry();
    expect(h.transport.send).toHaveBeenCalledTimes(1);
  } finally { a.dispose(); b.dispose(); }
});

it('restores the retained record when the followed deletion from a recovered editor is refused', async () => {
  const { h, a, b, inA, inB } = await setup(true);
  try {
    b.setVisible(false);
    await inA.remove();
    const [captured] = await h.commits.list('owner');
    b.setVisible(true);
    await waitFor(() => expect(inB.getPresence().kind).toBe('deleting'));

    jest.mocked(h.transport.send).mockResolvedValueOnce({
      kind: 'refused', operationId: captured.id, code: 'permission-denied',
    });
    a.setVisible(false);
    b.setOnline(true);
    await b.retry();
    await waitFor(() => expect(inB.getState().result?.kind).toBe('refused'));
    expect(inB.getState().manualWork).toBe(false);
    await inB.acceptRemote();
    expect(inB.getPresence()).toMatchObject({ kind: 'present', snapshot: { value: original } });
    expect(h.server.value).toEqual(original);
    expect(h.transport.send).toHaveBeenCalledTimes(1);
  } finally { a.dispose(); b.dispose(); }
});

it('shows a confirmed deletion on first offline return after its receipt is collected', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false);
    await inA.remove();
    a.setOnline(true);
    await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe('acknowledged'));
    await waitFor(async () => expect(await h.commits.list('owner')).toEqual([]));
    expect(h.server.metadata?.deleted).toBe(true);
    const readsBeforeReturn = jest.mocked(h.transport.read).mock.calls.length;

    b.setVisible(true);
    await waitFor(() => expect(inB.getPresence()).toMatchObject({
      kind: 'absent', snapshot: { value: null, metadata: { generation: 'g1', revision: 2, deleted: true } },
    }));
    expect(jest.mocked(h.transport.read).mock.calls).toHaveLength(readsBeforeReturn);
  } finally { a.dispose(); b.dispose(); }
});

it.each(['clean', 'private'] as const)('uses a proven already-deleted reply on first offline return with a %s editor', async opening => {
  const { h, a, b, inA, inB } = await setup();
  try {
    if (opening === 'private') await inB.edit({ ...original, title: 'Private second-tab words' });
    b.setVisible(false);
    await inA.remove();
    const [captured] = await h.commits.list('owner');
    h.silentRemoteDelete();
    // The command answer gets through. No document read reaches the returning tab.
    jest.mocked(h.transport.read).mockRejectedValue(new Error('Document read interrupted'));
    a.setOnline(true);
    await a.retry();
    expect(h.transport.send).toHaveBeenCalledTimes(1);
    const result = await jest.mocked(h.transport.send).mock.results[0].value;
    expect(result).toMatchObject({ kind: 'deleted', operationId: captured.id, snapshot: h.server });
    await waitFor(() => expect(inA.getState().checkpoint).toMatchObject({ confirmed: h.server, draft: null, pending: {} }));

    b.setVisible(true);
    if (opening === 'private') {
      await waitFor(() => expect(inB.getState().checkpoint).toMatchObject({
        draft: { title: 'Private second-tab words' }, remoteCandidate: h.server, pending: {}, dirty: true,
      }));
    } else {
      await waitFor(() => expect(inB.getPresence()).toMatchObject({ kind: 'absent', snapshot: h.server }));
      expect(inB.getState().checkpoint).toMatchObject({ confirmed: h.server, draft: null, pending: {}, dirty: false });
    }
    expect(h.transport.send).toHaveBeenCalledTimes(1);
  } finally { a.dispose(); b.dispose(); }
});

it('keeps private words in the second editor during a same-device deletion', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    await inB.edit({ ...original, title: 'Private second-tab words' });
    b.setVisible(false);
    await inA.remove();
    b.setVisible(true);
    await settleEngine();
    await settleEngine();
    expect(inB.getState().checkpoint).toMatchObject({ draft: { title: 'Private second-tab words' }, pending: {} });
    expect(h.transport.send).not.toHaveBeenCalled();
    expect(h.server.value).toEqual(original);
  } finally { a.dispose(); b.dispose(); }
});

it.each(['closed', 'pristine', 'from a recovered source'] as const)('follows a durable manual Save on return, %s', async opening => {
  const { h, a, b, inA, inB } = await setup(opening === 'from a recovered source');
  try {
    const source = inA.form('title', [['title']]);
    const target = inB.form('title', [['title']]);
    if (opening === 'pristine') await target.begin();
    b.setVisible(false);
    await source.begin();
    await source.save(value => ({ ...value, title: 'Manual Save in A' }));
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Manual Save in A'));
    if (opening !== 'pristine') await target.begin();
    await waitFor(() => expect(target.getState()?.value.title).toBe('Manual Save in A'));
    expect(target.getState()?.dirty).toBe(false);
    const [first] = await h.commits.list('owner');
    await target.save(value => ({ ...value, title: 'Manual Save continued in B' }));
    const second = (await h.commits.list('owner')).find(row => row.value?.title === 'Manual Save continued in B');
    expect(second?.predecessor).toBe(first.id);
    expect(h.server.value?.title).toBe('Opening group');
    b.setOnline(true); await b.retry();
    await waitFor(() => expect(h.server).toMatchObject({
      value: { title: 'Manual Save continued in B' }, metadata: { revision: 3 },
    }));
  } finally { a.dispose(); b.dispose(); }
});

it('keeps private manual words until Cancel, then shows the other tab’s saved title', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    const source = inA.form('title', [['title']]);
    const target = inB.form('title', [['title']]);
    await target.begin(); await target.update(value => ({ ...value, title: 'Private words in B' }));
    b.setVisible(false);
    await source.begin();
    await source.save(value => ({ ...value, title: 'Manual Save in A' }));
    b.setVisible(true); await settleEngine(); await settleEngine();
    expect(target.getState()?.value.title).toBe('Private words in B');
    expect((await h.commits.list('owner')).map(row => row.value?.title)).toEqual(['Manual Save in A']);
    await target.cancel();
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Manual Save in A'));
    expect(h.server.value?.title).toBe('Opening group');
  } finally { a.dispose(); b.dispose(); }
});

it.each(['original', 'fresh page', 'explicit recovery'] as const)('leaves a manual conflict with the %s form', async decider => {
  const { h, a, b, inA, inB } = await setup();
  try {
    const source = inA.form('title', [['title']]);
    const target = inB.form('title', [['title']]);
    await target.begin(); b.setVisible(false);
    await source.begin(); await source.save(value => ({ ...value, title: 'Manual Save in A' }));
    const [first] = await h.commits.list('owner');
    b.setVisible(true);
    await waitFor(() => expect(target.getState()?.value.title).toBe('Manual Save in A'));
    inB.dispose();
    const bId = editorIdentity('tab-B', resource, 'group', 'opening-B');
    expect((await b.listRecoverable(resource)).map(choice => choice.record.editorId)).not.toContain(bId);
    const reopeningId = decider === 'fresh page' ? editorIdentity('tab-B-reloaded', resource, 'group', 'new-opening') : bId;
    h.silentRemote({ title: 'Stored on another device' });
    a.setOnline(true); await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe('conflict'));
    const reopened = await b.openEditor(resource, reopeningId);
    const reader = reopened.form('title', [['title']]);
    await reader.begin();
    b.setVisible(true);
    await waitFor(() => expect(reopened.getState().result?.kind).toBe('conflict'));

    expect(reopened.getState().savedIntentReplaceable).toBe(false);
    expect(reader.getState()?.comparison).toBeUndefined();
    expect(b.getOpenAnswerScopes()).toEqual([]);
    expect(a.getOpenAnswerScopes()).toEqual([expect.objectContaining({ operationIds: [first.id] })]);
    await expect(reopened.keepLocal()).rejects.toMatchObject({ code: 'pending-delivery-first' });
    await expect(reader.resolve('remote')).rejects.toMatchObject({ code: 'pending-delivery-first' });
    expect((await h.commits.list('owner')).find(request => request.id === first.id)?.state).toBe('conflict');
    expect(reader.getState()?.record.active).toBe(true);

    if (decider !== 'explicit recovery') {
      await source.resolve('remote');
    } else {
      inA.dispose();
      const choices = await reader.listRecoverable();
      expect(choices.map(choice => choice.scopeId)).toEqual([first.editorId]);
      await reader.recover(first.editorId);
      expect(reopened.getState().savedIntentReplaceable).toBe(false);
      expect(reader.getState()?.exactChoice).toBe(true);
      expect(reader.getState()?.comparison?.requestId).toBe(first.id);
      await reader.resolve('remote');
    }
    b.setVisible(true);
    await waitFor(() => expect(reopened.getState().checkpoint.draft?.title).toBe('Stored on another device'));
    await waitFor(() => expect(reader.getState()?.value.title).toBe('Stored on another device'));
    expect(h.server).toMatchObject({ value: { title: 'Stored on another device' }, metadata: { revision: 2 } });
  } finally { a.dispose(); b.dispose(); }
});

it.each(['pristine', 'private', 'reverted'] as const)('takes a second saved title on return, %s', async stage => {
  const { h, a, b, inA, inB } = await setup();
  try {
    const source = inA.form('title', [['title']]);
    const target = inB.form('title', [['title']]);
    await target.begin(); b.setVisible(false);
    await source.begin(); await source.save(value => ({ ...value, title: 'First Save in A' }));
    b.setVisible(true);
    await waitFor(() => expect(target.getState()?.value.title).toBe('First Save in A'));
    if (stage === 'private') await target.update(value => ({ ...value, title: 'Private B stage' }));
    b.setVisible(false);
    const secondTitle = stage === 'reverted' ? 'Opening group' : 'Second Save in A';
    await source.begin(); await source.save(value => ({ ...value, title: secondTitle }));
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe(secondTitle));
    if (stage === 'private') {
      expect(target.getState()?.value.title).toBe('Private B stage');
      await target.cancel(); await target.begin();
    }
    await waitFor(() => expect(target.getState()?.value.title).toBe(secondTitle));
    await target.save(value => ({ ...value, title: 'Save in B after A twice' }));
    const [first, second, third] = await h.commits.list('owner');
    expect(first.value?.title).toBe('First Save in A');
    expect(second.predecessor).toBe(first.id);
    expect(third.predecessor).toBe(second.id);
  } finally { a.dispose(); b.dispose(); }
});

it('retains B’s later Save when A decides the conflict on its earlier Save', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    const source = inA.form('title', [['title']]);
    const target = inB.form('title', [['title']]);
    b.setVisible(false); await source.begin();
    await source.save(value => ({ ...value, title: 'Earlier Save in A' }));
    a.setVisible(false); b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Earlier Save in A'));
    await target.begin(); await target.save(value => ({ ...value, title: 'Later Save in B' }));
    b.setVisible(false); a.setVisible(true); await settleEngine(); await settleEngine();
    h.silentRemote({ title: 'Stored on another device' });
    a.setOnline(true); await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe('conflict'));
    await source.resolve('remote');
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.pending).toEqual({}));
    expect(inB.getState().checkpoint).toMatchObject({ draft: { title: 'Stored on another device' }, dirty: false });
    expect((await b.listRecoverable(resource)).map(copy => copy.record.checkpoint.draft?.title)).toContain('Later Save in B');
    expect(h.server.value?.title).toBe('Stored on another device');
  } finally { a.dispose(); b.dispose(); }
});

it.each([
  ['fresh reader', 'remote'], ['fresh reader', 'local'], ['later author', 'remote'], ['later author', 'local'],
] as const)('resolves only the earlier conflicting Save from the %s, choosing %s', async (decider, choice) => {
  const { h, a, b, inA, inB } = await setup();
  const c = h.createBrowser().engine;
  try {
    const source = inA.form('title', [['title']]);
    const later = inB.form('title', [['title']]);
    b.setVisible(false);
    await source.begin(); await source.save(value => ({ ...value, title: 'Earlier Save in A' }));
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Earlier Save in A'));
    await later.begin(); await later.save(value => ({ ...value, title: 'Later Save in B' }));
    const [first, second] = await h.commits.list('owner');
    expect(second.predecessor).toBe(first.id);
    h.silentRemote({ title: 'Stored on another device' });
    a.setOnline(true); await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe('conflict'));
    inA.dispose();

    let editor = inB, form = later;
    if (decider === 'fresh reader') {
      inB.dispose();
      c.setOnline(false); c.setOwner('owner');
      editor = await c.openEditor(resource, editorIdentity('tab-C', resource, 'group', 'fresh-C'));
      form = editor.form('title', [['title']]);
    } else {
      b.setVisible(true);
    }
    await waitFor(() => expect(editor.getState().result?.kind).toBe('conflict'));
    await form.recover(first.editorId);
    expect(form.getState()?.exactChoice).toBe(true);
    expect(form.getState()?.comparison).toMatchObject({ requestId: first.id, mine: { title: 'Earlier Save in A' } });
    await form.resolve(choice);

    const decidingEngine = decider === 'later author' ? b : c;
    decidingEngine.setOnline(true); await decidingEngine.retry();
    const chosenTitle = choice === 'local' ? 'Earlier Save in A' : 'Stored on another device';
    await waitFor(() => expect(editor.getState().checkpoint).toMatchObject({ draft: { title: chosenTitle }, dirty: false }));
    const waiting = await decidingEngine.listRecoverable(resource);
    expect(waiting.filter(copy => copy.record.checkpoint.draft?.title === 'Later Save in B')).toHaveLength(1);
    expect(h.server).toMatchObject({ value: { title: chosenTitle }, metadata: { revision: choice === 'local' ? 3 : 2 } });
  } finally { a.dispose(); b.dispose(); c.dispose(); }
});

it.each([
  ['fresh reader', 'remote', 'same source has two Saves'],
  ['fresh reader', 'local', 'later equals stored'],
  ['fresh reader', 'remote', 'later reverts the title'],
  ['later author', 'remote', 'document must not decide'],
  ['fresh reader', 'remote', 'late dependent races choice'],
] as const)('protects the exact choice from the %s, choosing %s, %s', async (decider, choice, variant) => {
  const { h, a, b, inA, inB } = await setup();
  const c = h.createBrowser().engine;
  try {
    const source = inA.form('title', [['title']]);
    const later = inB.form('title', [['title']]);
    b.setVisible(false);
    await source.begin(); await source.save(value => ({ ...value, title: 'Earlier Save in A' }));
    const twice = variant === 'same source has two Saves';
    if (twice) {
      await source.begin();
      await source.save(value => ({ ...value, title: 'Second Save in A' }));
    }
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe(twice ? 'Second Save in A' : 'Earlier Save in A'));
    await later.begin(); await later.save(value => ({ ...value, title: 'Later Save in B' }));
    const reverting = variant === 'later reverts the title';
    if (reverting) {
      await later.begin();
      await later.save(value => ({ ...value, title: 'Earlier Save in A' }));
    }
    const rows = await h.commits.list('owner');
    const first = rows[0];
    expect(rows[1].predecessor).toBe(first.id);
    if (twice || reverting) expect(rows[2].predecessor).toBe(rows[1].id);
    const external = variant === 'later equals stored' ? 'Later Save in B' : 'Stored on another device';
    h.silentRemote({ title: external });
    a.setOnline(true); await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe('conflict'));
    inA.dispose();

    let editor = inB, form = later;
    if (decider === 'fresh reader') {
      inB.dispose();
      c.setOnline(false); c.setOwner('owner');
      editor = await c.openEditor(resource, editorIdentity('tab-C', resource, 'group', 'fresh-C'));
      form = editor.form('title', [['title']]);
    } else {
      b.setVisible(true);
    }
    await waitFor(() => expect(editor.getState().result?.kind).toBe('conflict'));
    await form.recover(first.editorId);
    expect(form.getState()?.exactChoice).toBe(true);
    expect(form.getState()?.comparison).toMatchObject({ requestId: first.id, mine: { title: 'Earlier Save in A' } });
    if (variant === 'document must not decide') {
      await expect(editor.acceptRemote()).rejects.toMatchObject({ code: 'pending-delivery-first' });
    }
    if (variant === 'late dependent races choice') {
      const commit = h.commits.compareAndSetWithCheckpoint!.bind(h.commits);
      const observed = rows[1];
      const value = { ...observed.value!, title: 'Later write during choice' };
      const late = { ...observed, id: 'late-save-during-choice', editorId: 'late-writer', editGeneration: 1,
        predecessor: observed.id, revision: 0, initialized: false, value, intended: value, command: null,
        submitted: null, state: 'queued' as const, result: null, unfinalized: [] };
      jest.spyOn(h.commits, 'compareAndSetWithCheckpoint').mockImplementationOnce(async (changes, project, target) => {
        await h.commits.create(late);
        return commit(changes, project, target);
      });
      await expect(form.resolve(choice)).rejects.toMatchObject({ code: 'commit-changed' });
      expect((await h.commits.list('owner')).find(row => row.id === first.id)?.state).toBe('conflict');
      expect((await h.commits.list('owner')).find(row => row.id === late.id)?.state).toBe('queued');
      return;
    }
    await form.resolve(choice);

    const decidingEngine = decider === 'later author' ? b : c;
    decidingEngine.setOnline(true); await decidingEngine.retry();
    const chosenTitle = choice === 'local' ? 'Earlier Save in A' : external;
    await waitFor(() => expect(editor.getState().checkpoint).toMatchObject({ draft: { title: chosenTitle }, dirty: false }));
    const waiting = await decidingEngine.listRecoverable(resource);
    const retainedTitle = reverting ? 'Earlier Save in A' : 'Later Save in B';
    const preserved = waiting.filter(copy => copy.record.checkpoint.draft?.title === retainedTitle);
    expect(preserved).toHaveLength(1);
    expect(h.server).toMatchObject({ value: { title: chosenTitle }, metadata: { revision: choice === 'local' ? 3 : 2 } });
    if (variant === 'later equals stored') {
      const restored = await decidingEngine.recoverEditor(resource, editorIdentity('tab-C', resource, 'group', 'recover-later'), preserved[0].id);
      expect(restored.getState().checkpoint).toMatchObject({
        confirmed: { value: { title: chosenTitle } }, draft: { title: retainedTitle }, dirty: true,
      });
      await restored.save(); await decidingEngine.retry();
      await waitFor(() => expect(h.server).toMatchObject({ value: { title: retainedTitle }, metadata: { revision: 4 } }));
    }
  } finally { a.dispose(); b.dispose(); c.dispose(); }
});

it.each(['private text above the answer', 'original editor must use the form', 'generation mismatch'] as const)(
  'protects the exact manual answer, %s', async variant => {
  const { h, a, b, inA, inB } = await setup();
  const c = h.createBrowser().engine;
  try {
    const source = inA.form('title', [['title']]);
    const later = inB.form('title', [['title']]);
    await source.begin();
    await source.save(value => ({ ...value, title: 'Earlier Save in A' }));
    const twice = variant === 'private text above the answer';
    if (twice) {
      await source.begin();
      await source.save(value => ({ ...value, title: 'Second Save in A' }));
    }
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe(twice ? 'Second Save in A' : 'Earlier Save in A'));
    await later.begin();
    await later.save(value => ({ ...value, title: 'Later Save in B' }));
    const [first] = await h.commits.list('owner');
    const refused = variant === 'generation mismatch';
    if (refused) {
      jest.mocked(h.transport.send).mockImplementationOnce(async command => ({
        kind: 'refused', operationId: command.operationId, code: 'generation-mismatch',
      }));
    } else {
      h.silentRemote({ title: 'Stored on another device' });
    }
    a.setOnline(true); await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe(refused ? 'refused' : 'conflict'));
    if (variant === 'original editor must use the form') {
      await expect(inA.acceptRemote()).rejects.toMatchObject({ code: 'pending-delivery-first' });
      expect((await h.commits.list('owner')).find(row => row.id === first.id)?.state).toBe('conflict');
      await source.resolve('remote');
      b.setVisible(true);
      await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Stored on another device'));
      expect((await b.listRecoverable(resource)).some(copy => copy.record.checkpoint.draft?.title === 'Later Save in B')).toBe(true);
      return;
    }
    inA.dispose(); inB.dispose();
    c.setOnline(false); c.setOwner('owner');
    const editor = await c.openEditor(resource, editorIdentity('tab-C', resource, 'group', 'fresh-C'));
    const form = editor.form('title', [['title']]);
    await form.recover(first.editorId);
    expect(form.getState()?.exactChoice).toBe(true);
    if (refused) {
      await expect(form.resolve('local')).rejects.toMatchObject({ code: 'fresh-read-required' });
      expect((await h.commits.list('owner')).find(row => row.id === first.id)?.state).toBe('refused');
      return;
    }
    await form.update(value => ({ ...value, title: 'Private words typed after A2' }));
    await form.resolve('local');
    c.setOnline(true); await c.retry();
    await waitFor(() => expect(h.server).toMatchObject({ value: { title: 'Earlier Save in A' }, metadata: { revision: 3 } }));
    editor.dispose();
    const reopened = await c.openEditor(resource, editorIdentity('tab-C', resource, 'group', 'reopened-C'));
    const drafts = await c.listRecoveryChoices(resource, true);
    const privateDraft = drafts.find(copy => copy.record.checkpoint.draft?.title === 'Private words typed after A2');
    expect(privateDraft).toBeDefined();
    expect(drafts.some(copy => copy.record.checkpoint.draft?.title === 'Later Save in B')).toBe(true);
    reopened.dispose();
    const restored = await c.recoverEditor(resource, editorIdentity('tab-C', resource, 'group', 'restore-private'), privateDraft!.id);
    expect(restored.getState().checkpoint).toMatchObject({ dirty: true, draft: { title: 'Private words typed after A2' } });
    expect(h.server.value?.title).toBe('Earlier Save in A');
  } finally { a.dispose(); b.dispose(); c.dispose(); }
});

it.each(['original', 'reopened in the source tab'] as const)(
  'keeps a later ordinary Save out of an earlier manual field choice, %s', async opening => {
  const { h, a, b, inA, inB } = await setup();
  try {
    const source = inA.form('title', [['title']]);
    a.setVisible(false); b.setVisible(false);
    await source.begin();
    await source.save(value => ({ ...value, title: 'Earlier title in A' }));
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Earlier title in A'));
    await inB.commit(current => ({ ...current!, description: 'Later ordinary text in B' }));
    const [first, second] = await h.commits.list('owner');
    expect(second.predecessor).toBe(first.id);
    a.setVisible(true); await settleEngine(); await settleEngine();
    h.silentRemote({ title: 'Stored on another device' });
    a.setOnline(true); await a.retry();
    await waitFor(() => expect(inA.getState().result?.kind).toBe('conflict'));

    await expect(inA.acceptRemote()).rejects.toMatchObject({ code: 'pending-delivery-first' });
    expect((await h.commits.list('owner')).find(row => row.id === first.id)?.state).toBe('conflict');
    if (opening === 'original') {
      await source.resolve('remote');
    } else {
      inA.dispose();
      const fresh = await a.openEditor(resource, editorIdentity('tab-A', resource, 'group', 'reopen-in-A'));
      expect(fresh.getState().borrowedManualAnswers).toContain(first.editorId);
      const form = fresh.form('title', [['title']]);
      await form.recover(first.editorId);
      expect(form.getState()?.exactChoice).toBe(true);
      await form.resolve('remote');
    }
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Stored on another device'));
    expect((await b.listRecoveryChoices(resource, true)).map(copy => copy.record.checkpoint.draft)).toContainEqual(
      expect.objectContaining({ title: 'Stored on another device', description: 'Later ordinary text in B' }));
    expect(h.server.value?.description).toBeUndefined();
  } finally { a.dispose(); b.dispose(); }
});

it.each(['before reopening', 'after reopening'] as const)(
  'offers the source form after a same-tab reopen before the answer, continued %s', async timing => {
  const { h, a, b, inA, inB } = await setup();
  try {
    a.setVisible(false); b.setVisible(false);
    const source = inA.form('title', [['title']]);
    await source.begin();
    await source.save(value => ({ ...value, title: 'Earlier title in A' }));
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Earlier title in A'));
    const continueInB = () => inB.commit(current => ({ ...current!, description: 'Later ordinary text in B' }));
    if (timing === 'before reopening') await continueInB();
    inA.dispose();
    const fresh = await a.openEditor(resource, editorIdentity('tab-A', resource, 'group', 'reopened-before-answer'));
    if (timing === 'after reopening') await continueInB();
    const [first, second] = await h.commits.list('owner');
    expect(second.predecessor).toBe(first.id);
    a.setVisible(true); await settleEngine(); await settleEngine();
    h.silentRemote({ title: 'Stored on another device' });
    a.setOnline(true); await a.retry();
    await waitFor(() => expect(fresh.getState().result?.kind).toBe('conflict'));
    expect(fresh.getState().borrowedManualAnswers).toContain(first.editorId);
    expect(fresh.getState().savedIntentReplaceable).toBe(false);
    const form = fresh.form('title', [['title']]);
    expect((await form.listRecoverable()).map(candidate => candidate.scopeId)).toContain(first.editorId);
    await form.recover(first.editorId);
    expect(form.getState()?.exactChoice).toBe(true);
    await form.resolve('remote');
    expect((await a.listRecoveryChoices(resource, true)).map(copy => copy.record.checkpoint.draft)).toContainEqual(
      expect.objectContaining({ title: 'Stored on another device', description: 'Later ordinary text in B' }));
    expect(h.server.value?.description).toBeUndefined();
  } finally { a.dispose(); b.dispose(); }
});

it('keeps private unsaved words in B while A saves the same field offline', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    await inB.edit({ ...original, title: 'Private unsaved B' });
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    b.setVisible(true); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Private unsaved B');
    const requests = await h.commits.list('owner');
    expect(requests.some(r => r.value?.title === 'Saved locally in A')).toBe(true);
    expect(requests.some(r => r.value?.title === 'Private unsaved B')).toBe(false);
    expect(h.server.value?.title).toBe('Opening group');
  } finally { a.dispose(); b.dispose(); }
});


it('continues B after the captured A edit and delivers the continuation without a stale overwrite', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    b.setVisible(true); await settleEngine(); await settleEngine();
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Saved locally in A'));
    await inB.commit(current => ({ ...current!, title: 'Continued in B' }));
    const records = await h.commits.list('owner');
    const first = records.find(request => request.value?.title === 'Saved locally in A')!;
    const second = records.find(request => request.value?.title === 'Continued in B')!;
    expect(second.predecessor).toBe(first.id);
    b.setOnline(true); await b.retry(); await settleEngine(); await settleEngine();
    a.setOnline(true); await a.retry(); await settleEngine();
    expect(h.server.value?.title).toBe('Continued in B');
    expect(inB.getState().checkpoint.conflicts).toEqual([]);
  } finally { a.dispose(); b.dispose(); }
});

it('reads the whole saved A chain while leaving its confirmed baseline unchanged', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'First A words' }));
    await inA.commit(current => ({ ...current!, title: 'Last A words' }));
    b.setVisible(true); await settleEngine(); await settleEngine();
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Last A words'));
    const state = inB.getState().checkpoint;
    expect(state.draft?.title).toBe('Last A words');
    expect(state.confirmed.value?.title).toBe('Opening group');
    expect(Object.keys(state.pending)).toHaveLength(2);
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { a.dispose(); b.dispose(); }
});

it('keeps two already captured independent roots separate on return', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Independent A words' }));
    await inB.commit(current => ({ ...current!, title: 'Independent B words' }));
    b.setVisible(true); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Independent B words');
    expect((await h.commits.list('owner')).filter(request => !request.predecessor)).toHaveLength(2);
    expect(h.transport.send).not.toHaveBeenCalled();
  } finally { a.dispose(); b.dispose(); }
});

it('shows an accepted A edit even if its request was already collected before B returned', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Accepted A words' }));
    a.setOnline(true); await a.retry(); await settleEngine(); await settleEngine();
    expect(h.server.value?.title).toBe('Accepted A words');
    expect(await h.commits.list('owner')).toEqual([]);
    const calls = jest.mocked(h.transport.read).mock.calls.length;
    b.setVisible(true); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Accepted A words');
    expect(inB.getState().checkpoint.confirmed).toEqual(h.server);
    expect(inB.getState().checkpoint.pending).toEqual({});
    expect(jest.mocked(h.transport.read).mock.calls).toHaveLength(calls);
  } finally { a.dispose(); b.dispose(); }
});

it('keeps typing that arrives while the return read is waiting', async () => {
  const { h, a, b, inA, inB } = await setup();
  let release: (() => void) | undefined;
  const originalList = h.commits.list.bind(h.commits);
  let spy: jest.SpyInstance | undefined;
  try {
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    await settleEngine(); await settleEngine();
    const held = new Promise<void>(resolve => { release = resolve; });
    let reading = false;
    spy = jest.spyOn(h.commits, 'list').mockImplementationOnce(async owner => {
      const records = await originalList(owner); reading = true; await held; return records;
    });
    b.setVisible(true); await settleEngine();
    expect(reading).toBe(true);
    await inB.edit({ ...original, title: 'Typed during the read' });
    release!(); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Typed during the read');
    expect(inB.getState().checkpoint.pending).toEqual({});
    expect(h.server.value?.title).toBe('Opening group');
  } finally { release?.(); spy?.mockRestore(); a.dispose(); b.dispose(); }
});


it('retries an unchanged saved root after private typing is put back', async () => {
  const { a, b, inA, inB } = await setup();
  try {
    await inB.edit({ ...original, title: 'Private B words' });
    b.setVisible(false); await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    b.setVisible(true); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Private B words');
    await inB.edit(original);
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Saved locally in A'));
  } finally { a.dispose(); b.dispose(); }
});

it('keeps an active private form and follows the saved root only after it closes', async () => {
  const { a, b, inA, inB } = await setup();
  try {
    const form = inB.form('title', [['title']]);
    await form.begin(); await form.update(value => ({ ...value, title: 'Private form words' }));
    b.setVisible(false); await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    b.setVisible(true); await settleEngine(); await settleEngine();
    expect(inB.getState().checkpoint.draft?.title).toBe('Opening group');
    expect(form.getState()?.value.title).toBe('Private form words');
    await form.cancel(); b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Saved locally in A'));
  } finally { a.dispose(); b.dispose(); }
});

it('replays the real ACK retained by the adopted B checkpoint on its next return', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    b.setVisible(false); await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Saved locally in A'));
    await waitFor(() => expect(inB.getState().durable).toBe(true));
    const id = Object.keys(inB.getState().checkpoint.pending)[0]; expect(id).toBeDefined();
    b.setVisible(false); a.setOnline(true); await a.retry(); await settleEngine(); await settleEngine();
    const held = (await h.commits.list('owner')).find(request => request.id === id);
    expect(held?.state).toBe('acknowledged');
    expect((await h.checkpoints.read('owner', editorIdentity('tab-B', resource, 'group', 'opening-B')))?.checkpoint.pending[id]).toBeDefined();
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.pending).toEqual({}));
    expect(inB.getState().checkpoint.confirmed).toEqual(h.server);
    expect(inB.getState().checkpoint.draft?.title).toBe('Saved locally in A');
  } finally { a.dispose(); b.dispose(); }
});

it('does not publish a return read into an account that replaced its owner', async () => {
  const { h, a, b, inA, inB } = await setup();
  let release: (() => void) | undefined;
  const originalList = h.commits.list.bind(h.commits);
  let spy: jest.SpyInstance | undefined;
  try {
    b.setVisible(false); await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    await settleEngine(); await settleEngine();
    const held = new Promise<void>(resolve => { release = resolve; });
    let reading = false;
    spy = jest.spyOn(h.commits, 'list').mockImplementationOnce(async owner => {
      const records = await originalList(owner); reading = true; await held; return records;
    });
    b.setVisible(true); await settleEngine(); expect(reading).toBe(true);
    b.setOwner('other'); release!(); await settleEngine(); await settleEngine();
    expect(() => inB.getState()).toThrow();
    expect(b.getPending()).toEqual([]);
    expect(inA.getState().checkpoint.draft?.title).toBe('Saved locally in A');
  } finally { release?.(); spy?.mockRestore(); a.dispose(); b.dispose(); }
});

it('refreshes a visible offline collection through the same return path', async () => {
  const h = documentEngineHarness({ resource, value: original, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  const a = h.createBrowser().engine, b = h.createBrowser({ withCollections: true }).engine;
  a.setOnline(false); a.setOwner('owner'); b.setOnline(false); b.setOwner('owner');
  let title: unknown, pending: unknown;
  const stop = b.watchCollection('groups', state => { title = state.documents?.[0]?.value?.title; pending = state.documents?.[0]?.pending; });
  try {
    const inA = await a.openEditor(resource, editorIdentity('tab-A', resource, 'group', 'opening-A'));
    await waitFor(() => expect(title).toBe('Opening group'));
    b.setVisible(false); await inA.commit(current => ({ ...current!, title: 'Saved locally in A' }));
    b.setVisible(true); await waitFor(() => expect(title).toBe('Saved locally in A'));
    expect(pending).toBe(true); expect(h.transport.send).not.toHaveBeenCalled();
    b.setVisible(false); a.setOnline(true); await a.retry(); await settleEngine(); await settleEngine();
    expect(await h.commits.list('owner')).toEqual([]);
    const calls = jest.mocked(h.transport.read).mock.calls.length;
    b.setVisible(true); await waitFor(() => expect(pending).toBe(false));
    expect(title).toBe('Saved locally in A');
    expect(jest.mocked(h.transport.read).mock.calls).toHaveLength(calls);
  } finally { stop(); a.dispose(); b.dispose(); }
});


it('follows saved local work while an automatically opened form is still untouched', async () => {
  const { h, a, b, inA, inB } = await setup();
  try {
    const form = inB.form('group-meeting', [['meetingDates']]);
    await form.begin();
    expect(form.getState()?.record.active).toBe(true);
    expect(form.getState()?.dirty).toBe(false);
    b.setVisible(false);
    await inA.commit(current => ({ ...current!, title: 'Saved while the date form is open' }));
    b.setVisible(true);
    await waitFor(() => expect(inB.getState().checkpoint.draft?.title).toBe('Saved while the date form is open'));
    expect(form.getState()?.record.active).toBe(true);
    expect(form.getState()?.dirty).toBe(false);
    expect(h.server.value?.title).toBe('Opening group');
  } finally { a.dispose(); b.dispose(); }
});
