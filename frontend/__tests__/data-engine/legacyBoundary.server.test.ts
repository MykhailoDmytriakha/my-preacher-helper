/** @jest-environment node */
import { deleteTag } from '@/api/clients/firestore.client';
import { SeriesRepository } from '@/api/repositories/series.repository';
import { adminDb } from '@/config/firebaseAdminConfig';
import { assertLegacyWritable, createLegacyDocument, deleteLegacyDocument, legacyBoundaryResponse, runLegacyTransaction, updateLegacyDocument } from '@/data-engine/legacyBoundary.server';

import type { DocumentReference } from 'firebase-admin/firestore';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { runTransaction: jest.fn(), collection: jest.fn() } }));
jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, options: { status: number }) => ({ body, status: options.status }) } }));
const ref = (id: string) => ({ path: `sermons/${id}` }) as DocumentReference;
const records = new Map<string, Record<string, unknown>>();
const marker = { protocol: 1, generation: 'g', revision: 1, deleted: false };
const snap = (reference: DocumentReference) => ({ ref: reference, exists: records.has(reference.path), data: () => records.get(reference.path) });
let beforeCommit: (() => void) | undefined;
let attempts = 0;
beforeEach(() => {
  jest.mocked(adminDb.collection).mockImplementation((collection: string) => {
    const filters: Array<[string, string, unknown]> = [];
    const query = {
      queryCollection: collection, filters, maximum: 1000,
      doc: (id: string) => ({ path: `${collection}/${id}`, id }),
      where: (field: string, operator: string, value: unknown) => { filters.push([field, operator, value]); return query; },
      limit: (maximum: number) => { query.maximum = maximum; return query; },
    };
    return query as never;
  });
  records.clear(); beforeCommit = undefined; attempts = 0;
  jest.mocked(adminDb.runTransaction).mockImplementation(async callback => {
    for (;;) {
      attempts++;
      const before = JSON.stringify([...records]);
      const writes = new Map<string, Record<string, unknown> | undefined>();
      const transaction = {
        get: async (reference: any) => {
          if (reference.queryCollection) {
            const docs = [...records].filter(([path, value]) => path.startsWith(`${reference.queryCollection}/`) && reference.filters.every(([field, operator, expected]: [string, string, unknown]) => operator === 'array-contains' ? (value[field] as unknown[])?.includes(expected) : value[field] === expected))
              .slice(0, reference.maximum).map(([path]) => ({ ...snap({ path } as DocumentReference), id: path.split('/')[1] }));
            return { docs, empty: docs.length === 0 };
          }
          return 'docs' in reference ? { docs: reference.docs.map(snap) } : snap(reference);
        },
        getAll: async (...refs: DocumentReference[]) => refs.map(snap),
        update: (reference: DocumentReference, patch: Record<string, unknown>) => writes.set(reference.path, { ...records.get(reference.path), ...patch }),
        set: (reference: DocumentReference, patch: Record<string, unknown>) => writes.set(reference.path, patch),
        create: (reference: DocumentReference, patch: Record<string, unknown>) => writes.set(reference.path, patch),
        delete: (reference: DocumentReference) => writes.set(reference.path, undefined),
      };
      const result = await callback(transaction as never);
      const transition = beforeCommit; beforeCommit = undefined; transition?.();
      if (before !== JSON.stringify([...records])) continue;
      for (const [path, value] of writes) { if (value) records.set(path, value); else records.delete(path); }
      return result;
    }
  });
});

describe('a collection closed to legacy writers', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  const council = (id: string) => ({ path: `councils/${id}` }) as DocumentReference;

  it('refuses update, delete and create of an UNMARKED document once the collection is closed', async () => {
    process.env.DATA_ENGINE_COLLECTIONS = 'councils';
    process.env.DATA_ENGINE_CLOSED_COLLECTIONS = 'councils';
    records.set('councils/legacy', { userId: 'owner', title: 'Never touched by the engine' });
    await expect(updateLegacyDocument(council('legacy'), { title: 'Old bundle' })).rejects.toMatchObject({ code: 'data-engine-required', status: 426 });
    await expect(deleteLegacyDocument(council('legacy'))).rejects.toMatchObject({ code: 'data-engine-required' });
    await expect(createLegacyDocument(council('fresh'), { userId: 'owner', title: 'Invisible to the feed' }, 'owner')).rejects.toMatchObject({ code: 'data-engine-required' });
    expect(records.get('councils/legacy')).toEqual({ userId: 'owner', title: 'Never touched by the engine' });
    expect(records.has('councils/fresh')).toBe(false);
  });

  it('leaves an open collection and every other collection writable, as before', async () => {
    process.env.DATA_ENGINE_COLLECTIONS = 'councils';
    records.set('councils/legacy', { userId: 'owner', title: 'Original' });
    await updateLegacyDocument(council('legacy'), { title: 'Old bundle, still welcome' });
    expect(records.get('councils/legacy')?.title).toBe('Old bundle, still welcome');
    process.env.DATA_ENGINE_CLOSED_COLLECTIONS = 'councils';
    records.set('sermons/a', { userId: 'owner', title: 'Original' });
    await updateLegacyDocument(ref('a'), { title: 'Another domain' });
    expect(records.get('sermons/a')?.title).toBe('Another domain');
  });

  it('ignores a closure that names a collection the engine does not serve', async () => {
    // Closing without serving would leave nobody able to write: a misconfiguration must not
    // become an outage.
    process.env.DATA_ENGINE_CLOSED_COLLECTIONS = 'councils';
    records.set('councils/legacy', { userId: 'owner', title: 'Original' });
    await updateLegacyDocument(council('legacy'), { title: 'Still writable' });
    expect(records.get('councils/legacy')?.title).toBe('Still writable');
  });
});

