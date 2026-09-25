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

it('preserves all known group cache shapes with ownership from the correct source', async () => {
  installStorageHarness();
  const group = { id: 'g', userId: 'owner', title: 'List', flow: [], meetingDates: [] };
  jest.mocked(get).mockResolvedValue({ clientState: { queries: [
    { queryKey: ['groups', 'owner'], state: { data: [group] } },
    { queryKey: ['group-detail', 'g'], state: { data: { ...group, title: 'Detail', unknown: 'keep' } } },
    { queryKey: ['calendarGroups', 'owner', 'start', 'end'], state: { data: [{ ...group, title: 'Calendar' }] } },
    { queryKey: ['group-detail', 'mismatch'], state: { data: { ...group, title: 'Do not copy' } } },
    { queryKey: ['groups', 'different-owner'], state: { data: [group] } },
  ] } });
  await preserveLegacyQueryCache(collection => collection === 'groups');
  const copies = await listLegacyQueryCopies('owner');
  expect(copies.map(copy => JSON.parse(copy.raw).title)).toEqual(['List', 'Detail', 'Calendar']);
  expect(copies.map(copy => copy.collection)).toEqual(['groups', 'groups', 'groups']);
  expect(await listLegacyQueryCopies('different-owner')).toEqual([]);
  expect(JSON.parse(copies[1].raw).unknown).toBe('keep');
});

it('archives paused and failed mutation variables even when queries have expired or rolled back', async () => {
  installStorageHarness();
  const mutation = (operation: string, variables: unknown) => ({ mutationKey: ['groups', operation], state: { variables, status: 'error', submittedAt: 15, isPaused: false } });
  const create = mutation('create', { userId: 'owner', title: 'Only in a mutation', templates: [{ id: 't', content: 'preserve' }] });
  const update = mutation('update', { id: 'g', userId: 'owner', updates: { title: 'Refused title' }, expectedBaseline: { title: 'Opening' } });
  jest.mocked(get).mockResolvedValue({ clientState: { mutations: [create, update, mutation('create', { userId: 'other', title: 'Private' })] } });
  await preserveLegacyQueryCache(collection => collection === 'groups');
  const copies = await listLegacyQueryCopies('owner');
  expect(copies.map(copy => JSON.parse(copy.raw))).toEqual([create, update]);
  expect(copies.every(copy => copy.savedAt === 15)).toBe(true);
  expect(await listLegacyQueryCopies('other')).toHaveLength(1);
  await preserveLegacyQueryCache(collection => collection === 'groups');
  expect(await listLegacyQueryCopies('owner')).toHaveLength(2);
});

it('attributes old ownerless deletes only from a unique cached owner, quarantining ambiguous intent', async () => {
  const disk = installStorageHarness();
  const removed = (id: string) => ({ mutationKey: ['groups', 'delete'], state: { variables: id, isPaused: true } });
  jest.mocked(get).mockResolvedValue({ clientState: {
    queries: [{ queryKey: ['groups', 'owner'], state: { data: [{ id: 'known', userId: 'owner', title: 'Known' }] } }],
    mutations: [removed('known'), removed('unknown')],
  } });
  await preserveLegacyQueryCache(collection => collection === 'groups');
  expect((await listLegacyQueryCopies('owner')).map(copy => copy.documentId)).toEqual(['known', 'known']);
  expect(await listLegacyQueryCopies('other')).toEqual([]);
  expect(await listLegacyQueryCopies('')).toEqual([]);
  expect(JSON.stringify([...disk.rows.values()])).toContain('unknown');
});

