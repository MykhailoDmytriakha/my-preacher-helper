import { droppedProof, takeDroppedProof } from '@test-utils/droppedEvidence';

import { createIndexedDbCheckpoints } from '../checkpoint.client';
import { createIndexedDbCommitStore } from '../commits.client';
import { forkCheckpoint, recoveryCheckpointId, selectRecoverableCheckpoints, validateRecoveryRecord } from '../recovery.client';
import { DataSession } from '../session';
import { json } from '../transport.client';
import { installStorageHarness } from './storageHarness';

import type { CommitRequest } from '../commits';
import type { EditorRecord } from '../controller';
import type { SessionCheckpoint } from '../session';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

// BUG-20261112-checkpoint-validation-strips-action-time: valid ordering proof survives device storage; a proof
// field that does not validate is dropped whole, as every proof field was before, and nothing else changes. The three
// placement retries are instructions to resend a move, not proof, and stay unpersisted as before.
const time = { earliestMs: 1_800_000_000_010, latestMs: 1_800_000_000_020 };
const observation = { before: 'Original', after: 'Later', observedRevision: 1, time, predecessorOperationId: 'earlier-save' };
const optionalObservation = { ...observation, before: { exists: false }, after: { exists: true, value: 'Later' } };
const noteContentAction = { ...optionalObservation, before: { exists: true, value: 'Original' } };
const noteTypeAction = { ...noteContentAction, before: { exists: true, value: 'note' }, after: { exists: true, value: 'question' } };
const row = { ...observation, rowId: 'row', rowCreatedAt: '2026-11-12' };
const fieldDraft = { generation: 'g', action: observation };
const optionalDraft = { generation: 'g', action: optionalObservation };
const rowDrafts = { row: { generation: 'g', action: row } };
const church = { id: 'first-church', name: 'First church' };
const cityObservation = { ...row, scope: church };
const churchObservation = { ...row, before: church, after: { id: 'next-church', name: 'Next church', city: 'Next city' } };
const gap = { previous: { id: 'first', generation: 'g' }, next: null };
const placement = { observedRevision: 1, time, predecessorOperationId: 'earlier-save', opening: gap, destination: gap };
const pointGap = { section: 'main', previous: null, next: 'other' };
const outlineRetry = { generation: 'g', before: { introduction: [], main: [{ id: 'point' }, { id: 'other' }], conclusion: [] },
  after: { introduction: [], main: [{ id: 'other' }, { id: 'point' }], conclusion: [] },
  placement: { ...placement, pointId: 'point', opening: pointGap, destination: pointGap } };
const stepGap = { previous: null, next: 'other' };
const stepPlacement = { stepId: 'step', observedRevision: 1, time, opening: stepGap, destination: stepGap };
const groupPlacement = { generation: 'g', before: [{ id: 'step', templateId: 'block' }],
  after: [{ id: 'step', templateId: 'block' }], placement: stepPlacement };
const councilPlacement = { generation: 'g', before: [{ id: 'step' }], after: [{ id: 'step' }], placement: stepPlacement };
const links = { opening: { sermonId: 'sermon', generation: 'g', revision: 1, selected: { exists: false as const }, pending: [] },
  action: { observedRevision: 1, time, changes: [{ noteId: 'note', linked: false }] } };
const groupTextReview = { requestId: 'request', revision: 1, decisions: [
  { path: ['title'], birth: null, mine: 'Later', stored: 'Original', side: 'local' },
] };
const commentReference = { id: 'passage', book: 'Isaiah', chapter: 40, fromVerse: 31 };
const commentKindAction = { before: { exists: true, value: false }, after: { exists: true, value: true },
  reference: { exists: true, value: [commentReference] }, observedRevision: 1, time };
const commentPlaceAction = { before: { exists: true, value: commentReference },
  after: { exists: true, value: { ...commentReference, fromVerse: 28 } },
  paragraph: { exists: false }, observedRevision: 1, time };
type PlacementRetryKey = 'serviceOrderPlacementRetry' | 'serviceOrderStepPlacementRetry' | 'outlinePointPlacementRetry';
type EvidenceKey = Exclude<keyof SessionCheckpoint, 'confirmed' | 'draft' | 'dirty' | 'editGeneration' | 'remoteCandidate' | 'conflicts' | 'pending' | 'unreadableScalarProof' | 'unreadableRowProofs' | 'unreadableExegeticalProofs'
  | 'unreadableServiceOrderStepPlacement' | 'unreadableOutlinePointPlacement' | 'reviewedSermonOutlineOrder' | PlacementRetryKey>;
