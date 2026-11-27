import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';

import { applyCommand } from '../protocol';
import { planCellOpening } from '../sermonPlanCellSession';

import type { DocumentData } from '../types';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

it('retires a known earlier plan edit captured in the same offline editor', async () => {
  const resource = { collection: 'sermons', id: 'sermon-1' };
  const outline = { introduction: [{ id: 'removed', text: 'Point to remove' }], main: [], conclusion: [] };
  const value: DocumentData = { userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-11-06',
    thoughts: [], outline, planText: { removed: 'Previously saved words' } };
  const harness = documentEngineHarness({
    resource, value, metadata: { protocol: 1, generation: 'sermon-generation', revision: 1, deleted: false },
  });
  const { engine, dispose } = harness.createBrowser();
  try {
    engine.setOwner('owner');
    engine.setOnline(false);
    const editor = await engine.openEditor(resource, 'plan');
    await editor.commit(current => ({ ...current, planText: { removed: 'Earlier offline edit' } }));
    const removedOutline = { ...outline, introduction: [] };
    await editor.commit(current => ({ ...current, outline: removedOutline }));
    engine.setOnline(true);
    await engine.retry();
    await settleEngine();
    expect(harness.server.value?.outline).toEqual(removedOutline);
    expect(harness.server.value?.planText).toEqual({ removed: '' });
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
  } finally { dispose(); }
});

it('keeps an unsaved sibling selectable after the first Save adds a version to an old sermon without a creation date', async () => {
  const resource = { collection: 'sermons', id: 'old-sermon' };
  const value: DocumentData = { userId: 'owner', title: 'Old sermon', verse: 'John 1:1', date: '2025-03-06',
    thoughts: [], outline: { introduction: [], main: [{ id: 'first', text: 'First point' }, { id: 'second', text: 'Second point' }], conclusion: [] },
    planText: { first: 'First saved', second: 'Second saved' } };
  const harness = documentEngineHarness({ resource, value, metadata: null });
  const { engine, dispose } = harness.createBrowser();
  try {
    engine.setOwner('owner');
    const editor = await engine.openEditor(resource, 'plan', { autoSaveOnResume: false });
    const original = editor.getState().checkpoint;
    await editor.editPlanCell(planCellOpening(original, 'first', 'First saved')!, 'First typed');
    await editor.editPlanCell(planCellOpening(original, 'second', 'Second saved')!, 'Second typed');
    await editor.savePlanCells(['first']);
    await engine.retry();
    await settleEngine();
    expect(editor.getState().checkpoint.confirmed.metadata?.revision).toBe(1);
    expect(harness.server.value?.planText).toEqual({ first: 'First typed', second: 'Second saved' });
    expect(editor.getState().checkpoint.draft?.planText).toEqual({ first: 'First typed', second: 'Second typed' });

    const shown = editor.getState().checkpoint;
    const seen = editor.getSermonPlanModeOpening!(shown)!;
    await editor.commit(current => ({ ...current, planMode: 'manual' }),
      { kind: 'sermon-plan-mode', mode: { seen, time: null, initialize: true } });
    await engine.retry();
    await settleEngine();
    expect(harness.server.value?.planMode).toBe('manual');
    expect(harness.server.value?.planText).toEqual({ first: 'First typed', second: 'Second saved' });
    expect(editor.getState().checkpoint.draft?.planText).toEqual({ first: 'First typed', second: 'Second typed' });

    await editor.savePlanCells(['second']);
    await engine.retry();
    await settleEngine();
    expect(harness.server.value?.planText).toEqual({ first: 'First typed', second: 'Second typed' });
  } finally { dispose(); }
});

it('keeps unsaved plan cells recoverable and saves only the point selected by the person', async () => {
  const resource = { collection: 'sermons', id: 'sermon-1' };
  const value: DocumentData = { userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-11-06',
    thoughts: [], outline: { introduction: [], main: [{ id: 'first', text: 'First point' }, { id: 'second', text: 'Second point' }], conclusion: [] },
    planText: { first: 'First saved', second: 'Second saved' } };
  const opening = { sermonId: resource.id, generation: 'sermon-generation', observedRevision: 1 };
  const harness = documentEngineHarness({
    resource, value, metadata: { protocol: 1, generation: opening.generation, revision: 1, deleted: false },
  });
  const { engine, dispose } = harness.createBrowser();
  try {
    engine.setOwner('owner');
    engine.setOnline(false);
    const editor = await engine.openEditor(resource, 'plan', { autoSaveOnResume: false });
    await editor.editPlanCell({ ...opening, nodeId: 'first', text: 'First saved' }, 'First typed');
    await editor.editPlanCell({ ...opening, nodeId: 'second', text: 'Second saved' }, 'Second typed');
    expect(await harness.commits.list('owner')).toEqual([]);

    await editor.savePlanCells(['first']);
    expect((await harness.commits.list('owner')).map(request => request.value?.planText)).toEqual([
      { first: 'First typed', second: 'Second saved' },
    ]);
    expect((await harness.checkpoints.read('owner', 'plan'))?.checkpoint.draft?.planText).toEqual({
      first: 'First typed', second: 'Second typed',
    });
    expect(editor.getState().checkpoint.draft?.planText).toEqual({ first: 'First typed', second: 'Second typed' });

    await editor.savePlanCells(['second']);
    const firstAndSecond = await harness.commits.list('owner');
    expect(firstAndSecond).toHaveLength(2);
    const [first, second] = firstAndSecond.sort((left, right) => left.editGeneration - right.editGeneration);
    expect(second.predecessor).toBe(first.id);
    expect(second.value?.planText).toEqual({ first: 'First typed', second: 'Second typed' });
    engine.setOnline(true);
    await engine.retry();
    await settleEngine();
    expect(harness.server.value?.planText).toEqual({ first: 'First typed', second: 'Second typed' });
    expect(editor.getState().checkpoint.conflicts).toEqual([]);
  } finally { dispose(); }
});

