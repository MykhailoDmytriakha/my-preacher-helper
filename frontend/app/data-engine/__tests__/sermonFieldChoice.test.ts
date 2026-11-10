import { projectSavedChoiceDependents, recoverManualChoiceCopy } from '../manualChoice';
import { manualComparison } from '../manualComparison';
import { validateRecoveryRecord } from '../recovery.client';
import { keepUncontestedSermonFields, readSermonPlanModeComparison } from '../sermonFieldChoice';

import type { CommitRequest } from '../commits';
import type { ManualScope } from '../manualScope';
import type { SessionCheckpoint } from '../session';
import type { ResourceSnapshot } from '../types';

it('can choose a saved scripture that returned to its opening value while retaining a separate title edit', () => {
  const basis: ResourceSnapshot = {
    resource: { collection: 'sermons', id: 'sermon' },
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Opening title', verse: 'John 3:16' },
  };
  const stored = { ...basis, metadata: { ...basis.metadata!, revision: 3 } };
  const draft = { ...basis.value!, title: 'Edited title', verse: 'Romans 8:1' };
  expect(keepUncontestedSermonFields(basis, draft, stored, [{
    path: ['verse'], base: { exists: true, value: 'John 3:16' },
    mine: { exists: true, value: 'Romans 8:1' }, theirs: { exists: true, value: 'John 3:16' },
  }])).toEqual({ userId: 'owner', title: 'Edited title', verse: 'John 3:16' });
});


it('keeps an answered scripture comparison visible when the saved text returned to its opening value', () => {
  const basis: ResourceSnapshot = {
    resource: { collection: 'sermons', id: 'sermon' },
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false },
    value: { userId: 'owner', verse: 'John 3:16' },
  };
  const stored = { ...basis, metadata: { ...basis.metadata!, revision: 3 } };
  const value = { ...basis.value!, verse: 'Romans 8:1' };
  const editedVerse = { exists: true, value: value.verse };
  const savedVerse = { exists: true, value: 'John 3:16' };
  const conflicts = [{ path: ['verse'], base: savedVerse, mine: editedVerse, theirs: savedVerse }];
  const request: CommitRequest = {
    id: 'save', owner: 'owner', editorId: 'scope', editGeneration: 1, predecessor: null,
    baseline: basis, value, revision: 1, initialized: true, working: basis, intended: value,
    command: null, submitted: value, sequence: 0, state: 'conflict', unfinalized: [],
    result: { kind: 'conflict', operationId: 'save', snapshot: stored, conflicts },
  };
  const stage: ReturnType<ManualScope['getState']> = {
    record: { kind: 'manual', version: 1, resource: basis.resource, owner: 'owner', scopeId: 'scope', selection: [['verse']],
      baseline: basis, predecessor: { id: request.id, owner: 'owner', resource: basis.resource, value, predecessorId: null },
      stage: [editedVerse], savedSelection: [editedVerse], generation: 1, savedGeneration: 1, active: true },
    value, openingValue: basis.value, dirty: false, durable: true, capturing: false,
  };
  const parent: SessionCheckpoint = { confirmed: basis, remoteCandidate: stored, draft: value, dirty: true,
    editGeneration: 1, conflicts, pending: { save: { generation: 1, value } } };
  expect(manualComparison(stage, parent, new Map([[request.id, request]]), request)).toMatchObject({
    conflictPaths: [['verse']], mine: value, stored,
  });
});


it('keeps independent words and tags when using the saved membership of one thought tag', () => {
  const date = '2026-11-08T00:00:00.000Z';
  const thought = { id: 'one', date, text: 'Opening thought', tags: ['main', 'Alpha'] };
  const basis: ResourceSnapshot = {
    resource: { collection: 'sermons', id: 'sermon' },
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false },
    value: { userId: 'owner', thoughts: [thought] },
  };
  const stored = { ...basis, metadata: { ...basis.metadata!, revision: 3 },
    value: { userId: 'owner', thoughts: [{ ...thought, tags: ['main', 'Alpha', 'Other device'] }] } };
  const draft = { userId: 'owner', thoughts: [{ ...thought, text: 'Edited thought', tags: ['main', 'Beta'] }] };
  const conflicts = [{
    path: ['thoughts', 'id:one', 'tags', 'string:Alpha'], base: { exists: true, value: true },
    mine: { exists: true, value: false }, theirs: { exists: true, value: true },
  }];
  const selected = keepUncontestedSermonFields(basis, draft, stored, conflicts);
  expect(selected?.thoughts).toEqual([{ ...thought, text: 'Edited thought', tags: expect.arrayContaining(['main', 'Alpha', 'Other device', 'Beta']) }]);
  const replacement = { ...stored, value: { userId: 'owner', thoughts: [{ ...thought, date: '2026-11-09T00:00:00.000Z' }] } };
  expect(keepUncontestedSermonFields(basis, draft, replacement, conflicts)).toBeUndefined();
});


