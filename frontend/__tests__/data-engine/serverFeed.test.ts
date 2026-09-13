/** @jest-environment node */
import { assembleChangePage, collectionHeadId, HEADS_COLLECTION, parseChangePointer, planFeedWrites, readHeadVersion, sequenceId } from '@/data-engine/serverFeed';

import type { DocumentData, ResourceSnapshot } from '@/data-engine/types';

const owner = 'owner';
const collection = 'sermons';
const snapshot = (id: string, collectionName = collection): ResourceSnapshot => ({ resource: { collection: collectionName, id }, value: { userId: owner, title: id }, metadata: null });
const head = (version: number): DocumentData => ({ userId: owner, collection, version,
  _dataEngine: { protocol: 1, generation: collectionHeadId(owner, collection), revision: version + 1, deleted: false, operationId: 'previous' } });
const pointer = (version: number, id = `doc-${version}`) => ({ version, resource: { collection, id } });

describe('collection feed planning', () => {
  it('uses canonical shared identity and reserves contiguous stable sequences sorted by document id', () => {
    expect(collectionHeadId(owner, collection)).toBe(JSON.stringify([owner, collection]));
    const writes = planFeedWrites(owner, 'operation', [snapshot('z'), snapshot('a')], new Map([[collection, head(9)]]));
    expect(writes).toEqual([
      { path: [HEADS_COLLECTION, collectionHeadId(owner, collection), 'changes', '0000000000000010'], value: { resource: { collection, id: 'a' }, version: 10 } },
      { path: [HEADS_COLLECTION, collectionHeadId(owner, collection), 'changes', '0000000000000011'], value: { resource: { collection, id: 'z' }, version: 11 } },
      { path: [HEADS_COLLECTION, collectionHeadId(owner, collection)], value: { ...head(11), _dataEngine: { ...(head(11)._dataEngine as DocumentData), operationId: 'operation' } } },
    ]);
    expect(JSON.stringify(writes)).not.toContain('title');
  });

  it('creates independent counters for every affected collection and emits nothing for an empty effect', () => {
    const writes = planFeedWrites(owner, 'operation', [snapshot('a'), snapshot('b', 'groups')], new Map([[collection, undefined], ['groups', undefined]]));
    expect(writes.filter(write => write.path.length === 4).map(write => write.value.version)).toEqual([1, 1]);
    expect(planFeedWrites(owner, 'operation', [], new Map())).toEqual([]);
    expect(readHeadVersion(owner, collection, undefined)).toBe(0);
  });

  it('refuses duplicate effects, recursive head updates, unread heads, and exhausted sequences', () => {
    expect(() => planFeedWrites(owner, 'op', [snapshot('a'), snapshot('a')], new Map())).toThrow('invalid-change-feed');
    expect(() => planFeedWrites(owner, 'op', [snapshot('a', HEADS_COLLECTION)], new Map())).toThrow('invalid-change-feed');
    expect(() => planFeedWrites(owner, 'op', [snapshot('a')], new Map())).toThrow('missing-change-head');
    expect(() => planFeedWrites(owner, 'op', [snapshot('a')], new Map([[collection, head(Number.MAX_SAFE_INTEGER - 1)]]))).toThrow('change-feed-exhausted');
  });

  it.each([{ userId: 'foreign' }, { collection: 'groups' }, { version: -1 }, { version: 1.5 }, { _dataEngine: null }, { _dataEngine: {} }, { _dataEngine: { ...(head(1)._dataEngine as DocumentData), deleted: true } }] as DocumentData[])('rejects corrupted heads without resetting counters: %j', patch => {
    expect(() => readHeadVersion(owner, collection, { ...head(1), ...patch })).toThrow();
  });

  it('validates pointer collection, identifier, version, and stable sequence document id', () => {
    expect(parseChangePointer(collection, sequenceId(3), pointer(3))).toEqual(pointer(3));
    for (const malformed of [{ ...pointer(3), version: 2 }, { ...pointer(3), resource: { collection: 'groups', id: 'a' } }, { ...pointer(3), resource: { collection, id: 'bad/path' } }, { ...pointer(3), resource: { collection, id: '😀'.repeat(400) } }, { resource: null, version: 3 }]) {
      expect(parseChangePointer(collection, sequenceId(3), malformed)).toBeUndefined();
    }
  });
});

describe('bounded change page assembly', () => {
  it('returns current snapshots once for repeated pointers while advancing every consumed sequence', () => {
    const current = snapshot('a');
    expect(assembleChangePage(3, 0, [pointer(1, 'a'), pointer(2, 'a')], new Map([['a', current]]))).toEqual({ version: 3, cursor: 2, snapshots: [current], hasMore: true });
  });

  it('retains deletion tombstones in the feed', () => {
    const deleted: ResourceSnapshot = { ...snapshot('a'), value: null, metadata: { protocol: 1, generation: 'original', revision: 2, deleted: true } };
    expect(assembleChangePage(1, 0, [pointer(1, 'a')], new Map([['a', deleted]]))).toMatchObject({ cursor: 1, snapshots: [deleted], hasMore: false });
  });

  it('stops before response overflow at a contiguous pointer cursor', () => {
    const first = snapshot('a');
    const second = snapshot('b');
    const bytes = Buffer.byteLength(JSON.stringify(first));
    expect(assembleChangePage(3, 0, [pointer(1, 'a'), pointer(2, 'a'), pointer(3, 'b')], new Map([['a', first], ['b', second]]), bytes)).toEqual({ version: 3, cursor: 2, snapshots: [first], hasMore: true });
    expect(() => assembleChangePage(1, 0, [pointer(1, 'a')], new Map([['a', first]]), 1)).toThrow('change-document-too-large');
  });

  it.each([{ pointers: [pointer(2)] }, { pointers: [undefined] }, { pointers: [] }])('requests hydration when pointer history has a gap: %j', ({ pointers }) => {
    expect(assembleChangePage(3, 0, pointers, new Map())).toMatchObject({ cursor: 0, resetRequired: true });
  });

  it('requests hydration for a future cursor, impossible pointer, or hard-deleted document', () => {
    expect(assembleChangePage(2, 3, [], new Map())).toMatchObject({ version: 2, resetRequired: true });
    expect(assembleChangePage(0, 0, [pointer(1)], new Map())).toMatchObject({ resetRequired: true });
    expect(assembleChangePage(1, 0, [pointer(1, 'a')], new Map([['a', { ...snapshot('a'), value: null }]]))).toMatchObject({ resetRequired: true });
    expect(assembleChangePage(0, 0, [], new Map())).toEqual({ version: 0, cursor: 0, snapshots: [], hasMore: false });
  });
});
