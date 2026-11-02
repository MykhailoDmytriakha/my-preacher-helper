import { applyCommand, commandFingerprint, diffFields, equalValues, getResourcePolicy, mergeDocumentFields, mergeFields, readField, validateCommand } from '../protocol';

import type { DataCommand, DocumentData, FieldValue, ResourceSnapshot } from '../types';

const ref = { collection: 'sermons', id: 'sermon-1' };
const snapshot = (value: DocumentData | null): ResourceSnapshot => ({ resource: ref, value, metadata: null });
const update = (base: DocumentData, next: DocumentData): DataCommand => ({
  protocol: 1, operationId: 'operation-1', owner: 'owner', resource: ref, generation: null,
  dependsOn: [], kind: 'update', changes: diffFields(base, next),
});
const field = (value: FieldValue['value']): FieldValue => ({ exists: true, value });

describe('DataEngine command protocol', () => {
  it('allows creation only for the absent owned second participant of a council carry', () => {
    const topic = { id: 'topic', title: 'Matter', questions: [], options: [] };
    const value = { userId: 'owner', title: 'Next', status: 'preparing', topics: [{ ...topic, id: 'copy' }], createdAt: 'now', updatedAt: 'now' };
    const command = { protocol: 1, owner: 'owner', operationId: 'carry', resource: { collection: 'councils', id: 'source' }, generation: null, dependsOn: [],
      kind: 'relation', relation: 'council-carry', edits: [
        { resource: { collection: 'councils', id: 'source' }, generation: null, beforeTopics: [topic], afterTopics: [{ ...topic, carriedToCouncilId: 'target' }] },
        { resource: { collection: 'councils', id: 'target' }, generation: null, beforeTopics: [], afterTopics: value.topics, create: value },
      ] };
    expect(validateCommand(command)).toEqual(command);
    const mutate = (change: (copy: typeof command) => void) => { const copy = JSON.parse(JSON.stringify(command)); change(copy); return copy; };
    for (const invalid of [
      mutate(copy => { Object.assign(copy.edits[0], { create: value }); }),
      mutate(copy => { copy.edits[1].create!.userId = 'another'; }),
      mutate(copy => { copy.edits[1].create!.status = 'held'; }),
      mutate(copy => { Object.assign(copy.edits[1], { generation: 'existing' }); }),
      mutate(copy => { copy.edits[1].beforeTopics = [topic]; }),
      mutate(copy => { copy.edits[1].afterTopics = []; }),
    ]) expect(() => validateCommand(invalid)).toThrow();
  });

  it.each(['2', '2026-0', '2026-02-31'])('refuses a newly changed group date %s at the shared server boundary', date => {
    const resource = { collection: 'groups', id: 'group' };
    const meeting = { id: 'meeting', date: '2026-11-19', location: 'Hall', createdAt: 'created' };
    const before = { userId: 'owner', meetingDates: [meeting] };
    const after = { ...before, meetingDates: [{ ...meeting, date }] };
    const result = applyCommand({ ...update(before, after), resource }, { resource, value: before, metadata: null });
    expect(result).toMatchObject({ kind: 'refused', code: 'invalid-document' });
    expect(before.meetingDates[0]).toEqual(meeting);
  });

  it('accepts an undated group meeting and a detail edit over an unchanged legacy date', () => {
    const resource = { collection: 'groups', id: 'group' };
    for (const date of ['', '2']) {
      const meeting = { id: 'meeting', date, location: 'Hall', notes: 'Keep', createdAt: 'created' };
      const before = { userId: 'owner', meetingDates: [meeting] };
      const after = { ...before, meetingDates: [{ ...meeting, location: 'New hall' }] };
      const result = applyCommand({ ...update(before, after), resource }, { resource, value: before, metadata: null });
      expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { meetingDates: after.meetingDates } } });
    }
  });

  it('never replaces an unowned scalar or array ancestor with an object', () => {
    for (const [value, path] of [
      [{ userId: 'owner', title: 'keep' }, ['title', 'child']],
      [{ userId: 'owner', scratch: [{ id: 'a', text: 'keep' }] }, ['scratch', '0', 'text']],
    ] as [DocumentData, string[]][]) {
      const before = JSON.stringify(value);
      const command: DataCommand = { ...update({}, {}), kind: 'update', changes: [{ path, before: { exists: false }, after: field('replace') }] };
      expect(() => applyCommand(command, snapshot(value))).toThrow('Invalid field change');
      expect(JSON.stringify(value)).toBe(before);
    }
  });

  it('preserves independent edits of two existing scratch notes', () => {
    const base = { scratch: [{ id: 'a', text: 'A0', createdAt: '2026-09-12' }, { id: 'b', text: 'B0', createdAt: '2026-09-12' }] };
    const next = { scratch: [{ id: 'a', text: 'A1', createdAt: '2026-09-12' }, { id: 'b', text: 'B0', createdAt: '2026-09-12' }] };
    const remote = { userId: 'owner', scratch: [{ id: 'a', text: 'A0', createdAt: '2026-09-12' }, { id: 'b', text: 'B1', createdAt: '2026-09-12' }] };
    const result = applyCommand(update(base, next), snapshot(remote));
    expect(result.kind).toBe('acknowledged');
    if (result.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    expect(result.snapshot.value?.scratch).toEqual([{ id: 'a', text: 'A1', createdAt: '2026-09-12' }, { id: 'b', text: 'B1', createdAt: '2026-09-12' }]);
    expect(result.snapshot.metadata).toEqual({ protocol: 1, generation: 'operation-1', revision: 1, deleted: false, operationId: 'operation-1' });
    expect(result.snapshot.value?.rev).toEqual({ scratch: 1 });
    expect(remote.scratch[0].text).toBe('A0');
  });

  it('refuses intersecting text edits and returns all three versions', () => {
    const remote = snapshot({ userId: 'owner', title: 'theirs' });
    const result = applyCommand(update({ title: 'base' }, { title: 'mine' }), remote);
    expect(result).toMatchObject({ kind: 'conflict', snapshot: remote, conflicts: [{
      path: ['title'], base: field('base'), mine: field('mine'), theirs: field('theirs'),
    }] });
  });

  it('treats matching edits and unmodified fields as compatible', () => {
    expect(mergeFields(field('a'), field('a'), field('b'))).toEqual({ value: field('b'), conflicts: [] });
    expect(mergeFields(field('a'), field('b'), field('b'))).toEqual({ value: field('b'), conflicts: [] });
    expect(mergeFields(field({ x: 0, y: 0 }), field({ x: 1, y: 0 }), field({ x: 0, y: 1 })).value)
      .toEqual(field({ x: 1, y: 1 }));
  });

  it('rebases independent content without conflicting on root recency metadata', () => {
    const base = { title: 'First', date: '2026-10-15', updatedAt: '2026-10-15T10:00:00Z' };
    const mine = { ...base, title: 'Second', updatedAt: '2026-10-15T10:01:00Z' };
    const theirs = { ...base, date: '2026-10-16', updatedAt: '2026-10-15T10:02:00Z' };
    expect(mergeDocumentFields(base, mine, theirs)).toEqual({ value: field({ ...mine, date: theirs.date, updatedAt: theirs.updatedAt }), conflicts: [] });
    expect(mergeDocumentFields(base, mine, { ...theirs, title: 'Other' }).conflicts.map(conflict => conflict.path)).toEqual([['title']]);
  });

  it('retains a pending creation timestamp while the server document is absent', () => {
    const mine = { title: 'New', updatedAt: '2026-10-15T10:00:00.000Z' };
    expect(mergeDocumentFields(null, mine, null)).toEqual({ value: field(mine), conflicts: [] });
  });

  it('retains authored work and its timestamp in a remote deletion conflict', () => {
    const base = { title: 'Before', updatedAt: '2026-10-15T10:00:00.000Z' };
    const mine = { ...base, title: 'Local work', updatedAt: '2026-10-15T10:01:00.000Z' };
    const result = mergeDocumentFields(base, mine, null);
    expect(result.value).toEqual(field(mine));
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].theirs).toEqual({ exists: false });
    expect(base.title).toBe('Before');
  });

  it('does not mistake the root of an arbitrary value for resource metadata', () => {
    const result = mergeFields(field({ updatedAt: 'base' }), field({ updatedAt: 'mine' }), field({ updatedAt: 'theirs' }));
    expect(result.conflicts.map(conflict => conflict.path)).toEqual([['updatedAt']]);
  });

  it('keeps nested authored updatedAt fields subject to normal conflict checks', () => {
    const result = mergeFields(field({ custom: { updatedAt: 'base' } }), field({ custom: { updatedAt: 'mine' } }), field({ custom: { updatedAt: 'theirs' } }));
    expect(result.conflicts.map(conflict => conflict.path)).toEqual([['custom', 'updatedAt']]);
  });

  it('does not resolve deletion against concurrent authored text silently', () => {
    const result = mergeFields(field([{ id: 'a', text: 'base' }]), field([]), field([{ id: 'a', text: 'new' }]));
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ mine: { exists: false }, theirs: field({ id: 'a', text: 'new' }) });
  });

  it('preserves additions, respects one reorder, and conflicts on incompatible reorders', () => {
    const result = mergeFields(field(['a', 'b']), field(['b', 'a', 'c']), field(['a', 'b', 'd']));
    expect(result.value).toEqual(field(['b', 'a', 'c', 'd']));
    expect(result.conflicts).toEqual([]);
    expect(mergeFields(field(['a', 'b', 'c']), field(['b', 'a', 'c']), field(['a', 'c', 'b'])).conflicts).toHaveLength(1);
    expect(mergeFields(field([0]), field([1]), field([2])).conflicts).toHaveLength(1);
    expect(mergeFields(field(['a']), field(['a', 'a']), field(['a', 'b'])).conflicts).toHaveLength(1);
  });

  it('preserves concurrent insertion anchors and refuses cyclic ordering intents', () => {
    const result = mergeFields(field(['a', 'b']), field(['a', 'x', 'b']), field(['a', 'b', 'y']));
    expect(result).toEqual({ value: field(['a', 'x', 'b', 'y']), conflicts: [] });
    expect(mergeFields(field(['a', 'b']), field(['b', 'a']), field(['a', 'x', 'b'])).conflicts).toHaveLength(1);
    const sameGap = mergeFields(field(['a', 'b']), field(['a', 'x', 'b']), field(['a', 'y', 'b']));
    expect(sameGap.conflicts).toEqual([]);
    expect(sameGap.value.value).toEqual(['a', 'y', 'x', 'b']);
  });

  it('creates only absent records and refuses tombstoned generations', () => {
    const command: DataCommand = { ...update({}, { title: 'new' }), kind: 'create', value: { title: 'new', verse: 'John 1:1', date: '2026-09-12', thoughts: [] } };
    expect(applyCommand(command, snapshot(null))).toMatchObject({ kind: 'acknowledged', snapshot: { value: { title: 'new', userId: 'owner' } } });
    expect(applyCommand(command, snapshot({ userId: 'owner' }))).toMatchObject({ kind: 'refused', code: 'already-exists' });
    const deleted = { ...snapshot(null), metadata: { protocol: 1 as const, generation: 'old', revision: 3, deleted: true } };
    expect(applyCommand(command, deleted)).toMatchObject({ kind: 'deleted' });
    expect(applyCommand(command, { ...deleted, metadata: { ...deleted.metadata, deleted: false } })).toMatchObject({ code: 'generation-mismatch' });
  });

  it('guards deletes against unseen edits and produces a persistent tombstone', () => {
    const value = { userId: 'owner', title: 'base' };
    const command: DataCommand = { ...update({}, { title: '' }), kind: 'delete', baseline: value };
    expect(applyCommand(command, snapshot({ ...value, title: 'changed' }))).toMatchObject({ kind: 'conflict' });
    expect(applyCommand(command, snapshot(value))).toMatchObject({ kind: 'acknowledged', snapshot: { value: null, metadata: { deleted: true } } });
    expect(applyCommand(update({ title: 'base' }, { title: 'next' }), snapshot(null))).toMatchObject({ kind: 'deleted' });
  });

  it('allows a same-generation delete after only the server-derived materialIds index changed', () => {
    const resource = { collection: 'studyNotes', id: 'note' };
    const baseline = { userId: 'owner', title: 'base', content: 'words', materialIds: [] };
    const current: ResourceSnapshot = { resource, value: { ...baseline, materialIds: ['material'] },
      metadata: { protocol: 1, generation: 'note-generation', revision: 2, deleted: false } };
    const command: DataCommand = { ...update({}, {}), resource, generation: 'note-generation', kind: 'delete', baseline };
    expect(applyCommand(command, current)).toMatchObject({ kind: 'acknowledged', snapshot: { value: null, metadata: { deleted: true } } });
  });

  it('still conflicts when a delete baseline has authored content changes alongside a derived index change', () => {
    const resource = { collection: 'studyNotes', id: 'note' };
    const baseline = { userId: 'owner', title: 'base', content: 'words', materialIds: [] };
    const current: ResourceSnapshot = { resource, value: { ...baseline, title: 'edited', materialIds: ['material'] },
      metadata: { protocol: 1, generation: 'note-generation', revision: 2, deleted: false } };
    const command: DataCommand = { ...update({}, {}), resource, generation: 'note-generation', kind: 'delete', baseline };
    expect(applyCommand(command, current)).toMatchObject({ kind: 'conflict' });
  });

  it('refuses a delete when the resource generation changed even if authored content is unchanged', () => {
    const resource = { collection: 'studyNotes', id: 'note' };
    const baseline = { userId: 'owner', title: 'base', content: 'words', materialIds: [] };
    const current: ResourceSnapshot = { resource, value: baseline,
      metadata: { protocol: 1, generation: 'replacement-generation', revision: 1, deleted: false } };
    const command: DataCommand = { ...update({}, {}), resource, generation: 'note-generation', kind: 'delete', baseline };
    expect(applyCommand(command, current)).toMatchObject({ kind: 'refused', code: 'generation-mismatch' });
  });

  it('rejects ownership, resource and privileged-field bypasses', () => {
    const command = update({ title: 'base' }, { title: 'next' });
    expect(applyCommand(command, snapshot({ userId: 'other', title: 'base' }))).toMatchObject({ code: 'permission-denied' });
    expect(applyCommand(command, { ...snapshot(null), resource: { ...ref, id: 'other' } })).toMatchObject({ code: 'resource-mismatch' });
    expect(() => validateCommand(update({}, { userId: 'other' }))).toThrow('Invalid field change');
    expect(() => validateCommand({ ...command, resource: { collection: 'users', id: 'owner' }, changes: diffFields({}, { paidTier: 'premium' }) })).toThrow();
    expect(() => getResourcePolicy('_dataEngineReceipts')).toThrow();
    expect(() => validateCommand({ ...command, dependsOn: [command.operationId] })).toThrow();
  });

  it('lets the person keep reading settings in their own settings document', () => {
    // The account's reading settings (`utils/accountChoice.ts`) travel as one `reading` field; a field missing from the
    // users list was refused on the device before it was ever sent (2026-11-02).
    const users = { collection: 'users', id: 'owner' };
    const before = { language: 'ru', reading: { mine: { show: true } } };
    const after = { language: 'ru', reading: { mine: { show: true }, trail: { history: 50, recent: 7 } } };
    const command = validateCommand({ ...update(before, after), resource: users });
    expect(command).toMatchObject({ kind: 'update', changes: [{ path: ['reading'] }] });
    expect(applyCommand(command, { resource: users, value: before, metadata: null }))
      .toMatchObject({ kind: 'acknowledged', snapshot: { value: after } });
  });

  it.each([
    null, {}, { protocol: 2 }, { value: Infinity }, { value: undefined },
    JSON.parse('{"__proto__":{"paidTier":"premium"}}'),
  ])('rejects malformed JSON/envelopes %#', input => expect(() => validateCommand(input)).toThrow());

  it('rejects overlapping paths and invalid field markers', () => {
    const command = update({}, { preparation: {} });
    if (command.kind !== 'update') throw new Error('Expected update');
    expect(() => validateCommand({ ...command, changes: [...command.changes, {
      path: ['preparation', 'thesis'], before: { exists: false }, after: field('x'),
    }] })).toThrow('Invalid field change');
    expect(() => validateCommand({ ...command, changes: [{ path: ['title'], before: { exists: false, value: null }, after: field('x') }] })).toThrow();
  });

  it('applies nested field removal and canonicalizes keys without losing types', () => {
    const command = update({ planText: { a: 'old', b: 'kept' } }, { planText: { b: 'kept' }, preparation: { thesis: { oneSentence: 'new' } } });
    const result = applyCommand(command, snapshot({ userId: 'owner', planText: { a: 'old', b: 'kept' } }));
    expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { planText: { b: 'kept' }, preparation: { thesis: { oneSentence: 'new' } } } } });
    expect(equalValues({ b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(equalValues({ x: '1' }, { x: 1 })).toBe(false);
    expect(commandFingerprint({ a: [true, null] })).toBe('{"a":[true,null]}');
    expect(readField({}, ['missing', 'child'])).toEqual({ exists: false });
  });

  it('does not recreate a remotely deleted ancestor from a leaf-only absence baseline', () => {
    const command: DataCommand = { ...update({}, {}), kind: 'update', changes: [{ path: ['preparation', 'thesis'], before: { exists: false }, after: field('new') }] };
    expect(() => validateCommand(command)).toThrow('Invalid field change');
    const completeBaseline = update({ preparation: { thesis: 'old' } }, { preparation: { thesis: 'old', authorIntent: 'new' } });
    expect(applyCommand(completeBaseline, snapshot({ userId: 'owner' }))).toMatchObject({ kind: 'conflict' });
  });
});


