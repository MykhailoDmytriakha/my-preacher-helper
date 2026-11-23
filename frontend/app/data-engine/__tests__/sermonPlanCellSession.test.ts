import { clearDraftIfMatches, isDraftStorageRefused, listDraftKeys, readDraft, retireDraftCapture } from '@/utils/durableDraft';

import { CommitQueue, createMemoryCommitStore } from '../commits';
import { EditorController, type EditorRecord } from '../controller';
import { PlanCellEmergency } from '../planCellEmergency';
import { localPlanCellEmergencyStorage } from '../planCellEmergency.client';
import { validateRecoveryRecord } from '../recovery.client';
import { readSermonConflict } from '../rowConflictDetails';
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

it.each(['mine', 'stored'] as const)('keeps unverified plan text out of saves until the person picks %s', choice => {
  const session = new DataSession(frame(4, { first: 'Previously saved', sibling: 'Sibling opening' }));
  session.editPlanCell({ ...shown('Displayed words', 4), unverified: true }, 'My new words');
  expect(session.checkpoint().conflicts).toEqual([{
    path: ['planText', 'first'], base: field('Displayed words'), mine: field('My new words'), theirs: field('Previously saved'),
  }]);
  expect(capturePlanCellOpenings(session.checkpoint())).toBeUndefined();
  session.editPlanCell({ ...shown('Sibling opening', 4), nodeId: 'sibling' }, 'Sibling local edit');
  session.observe(frame(5, { first: 'Newer saved', sibling: 'Sibling opening' }), { source: 'server' });
  expect(session.checkpoint().conflicts[0].theirs).toEqual(field('Newer saved'));
  expect(capturePlanCellOpenings(session.checkpoint())).toEqual({ [sermonTextKey('planText', 'sibling')]: 4 });

  if (choice === 'mine') session.keepLocal();
  else session.acceptRemote();
  const checkpoint = session.checkpoint();
  expect(checkpoint.conflicts).toEqual([]);
  expect(checkpoint.draft?.planText).toEqual({
    first: choice === 'mine' ? 'My new words' : 'Newer saved', sibling: 'Sibling local edit',
  });
  expect(capturePlanCellOpenings(checkpoint)).toEqual({
    [sermonTextKey('planText', 'sibling')]: 4, ...(choice === 'mine' && { [sermonTextKey('planText', 'first')]: 5 }),
  });
});

it('does not compare an unverified edit that exactly matches the stored words', () => {
  const session = new DataSession(frame(4, { first: 'Already saved' }));
  session.editPlanCell({ ...shown('Displayed words', 4), unverified: true }, 'Already saved');
  expect(session.checkpoint()).toMatchObject({ dirty: false, conflicts: [], remoteCandidate: null });
  expect(session.checkpoint().planCellDrafts).toBeUndefined();
});

it.each(['my words', ''] as const)('shows the exact unverified comparison with a blank side (%s)', text => {
  const saved = text ? undefined : 'Saved words';
  const session = new DataSession(frame(4, saved ? { first: saved } : {}));
  session.editPlanCell({ ...shown('Earlier visible words', 4), unverified: true }, text);
  expect(readSermonConflict(session.checkpoint())).toMatchObject({
    kind: 'plan-cell', unverified: true, mine: text || undefined, stored: saved,
  });
});

it.each(['authored continuation', 'new proposal'] as const)('follows a held copy only along its admitted editing chain (%s)', action => {
  localStorage.clear();
  const session = new DataSession(frame(1, { first: 'Original words' }));
  const emergency = new PlanCellEmergency('owner', 'plan-alternative', localPlanCellEmergencyStorage);
  const selected = 'Words selected by the preacher';
  const alternate = emergency.hold('sermon', 'first', selected);
  try {
    emergency.preserve();
    const [key] = listDraftKeys();
    expect(readDraft(key)?.value).toBe(selected);
    alternate.followAdmittedCell();
    expect(readDraft(key)?.value).toBe(selected);

    stamp(session, shown(), selected);
    emergency.admit(shown(), selected);
    alternate.followAdmittedCell();
    expect(readDraft(key)?.value).toBe(selected);

    const next = action === 'authored continuation' ? selected + ' and continued' : 'Independent proposal';
    stamp(session, shown(selected), next);
    emergency.admit(shown(selected), next, action === 'authored continuation' ? selected : undefined);
    emergency.stored(session.checkpoint());
    expect(readDraft(key)?.value).toBe(action === 'authored continuation' ? undefined : selected);
  } finally {
    alternate.release();
    localStorage.clear();
  }
});

it('discards only the selected held plan copy even when another hold has the same words', () => {
  localStorage.clear();
  const emergency = new PlanCellEmergency('owner', 'plan-alternative', localPlanCellEmergencyStorage);
  const first = emergency.hold('sermon', 'first', 'Exact same words');
  const second = emergency.hold('sermon', 'first', 'Exact same words');
  try {
    emergency.preserve();
    expect(listDraftKeys()).toHaveLength(2);
    second.release();
    expect(listDraftKeys().map(key => readDraft(key)?.value)).toEqual(['Exact same words']);
  } finally {
    first.release();
    second.release();
    localStorage.clear();
  }
});

it.each(['source disappears', 'person continues typing'] as const)('backs up a staged cell once its result no longer covers the exact words (%s)', action => {
  localStorage.clear();
  const emergency = new PlanCellEmergency('owner', 'generated-plan', localPlanCellEmergencyStorage);
  const generated = 'Already stored generation';
  let hasSource = true;
  try {
    emergency.admit(shown(), generated, undefined, () => hasSource);
    emergency.preserve();
    expect(listDraftKeys()).toEqual([]);

    if (action === 'source disappears') hasSource = false;
    else emergency.admit(shown(generated), generated + ' and a manual addition', generated);
    emergency.preserve();
    expect(listDraftKeys().map(key => readDraft(key)?.value)).toEqual([
      action === 'source disappears' ? generated : generated + ' and a manual addition',
    ]);
  } finally {
    localStorage.clear();
  }
});

