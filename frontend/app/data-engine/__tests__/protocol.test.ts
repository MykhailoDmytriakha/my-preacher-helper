import { applyCommand, commandFingerprint, diffFields, equalValues, getResourcePolicy, mergeFields, readField, validateCommand } from '../protocol';

import type { DataCommand, DocumentData, FieldValue, ResourceSnapshot } from '../types';

const ref = { collection: 'sermons', id: 'sermon-1' };
const snapshot = (value: DocumentData | null): ResourceSnapshot => ({ resource: ref, value, metadata: null });
const update = (base: DocumentData, next: DocumentData): DataCommand => ({
  protocol: 1, operationId: 'operation-1', owner: 'owner', resource: ref, generation: null,
  dependsOn: [], kind: 'update', changes: diffFields(base, next),
});
const field = (value: FieldValue['value']): FieldValue => ({ exists: true, value });

describe('DataEngine command protocol', () => {
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

  it('rejects ownership, resource and privileged-field bypasses', () => {
    const command = update({ title: 'base' }, { title: 'next' });
    expect(applyCommand(command, snapshot({ userId: 'other', title: 'base' }))).toMatchObject({ code: 'permission-denied' });
    expect(applyCommand(command, { ...snapshot(null), resource: { ...ref, id: 'other' } })).toMatchObject({ code: 'resource-mismatch' });
    expect(() => validateCommand(update({}, { userId: 'other' }))).toThrow('Invalid field change');
    expect(() => validateCommand({ ...command, resource: { collection: 'users', id: 'owner' }, changes: diffFields({}, { paidTier: 'premium' }) })).toThrow();
    expect(() => getResourcePolicy('_dataEngineReceipts')).toThrow();
    expect(() => validateCommand({ ...command, dependsOn: [command.operationId] })).toThrow();
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