describe('atomic legacy boundary', () => {
  it.each([null, {}, marker, { ...marker, deleted: true }])('refuses any existing marker shape: %j', async metadata => {
    records.set('sermons/a', { userId: 'owner', title: 'Original', _dataEngine: metadata });
    await expect(updateLegacyDocument(ref('a'), { title: 'Legacy' })).rejects.toMatchObject({ code: 'data-engine-required', status: 426 });
    await expect(deleteLegacyDocument(ref('a'))).rejects.toMatchObject({ code: 'data-engine-required' });
    expect(records.get('sermons/a')?.title).toBe('Original');
  });
  it('preserves unmarked create/replay/update/delete and refuses a foreign create collision', async () => {
    const data = { userId: 'owner', title: 'Original' };
    expect(await createLegacyDocument(ref('a'), data, 'owner')).toEqual({ created: true, data });
    expect(await createLegacyDocument(ref('a'), { ...data, title: 'Replay' }, 'owner')).toEqual({ created: false, data });
    await expect(createLegacyDocument(ref('a'), data, 'other')).rejects.toMatchObject({ code: 'permission-denied' });
    await updateLegacyDocument(ref('a'), { title: 'Edited' }); expect(records.get('sermons/a')?.title).toBe('Edited');
    await deleteLegacyDocument(ref('a')); expect(records.size).toBe(0);
  });
  it.each([false, true])('forces engine transition between legacy read and commit (create: %s)', async create => {
    if (!create) records.set('sermons/a', { userId: 'owner', title: 'Original' });
    beforeCommit = () => records.set('sermons/a', { userId: 'owner', title: 'Engine version', _dataEngine: marker });
    const operation = create ? createLegacyDocument(ref('a'), { userId: 'owner', title: 'Old' }, 'owner') : updateLegacyDocument(ref('a'), { title: 'Old' });
    await expect(operation).rejects.toMatchObject({ code: 'data-engine-required' });
    expect(attempts).toBe(2); expect(records.get('sermons/a')?.title).toBe('Engine version');
  });
  it('rolls back earlier cascade writes when a later participant is protected', async () => {
    records.set('sermons/a', { title: 'First' }); records.set('sermons/b', { title: 'Second', _dataEngine: marker });
    await expect(runLegacyTransaction(async transaction => {
      await transaction.getAll(ref('a'), ref('b'));
      transaction.update(ref('a'), { title: 'Changed' }); transaction.delete(ref('b'));
    })).rejects.toMatchObject({ code: 'data-engine-required' });
    expect(records.get('sermons/a')?.title).toBe('First'); expect(records.size).toBe(2);
  });
  it('registers query targets and refuses more than 100 effects atomically', async () => {
    const refs = Array.from({ length: 101 }, (_, index) => ref(String(index)));
    for (const reference of refs) records.set(reference.path, {});
    await expect(runLegacyTransaction(async transaction => {
      await transaction.get({ docs: refs } as never);
      for (const reference of refs) transaction.delete(reference);
    })).rejects.toMatchObject({ code: 'data-engine-required' });
    expect(records.size).toBe(101);
  });
  it('requires transactional target reads before effects and forbids incoming markers', async () => {
    await expect(runLegacyTransaction(async transaction => { transaction.delete(ref('a')); })).rejects.toThrow('target read');
    await expect(runLegacyTransaction(async transaction => { await transaction.get(ref('a')); transaction.set(ref('a'), {}); await transaction.get(ref('b')); })).rejects.toThrow('precede writes');
    for (const patch of [{ _dataEngine: marker }, { '_dataEngine.revision': 9 }]) await expect(updateLegacyDocument(ref('a'), patch)).rejects.toMatchObject({ code: 'data-engine-required' });
    await expect(runLegacyTransaction(async transaction => { await transaction.get(ref('a')); transaction.update(ref('a'), '_dataEngine.revision', 9); })).rejects.toMatchObject({ code: 'data-engine-required' });
    expect(records.size).toBe(0);
  });
  it('refuses a migrated write with a status old bundles do not read as a conflict', () => {
    expect(() => assertLegacyWritable(undefined)).not.toThrow();
    expect(legacyBoundaryResponse(new Error('Other'))).toBeNull();
    try { assertLegacyWritable({ _dataEngine: null }); } catch (error) {
      expect(legacyBoundaryResponse(error)).toEqual({ status: 426, body: { code: 'data-engine-required', error: 'data-engine-required' } });
    }
  });
});