const guardedScratch = { sermonId: 'sermon', generation: 'g', observedRevision: 1, pending: [],
  target: { kind: 'scratch', id: 'sketch', createdAt: '2026-11-12' }, text: 'Original' };
const evidence = {
  guardedScratchText: guardedScratch,
  groupTitleDraft: fieldDraft, groupDescriptionDraft: optionalDraft, groupStatusDraft: { generation: 'g', action: { ...observation, time: null } }, councilTitleDraft: fieldDraft,
  councilDateDraft: optionalDraft, councilLifecycleDraft: optionalDraft,
  studyNoteContentDraft: { generation: 'g', action: noteContentAction },
  planCellDrafts: { point: { generation: 'g', observedRevision: 1, opening: 'Original', text: 'Later' } },
  commentKindDraft: { generation: 'g', action: commentKindAction }, commentPlaceDraft: { generation: 'g', action: commentPlaceAction },
  studyNoteTitleDraft: { generation: 'g', action: noteContentAction }, studyNoteTypeDraft: { generation: 'g', action: noteTypeAction },
  councilOutcomeDrafts: rowDrafts, councilTopicTitleDrafts: rowDrafts, councilTopicSummaryDrafts: rowDrafts, councilTopicTextDrafts: rowDrafts, groupBlockTitleDrafts: rowDrafts,
  groupStepTitleDrafts: rowDrafts, groupBlockContentDrafts: rowDrafts, groupStepNotesDrafts: rowDrafts, groupBlockStatusDrafts: { row: { generation: 'g', action: { ...row, before: 'empty', after: 'filled' } } },
  groupStepDurationDrafts: { row: { generation: 'g', action: { ...row, before: 1, after: 2 } } },
  thoughtLockDrafts: rowDrafts, thoughtTextDrafts: rowDrafts, thoughtPlacementDrafts: rowDrafts,
  exegeticalPointDrafts: [{ nodeId: 'point', kind: 'title', observedRevision: 1, time, predecessorOperationId: 'earlier-save',
    generation: 'g', title: 'Later', ancestors: ['parent'] }],
  serviceOrderInputs: { '["step","body"]': { field: 'body', stepId: 'step', before: 'Original', value: 'Later',
    version: { generation: 'g', observedRevision: 1 }, time } },
  serviceOrderPlacementComparison: { mine: gap, saved: null, available: false, step: { id: 'step', title: 'Step' } },
  sermonChurchRecovery: { generation: 'g', observation: {
    before: { exists: false }, after: { exists: true, value: church }, observedRevision: 1, time,
  } },
  preparationCheckRetry: { field: 'readAndPrayedConfirmed', generation: 'g', action: {
    before: { exists: false }, after: { exists: true, value: true }, observedRevision: 1, time,
  } },
  sermonTextRetry: { field: 'authorIntent', generation: 'g', action: { before: { exists: true, value: 'Original' },
    after: { exists: true, value: 'Later' }, observedRevision: 1, time } },
  accountPreferenceRetry: { field: 'language', time: null }, outlineTitleDrafts: rowDrafts, preachDateNotesDrafts: rowDrafts,
  preachDateAudienceDrafts: rowDrafts, preachDateCityDrafts: { row: { generation: 'g', action: cityObservation } },
  preachDateChurchDrafts: { row: { generation: 'g', action: churchObservation } },
  groupMeetingReview: { generation: 'g', rowId: row.rowId, rowCreatedAt: row.rowCreatedAt, fields: { location: row } },
  groupTextReview, privateFieldReview: { revision: 1, decisions: groupTextReview.decisions }, groupFlowStepPlacementRetry: groupPlacement, councilTopicPlacementRetry: councilPlacement, sourceNoteLinkRetry: links,
} satisfies Record<EvidenceKey, unknown>;
const placementRetries = {
  serviceOrderPlacementRetry: { generation: 'g', before: { exists: true, value: 1 }, rank: 2, afterRequests: ['request'], placement },
  serviceOrderStepPlacementRetry: { generation: 'g', shownIds: ['step', 'other'], placement: { ...placement, stepId: 'step',
    opening: { previous: null, next: 'other' }, destination: { previous: null, next: 'other' } } },
  outlinePointPlacementRetry: outlineRetry,
} satisfies Record<PlacementRetryKey, unknown>;
type Pending = SessionCheckpoint['pending'][string];
type PendingEvidenceKey = Exclude<keyof Pending, 'generation' | 'value' | 'operations' | 'borrowedManualScope'>;
const pendingEvidence = {
  groupTitleAction: observation, groupDescriptionAction: optionalObservation, groupStatusAction: observation, councilTitleAction: observation,
  councilDateAction: optionalObservation, councilLifecycleAction: optionalObservation, studyNoteContentAction: noteContentAction,
  studyNoteTitleAction: noteContentAction, studyNoteTypeAction: noteTypeAction,
  councilOutcomeActions: [row], councilTopicTitleActions: [row], councilTopicSummaryActions: [row], councilTopicTextActions: [row], groupBlockTitleActions: [row], groupStepTitleActions: [row],
  groupBlockContentActions: [row], groupStepNotesActions: [row], groupBlockStatusActions: [row], groupStepDurationActions: [row], thoughtLockActions: [row], thoughtTextActions: [row], thoughtPlacementActions: [row],
  outlinePointPlacement: outlineRetry, outlineTitleActions: [row], preachDateNotesActions: [row], groupFlowStepPlacement: groupPlacement,
  preachDateAudienceActions: [row], preachDateCityActions: [cityObservation], preachDateChurchActions: [churchObservation],
  councilTopicPlacement: councilPlacement, commentPlaceAction, commentKindAction, amendedScratchAppend: 'conflict', scratchTextConflict: { id: 'note', createdAt: 'date', words: 'Typed words' },
} satisfies Record<PendingEvidenceKey, unknown>;
// Group title and status are causal: an unclocked autosave carries `time: null` (documentFieldAction.ts:637).
const unclockedGroupActions: Array<[PendingEvidenceKey, unknown]> = [
  ['groupTitleAction', { ...observation, time: null }], ['groupStatusAction', { ...observation, before: 'draft', after: 'active', time: null }],
];