it('preserves series lists, detail documents and pending mutation inputs before hydration', async () => {
  const disk = installStorageHarness();
  const series = { id: 's', userId: 'owner', title: 'List', items: [], unknownField: { keep: true } };
  const mutation = (op: string, variables: unknown) => ({ mutationKey: ['series', op], state: { variables, isPaused: true, submittedAt: 20 } });
  const update = mutation('update', { seriesId: 's', userId: 'owner', updates: { title: 'Pending text' }, expectedBaseline: { title: 'Opening' } });
  const removed = mutation('delete', 's');
  jest.mocked(get).mockResolvedValue({ clientState: { queries: [
    { queryKey: ['series', 'owner'], state: { data: [series] } },
    { queryKey: ['series-detail', 's'], state: { data: { series: { ...series, title: 'Detail' }, items: [] } } },
    { queryKey: ['series-detail', 'wrong'], state: { data: { series } } },
  ], mutations: [update, removed, mutation('create', { userId: 'other', title: 'Private' }), mutation('delete', 'unknown')] } });
  await preserveLegacyQueryCache(collection => collection === 'series');
  const copies = await listLegacyQueryCopies('owner');
  expect(copies.map(copy => JSON.parse(copy.raw))).toEqual([series, { ...series, title: 'Detail' }, update, removed]);
  expect(copies.every(copy => copy.collection === 'series')).toBe(true);
  expect(await listLegacyQueryCopies('other')).toHaveLength(1);
  expect(JSON.stringify([...disk.rows.values()])).toContain('unknown');
  await preserveLegacyQueryCache(collection => collection === 'series'); expect(await listLegacyQueryCopies('owner')).toHaveLength(4);
});


it('archives sermon list, owner-scoped detail, calendar and every paused dashboard operation without inferring a fresh baseline', async () => {
  installStorageHarness();
  const sermon = { id: 's', userId: 'owner', title: 'List', scratch: [{ text: 'private draft' }] };
  const operations = ['create', 'update', 'delete', 'markPreached', 'unmarkPreached', 'savePreachDate'];
  const mutations = operations.map(operation => ({ mutationKey: ['dashboardSermons', operation], state: { isPaused: true,
    variables: { uid: 'owner', sermonId: 's', input: { title: operation, seriesId: 'series' }, expectedRevision: 7 } } }));
  jest.mocked(get).mockResolvedValue({ clientState: { queries: [
    { queryKey: ['sermons', 'owner'], state: { data: [sermon] } },
    { queryKey: ['sermon', 'owner', 's'], state: { data: { ...sermon, title: 'Detail' } } },
    { queryKey: ['calendarSermons', 'owner', 'start', 'end'], state: { data: [{ ...sermon, title: 'Calendar' }] } },
    { queryKey: ['sermon', 'other', 's'], state: { data: { ...sermon, title: 'Wrong owner' } } },
    { queryKey: ['sermon', 'owner', 'wrong'], state: { data: { ...sermon, title: 'Wrong ID' } } },
  ], mutations } });
  await preserveLegacyQueryCache(collection => collection === 'sermons');
  const copies = await listLegacyQueryCopies('owner');
  expect(copies.map(copy => JSON.parse(copy.raw))).toEqual([sermon, { ...sermon, title: 'Detail' }, { ...sermon, title: 'Calendar' }, ...mutations]);
  expect(await listLegacyQueryCopies('other')).toEqual([]);
  await preserveLegacyQueryCache(collection => collection === 'sermons');
  expect(await listLegacyQueryCopies('owner')).toHaveLength(9);
});

describe('which legacy queries the persisted cache may keep', () => {
  const { isEngineOwnedLegacyQuery } = jest.requireActual('../legacyQueryRecovery.client') as typeof import('../legacyQueryRecovery.client');
  const onEngine = (collection: string) => collection === 'sermons';

  it('keeps an engine-owned collection out of the persisted cache so it is not archived again on the next start', () => {
    expect(isEngineOwnedLegacyQuery(['sermon', 'owner', 'sermon-1'], onEngine)).toBe(true);
    expect(isEngineOwnedLegacyQuery(['calendarSermons', 'owner', 'a', 'b'], onEngine)).toBe(true);
  });

  it('leaves collections still on the legacy road and unrelated queries persisted', () => {
    expect(isEngineOwnedLegacyQuery(['groups', 'owner'], onEngine)).toBe(false);
    expect(isEngineOwnedLegacyQuery(['userSettings', 'owner'], onEngine)).toBe(false);
  });
});