it('retries retiring a rejected plan copy when its first local removal refuses', () => {
  localStorage.clear();
  const emergency = new PlanCellEmergency('owner', 'plan-alternative', localPlanCellEmergencyStorage);
  const alternative = emergency.hold('sermon', 'first', 'Rejected words');
  emergency.preserve();
  const removal = jest.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => { throw new Error('Temporarily unavailable'); });
  try {
    alternative.release();
    expect(listDraftKeys()).toHaveLength(1);
    emergency.preserve();
    expect(listDraftKeys()).toEqual([]);
    emergency.preserve();
    expect(listDraftKeys()).toEqual([]);
  } finally {
    removal.mockRestore();
    localStorage.clear();
  }
});

it.each(['first backup', 'newer text after binding'] as const)('clears a refused emergency write only after its exact device receipt (%s)', scenario => {
  localStorage.clear();
  const session = new DataSession(frame(1, { first: 'Original words' }));
  const emergency = new PlanCellEmergency('owner', 'emergency-test', localPlanCellEmergencyStorage);
  const first = 'Text before the transfer';
  const newer = 'Newer words that reach IndexedDB';
  let opening = shown();
  const binding = scenario === 'newer text after binding' ? (() => {
    stamp(session, opening, first);
    emergency.admit(opening, first);
    opening = shown(first);
    return emergency.bind({ first })[0];
  })() : undefined;
  const mute = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('Local storage is temporarily full'); });
  try {
    stamp(session, opening, newer);
    emergency.admit(opening, newer, opening.text);
    if (!binding) emergency.preserve();
    expect(isDraftStorageRefused()).toBe(true);
    if (binding) expect(retireDraftCapture(binding.key, binding.proof, first)).toBe(false);

    emergency.stored(session.checkpoint());
    expect(isDraftStorageRefused()).toBe(false);
    expect(listDraftKeys()).toEqual([]);
  } finally {
    const failedAddress = setItem.mock.calls[0]?.[0];
    setItem.mockRestore();
    mute.mockRestore();
    if (failedAddress) clearDraftIfMatches(failedAddress, newer);
    localStorage.clear();
  }
});

it('retries the token of the same words on the next departure after a refused renewal', () => {
  localStorage.clear();
  const emergency = new PlanCellEmergency('owner', 'emergency-token-test', localPlanCellEmergencyStorage);
  const first = 'Words in the old transfer';
  emergency.admit(shown(), first);
  const [old] = emergency.bind({ first });
  const mute = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage is temporarily full'); });
  try {
    emergency.admit(shown(first), 'An edit later undone', first);
    emergency.admit(shown('An edit later undone'), first, 'An edit later undone');
    expect(isDraftStorageRefused()).toBe(true);
    setItem.mockRestore();

    emergency.preserve();
    expect(readDraft(old.key)?.captureToken).not.toBe(old.proof);
    expect(isDraftStorageRefused()).toBe(false);
    expect(retireDraftCapture(old.key, old.proof, first)).toBe(false);
    expect(readDraft(old.key)?.value).toBe(first);
  } finally {
    setItem.mockRestore();
    mute.mockRestore();
    clearDraftIfMatches(old.key, first);
    localStorage.clear();
  }
});

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

it('does not certify an older plan copy when a pending sibling Save holds back a newer version', async () => {
  const old = frame(1, { first: 'Original words', sibling: 'Other words' });
  const incoming = frame(2, { first: 'Phone words', sibling: 'Other words' });
  const runtime = new DataEngineRuntime({ transport: { read: async () => old, send: jest.fn() }, journal: {
    list: async () => [], put: async () => undefined, remove: async () => undefined,
  } });
  runtime.setOwner('owner');
  const commits = new CommitQueue({ store: createMemoryCommitStore(), runtime, operationId: () => 'plan-op',
    readConfirmed: async () => old });
  commits.setOwner('owner');
  let stored: EditorRecord | undefined;
  localStorage.clear();
  const emergency = new PlanCellEmergency('owner', 'pending-other-cell', localPlanCellEmergencyStorage);
  const editor = await EditorController.open({
    owner: 'owner', editorId: 'plan', snapshot: old, runtime, commits, operationId: () => 'unused',
    isCurrentOwner: owner => owner === 'owner', planCellEmergency: emergency,
    store: { read: async () => stored, put: async record => { stored = record; } },
  });
  try {
    await editor.editPlanCell({ ...shown('Other words'), nodeId: 'sibling' }, 'Edited sibling');
    await editor.save({ ...editor.captureFieldSave(), planCellSaveIds: ['sibling'] });
    await editor.observe(incoming, 'server');
    expect(editor.getState().checkpoint).toMatchObject({ confirmed: old, remoteCandidate: incoming });

    const writing = editor.editPlanCell(shown(), 'Original words');
    emergency.preserve();
    await writing;

    expect(stored?.checkpoint.planCellDrafts?.first).toBeUndefined();
    await expect(editor.assertPlanCellsStored({ first: 'Original words' })).rejects.toMatchObject({ code: 'decision-changed' });
    expect(listDraftKeys().map(key => readDraft(key)?.value)).toContain('Original words');
  } finally {
    editor.dispose();
    localStorage.clear();
  }
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
