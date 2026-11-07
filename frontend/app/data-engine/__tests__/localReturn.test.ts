import { waitFor } from '@testing-library/react';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { editorIdentity, recoveryEditorIdentity } from '@/data-engine/editorIdentity';

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
