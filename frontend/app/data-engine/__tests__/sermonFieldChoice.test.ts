import { manualComparison } from '../manualComparison';
import { keepUncontestedSermonFields } from '../sermonFieldChoice';

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