it('merges independent newly created map fields without treating their shared absent container as authored text', () => {
  const base = { userId: 'owner' };
  const mine = { ...base, preparation: { mainIdea: { contextIdea: 'Context words' } } };
  const theirs = { ...base, preparation: { mainIdea: { textIdea: 'Text words' } } };
  const result = applyCommand(update(base, mine), snapshot(theirs));
  expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: {
    preparation: { mainIdea: { contextIdea: 'Context words', textIdea: 'Text words' } } } } });
  expect(mergeDocumentFields(base, mine, theirs)).toMatchObject({ conflicts: [], value: { value: {
    preparation: { mainIdea: { contextIdea: 'Context words', textIdea: 'Text words' } } } } });
});

it('still compares newly created same-leaf words and scalar or deleted ancestors', () => {
  const missing: FieldValue = { exists: false };
  expect(mergeFields(missing, field({ value: 'Mine' }), field({ value: 'Theirs' }), ['preparation']).conflicts).toHaveLength(1);
  expect(mergeFields(field('Old scalar'), field({ value: 'Mine' }), field({ value: 'Theirs' }), ['preparation']).conflicts).toHaveLength(1);
  expect(mergeFields(field({ before: 'Old' }), field({ before: 'Old', added: 'Mine' }), missing, ['preparation']).conflicts).toHaveLength(1);
  expect(mergeFields(missing, field({ quote: 'Mine' }), field({ location: 'Theirs' }), ['scriptureRefs', 'id:ref']).conflicts).toHaveLength(1);
  expect(mergeFields(missing, field({ title: 'Mine' }), field({ verse: 'Theirs' })).conflicts).toHaveLength(1);
  expect(mergeFields(missing, field({ id: 'same', title: 'Mine' }), field({ id: 'same', verse: 'Theirs' }), ['points', 'id:same']).conflicts).toHaveLength(1);
});