it('compares the two plan modes while retaining words independently of the mode choice', () => {
  const basis: ResourceSnapshot = {
    resource: { collection: 'sermons', id: 'sermon' },
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false },
    value: { userId: 'owner', planMode: 'manual', planText: { opening: 'Previous intro', end: 'Previous conclusion' } },
  };
  const stored = { ...basis, metadata: { ...basis.metadata!, revision: 3 },
    value: { ...basis.value!, planMode: 'ai', planText: { opening: 'Previous intro', end: 'Saved conclusion' } } };
  const draft = { ...basis.value!, planMode: 'note', planText: { opening: 'My edited intro', end: 'Previous conclusion' } };
  const mine = { exists: true, value: 'note' };
  const theirs = { exists: true, value: 'ai' };
  const conflicts = [{ path: ['planMode'], base: { exists: true, value: 'manual' }, mine, theirs }];
  const checkpoint: SessionCheckpoint = { confirmed: basis, remoteCandidate: stored, draft,
    conflicts, editGeneration: 1, dirty: true, pending: {} };
  expect(readSermonPlanModeComparison(checkpoint)).toMatchObject({ mine, stored: theirs });
  expect(keepUncontestedSermonFields(basis, draft, stored, conflicts)?.planText)
    .toEqual({ opening: 'My edited intro', end: 'Saved conclusion' });
});

it('keeps the second scratch note opening when the first queued note gets a separate choice', () => {
  const resource = { collection: 'sermons', id: 's1' };
  const snapshot = (revision: number, first: string, second: string): ResourceSnapshot => ({
    resource, metadata: { protocol: 1, generation: 'g1', revision, deleted: false },
    value: { userId: 'owner', scratch: [{ id: 'one', createdAt: 't1', text: first }, { id: 'two', createdAt: 't2', text: second }] },
  });
  const baseline = snapshot(1, 'A at opening', 'B at opening');
  const firstDraft = snapshot(1, 'A on phone', 'B at opening').value;
  const secondDraft = snapshot(1, 'A on phone', 'B on phone').value;
  const stored = snapshot(2, 'A on computer', 'B on computer');
  const first: CommitRequest = { id: 'first', owner: 'owner', editorId: 'scratch', editGeneration: 1,
    predecessor: null, baseline, working: baseline, value: firstDraft, intended: firstDraft,
    initialized: true, command: null, submitted: firstDraft, revision: 1, sequence: 0, state: 'cancelled', result: null, unfinalized: [] };
  const second: CommitRequest = { ...first, id: 'second', predecessor: first.id, editGeneration: 2,
    initialized: false, value: secondDraft, intended: secondDraft, submitted: null, retainedAfterChoice: true,
    sermonNoteText: { sermonId: resource.id, generation: 'g1', pending: [], target: { kind: 'scratch', id: 'two', createdAt: 't2' }, text: 'B at opening' } };
  const [copy] = projectSavedChoiceDependents('owner', first, stored, stored.value, [first, second]);
  const reopened = validateRecoveryRecord(copy, copy.owner, copy.editorId, resource);
  const recovered = recoverManualChoiceCopy(reopened, stored);
  expect(recovered.checkpoint).toMatchObject({
    draft: snapshot(2, 'A on computer', 'B on phone').value,
    remoteCandidate: stored,
    conflicts: [{ path: ['scratch', 'id:two', 'text'], base: { value: 'B at opening' },
      mine: { value: 'B on phone' }, theirs: { value: 'B on computer' } }],
  });
});