describe('legacy repository cascades are atomic', () => {
  const repository = new SeriesRepository();
  const items = [{ id: 's', type: 'sermon', refId: 'a', position: 1 }, { id: 'g', type: 'group', refId: 'g', position: 2 }];
  const seedSeries = () => {
    records.set('series/list', { userId: 'owner', items, sermonIds: ['a'] });
    records.set('sermons/a', { userId: 'owner', title: 'Keep', seriesId: 'list' });
    records.set('groups/g', { userId: 'owner', seriesId: 'list' });
  };
  it('detaches mixed members and deletes the series in one transaction', async () => {
    seedSeries(); await repository.deleteSeriesAndDetach('list', 'owner');
    expect(records.has('series/list')).toBe(false);
    expect(records.get('sermons/a')).toMatchObject({ title: 'Keep', seriesId: null });
    expect(records.get('groups/g')?.seriesId).toBeNull();
  });
  it.each(['series/list', 'sermons/a', 'groups/g'])('refuses the entire cascade when %s is migrated', async path => {
    seedSeries(); records.set(path, { ...records.get(path), _dataEngine: marker });
    const original = JSON.stringify([...records]);
    await expect(repository.deleteSeriesAndDetach('list', 'owner')).rejects.toMatchObject({ code: 'data-engine-required' });
    expect(JSON.stringify([...records])).toBe(original);
  });
  it('preserves foreign and reassigned backrefs and supports legacy sermonIds', async () => {
    seedSeries(); records.set('series/list', { userId: 'owner', sermonIds: ['a'], items: [] });
    records.set('sermons/a', { userId: 'other', seriesId: 'list', _dataEngine: marker });
    await repository.deleteSeriesAndDetach('list', 'owner');
    expect(records.get('sermons/a')?.seriesId).toBe('list');
    seedSeries(); records.set('sermons/a', { userId: 'owner', seriesId: 'new-list' });
    await repository.deleteSeriesAndDetach('list', 'owner');
    expect(records.get('sermons/a')?.seriesId).toBe('new-list');
  });
  it('refuses oversized series rather than deleting with partial cleanup', async () => {
    records.set('series/list', { userId: 'owner', sermonIds: Array.from({ length: 100 }, (_, index) => String(index)) });
    await expect(repository.deleteSeriesAndDetach('list', 'owner')).rejects.toMatchObject({ code: 'data-engine-required' });
    expect(records.has('series/list')).toBe(true);
  });
  it('removes tag references atomically and preserves untouched thoughts', async () => {
    records.set('tags/tag', { userId: 'owner', name: 'Topic' });
    records.set('sermons/a', { userId: 'owner', thoughts: [{ id: 'a', text: 'Keep', tags: ['Topic', 'Other'] }, { id: 'b', text: 'No tags' }] });
    expect(await deleteTag('owner', 'Topic')).toEqual({ affectedThoughts: 1 });
    expect(records.has('tags/tag')).toBe(false);
    expect(records.get('sermons/a')?.thoughts).toEqual([{ id: 'a', text: 'Keep', tags: ['Other'] }, { id: 'b', text: 'No tags' }]);
  });
  it.each(['tags/tag', 'sermons/a'])('keeps tag and every reference if %s is protected', async path => {
    records.set('tags/tag', { userId: 'owner', name: 'Topic' });
    records.set('sermons/a', { userId: 'owner', thoughts: [{ id: 'a', tags: ['Topic'] }] });
    records.set(path, { ...records.get(path), _dataEngine: marker });
    const original = JSON.stringify([...records]);
    await expect(deleteTag('owner', 'Topic')).rejects.toMatchObject({ code: 'data-engine-required' });
    expect(JSON.stringify([...records])).toBe(original);
  });
});
