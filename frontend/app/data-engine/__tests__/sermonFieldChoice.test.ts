import { moveSubPoint } from '@/utils/outlineDnd';

import { projectSavedChoiceDependents, recoverManualChoiceCopy } from '../manualChoice';
import { manualComparison } from '../manualComparison';
import { projectOutlineParentChoice } from '../outlineParentChoice';
import { replaceResourceOutline } from '../outlinePlacementResource';
import { mergeDocumentFields } from '../protocol';
import { validateRecoveryRecord } from '../recovery.client';
import { keepUncontestedSermonFields, readSermonPlanModeComparison } from '../sermonFieldChoice';

import type { CommitRequest } from '../commits';
import type { ManualScope } from '../manualScope';
import type { SessionCheckpoint } from '../session';
import type { DocumentData, ResourceSnapshot } from '../types';
import type { SermonOutline } from '@/models/models';

it.each(['remote', 'local', 'new-local-parent', 'new-saved-parent', 'later-independent-words', 'later-same-parent', 'later-same-parent-different-slot', 'later-opening-parent', 'competing-words'] as const)(
  'keeps independent words and linked thoughts when resolving %s subpoint placement', scenario => {
  const differentSlot = scenario === 'later-same-parent-different-slot';
  const outline: SermonOutline = { introduction: [], main: [
    { id: 'opening', text: 'Opening point', subPoints: [{ id: 'child', text: 'Subpoint', position: 1000 }] },
    { id: 'phone', text: 'Phone destination', subPoints: differentSlot ? [{ id: 'sibling', text: 'Sibling', position: 0 }] : [] },
    { id: 'desktop', text: 'Desktop destination', subPoints: [] },
  ], conclusion: [] };
  const thought = { id: 'one', text: 'Opening words', tags: ['main'], date: '2026-11-13T00:00:00.000Z',
    outlinePointId: 'opening', subPointId: 'child' };
  const basis: ResourceSnapshot = {
    resource: { collection: 'sermons', id: 'sermon' },
    metadata: { protocol: 1, generation: 'original', revision: 1, deleted: false },
    value: { userId: 'owner', outline: outline as unknown as DocumentData, thoughts: [thought] },
  };
  if (scenario === 'new-local-parent') outline.main = outline.main.filter(point => point.id !== 'phone');
  if (scenario === 'new-saved-parent') outline.main = outline.main.filter(point => point.id !== 'desktop');
  const withParent = (id: string) => outline.main.some(point => point.id === id) ? outline : { ...outline,
    main: [...outline.main, { id, text: 'New destination', subPoints: [] }] };
  const phoneOutline = moveSubPoint(withParent('phone'), 'child', 'phone', 0);
  phoneOutline.main = phoneOutline.main.map(point => point.id === 'desktop'
    ? { ...point, text: 'Independent phone point title' } : point);
  const draft = replaceResourceOutline('sermons', { ...basis.value!, thoughts: [{ ...thought, text: 'Independent phone words' }] }, phoneOutline);
  const desktopOutline = moveSubPoint(withParent('desktop'), 'child', 'desktop', 0);
  desktopOutline.main = desktopOutline.main.map(point => point.id === 'opening'
    ? { ...point, text: 'Independent desktop point title' } : point.id === 'desktop' && scenario === 'competing-words'
      ? { ...point, text: 'Competing saved title' } : point);
  const stored: ResourceSnapshot = { ...basis, metadata: { ...basis.metadata!, revision: 2 },
    value: replaceResourceOutline('sermons', basis.value!, desktopOutline) };
  const { conflicts } = mergeDocumentFields(basis.value, draft, stored.value);
  expect(conflicts.map(({ path }) => path)).toEqual([['outline'], ['thoughts', 'id:one', 'outlinePointId']]);
  const side = scenario === 'local' || scenario === 'new-local-parent' ? 'local' : 'remote';
  const parent = side === 'local' || (scenario === 'later-same-parent' || differentSlot) ? 'phone' : scenario === 'later-opening-parent' ? 'opening' : 'desktop';
  const laterOutline = scenario === 'later-independent-words' ? { ...desktopOutline, main: desktopOutline.main.map(point => point.id === 'phone'
    ? { ...point, text: 'Later saved title' } : point) }
    : scenario === 'later-same-parent' || scenario === 'later-opening-parent' || differentSlot ? moveSubPoint(desktopOutline, 'child', parent, differentSlot ? 1 : 0) : null;
  const live = laterOutline ? { ...stored, metadata: { ...stored.metadata!, revision: 3 },
    value: replaceResourceOutline('sermons', stored.value!, laterOutline) } : stored;
  if (scenario === 'competing-words') {
    for (const choice of ['local', 'remote'] as const) {
      expect(() => projectOutlineParentChoice(basis, draft, live, conflicts, choice)).toThrow('other changes need review');
    }
    return;
  }
  const selected = side === 'remote' ? keepUncontestedSermonFields(basis, draft, live, conflicts)
    : projectOutlineParentChoice(basis, draft, live, conflicts, side);
  expect(selected?.thoughts).toMatchObject([{ id: 'one', outlinePointId: parent, subPointId: 'child', text: 'Independent phone words' }]);
  const chosen = selected?.outline as unknown as SermonOutline;
  expect(chosen.main.find(point => point.id === 'opening')?.text).toBe('Independent desktop point title');
  expect(chosen.main.find(point => point.id === 'desktop')?.text).toBe(scenario === 'new-saved-parent' ? 'New destination' : 'Independent phone point title');
  expect(chosen.main.find(point => point.id === 'phone')?.text).toBe(scenario === 'later-independent-words' ? 'Later saved title'
    : scenario === 'new-local-parent' ? 'New destination' : 'Phone destination');
  if (differentSlot) expect(chosen.main.find(point => point.id === 'phone')?.subPoints?.map(child => child.id)).toEqual(['sibling', 'child']);
  expect(chosen.main.filter(point => point.subPoints?.some(child => child.id === 'child')).map(point => point.id)).toEqual([parent]);
});

