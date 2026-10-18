/** @jest-environment node */
import { audioExportFirestore } from '../../test-utils/audioExportFirestore';

import { createAudioExportStore } from '@/data-engine/server';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: {} }));

const usage = { aiUsed: 3, audioSecondsUsed: 7, transcriptionSecondsUsed: 5, periodStart: '2026-10-01T00:00:00.000Z' };

describe('scoped operational audio storage', () => {
  it('writes usage atomically with receipts while preserving every profile and engine field', async () => {
    const io = audioExportFirestore();
    const profile = { displayName: 'Preserved', settings: { language: 'en' }, _dataEngine: { revision: 9 }, usage: { ...usage, aiUsed: 2 } };
    io.documents.set('users/owner', profile);
    const store = createAudioExportStore('owner', 'sermon', io.db);
    await store.transaction(async transaction => {
      expect(await transaction.readUsage()).toEqual(profile.usage);
      transaction.write({ kind: 'admission', exportId: 'export' }, { userId: 'owner', sermonId: 'sermon', aiCharged: true });
      transaction.writeUsage(usage);
    });
    expect(io.documents.get('users/owner')).toEqual({ ...profile, usage });
    expect(Object.keys(store).sort()).toEqual(['cacheKeys', 'read', 'readMany', 'sermonId', 'transaction', 'userId']);
    expect([...io.documents.keys()].filter(path => !path.startsWith('users/'))).toHaveLength(1);
  });

  it.each([
    { ...usage, displayName: 'overwrite' }, { ...usage, _dataEngine: { revision: 0 } },
    { ...usage, aiUsed: NaN }, { ...usage, audioSecondsUsed: -1 }, { ...usage, periodStart: 'invalid' },
    { ...usage, transcriptionSecondsUsed: undefined },
  ])('rejects untrusted usage fields and malformed counters: %j', async invalid => {
    const io = audioExportFirestore(); io.documents.set('users/owner', { displayName: 'Preserved', usage });
    const store = createAudioExportStore('owner', 'sermon', io.db);
    await expect(store.transaction(async transaction => transaction.writeUsage(invalid as never))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(io.documents.get('users/owner')).toEqual({ displayName: 'Preserved', usage });
  });

  it.each([
    { kind: 'cache', id: '../../users/foreign' }, { kind: 'admission', exportId: 'foreign/path' },
    { kind: 'settlement', exportId: 'valid', outputId: '../foreign' }, { kind: 'users', id: 'foreign' },
  ])('rejects paths and keys outside the operational namespace: %j', async key => {
    const io = audioExportFirestore(); const store = createAudioExportStore('owner', 'sermon', io.db);
    await expect(store.read(key as never)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(io.documents.size).toBe(0);
  });

  it('isolates owners and sermons and rejects foreign ownership in a stored receipt', async () => {
    const io = audioExportFirestore(); const store = createAudioExportStore('owner', 'sermon', io.db);
    await store.transaction(async transaction => transaction.write({ kind: 'head' }, { userId: 'owner', sermonId: 'sermon', value: 'private' }));
    expect(await createAudioExportStore('other', 'sermon', io.db).read({ kind: 'head' })).toBeUndefined();
    expect(await createAudioExportStore('owner', 'other', io.db).read({ kind: 'head' })).toBeUndefined();
    await expect(store.transaction(async transaction => transaction.write({ kind: 'head' }, { userId: 'other' }))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await store.read({ kind: 'head' })).toMatchObject({ value: 'private' });
  });

  it.each([
    { kind: 'head' }, { kind: 'admission', exportId: 'export' },
    { kind: 'settlement', exportId: 'export', outputId: 'output' }, { kind: 'cache', id: 'chunk-0' },
  ] as const)('isolates every key kind across sermons and owners: %j', async key => {
    const io = audioExportFirestore(); const store = createAudioExportStore('owner', 'sermon', io.db);
    await store.transaction(async transaction => transaction.write(key, { userId: 'owner', sermonId: 'sermon', value: 'private' }));
    expect(await store.read(key)).toMatchObject({ value: 'private' });
    expect(await createAudioExportStore('owner', 'other', io.db).read(key)).toBeUndefined();
    expect(await createAudioExportStore('other', 'sermon', io.db).read(key)).toBeUndefined();
  });

  it('never exposes a profile through a receipt key and restricts deletion to cache records', async () => {
    const io = audioExportFirestore(); const store = createAudioExportStore('owner', 'sermon', io.db);
    io.documents.set('users/owner', { displayName: 'Private', usage });
    await expect(store.transaction(async transaction => transaction.removeCache({ kind: 'head' } as never))).rejects.toMatchObject({ code: 'invalid-argument' });
    await store.transaction(async transaction => expect(await transaction.readUsage()).toEqual(usage));
    expect(await store.read({ kind: 'head' })).toBeUndefined();
    expect(io.documents.get('users/owner')!.displayName).toBe('Private');
  });
});
