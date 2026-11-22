import { CommitQueue, createMemoryCommitStore } from '../commits';
import { validateRecoveryRecord } from '../recovery.client';
import { DataEngineRuntime } from '../runtime';
import { sermonTextKey } from '../sermonTextOpenings';
import { capturePlanCellOpenings, planCellOpening } from '../sermonPlanCellSession';
import { DataSession } from '../session';

import type { ResourceSnapshot } from '../types';

const frame = (revision: number, planText: Record<string, string>, title = 'Sermon'): ResourceSnapshot => ({
  resource: { collection: 'sermons', id: 'sermon' },
  value: { userId: 'owner', title, verse: 'John 1:1', date: '2026-11-06', thoughts: [],
    outline: { introduction: [], main: [{ id: 'first', text: 'First point' }, { id: 'sibling', text: 'Sibling point' }], conclusion: [] },
    planText },
  metadata: { protocol: 1, generation: 'sermon-generation', revision, deleted: false },
});
const shown = (text = 'Original words', observedRevision = 1) =>
  ({ sermonId: 'sermon', nodeId: 'first', generation: 'sermon-generation', observedRevision, text });
const field = (value: string) => ({ exists: true, value });
const stamp = (session: DataSession, opening: ReturnType<typeof shown>, text: string) =>
  session.editPlanCell(opening, text);

it('keeps the displayed words as the cell opening when the next revision was accepted before input', () => {
  const accepted = frame(2, { first: 'Phone words', sibling: 'Latest sibling' });
  const session = new DataSession(frame(1, { first: 'Original words', sibling: 'Older sibling' }));
  session.observe(accepted, { source: 'server' });
  stamp(session, shown(), 'Original words and one more word');

  expect(session.checkpoint()).toMatchObject({
    confirmed: accepted, remoteCandidate: accepted,
    draft: { planText: { first: 'Original words and one more word', sibling: 'Latest sibling' } },
    conflicts: [{ path: ['planText', 'first'], base: field('Original words'),
      mine: field('Original words and one more word'), theirs: field('Phone words') }],
  });
  expect(session.prepare('unanswered', 'owner')).toBeNull();
});

it('takes a sibling arrival without replacing the cell opening and captures that opening after recovery', async () => {
  const old = frame(1, { first: 'Original words', sibling: 'Older sibling' });
  const accepted = frame(2, { first: 'Original words', sibling: 'Latest sibling' }, 'Updated title');
  const session = new DataSession(old);
  stamp(session, shown(), 'New words for the first cell');
  session.observe(accepted, { source: 'server' });
  const serialized = JSON.parse(JSON.stringify({ owner: 'owner', editorId: 'plan', prepared: null, checkpoint: session.checkpoint() }));
  const restored = DataSession.restore(validateRecoveryRecord(serialized, 'owner', 'plan').checkpoint);

  expect(restored.checkpoint()).toMatchObject({ confirmed: accepted, conflicts: [], remoteCandidate: null,
    draft: { title: 'Updated title', planText: { first: 'New words for the first cell', sibling: 'Latest sibling' } },
  });
  const runtime = new DataEngineRuntime({ transport: { read: async () => accepted, send: jest.fn() }, journal: {
    list: async () => [], put: async () => undefined, remove: async () => undefined,
  } });
  runtime.setOwner('owner');
  const queue = new CommitQueue({ store: createMemoryCommitStore(), runtime, operationId: () => 'plan-op',
    readConfirmed: async () => accepted });
  queue.setOwner('owner');
  const request = await queue.save('plan', restored.checkpoint(), { planCellSaveIds: ['first'] });

  expect(request?.sermonTextOpenings).toEqual({ [sermonTextKey('planText', 'first')]: 1 });
  expect(request?.value?.planText).toEqual({ first: 'New words for the first cell', sibling: 'Latest sibling' });
});