it('shows the saved and current local parent in the manual comparison while the owner edits other words', () => {
  const outline = (parent: string, words = 'Third point') => ({ introduction: [], conclusion: [], main: [
    { id: 'a', text: 'First point' }, { id: 'b', text: 'Second point' }, { id: 'c', text: words },
  ].map(point => ({ ...point, subPoints: point.id === parent ? [{ id: 'child', text: 'Child', position: 0 }] : [] })) });
  const baseline: ResourceSnapshot = { resource: { collection: 'sermons', id: 'sermon' },
    metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false }, value: { outline: outline('a') } };
  const value = { outline: outline('b') };
  const stored = { ...baseline, metadata: { ...baseline.metadata!, revision: 2 }, value: { outline: outline('c') } };
  const { conflicts } = mergeDocumentFields(baseline.value, value, stored.value);
  const request: CommitRequest = { id: 'save', owner: 'owner', editorId: 'scope', editGeneration: 1, predecessor: null,
    baseline, value, revision: 1, initialized: true, working: baseline, intended: value, command: null, submitted: value,
    sequence: 0, state: 'conflict', unfinalized: [], result: { kind: 'conflict', operationId: 'save', snapshot: stored, conflicts } };
  const amended = { outline: outline('b', 'Later independent words') };
  const form: ReturnType<ManualScope['getState']> = { record: { kind: 'manual', version: 1, resource: baseline.resource,
    owner: 'owner', scopeId: 'scope', selection: [['outline']], baseline, active: true, savedGeneration: 1, generation: 2,
    predecessor: { id: request.id, owner: 'owner', resource: baseline.resource, value, predecessorId: null },
    stage: [{ exists: true, value: amended.outline }], savedSelection: [{ exists: true, value: value.outline }] },
    value: amended, openingValue: baseline.value, dirty: true, durable: true, capturing: false };
  const checkpoint: SessionCheckpoint = { confirmed: baseline, remoteCandidate: stored, draft: value, dirty: true,
    editGeneration: 1, conflicts, pending: { save: { generation: 1, value } } };
  expect(manualComparison(form, checkpoint, new Map([[request.id, request]]), request)).toMatchObject({
    outlineParent: { moves: [{ local: { point: { id: 'b' } }, remote: { point: { id: 'c' } } }] },
    mine: amended,
  });
  expect(projectOutlineParentChoice(baseline, amended, stored, conflicts, 'remote')?.outline).toEqual(outline('c', 'Later independent words'));
  const movedBack = { ...baseline, metadata: { ...baseline.metadata!, revision: 3 } };
  expect(manualComparison(form, { ...checkpoint, remoteCandidate: movedBack }, new Map([[request.id, request]]), request))
    .toMatchObject({ outlineParent: { moves: [{ local: { point: { id: 'b' } }, remote: { point: { id: 'a' } } }] } });
});

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
