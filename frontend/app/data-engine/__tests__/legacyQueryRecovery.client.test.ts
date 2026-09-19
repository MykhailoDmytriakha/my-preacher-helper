import { createStore, get } from 'idb-keyval';

import { listLegacyQueryCopies, preserveLegacyQueryCache } from '../legacyQueryRecovery.client';

import { installStorageHarness } from './storageHarness';

jest.mock('idb-keyval', () => ({ createStore: jest.fn(), get: jest.fn() }));
const council = (owner = 'owner', title = 'Unsent decision') => ({ id: 'council', userId: owner, title, topics: [{ id: 'topic', decision: title }], unknownField: { keep: true } });
const cached = (data = [council()], owner = 'owner', savedAt = 10) => ({
  timestamp: 1, buster: 'expired-version',
  clientState: { queries: [{ queryKey: ['councils', owner], state: { data, dataUpdatedAt: savedAt } }] },
});
const enabled = (collection: string) => collection === 'councils';

describe('legacy query input preservation', () => {
  let disk: ReturnType<typeof installStorageHarness>;
  beforeEach(() => { disk = installStorageHarness(); jest.mocked(get).mockResolvedValue(cached()); });
  it('archives even expired cache before any query hydration, preserving full unknown fields', async () => {
    await preserveLegacyQueryCache(enabled);
    const [copy] = await listLegacyQueryCopies('owner');
    expect(JSON.parse(copy.raw)).toEqual(council());
    expect(copy).toMatchObject({ collection: 'councils', documentId: 'council', savedAt: 10 });
    expect(await listLegacyQueryCopies('other')).toEqual([]);
  });
  it('is idempotent across reloads and timestamps but retains a distinct later or stale-tab copy', async () => {
    await preserveLegacyQueryCache(enabled);
    jest.mocked(get).mockResolvedValue(cached([council()], 'owner', 20));
    await preserveLegacyQueryCache(enabled);
    expect(await listLegacyQueryCopies('owner')).toHaveLength(1);
    jest.mocked(get).mockResolvedValue(cached([council('owner', 'Different draft')]));
    await preserveLegacyQueryCache(enabled);
    const copies = await listLegacyQueryCopies('owner');
    expect(copies.map(copy => JSON.parse(copy.raw).title)).toEqual(['Unsent decision', 'Different draft']);
    expect(new Set(copies.map(copy => copy.id)).size).toBe(2);
  });
  it('accepts only the known owner-scoped key and matching document ownership', async () => {
    jest.mocked(get).mockResolvedValue(cached([council('other')]));
    await preserveLegacyQueryCache(enabled);
    expect(await listLegacyQueryCopies('owner')).toEqual([]);
    expect(await listLegacyQueryCopies('other')).toEqual([]);
    jest.mocked(get).mockResolvedValue({ clientState: { queries: [{ queryKey: ['councils'], state: { data: [council()] } }] } });
    await preserveLegacyQueryCache(enabled);
    expect(await listLegacyQueryCopies('owner')).toEqual([]);
  });
  it('rolls back on storage failure so a retry can preserve the original input', async () => {
    disk.writeFailure = true;
    await expect(preserveLegacyQueryCache(enabled)).rejects.toThrow('disk full');
    expect(disk.rows.size).toBe(0);
    disk.writeFailure = false;
    await preserveLegacyQueryCache(enabled);
    expect(await listLegacyQueryCopies('owner')).toHaveLength(1);
  });
  it('does no storage work for inactive domains', async () => {
    jest.mocked(get).mockClear(); jest.mocked(createStore).mockClear();
    await preserveLegacyQueryCache(() => false);
    expect(get).not.toHaveBeenCalled(); expect(createStore).not.toHaveBeenCalled();
  });
});