it('updates only the draft side of a cell comparison as the person keeps typing', () => {
  const session = new DataSession(frame(1, { first: 'Original words' }));
  const accepted = frame(2, { first: 'Phone words' });
  session.observe(accepted, { source: 'server' });
  stamp(session, shown(), 'First typed words');
  stamp(session, shown('First typed words', 2), 'Second typed words');

  expect(session.checkpoint().conflicts).toEqual([{
    path: ['planText', 'first'], base: field('Original words'), mine: field('Second typed words'), theirs: field('Phone words'),
  }]);
  stamp(session, shown('Second typed words', 2), 'Phone words');
  expect(session.checkpoint()).toMatchObject({ dirty: false, conflicts: [], remoteCandidate: null });
});

it('uses the reviewed revision for the chosen text and keeps the original revision of another edited cell', () => {
  const session = new DataSession(frame(1, { first: 'Original words', sibling: 'Other words' }));
  stamp(session, { ...shown('Other words'), nodeId: 'sibling' }, 'Edited sibling');
  session.observe(frame(2, { first: 'Phone words', sibling: 'Other words' }), { source: 'server' });
  stamp(session, shown(), 'First typed words');

  expect(session.checkpoint().conflicts).toHaveLength(1);
  session.keepLocal();
  expect(session.checkpoint().conflicts).toEqual([]);
  expect(capturePlanCellOpenings(session.checkpoint())).toEqual({
    [sermonTextKey('planText', 'first')]: 2,
    [sermonTextKey('planText', 'sibling')]: 1,
  });
  session.observe(frame(3, { first: 'More phone words', sibling: 'Other words' }), { source: 'server' });
  expect(session.checkpoint().conflicts).toEqual([{
    path: ['planText', 'first'], base: field('Phone words'), mine: field('First typed words'), theirs: field('More phone words'),
  }]);
});

it('keeps an unrelated unsaved point and its opening when taking the stored version of a compared point', () => {
  const session = new DataSession(frame(1, { first: 'Original words', sibling: 'Other words' }));
  stamp(session, { ...shown('Other words'), nodeId: 'sibling' }, 'Edited sibling');
  const accepted = frame(2, { first: 'Phone words', sibling: 'Other words' });
  session.observe(accepted, { source: 'server' });
  stamp(session, shown(), 'First typed words');

  session.acceptRemote(session.checkpoint().draft);
  expect(session.checkpoint()).toMatchObject({ confirmed: accepted, conflicts: [], remoteCandidate: null, dirty: true,
    draft: { planText: { first: 'Phone words', sibling: 'Edited sibling' } },
  });
  expect(capturePlanCellOpenings(session.checkpoint())).toEqual({ [sermonTextKey('planText', 'sibling')]: 1 });
});

it('stages changes to an old plan cell before the sermon has a version or a planText map', () => {
  const snapshot = frame(1, {});
  const legacy: ResourceSnapshot = { ...snapshot, metadata: null, value: {
    ...snapshot.value!,
    createdAt: '2025-01-01T00:00:00.000Z',
    plan: { main: { outlinePoints: { first: 'Legacy words', sibling: 'Other legacy words' } } },
  } };
  delete legacy.value!.planText;
  const session = new DataSession(legacy);
  const opening = planCellOpening(session.checkpoint(), 'first', 'Legacy words');
  expect(opening).toMatchObject({ generation: null, observedRevision: null });
  session.editPlanCell(opening!, 'My addition to legacy words');

  expect(session.checkpoint().draft).toMatchObject({ planText: { first: 'My addition to legacy words' }, plan: legacy.value!.plan });
  session.observe({ ...legacy, metadata: snapshot.metadata, value: { ...legacy.value!, planText: { first: 'Phone updated the legacy words' } } },
    { source: 'server' });
  expect(session.checkpoint().conflicts).toEqual([{
    path: ['planText', 'first'], base: field('Legacy words'), mine: field('My addition to legacy words'), theirs: field('Phone updated the legacy words'),
  }]);
});