it('saves an independent point while the two versions of another point remain available', async () => {
  const resource = { collection: 'sermons', id: 'sermon-1' };
  const value: DocumentData = { userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-11-06',
    thoughts: [], outline: { introduction: [], main: [{ id: 'first', text: 'First' }, { id: 'second', text: 'Second' }], conclusion: [] },
    planText: { first: 'First saved', second: 'Second saved' } };
  const harness = documentEngineHarness({
    resource, value, metadata: { protocol: 1, generation: 'sermon-generation', revision: 1, deleted: false },
  });
  const { engine, dispose } = harness.createBrowser();
  try {
    engine.setOwner('owner');
    const editor = await engine.openEditor(resource, 'plan', { autoSaveOnResume: false });
    await editor.editPlanCell(planCellOpening(editor.getState().checkpoint, 'first', 'First saved')!, 'First typed');
    await harness.remote({ planText: { first: 'From phone', second: 'Second saved' } });
    await editor.editPlanCell(planCellOpening(editor.getState().checkpoint, 'second', 'Second saved')!, 'Second typed');

    await editor.savePlanCells(['second']);
    await engine.retry();
    await settleEngine();
    expect(harness.server.value?.planText).toEqual({ first: 'From phone', second: 'Second typed' });
    expect(editor.getState().checkpoint.conflicts).toEqual([{
      path: ['planText', 'first'],
      base: { exists: true, value: 'First saved' },
      mine: { exists: true, value: 'First typed' },
      theirs: { exists: true, value: 'From phone' },
    }]);
  } finally { dispose(); }
});

it('replays a selected plan version after reopening behind an earlier in-flight save of the same cell', async () => {
  const resource = { collection: 'sermons', id: 'sermon-plan-proposal' };
  const value: DocumentData = { userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-11-21',
    thoughts: [], outline: { introduction: [], main: [{ id: 'point', text: 'Point' }], conclusion: [] },
    planText: { point: 'Originally saved' } };
  let noteEarlierEntered!: () => void;
  const earlierEntered = new Promise<void>(resolve => { noteEarlierEntered = resolve; });
  let releaseEarlier!: () => void;
  const earlierGate = new Promise<void>(resolve => { releaseEarlier = resolve; });
  let held = false;
  const harness = documentEngineHarness({
    resource, value, metadata: { protocol: 1, generation: 'sermon-generation', revision: 1, deleted: false },
  }, {
    apply: async (command, server) => {
      if (!held) {
        held = true;
        noteEarlierEntered();
        await earlierGate;
      }
      return applyCommand(command, server);
    },
  });
  const initial = harness.createBrowser();
  let reopened: ReturnType<typeof harness.createBrowser> | undefined;
  try {
    initial.engine.setOwner('owner');
    initial.engine.setOnline(false);
    const editor = await initial.engine.openEditor(resource, 'plan-before-reload', { autoSaveOnResume: false });
    const seen = planCellOpening(editor.getState().checkpoint, 'point', 'Originally saved')!;
    await editor.editPlanCell(seen, 'Earlier typed words');
    await editor.savePlanCells(['point']);
    initial.engine.setOnline(true);
    await earlierEntered;

    const proposalOpening = planCellOpening(editor.getState().checkpoint, 'point', 'Earlier typed words')!;
    const staging = editor.editPlanCell(proposalOpening, 'Selected proposal');
    const saving = editor.savePlanCells(['point']);
    await Promise.all([staging, saving]);

    const captured = (await harness.commits.list('owner')).sort((a, b) => a.editGeneration - b.editGeneration);
    expect(captured.map(item => item.value?.planText)).toEqual([
      { point: 'Earlier typed words' }, { point: 'Selected proposal' },
    ]);
    expect(captured[1].predecessor).toBe(captured[0].id);
    expect(harness.server.value?.planText).toEqual({ point: 'Originally saved' });

    initial.dispose();
    releaseEarlier();
    await settleEngine();

    reopened = harness.createBrowser();
    reopened.engine.setOwner('owner');
    reopened.engine.setOnline(true);
    await reopened.engine.retry(resource);
    await settleEngine();
    expect(harness.server.value?.planText).toEqual({ point: 'Selected proposal' });
    expect(harness.server.metadata?.revision).toBe(3);
  } finally {
    releaseEarlier();
    reopened?.dispose();
    initial.dispose();
  }
});