it('keeps a damaged guarded scratch opening out of writable recovery', () => {
  const source = titleRecord();
  source.checkpoint.confirmed.resource = { collection: 'sermons', id: 'sermon' };
  const unverified = { ...source.checkpoint, guardedScratchText: { ...guardedScratch, observedRevision: 'unreadable' } };
  expect(() => validateRecoveryRecord({ ...source, checkpoint: unverified }, 'owner', source.editorId))
    .toThrow('Guarded scratch text opening is unreadable');
});

function titleRecord(editorId = 'editor'): EditorRecord {
  const initial = { resource: { collection: 'groups', id: 'group' }, value: { userId: 'owner', title: 'Original' },
    metadata: { protocol: 1 as const, generation: 'g', revision: 1, deleted: false } };
  const session = new DataSession(initial);
  session.edit({ ...initial.value, title: 'Later' }, undefined, { field: 'title', time });
  return { owner: 'owner', editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
}
const request = (record: EditorRecord): CommitRequest => ({ id: 'request', owner: 'owner', editorId: record.editorId, editGeneration: 1,
  baseline: record.checkpoint.confirmed, value: record.checkpoint.draft, predecessor: null, revision: 0, initialized: false,
  working: record.checkpoint.confirmed, intended: record.checkpoint.draft, command: null, submitted: null, sequence: 0, state: 'queued',
  result: null, unfinalized: [] });

/** Write through the native adapter, read it back, discover it and fork it: what each step holds. */
async function throughDeviceStorage(record: EditorRecord, withRequest = false) {
  installStorageHarness();
  const store = createIndexedDbCheckpoints();
  if (withRequest) await createIndexedDbCommitStore().create(request(record));
  await store.put(record);
  const read = await store.read('owner', record.editorId);
  const [found] = await store.listRecoverable('owner', record.checkpoint.confirmed.resource);
  const fork = await forkCheckpoint(store, 'owner', found.id, 'fork', record.checkpoint.confirmed.resource);
  return { read: read!.checkpoint, found: found.record.checkpoint, fork: fork.checkpoint };
}

it.each(Object.entries(evidence))('keeps valid %s through native write, read, discovery and fork', async (key, value) => {
  const source = titleRecord();
  if (key === 'guardedScratchText') {
    source.checkpoint.confirmed.resource = { collection: 'sermons', id: 'sermon' };
    const note = { id: 'sketch', createdAt: '2026-11-12', text: 'Original' };
    source.checkpoint.confirmed.value = { userId: 'owner', scratch: [note] };
    source.checkpoint.draft = { userId: 'owner', scratch: [{ ...note, text: 'Later' }] };
  }
  if (key === 'sermonChurchRecovery') {
    source.checkpoint.confirmed.resource = { collection: 'sermons', id: 'sermon' };
    source.checkpoint.draft = { ...source.checkpoint.confirmed.value, church };
    source.checkpoint.draft.title = 'Original';
  }
  if (key === 'preparationCheckRetry') {
    source.checkpoint.confirmed.resource = { collection: 'sermons', id: 'sermon' };
    source.checkpoint.draft = { ...source.checkpoint.confirmed.value, preparation: { spiritual: { readAndPrayedConfirmed: true } } };
  }
  if (key === 'sermonTextRetry') {
    source.checkpoint.confirmed.resource = { collection: 'sermons', id: 'sermon' };
    source.checkpoint.confirmed.value = { userId: 'owner', preparation: { authorIntent: 'Original' } };
    source.checkpoint.draft = { ...source.checkpoint.confirmed.value, preparation: { authorIntent: 'Later' } };
  }
  if (key === 'councilTopicPlacementRetry') source.checkpoint.confirmed.resource = { collection: 'councils', id: 'council' };
  if (key === 'serviceOrderInputs') {
    source.checkpoint.confirmed.resource = { collection: 'serviceOrders', id: 'order' };
    source.checkpoint.confirmed.value = { userId: 'owner', title: 'Service', steps: [{ id: 'step', body: 'Original' }] };
    source.checkpoint.draft = { ...source.checkpoint.confirmed.value, steps: [{ id: 'step', body: 'Later' }] };
  }
  if (key.startsWith('studyNote')) {
    source.checkpoint.confirmed.resource = { collection: 'studyNotes', id: 'note' };
    source.checkpoint.confirmed.value = { userId: 'owner', type: 'note', content: 'Original', title: 'Original' };
    source.checkpoint.draft = { userId: 'owner', type: 'question', content: 'Later', title: 'Later' };
  }
  if (key === 'commentKindDraft' || key === 'commentPlaceDraft') {
    source.checkpoint.confirmed.resource = { collection: 'studyNotes', id: 'note' };
    const opening = { userId: 'owner', type: 'comment', content: 'Original', paragraph: false, scriptureRefs: [commentReference] };
    source.checkpoint.confirmed.value = opening;
    source.checkpoint.draft = key === 'commentKindDraft' ? { ...opening, paragraph: true }
      : { ...opening, scriptureRefs: [commentPlaceAction.after.value] };
  }
  if (key === 'sourceNoteLinkRetry') source.checkpoint.confirmed.resource = { collection: 'sermons', id: 'sermon' };
  if (key.startsWith('preachDate')) {
    source.checkpoint.confirmed.resource = { collection: 'sermons', id: 'sermon' };
    const date = { id: row.rowId, createdAt: row.rowCreatedAt, notes: row.before, audience: row.before,
      church: key === 'preachDateChurchDrafts' ? church : { ...church, city: row.before } };
    const next = { ...date, notes: row.after, audience: row.after,
      church: key === 'preachDateChurchDrafts' ? churchObservation.after : { ...church, city: row.after } };
    source.checkpoint.confirmed.value = { ...source.checkpoint.confirmed.value, preachDates: [date] };
    source.checkpoint.draft = { ...source.checkpoint.draft, preachDates: [next] };
  }
  if (key === 'groupTextReview') source.checkpoint.pending.request = { generation: 1, value: source.checkpoint.draft };
  if (key.startsWith('groupBlock') || key.startsWith('groupStep')) {
    const block = { id: row.rowId, createdAt: row.rowCreatedAt, title: row.after, content: row.after, status: 'filled' };
    const step = { id: row.rowId, templateId: row.rowCreatedAt, instanceTitle: row.after, instanceNotes: row.after, durationMin: 2 };
    source.checkpoint.draft = { ...source.checkpoint.draft, templates: [block], flow: [step] };
  }
  const record = { ...source, checkpoint: { ...source.checkpoint, [key]: value } } as EditorRecord;
  const kept = await throughDeviceStorage(record, key === 'groupTextReview');
  for (const checkpoint of Object.values(kept)) expect((checkpoint as unknown as Record<string, unknown>)[key]).toEqual(value);
  expect(kept.read.draft).toEqual(source.checkpoint.draft);
});

it('keeps service input and its observed revision when its clock cannot be trusted', async () => {
  const source = titleRecord();
  const key = '["step","body"]';
  const input = evidence.serviceOrderInputs[key];
  source.checkpoint.confirmed.resource = { collection: 'serviceOrders', id: 'order' };
  source.checkpoint.confirmed.value = { userId: 'owner', title: 'Service', steps: [{ id: 'step', body: 'Original' }] };
  source.checkpoint.draft = { ...source.checkpoint.confirmed.value, steps: [{ id: 'step', body: 'Later' }] };
  source.checkpoint.serviceOrderInputs = { [key]: { ...input, field: 'body', time: { earliestMs: 8, latestMs: 2 } } };
  const kept = await throughDeviceStorage(source);
  for (const checkpoint of Object.values(kept)) {
    expect(checkpoint.serviceOrderInputs?.[key]).toEqual({ ...input, time: null });
    expect(checkpoint.draft).toEqual(source.checkpoint.draft);
  }
  takeDroppedProof('serviceOrderInputs');
});

it('reads and rewrites an earlier preparation text proof using the same on-device key', async () => {
  const harness = installStorageHarness();
  const store = createIndexedDbCheckpoints();
  const original = titleRecord();
  const { checkpoint } = original;
  checkpoint.confirmed.resource = { collection: 'sermons', id: 'sermon' };
  checkpoint.confirmed.value = { userId: 'owner', preparation: { authorIntent: 'Original' } };
  checkpoint.draft = { ...checkpoint.confirmed.value, preparation: { authorIntent: 'Later' } };
  const key = JSON.stringify(['checkpoint', original.owner, original.editorId]);
  const proof = evidence.sermonTextRetry;
  harness.rows.set(key, { ...original, checkpoint: { ...checkpoint, preparationTextRetry: proof } });

  const opened = (await store.read(original.owner, original.editorId))!;
  expect(opened.checkpoint.sermonTextRetry).toEqual(proof);
  await store.put(opened);
  expect(harness.rows.get(key)).toMatchObject({ checkpoint: { preparationTextRetry: proof } });
  expect(harness.rows.get(key)).not.toHaveProperty('checkpoint.sermonTextRetry');
  expect((await store.read(original.owner, original.editorId))?.checkpoint.sermonTextRetry).toEqual(proof);
});

it.each(Object.entries(placementRetries))('does not keep %s through native write, read, discovery or fork, as before, and says nothing', async (key, value) => {
  const source = titleRecord();
  const record = { ...source, checkpoint: { ...source.checkpoint, [key]: value } } as EditorRecord;
  const kept = await throughDeviceStorage(record);
  for (const checkpoint of Object.values(kept)) {
    expect(checkpoint).not.toHaveProperty(key);
    expect(checkpoint.groupTitleDraft).toEqual(source.checkpoint.groupTitleDraft);
    expect(checkpoint.draft).toEqual(source.checkpoint.draft);
  }
  expect(droppedProof()).toEqual([]);
});

it.each([...Object.entries(pendingEvidence), ...unclockedGroupActions.map(([key, value]) => [key + ' (unclocked)', value] as const)])(
  'keeps valid pending %s through native write, read, discovery and fork', async (label, value) => {
    const key = label.replace(' (unclocked)', '');
    const source = titleRecord();
    if (key === 'outlinePointPlacement' || key === 'preachDateNotesActions') source.checkpoint.confirmed.resource = { collection: 'sermons', id: 'sermon' };
    if (key === 'councilTopicPlacement') source.checkpoint.confirmed.resource = { collection: 'councils', id: 'council' };
    if (key.startsWith('comment') || key.startsWith('studyNote')) source.checkpoint.confirmed.resource = { collection: 'studyNotes', id: 'note' };
    const record = { ...source, checkpoint: { ...source.checkpoint,
      pending: { request: { generation: 1, value: source.checkpoint.draft, [key]: value } } } } as EditorRecord;
    const kept = await throughDeviceStorage(record, true);
    for (const checkpoint of Object.values(kept)) {
      expect((checkpoint.pending.request as unknown as Record<string, unknown>)[key]).toEqual(value);
      expect(checkpoint.pending.request.value).toEqual(source.checkpoint.draft);
    }
  });

it('keeps valid proof in the checkpoint a Save captures with its request in one transaction', async () => {
  installStorageHarness();
  const source = titleRecord();
  const saved = await createIndexedDbCommitStore().createWithCheckpoint!(request(source), captured => ({ ...source,
    checkpoint: { ...source.checkpoint, pending: { [captured.id]: { generation: 1, value: captured.value, groupTitleAction: observation } } } }));
  const stored = await createIndexedDbCheckpoints().read('owner', source.editorId);
  expect(stored?.checkpoint.groupTitleDraft).toEqual(source.checkpoint.groupTitleDraft);
  expect(stored?.checkpoint.pending[saved.id].groupTitleAction).toEqual(observation);
});

it('drops an invalid proof field whole, as before, and keeps the words, the other proofs and the core', async () => {
  const source = titleRecord();
  const record = { ...source, checkpoint: { ...source.checkpoint,
    // One readable and one unreadable member: the field passes whole or goes whole.
    thoughtLockDrafts: { readable: { generation: 'g', action: { ...row, rowId: 'readable' } }, later: { generation: 'g', action: { ...row, rowId: 'later', rowCreatedAt: 7 } } },
    accountPreferenceRetry: { ...evidence.accountPreferenceRetry, field: 'not-a-preference' },
  } } as unknown as EditorRecord;
  const kept = await throughDeviceStorage(record);
  takeDroppedProof('thoughtLockDrafts', 'accountPreferenceRetry');
  for (const checkpoint of Object.values(kept)) {
    expect(checkpoint).not.toHaveProperty('thoughtLockDrafts');
    expect(checkpoint).not.toHaveProperty('accountPreferenceRetry');
    expect(checkpoint.groupTitleDraft).toEqual(source.checkpoint.groupTitleDraft);
    expect(checkpoint.draft).toEqual(source.checkpoint.draft);
    expect(checkpoint.conflicts).toEqual([]);
    expect(checkpoint.remoteCandidate).toBeNull();
  }
  expect(droppedProof()).toEqual([]);
});

it('drops an invalid pending proof whole and keeps the pending words', () => {
  const source = titleRecord();
  const record = { ...source, checkpoint: { ...source.checkpoint,
    pending: { request: { generation: 1, value: source.checkpoint.draft, groupStepTitleActions: [row, { ...row, before: ['a'], after: ['b'] }], groupTitleAction: observation } } } } as unknown as EditorRecord;
  const saved = validateRecoveryRecord(record, 'owner', 'editor');
  takeDroppedProof('pending.groupStepTitleActions');
  expect(saved.checkpoint.pending.request).not.toHaveProperty('groupStepTitleActions');
  expect(saved.checkpoint.pending.request.groupTitleAction).toEqual(observation);
  expect(saved.checkpoint.pending.request.value).toEqual(source.checkpoint.draft);
});

// N1 (review 29): a proof nested near the stack limit could pass the guarded first parse and overflow the record's
// own second parse, aborting discovery of this draft and the next. The ceiling is found where a recursive parse
// overflows here; every depth from just past the bound to well beyond that ceiling must drop the proof whole.
const nested = (levels: number): unknown => Array.from({ length: levels }).reduce<unknown>(child => ({ child }), 'leaf');
const withDeepDate = (editorId: string, levels: number) => {
  const source = titleRecord(editorId);
  // The field root, `action` and `before` are three levels; the value's own levels come on top.
  return { ...source, checkpoint: { ...source.checkpoint,
    councilDateDraft: { generation: 'g', action: { ...optionalObservation, before: { exists: true, value: nested(levels - 3) } } } } };
};
const discover = (record: unknown) => selectRecoverableCheckpoints([[recoveryCheckpointId('owner', 'deep'), record],
  [recoveryCheckpointId('owner', 'next'), titleRecord('next')]], 'owner');
function parserCeiling(): number {
  const overflows = (levels: number) => { try { json.safeParse(nested(levels)); return false; } catch { return true; } };
  let low = 1, high = 2;
  while (!overflows(high)) { low = high; high *= 2; }
  while (high - low > 1) { const middle = Math.floor((low + high) / 2); if (overflows(middle)) high = middle; else low = middle; }
  return high;
}

it('drops a proof nested past the bound whole at every depth to beyond the parser\'s stack limit, and discovery finds both drafts', () => {
  const outcome = (levels: number): string => {
    let found: ReturnType<typeof discover>;
    try { found = discover(withDeepDate('deep', levels)); } catch (error) { return (error as Error).name; }
    if (found.map(item => item.record.editorId).join() !== 'deep,next') return found.map(item => item.record.editorId).join();
    if ('councilDateDraft' in found[0].record.checkpoint) return 'kept';
    return found[0].record.checkpoint.draft?.title === 'Later' ? 'dropped' : 'words changed';
  };
  for (let i = 0; i < 12; i++) outcome(900);
  const ceiling = parserCeiling();
  const escaped: number[] = [], notDropped: string[] = [];
  for (const levels of [...Array.from({ length: Math.ceil(ceiling * 1.25) - 32 }, (_, index) => 33 + index), ceiling * 4]) {
    const result = outcome(levels);
    if (result === 'RangeError') escaped.push(levels);
    else if (result !== 'dropped') notDropped.push(`${levels}: ${result}`);
  }
  takeDroppedProof(...droppedProof());
  expect(ceiling).toBeGreaterThan(1000);
  expect(escaped).toEqual([]);
  expect(notDropped).toEqual([]);
});

it('keeps a valid proof at the deepest shape a producer writes and at the bound, and drops it one level deeper', () => {
  // The deepest proof producers write is four levels: a row map, its row, the action, a flat before/after object.
  const placement = { row: { generation: 'g', action: { ...row, before: { outlinePointId: null, subPointId: null }, after: { outlinePointId: 'p1', subPointId: null } } } };
  const source = titleRecord('deep');
  const [deepest] = discover({ ...source, checkpoint: { ...source.checkpoint, thoughtPlacementDrafts: placement } });
  expect(deepest.record.checkpoint.thoughtPlacementDrafts).toEqual(placement);
  const [atBound] = discover(withDeepDate('deep', 32));
  expect(atBound.record.checkpoint.councilDateDraft).toEqual(withDeepDate('deep', 32).checkpoint.councilDateDraft);
  const past = discover(withDeepDate('deep', 33));
  takeDroppedProof('councilDateDraft');
  expect(past.map(item => item.record.editorId)).toEqual(['deep', 'next']);
  expect(past[0].record.checkpoint).not.toHaveProperty('councilDateDraft');
});

it('keeps old core-only records, rejects a broken core as before, and never admits unknown checkpoint fields', () => {
  const source = titleRecord(); delete source.checkpoint.groupTitleDraft;
  expect(validateRecoveryRecord(source, 'owner', 'editor')).toEqual(source);
  expect(() => validateRecoveryRecord({ ...source, checkpoint: { ...source.checkpoint, dirty: 'maybe' } }, 'owner', 'editor')).toThrow();
  const input = { ...source, checkpoint: { ...source.checkpoint, unexpectedProof: 'untrusted',
    groupTitleDraft: { ...fieldDraft, action: { ...observation, time: null, unexpectedProof: 'untrusted' } } } };
  const saved = validateRecoveryRecord(input, 'owner', 'editor');
  expect(saved.checkpoint.groupTitleDraft?.action.time).toBeNull();
  expect(saved.checkpoint).not.toHaveProperty('unexpectedProof');
  expect(saved.checkpoint.groupTitleDraft?.action).not.toHaveProperty('unexpectedProof');
});

describe('the dropped-proof tripwire', () => {
  const REPORTER = Symbol.for('preacher.dataEngine.droppedEvidenceReporter');
  const slot = globalThis as unknown as Record<symbol, unknown>;
  const unreadable = (key: 'groupTitleDraft' | 'councilTitleDraft' | 'groupStatusDraft' | 'councilLifecycleDraft') => {
    const source = titleRecord();
    return { ...source, checkpoint: { ...source.checkpoint, [key]: { ...fieldDraft, action: { ...observation, time: { earliestMs: 1, latestMs: 200_000 } } } } };
  };

  it('says each dropped field name on the console at most once per page session, names only', () => {
    const installed = slot[REPORTER];
    slot[REPORTER] = undefined;
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (let i = 0; i < 3; i++) expect(validateRecoveryRecord(unreadable('groupTitleDraft'), 'owner', 'editor').checkpoint.draft).toEqual({ userId: 'owner', title: 'Later' });
      expect(error).toHaveBeenCalledTimes(1);
      validateRecoveryRecord(unreadable('councilTitleDraft'), 'owner', 'editor');
      validateRecoveryRecord(unreadable('groupTitleDraft'), 'owner', 'editor');
      expect(error).toHaveBeenCalledTimes(2);
      const said = JSON.stringify(error.mock.calls);
      expect(said).toContain('groupTitleDraft');
      expect(said).toContain('councilTitleDraft');
      expect(said).not.toContain('Later');
    } finally { error.mockRestore(); slot[REPORTER] = installed; }
  });

  it('reads the draft the same when the reporter or the console throws', () => {
    const installed = slot[REPORTER];
    const error = jest.spyOn(console, 'error').mockImplementation(() => { throw new Error('console unavailable'); });
    try {
      slot[REPORTER] = () => { throw new Error('diagnostic unavailable'); };
      const reported = validateRecoveryRecord(unreadable('groupStatusDraft'), 'owner', 'editor');
      slot[REPORTER] = undefined;
      const said = validateRecoveryRecord(unreadable('councilLifecycleDraft'), 'owner', 'editor');
      expect(error).toHaveBeenCalledTimes(1);
      for (const record of [reported, said]) {
        expect(record.checkpoint.draft).toEqual({ userId: 'owner', title: 'Later' });
        if (record === reported) expect(record.checkpoint.groupStatusDraft?.action.time).toBeNull();
        else expect(record.checkpoint).not.toHaveProperty('groupStatusDraft');
        expect(record.checkpoint).not.toHaveProperty('councilLifecycleDraft');
      }
    } finally { error.mockRestore(); slot[REPORTER] = installed; }
  });

  it('collects every dropped name under Jest without throwing, and a test takes only the names it expects', () => {
    const record = unreadable('groupTitleDraft');
    record.checkpoint.councilTitleDraft = { ...fieldDraft, action: null } as never;
    expect(() => validateRecoveryRecord(record, 'owner', 'editor')).not.toThrow();
    expect(droppedProof()).toEqual(['groupTitleDraft', 'councilTitleDraft']);
    takeDroppedProof('groupTitleDraft');
    expect(droppedProof()).toEqual(['councilTitleDraft']);
    expect(() => takeDroppedProof('groupStatusDraft')).toThrow('Expected the codec to drop groupStatusDraft');
    takeDroppedProof('councilTitleDraft');
  });

  it('settles a closed copy the same way under the Jest reporter as in production', async () => {
    const outcomes: Array<{ mode: string; stillStored: boolean }> = [];
    for (const mode of ['production', 'jest'] as const) {
      const harness = installStorageHarness();
      const store = createIndexedDbCheckpoints();
      const stored = titleRecord('closed');
      await store.put(stored);
      const current = JSON.parse(JSON.stringify(harness.rows.get(JSON.stringify(['checkpoint', 'owner', 'closed'])))) as EditorRecord;
      // Answered: nothing of the person's is left, and the prospective copy carries a proof the codec drops.
      const settled = { ...current, checkpoint: { ...current.checkpoint, draft: current.checkpoint.confirmed.value, dirty: false,
        groupTitleDraft: { ...fieldDraft, action: null } } } as unknown as EditorRecord;
      const installed = slot[REPORTER];
      if (mode === 'production') slot[REPORTER] = () => undefined;
      try { await store.settleClosed!('owner', [{ stored: current, settled }]); } finally { slot[REPORTER] = installed; }
      if (mode === 'jest') takeDroppedProof('groupTitleDraft');
      outcomes.push({ mode, stillStored: harness.rows.has(JSON.stringify(['checkpoint', 'owner', 'closed'])) });
    }
    expect(outcomes).toEqual([{ mode: 'production', stillStored: false }, { mode: 'jest', stillStored: false }]);
  });
});
