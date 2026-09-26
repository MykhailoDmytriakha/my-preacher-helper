import { createStore, get } from 'idb-keyval';

import { compareLegacyCopy, listLegacyQueryCopies, preserveLegacyQueryCache, removeLegacyCopies, retireLegacyEchoes } from '../legacyQueryRecovery.client';

import { deriveSermonIdsFromItems, inferSeriesKind, normalizeSeriesItems } from '@/utils/seriesItems';

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

describe('retiring copies proven to be echoes of the server', () => {
  const key = (collection: string, documentId: string, owner = 'owner') => JSON.stringify(['legacy-query', owner, collection, documentId]);
  const copy = (collection: string, documentId: string, index: number, raw: unknown, owner = 'owner') => ({
    id: JSON.stringify(['legacy-query', owner, collection, documentId, index]), owner, collection, documentId,
    title: 'Copy', raw: JSON.stringify(raw, null, 2), savedAt: 10,
  });
  const server = (copies: Record<string, Record<string, unknown> | null>) =>
    async (collection: string, documentId: string) => copies[`${collection}/${documentId}`];

  it('retires a row that says exactly what the server says, bookkeeping aside', async () => {
    const disk = installStorageHarness();
    const stored = { id: 'c1', userId: 'owner', title: 'Decided', topics: [{ id: 't', decision: 'Yes', updatedAt: 'later' }], rev: { council: 4 } };
    disk.rows.set(key('councils', 'c1'), [copy('councils', 'c1', 0, { ...stored, updatedAt: 'old', rev: { council: 3 }, topics: [{ id: 't', decision: 'Yes' }] })]);
    expect(await retireLegacyEchoes('owner', server({ 'councils/c1': stored }))).toEqual({ retired: 1, undecided: 0 });
    expect(disk.rows.has(key('councils', 'c1'))).toBe(false);
  });

  it('keeps a council row whose text the server never received', async () => {
    const disk = installStorageHarness();
    const unsent = copy('councils', 'c1', 0, { id: 'c1', userId: 'owner', title: 'Decided', topics: [{ id: 't', decision: 'Refused edit' }] });
    disk.rows.set(key('councils', 'c1'), [unsent]);
    const result = await retireLegacyEchoes('owner', server({ 'councils/c1': { id: 'c1', userId: 'owner', title: 'Decided', topics: [{ id: 't', decision: 'Yes' }] } }));
    expect(result).toEqual({ retired: 0, undecided: 0 });
    expect(await listLegacyQueryCopies('owner')).toEqual([unsent]);
  });

  it('reads both sides through the previous version\'s lens: sermon aliases and rebuilt series fields', async () => {
    const disk = installStorageHarness();
    const structure = { introduction: ['a'], main: [], conclusion: [], ambiguous: [] };
    const plan = { introduction: { outline: 'Intro' } };
    disk.rows.set(key('sermons', 's1'), [copy('sermons', 's1', 0, { id: 's1', userId: 'owner', title: 'T', structure, thoughtsBySection: structure, plan, draft: plan })]);
    const items = normalizeSeriesItems(undefined, ['s1']);
    disk.rows.set(key('series', 'x1'), [copy('series', 'x1', 0, { id: 'x1', userId: 'owner', title: 'S', sermonIds: deriveSermonIdsFromItems(items), items, seriesKind: inferSeriesKind(items) })]);
    const result = await retireLegacyEchoes('owner', server({
      'sermons/s1': { id: 's1', userId: 'owner', title: 'T', structure, plan },
      'series/x1': { id: 'x1', userId: 'owner', title: 'S', sermonIds: ['s1'] },
    }));
    expect(result).toEqual({ retired: 2, undecided: 0 });
    expect(disk.rows.size).toBe(0);
  });

  it('keeps rows it cannot compare yet, rows of documents deleted on the server, operations and unreadable copies', async () => {
    const disk = installStorageHarness();
    const row = { id: 'g1', userId: 'owner', title: 'Group' };
    const operation = { mutationKey: ['groups', 'update'], state: { isPaused: true, variables: { id: 'g1', userId: 'owner', updates: { title: 'Group' } } } };
    disk.rows.set(key('groups', 'g1'), [copy('groups', 'g1', 0, operation), { ...copy('groups', 'g1', 1, row), raw: '{not json' }]);
    disk.rows.set(key('groups', 'g2'), [copy('groups', 'g2', 0, { ...row, id: 'g2' })]);
    disk.rows.set(key('groups', 'g3'), [copy('groups', 'g3', 0, { ...row, id: 'g3' })]);
    const result = await retireLegacyEchoes('owner', server({ 'groups/g1': row, 'groups/g3': null }));
    expect(result).toEqual({ retired: 0, undecided: 1 });
    expect(await listLegacyQueryCopies('owner')).toHaveLength(4);
  });

  it('removes only the echo from a document that also holds an unsent copy, and files a later copy under a fresh id', async () => {
    const disk = installStorageHarness();
    const stored = { id: 'c1', userId: 'owner', title: 'Server' };
    const unsent = copy('councils', 'c1', 1, { ...stored, title: 'Unsent' });
    disk.rows.set(key('councils', 'c1'), [copy('councils', 'c1', 0, stored), unsent]);
    await retireLegacyEchoes('owner', server({ 'councils/c1': stored }));
    expect(disk.rows.get(key('councils', 'c1'))).toEqual([unsent]);
    jest.mocked(get).mockResolvedValue({ clientState: { queries: [{ queryKey: ['councils', 'owner'], state: { data: [{ ...stored, title: 'Later' }] } }] } });
    await preserveLegacyQueryCache(collection => collection === 'councils');
    const copies = await listLegacyQueryCopies('owner');
    expect(copies.map(entry => JSON.parse(entry.raw).title)).toEqual(['Unsent', 'Later']);
    expect(new Set(copies.map(entry => entry.id)).size).toBe(2);
  });

  it('never touches another account, a misfiled group, or anything when storage fails', async () => {
    const disk = installStorageHarness();
    const stored = { id: 'c1', userId: 'owner', title: 'Server' };
    disk.rows.set(key('councils', 'c1', 'other'), [copy('councils', 'c1', 0, { ...stored, userId: 'other' }, 'other')]);
    const misfiled = { ...copy('councils', 'c2', 0, { ...stored, id: 'c2' }), id: JSON.stringify(['legacy-query', 'someone-else', 'councils', 'c2', 0]) };
    disk.rows.set(key('councils', 'c2'), [misfiled]);
    const unsent = copy('councils', 'c3', 1, { ...stored, id: 'c3', title: 'Unsent' });
    disk.rows.set(key('councils', 'c3'), [copy('councils', 'c3', 0, { ...stored, id: 'c3' }), unsent]);
    const everything = server({ 'councils/c1': stored, 'councils/c2': { ...stored, id: 'c2' }, 'councils/c3': { ...stored, id: 'c3' } });
    disk.writeFailure = true;
    await expect(retireLegacyEchoes('owner', everything)).rejects.toThrow('disk full');
    expect(await listLegacyQueryCopies('owner')).toHaveLength(3);
    disk.writeFailure = false;
    expect(await retireLegacyEchoes('owner', everything)).toEqual({ retired: 1, undecided: 0 });
    expect(disk.rows.has(key('councils', 'c1', 'other'))).toBe(true);
    expect(disk.rows.get(key('councils', 'c2'))).toEqual([misfiled]);
    expect(disk.rows.get(key('councils', 'c3'))).toEqual([unsent]);
  });

  it('removes a decided echo only while its stored content is still the one it compared', async () => {
    const disk = installStorageHarness();
    const stored = { id: 'c1', userId: 'owner', title: 'Server' };
    disk.rows.set(key('councils', 'c1'), [copy('councils', 'c1', 0, stored)]);
    // Another tab retires the same echo meanwhile, and a later start files a refused edit under the freed id.
    const refused = copy('councils', 'c1', 0, { ...stored, title: 'Refused edit' });
    const slow = async () => { disk.rows.set(key('councils', 'c1'), [refused]); return stored; };
    expect(await retireLegacyEchoes('owner', slow)).toEqual({ retired: 0, undecided: 0 });
    expect(disk.rows.get(key('councils', 'c1'))).toEqual([refused]);
  });

  it('treats an unreadable server copy as undecided and still retires the others', async () => {
    const disk = installStorageHarness();
    const stored = { id: 'c1', userId: 'owner', title: 'Server' };
    disk.rows.set(key('councils', 'c1'), [copy('councils', 'c1', 0, stored)]);
    disk.rows.set(key('councils', 'c2'), [copy('councils', 'c2', 0, { ...stored, id: 'c2' })]);
    const reader = async (collection: string, documentId: string) => {
      if (documentId === 'c1') throw new Error('snapshot unreadable');
      return { ...stored, id: documentId };
    };
    expect(await retireLegacyEchoes('owner', reader)).toEqual({ retired: 1, undecided: 1 });
    expect(disk.rows.has(key('councils', 'c1'))).toBe(true);
  });

  it('reads the server copy once per document however many cached copies it has', async () => {
    const disk = installStorageHarness();
    const stored = { id: 's1', userId: 'owner', title: 'T' };
    disk.rows.set(key('sermons', 's1'), [copy('sermons', 's1', 0, stored), copy('sermons', 's1', 1, { ...stored, title: 'Other' }), copy('sermons', 's1', 2, stored)]);
    const reader = jest.fn(async () => stored);
    await retireLegacyEchoes('owner', reader);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('lists around a damaged group instead of failing the whole archive', async () => {
    const disk = installStorageHarness();
    disk.rows.set(key('councils', 'c1'), { not: 'an array' });
    disk.rows.set(key('councils', 'c2'), [copy('councils', 'c2', 0, { id: 'c2', userId: 'owner' })]);
    expect(await listLegacyQueryCopies('owner')).toHaveLength(1);
  });
});

describe('comparing a copy with the server for the person', () => {
  const copyOf = (raw: unknown, collection = 'sermons', savedAt: number | null = Date.UTC(2026, 8, 1)) => ({
    id: JSON.stringify(['legacy-query', 'owner', collection, 's1', 0]), owner: 'owner', collection, documentId: 's1', title: 'T',
    raw: typeof raw === 'string' ? raw : JSON.stringify(raw), savedAt,
  });

  it('names the newer side by each document\'s own update time and lists only differing fields', () => {
    const device = { id: 's1', userId: 'owner', title: 'T', verse: 'John 1', updatedAt: '2026-09-03T00:00:00.000Z', rev: { core: 2 } };
    const server = { id: 's1', userId: 'owner', title: 'T', verse: 'John 3', updatedAt: '2026-09-15T00:00:00.000Z', rev: { core: 5 } };
    const result = compareLegacyCopy(copyOf(device), server);
    expect(result).toMatchObject({ kind: 'row', server: 'present', freshness: 'server-newer',
      deviceVersionAt: '2026-09-03T00:00:00.000Z', serverVersionAt: '2026-09-15T00:00:00.000Z' });
    expect(result.differences).toEqual([{ field: 'verse', device: 'John 1', server: 'John 3' }]);
    expect(compareLegacyCopy(copyOf({ ...device, updatedAt: '2026-09-20T00:00:00.000Z' }), server).freshness).toBe('device-newer');
    expect(compareLegacyCopy(copyOf({ ...device, updatedAt: server.updatedAt }), server).freshness).toBe('same-version');
  });

  it('does not report the previous version\'s read aliases as differences', () => {
    const structure = { introduction: ['a'] };
    const result = compareLegacyCopy(copyOf({ id: 's1', title: 'T', structure, thoughtsBySection: structure }), { id: 's1', title: 'T', structure });
    expect(result.differences).toEqual([]);
  });

  it('falls back to when this device saved the copy, and to unknown without either date', () => {
    const saved = compareLegacyCopy(copyOf({ id: 's1', title: 'A' }), { id: 's1', title: 'B', updatedAt: '2026-09-15T00:00:00.000Z' });
    expect(saved).toMatchObject({ deviceVersionAt: '2026-09-01T00:00:00.000Z', freshness: 'server-newer' });
    // When the device last saved its cache proves the server changed after that — never that the device changed later.
    expect(compareLegacyCopy(copyOf({ id: 's1', title: 'A' }), { id: 's1', title: 'B', updatedAt: '2026-08-15T00:00:00.000Z' }).freshness).toBe('unknown');
    expect(compareLegacyCopy(copyOf({ id: 's1', title: 'A' }, 'sermons', null), { id: 's1', title: 'B' }).freshness).toBe('unknown');
  });

  it('tells operations, unreadable copies, missing and deleted server copies apart', () => {
    const operation = { mutationKey: ['series', 'update'], state: { isPaused: true, variables: {} } };
    expect(compareLegacyCopy(copyOf(operation, 'series'), { id: 's1' })).toMatchObject({ kind: 'operation', differences: [] });
    expect(compareLegacyCopy(copyOf('{broken'), undefined)).toMatchObject({ kind: 'unreadable', server: 'missing' });
    expect(compareLegacyCopy(copyOf({ id: 's1', title: 'A' }), null)).toMatchObject({ kind: 'row', server: 'deleted', differences: [] });
  });

  it('shows a sermon alias that drifted from its field, so a copy kept for it never shows an empty diff', () => {
    const current = { main: ['new order'] }, stale = { main: ['old order'] };
    const result = compareLegacyCopy(copyOf({ id: 's1', title: 'T', structure: current, thoughtsBySection: stale }), { id: 's1', title: 'T', structure: current });
    expect(result.differences).toEqual([{ field: 'thoughtsBySection', device: stale, server: current }]);
  });

  it('shows a sermon alias difference once, under its current name', () => {
    const result = compareLegacyCopy(copyOf({ id: 's1', title: 'T', structure: { main: ['a'] } }), { id: 's1', title: 'T', structure: { main: ['b'] } });
    expect(result.differences.map(entry => entry.field)).toEqual(['structure']);
  });

  it('compares a malformed cached series as stored instead of failing', () => {
    const broken = copyOf({ id: 's1', title: 'S', sermonIds: 'not-a-list', items: 'nope' }, 'series');
    expect(() => compareLegacyCopy(broken, { id: 's1', title: 'S', sermonIds: ['x'] })).not.toThrow();
  });

  it('removes a chosen copy only while its id and content still match', async () => {
    const disk = installStorageHarness();
    const kept = copyOf({ id: 's1', title: 'Other' });
    const chosen = { ...copyOf({ id: 's1', title: 'Chosen' }), id: JSON.stringify(['legacy-query', 'owner', 'sermons', 's1', 1]) };
    disk.rows.set(JSON.stringify(['legacy-query', 'owner', 'sermons', 's1']), [kept, chosen]);
    expect(await removeLegacyCopies('owner', [{ id: chosen.id, raw: '{"changed":true}' }])).toBe(0);
    expect(await removeLegacyCopies('owner', [{ id: chosen.id, raw: chosen.raw }])).toBe(1);
    expect(await listLegacyQueryCopies('owner')).toEqual([kept]);
  });
});
