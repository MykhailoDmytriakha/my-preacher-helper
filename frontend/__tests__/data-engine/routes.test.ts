/** @jest-environment node */
import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { GET as changes } from '@/api/data-engine/changes/[collection]/route';
import { GET as list } from '@/api/data-engine/collections/[collection]/route';
import { POST } from '@/api/data-engine/commands/route';
import { GET as assemblyHistory } from '@/api/data-engine/documents/[collection]/[id]/assembly-history/route';
import { GET as topicOutcomeHistory } from '@/api/data-engine/documents/[collection]/[id]/topic-outcome-history/route';
import { GET as topicKindHistory } from '@/api/data-engine/documents/[collection]/[id]/topic-kind-history/route';
import { GET as topicTitleHistory } from '@/api/data-engine/documents/[collection]/[id]/topic-title-history/route';
import { GET as stepFlagHistory } from '@/api/data-engine/documents/[collection]/[id]/step-flag-history/route';
import { GET as stepTitleHistory } from '@/api/data-engine/documents/[collection]/[id]/step-title-history/route';
import { GET as markHistory } from '@/api/data-engine/documents/[collection]/[id]/mark-history/route';
import { GET as meetingFieldHistory } from '@/api/data-engine/documents/[collection]/[id]/meeting-field-history/route';
import { GET as meetingHistory } from '@/api/data-engine/documents/[collection]/[id]/meeting-date-history/route';
import { GET as preachStatusHistory } from '@/api/data-engine/documents/[collection]/[id]/preach-status-history/route';
import { GET as detailHistory } from '@/api/data-engine/documents/[collection]/[id]/preach-date-field-history/route';
import { GET as history } from '@/api/data-engine/documents/[collection]/[id]/preach-date-history/route';
import { GET as read } from '@/api/data-engine/documents/[collection]/[id]/route';
import { GET as statusHistory } from '@/api/data-engine/documents/[collection]/[id]/status-history/route';
import { GET as membershipHistory } from '@/api/data-engine/documents/[collection]/[id]/series-membership-history/route';
import { GET as seriesHistory } from '@/api/data-engine/documents/[collection]/[id]/metadata-history/route';
import { GET as churchHistory } from '@/api/data-engine/documents/[collection]/[id]/church-history/route';
import { GET as verseHistory } from '@/api/data-engine/documents/[collection]/[id]/verse-history/route';
import { GET as noteTypeHistory } from '@/api/data-engine/documents/[collection]/[id]/type-history/route';
import { GET as titleHistory } from '@/api/data-engine/documents/[collection]/[id]/title-history/route';
import { ENGINE_OWNED_COLLECTIONS } from '@/data-engine/engineOwnedCollections';
import { listCouncilAssemblyHistory, listCouncilOutcomeHistory, listCouncilTopicKindHistory, listCouncilTopicTitleHistory, listStudyNoteTypeHistory, listServiceOrderFlagHistory, listServiceOrderStepTitleHistory } from '@/data-engine/server';
import { assertDataEngineEnabled, DataEngineServerError, listBibleMarkHistory, listCouncilMetadataHistory, listDocuments, listGroupMeetingFieldHistory, listGroupStatusHistory, listGroupTitleHistory, listMeetingDateHistory, listPreachDateFieldHistory, listPreachDateHistory, listPreachStatusHistory, listSermonChurchHistory, listSermonTitleHistory, listSermonVerseHistory, listSeriesMembershipHistory, listSeriesMetadataHistory, listServiceOrderTitleHistory, processCommand, readCollectionChanges, readCommandBody, readDocument } from '@/data-engine/server';
import { __resetStoreAvailabilityForTests } from '@/services/storeAvailability.server';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: {} }));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn() }));
jest.mock('@/data-engine/server', () => ({
  ...jest.requireActual('@/data-engine/server'),
  processCommand: jest.fn(),
  readCommandBody: jest.fn(),
  readDocument: jest.fn(),
  assertDataEngineEnabled: jest.fn(jest.requireActual('@/data-engine/server').assertDataEngineEnabled),
  listBibleMarkHistory: jest.fn(),
  listCouncilAssemblyHistory: jest.fn(),
  listCouncilTopicKindHistory: jest.fn(),
  listCouncilOutcomeHistory: jest.fn(),
  listStudyNoteTypeHistory: jest.fn(),
  listCouncilTopicTitleHistory: jest.fn(),
  listServiceOrderFlagHistory: jest.fn(),
  listServiceOrderStepTitleHistory: jest.fn(),
  listDocuments: jest.fn(),
  listPreachDateHistory: jest.fn(),
  listPreachDateFieldHistory: jest.fn(),
  listPreachStatusHistory: jest.fn(),
  listMeetingDateHistory: jest.fn(),
  listGroupMeetingFieldHistory: jest.fn(),
  listServiceOrderTitleHistory: jest.fn(),
  listSermonTitleHistory: jest.fn(),
  listSermonVerseHistory: jest.fn(),
  listSermonChurchHistory: jest.fn(),
  listSeriesMembershipHistory: jest.fn(),
  listSeriesMetadataHistory: jest.fn(),
  listCouncilMetadataHistory: jest.fn(),
  listGroupTitleHistory: jest.fn(),
  listGroupStatusHistory: jest.fn(),
  readCollectionChanges: jest.fn(),
}));

const documentContext = { params: Promise.resolve({ collection: 'sermons', id: 'sermon-1' }) };
const listContext = { params: Promise.resolve({ collection: 'sermons' }) };
const request = (url = 'http://localhost/api/data-engine/commands'): Request => ({ url, headers: new Headers() } as Request);
const originalEnabled = process.env.DATA_ENGINE_ENABLED;

beforeAll(() => {
  global.Response = jest.requireActual('undici').Response;
});
beforeEach(() => {
  __resetStoreAvailabilityForTests();
  process.env.DATA_ENGINE_ENABLED = 'true';
  (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue('verified-owner');
  (readCommandBody as jest.Mock).mockResolvedValue({ owner: 'spoofed-owner' });
  (processCommand as jest.Mock).mockResolvedValue({ kind: 'acknowledged', operationId: 'operation' });
  (readDocument as jest.Mock).mockResolvedValue({ resource: { collection: 'sermons', id: 'sermon-1' }, value: null, metadata: null });
  (listDocuments as jest.Mock).mockResolvedValue({ snapshots: [], nextCursor: null });
  (readCollectionChanges as jest.Mock).mockResolvedValue({ version: 3, cursor: 3, snapshots: [], hasMore: false });
});
afterAll(() => {
  if (originalEnabled === undefined) delete process.env.DATA_ENGINE_ENABLED;
  else process.env.DATA_ENGINE_ENABLED = originalEnabled;
});

describe('Row field history routes', () => {
  it.each([
    ['assembly-history', 'councils', assemblyHistory, listCouncilAssemblyHistory],
    ['type-history', 'studyNotes', noteTypeHistory, listStudyNoteTypeHistory],
    ['topic-outcome-history', 'councils', topicOutcomeHistory, listCouncilOutcomeHistory],
    ['topic-kind-history', 'councils', topicKindHistory, listCouncilTopicKindHistory],
    ['topic-title-history', 'councils', topicTitleHistory, listCouncilTopicTitleHistory],
    ['step-flag-history', 'serviceOrders', stepFlagHistory, listServiceOrderFlagHistory],
    ['step-title-history', 'serviceOrders', stepTitleHistory, listServiceOrderStepTitleHistory],
  ] as const)('reads only the owner-scoped %s for its collection', async (path, collection, handler, reader) => {
    const context = (name = collection) => ({ params: Promise.resolve({ collection: name, id: 'owned-1' }) });
    const url = `http://localhost/api/data-engine/documents/${collection}/owned-1/${path}`;
    const allowed = request(url + '?generation=exact&cursor=page-2');
    const readHistory = reader as jest.Mock;
    const document = collection === 'councils' ? { councilId: 'owned-1' } : { orderId: 'owned-1' };
    const reply = { ...document, owner: 'verified-owner', generation: 'exact', entries: [], nextCursor: null };
    readHistory.mockResolvedValue(reply);

    const response = await handler(allowed, context());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(reply);
    expect(readHistory).toHaveBeenCalledWith('verified-owner', 'owned-1', 'exact', 'page-2');

    readHistory.mockClear();
    const otherCollection = collection === 'councils' ? 'serviceOrders' : 'councils';
    for (const invalid of [
      await handler(allowed, context(otherCollection)),
      await handler(request(url), context()),
      await handler(request(url + '?generation=exact&generation=old'), context()),
      await handler(request(url + '?generation=exact&cursor=one&cursor=two'), context()),
      await handler(request(url + '?generation=exact&owner=spoofed'), context()),
    ]) expect(invalid.status).toBe(400);

    jest.mocked(getRequiredAuthenticatedUid).mockResolvedValueOnce(null);
    expect((await handler(allowed, context())).status).toBe(401);
    expect(readHistory).not.toHaveBeenCalled();
  });
});

describe('DataEngine HTTP routes', () => {
  it('serves every route with no switch set, because the engine owns collections in code', async () => {
    const collections = process.env.DATA_ENGINE_COLLECTIONS;
    try {
      delete process.env.DATA_ENGINE_ENABLED;
      delete process.env.DATA_ENGINE_COLLECTIONS;
      const owned = ENGINE_OWNED_COLLECTIONS[0];
      const ownedList = { params: Promise.resolve({ collection: owned }) };
      const ownedDocument = { params: Promise.resolve({ collection: owned, id: 'document-1' }) };
      expect((await POST(request())).status).toBe(200);
      expect((await read(request(), ownedDocument)).status).toBe(200);
      expect((await list(request(), ownedList)).status).toBe(200);
      expect((await changes(request(`http://localhost/api/data-engine/changes/${owned}?after=0`), ownedList)).status).toBe(200);
    } finally {
      if (collections === undefined) delete process.env.DATA_ENGINE_COLLECTIONS;
      else process.env.DATA_ENGINE_COLLECTIONS = collections;
    }
  });

  // The client switch alone is not a boundary: a build with one migrated collection
  // must not be able to drive an unmigrated one through the protocol.
  it('serves only the collections this deployment migrated', async () => {
    const collections = process.env.DATA_ENGINE_COLLECTIONS;
    try {
      delete process.env.DATA_ENGINE_ENABLED;
      // `users` is engine-owned in code; an unrelated registered collection remains opt-in.
      expect(ENGINE_OWNED_COLLECTIONS).toContain('users');
      expect(ENGINE_OWNED_COLLECTIONS).toContain('studyNoteShareLinks');
      delete process.env.DATA_ENGINE_COLLECTIONS;
      const unservedCollection = 'prayerCategories';
      const unservedContext = { params: Promise.resolve({ collection: unservedCollection }) };
      const unservedDocument = { params: Promise.resolve({ collection: unservedCollection, id: 'category-1' }) };
      const servedContext = { params: Promise.resolve({ collection: 'users' }) };
      const servedDocument = { params: Promise.resolve({ collection: 'users', id: 'user-1' }) };

      for (const response of [await read(request(), unservedDocument), await list(request(), unservedContext),
        await changes(request(`http://localhost/api/data-engine/changes/${unservedCollection}?after=0`), unservedContext)]) {
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ code: 'data-engine-disabled' });
      }
      expect(readDocument).not.toHaveBeenCalled();
      expect(listDocuments).not.toHaveBeenCalled();
      expect(readCollectionChanges).not.toHaveBeenCalled();

      expect((await read(request(), servedDocument)).status).toBe(200);
      expect((await list(request(), servedContext)).status).toBe(200);
      expect((await changes(request('http://localhost/api/data-engine/changes/users?after=0'), servedContext)).status).toBe(200);

      (readCommandBody as jest.Mock).mockResolvedValue({ resource: { collection: unservedCollection, id: 'category-1' } });
      expect((await POST(request())).status).toBe(503);
      expect(processCommand).not.toHaveBeenCalled();

      (readCommandBody as jest.Mock).mockResolvedValue({ resource: { collection: 'users', id: 'user-1' } });
      expect((await POST(request())).status).toBe(200);
      expect(processCommand).toHaveBeenCalledTimes(1);

      // The engine reads its own change heads through the same route. That record is its
      // bookkeeping, not a migrated domain, so listing user collections must not cut it off —
      // a client enabled for one collection could otherwise never learn of a remote change.
      const heads = { params: Promise.resolve({ collection: '_dataEngineHeads', id: JSON.stringify(['owner', 'users']) }) };
      expect((await read(request(), heads)).status).toBe(200);
    } finally {
      if (collections === undefined) delete process.env.DATA_ENGINE_COLLECTIONS;
      else process.env.DATA_ENGINE_COLLECTIONS = collections;
    }
  });

  it('requires authentication before parsing commands or accessing documents', async () => {
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect((await read(request(), documentContext)).status).toBe(401);
    expect((await list(request(), listContext)).status).toBe(401);
    expect((await changes(request(), listContext)).status).toBe(401);
    expect(readCommandBody).not.toHaveBeenCalled();
    expect(processCommand).not.toHaveBeenCalled();
    expect(readDocument).not.toHaveBeenCalled();
    expect(listDocuments).not.toHaveBeenCalled();
    expect(readCollectionChanges).not.toHaveBeenCalled();
  });

  it('passes the verified owner separately from the untrusted command body', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(processCommand).toHaveBeenCalledWith('verified-owner', { owner: 'spoofed-owner' });
    expect(await response.json()).toMatchObject({ kind: 'acknowledged' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('gates date history before storage and uses only the authenticated owner when served', async () => {
    const input = request('http://localhost/api/data-engine/documents/sermons/sermon-1/preach-date-history?generation=g1');
    jest.mocked(assertDataEngineEnabled).mockImplementationOnce(() => { throw new DataEngineServerError('data-engine-disabled', 503); });
    expect((await history(input, documentContext)).status).toBe(503);
    expect(assertDataEngineEnabled).toHaveBeenLastCalledWith('sermons');
    expect(listPreachDateHistory).not.toHaveBeenCalled();

    jest.mocked(listPreachDateHistory).mockResolvedValue({ owner: 'verified-owner', sermonId: 'sermon-1', generation: 'g1', entries: [], nextCursor: null });
    const response = await history(input, documentContext);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listPreachDateHistory).toHaveBeenCalledWith('verified-owner', 'sermon-1', 'g1', undefined);
  });

  it('reads preaching detail history only for an authenticated sermon and returns no-store', async () => {
    const input = request('http://localhost/api/data-engine/documents/sermons/sermon-1/preach-date-field-history?generation=g1');
    jest.mocked(listPreachDateFieldHistory).mockResolvedValue({ owner: 'verified-owner', sermonId: 'sermon-1', generation: 'g1', entries: [], nextCursor: null });
    const response = await detailHistory(input, documentContext);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listPreachDateFieldHistory).toHaveBeenCalledWith('verified-owner', 'sermon-1', 'g1', undefined);
    expect((await detailHistory(input, { params: Promise.resolve({ collection: 'groups', id: 'sermon-1' }) })).status).toBe(400);
    expect(listPreachDateFieldHistory).toHaveBeenCalledTimes(1);
  });

  it('reads preaching status history for the authenticated sermon owner with no-store', async () => {
    const input = request('http://localhost/api/data-engine/documents/sermons/sermon-1/preach-status-history?generation=g1');
    jest.mocked(listPreachStatusHistory).mockResolvedValue({ owner: 'verified-owner', sermonId: 'sermon-1', generation: 'g1', entries: [], nextCursor: null });
    const response = await preachStatusHistory(input, documentContext);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listPreachStatusHistory).toHaveBeenCalledWith('verified-owner', 'sermon-1', 'g1', undefined);
    expect((await preachStatusHistory(input, { params: Promise.resolve({ collection: 'groups', id: 'sermon-1' }) })).status).toBe(400);
    expect(listPreachStatusHistory).toHaveBeenCalledTimes(1);
  });

  it('gates the mark history route and binds its no-store answer to the authenticated owner', async () => {
    const context = { params: Promise.resolve({ collection: 'bibleMarks', id: 'book' }) };
    const input = request('http://localhost/api/data-engine/documents/bibleMarks/book/mark-history?generation=g1');
    jest.mocked(assertDataEngineEnabled).mockImplementationOnce(() => { throw new DataEngineServerError('data-engine-disabled', 503); });
    expect((await markHistory(input, context)).status).toBe(503);
    expect(assertDataEngineEnabled).toHaveBeenLastCalledWith('bibleMarks');
    expect(listBibleMarkHistory).not.toHaveBeenCalled();

    jest.mocked(listBibleMarkHistory).mockResolvedValue({ owner: 'verified-owner', bookId: 'book', generation: 'g1', entries: [], nextCursor: null });
    const response = await markHistory(input, context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listBibleMarkHistory).toHaveBeenCalledWith('verified-owner', 'book', 'g1', undefined);
  });

  it('gates service order title history and binds the no-store response to the verified owner', async () => {
    const context = { params: Promise.resolve({ collection: 'serviceOrders', id: 'order' }) };
    const input = request('http://localhost/api/data-engine/documents/serviceOrders/order/title-history?generation=g1');
    jest.mocked(assertDataEngineEnabled).mockImplementationOnce(() => { throw new DataEngineServerError('data-engine-disabled', 503); });
    expect((await titleHistory(input, context)).status).toBe(503);
    expect(assertDataEngineEnabled).toHaveBeenLastCalledWith('serviceOrders');
    expect(listServiceOrderTitleHistory).not.toHaveBeenCalled();

    jest.mocked(listServiceOrderTitleHistory).mockResolvedValue({
      owner: 'verified-owner', orderId: 'order', generation: 'g1', entries: [], nextCursor: null,
    });
    const response = await titleHistory(input, context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listServiceOrderTitleHistory).toHaveBeenCalledWith('verified-owner', 'order', 'g1', undefined);
  });

  it('reads status history only for the authenticated group owner', async () => {
    const input = request('http://localhost/api/data-engine/documents/groups/group/status-history?generation=g1');
    jest.mocked(listGroupStatusHistory).mockResolvedValue({ owner: 'verified-owner', groupId: 'group', generation: 'g1', entries: [], nextCursor: null });
    const response = await statusHistory(input, { params: Promise.resolve({ collection: 'groups', id: 'group' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listGroupStatusHistory).toHaveBeenCalledWith('verified-owner', 'group', 'g1', undefined);
    const wrong = await statusHistory(input, { params: Promise.resolve({ collection: 'series', id: 'group' }) });
    expect(wrong.status).toBe(400);
    expect(listGroupStatusHistory).toHaveBeenCalledTimes(1);
  });

  it('reads meeting field history for the authenticated group owner with no-store', async () => {
    const input = request('http://localhost/api/data-engine/documents/groups/group/meeting-field-history?generation=g1');
    jest.mocked(listGroupMeetingFieldHistory).mockResolvedValue({ owner: 'verified-owner', groupId: 'group', generation: 'g1', entries: [], nextCursor: null });
    const response = await meetingFieldHistory(input, { params: Promise.resolve({ collection: 'groups', id: 'group' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listGroupMeetingFieldHistory).toHaveBeenCalledWith('verified-owner', 'group', 'g1', undefined);
    expect((await meetingFieldHistory(input, { params: Promise.resolve({ collection: 'sermons', id: 'group' }) })).status).toBe(400);
    expect(listGroupMeetingFieldHistory).toHaveBeenCalledTimes(1);
  });

  it('reads group title history for only the verified owner and returns no-store', async () => {
    const context = { params: Promise.resolve({ collection: 'groups', id: 'group' }) };
    const input = request('http://localhost/api/data-engine/documents/groups/group/title-history?generation=g1');
    jest.mocked(listGroupTitleHistory).mockResolvedValue({ owner: 'verified-owner', groupId: 'group', generation: 'g1', entries: [], nextCursor: null });
    const response = await titleHistory(input, context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listGroupTitleHistory).toHaveBeenCalledWith('verified-owner', 'group', 'g1', undefined);
    expect(listServiceOrderTitleHistory).not.toHaveBeenCalled();
  });

  it('returns sermon title history for the authenticated owner and document generation', async () => {
    const input = request('http://localhost/api/data-engine/documents/sermons/sermon/title-history?generation=g1');
    jest.mocked(listSermonTitleHistory).mockResolvedValue({ owner: 'verified-owner', sermonId: 'sermon', generation: 'g1', entries: [], nextCursor: null });
    const response = await titleHistory(input, { params: Promise.resolve({ collection: 'sermons', id: 'sermon' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listSermonTitleHistory).toHaveBeenCalledWith('verified-owner', 'sermon', 'g1', undefined);
    expect(listGroupTitleHistory).not.toHaveBeenCalled();
  });

  it('serves scripture history with the authenticated owner and no-store', async () => {
    const input = request('http://localhost/api/data-engine/documents/sermons/sermon/verse-history?generation=g1');
    jest.mocked(listSermonVerseHistory).mockResolvedValue({ owner: 'verified-owner', sermonId: 'sermon', generation: 'g1', entries: [], nextCursor: null });
    const response = await verseHistory(input, { params: Promise.resolve({ collection: 'sermons', id: 'sermon' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listSermonVerseHistory).toHaveBeenCalledWith('verified-owner', 'sermon', 'g1', undefined);
    expect((await verseHistory(input, { params: Promise.resolve({ collection: 'groups', id: 'sermon' }) })).status).toBe(400);
  });

  it('serves church history only for the authenticated owner and sermon generation with no-store', async () => {
    const input = request('http://localhost/api/data-engine/documents/sermons/sermon/church-history?generation=g1');
    const selected = { id: 'church', name: 'Church', city: 'City' };
    const page = { owner: 'verified-owner', sermonId: 'sermon', generation: 'g1', nextCursor: null,
      entries: [{ id: 'entry', church: null, winnerChurch: selected, acceptedAt: '2026-11-08T00:00:00.000Z' }] };
    jest.mocked(listSermonChurchHistory).mockResolvedValue(page);
    const response = await churchHistory(input, { params: Promise.resolve({ collection: 'sermons', id: 'sermon' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual(page);
    expect(listSermonChurchHistory).toHaveBeenCalledWith('verified-owner', 'sermon', 'g1', undefined);
    expect((await churchHistory(input, { params: Promise.resolve({ collection: 'groups', id: 'sermon' }) })).status).toBe(400);
  });

  it('serves membership history for an authenticated group or sermon with the optional legacy generation', async () => {
    const url = 'http://localhost/api/data-engine/documents/groups/member/series-membership-history';
    const context = { params: Promise.resolve({ collection: 'groups', id: 'member' }) };
    const page = { owner: 'verified-owner', collection: 'groups' as const, memberId: 'member', generation: null, entries: [], nextCursor: null };
    jest.mocked(listSeriesMembershipHistory).mockResolvedValue(page);
    const response = await membershipHistory(request(url + '?generation='), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual(page);
    expect(listSeriesMembershipHistory).toHaveBeenCalledWith('verified-owner', 'groups', 'member', null, undefined);
    expect((await membershipHistory(request(url + '?owner=other'), context)).status).toBe(400);
    expect((await membershipHistory(request(url), { params: Promise.resolve({ collection: 'series', id: 'member' }) })).status).toBe(400);
  });

  it('serves series metadata history with owner, generation and no-store', async () => {
    const input = request('http://localhost/api/data-engine/documents/series/series-id/metadata-history?generation=g1');
    const page = { owner: 'verified-owner', seriesId: 'series-id', generation: 'g1', entries: [], nextCursor: null };
    jest.mocked(listSeriesMetadataHistory).mockResolvedValue(page);
    const context = { params: Promise.resolve({ collection: 'series', id: 'series-id' }) };
    const response = await seriesHistory(input, context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listSeriesMetadataHistory).toHaveBeenCalledWith('verified-owner', 'series-id', 'g1', undefined);
    expect((await seriesHistory(input, { params: Promise.resolve({ collection: 'groups', id: 'series-id' }) })).status).toBe(400);
  });

  it('serves council metadata history only for its owner and generation with no-store', async () => {
    const input = request('http://localhost/api/data-engine/documents/councils/council-id/metadata-history?generation=g1');
    const page = { owner: 'verified-owner', councilId: 'council-id', generation: 'g1', entries: [], nextCursor: null };
    jest.mocked(listCouncilMetadataHistory).mockResolvedValue(page);
    const response = await seriesHistory(input, { params: Promise.resolve({ collection: 'councils', id: 'council-id' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listCouncilMetadataHistory).toHaveBeenCalledWith('verified-owner', 'council-id', 'g1', undefined);
  });

  it.each(['groups', 'series', 'councils'])('calibrates on the existing authenticated %s document read', async collection => {
    const resource = { collection, id: 'group' };
    const input = request('http://localhost/api/data-engine/documents/' + collection + '/group');
    input.headers.set('x-engine-action-clock', 'group-challenge');
    jest.mocked(readDocument).mockResolvedValueOnce({ resource, value: null, metadata: null,
      actionClock: { challenge: 'group-challenge', serverMs: 1_800_000_000_000 } });
    const response = await read(input, { params: Promise.resolve(resource) });
    expect(readDocument).toHaveBeenCalledWith('verified-owner', resource, { actionClockChallenge: 'group-challenge' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ actionClock: { challenge: 'group-challenge' } });
  });

  it('gates the meeting date history and binds its no-store response to the verified owner', async () => {
    const context = { params: Promise.resolve({ collection: 'groups', id: 'group' }) };
    const input = request('http://localhost/api/data-engine/documents/groups/group/meeting-date-history?generation=g1');
    jest.mocked(assertDataEngineEnabled).mockImplementationOnce(() => { throw new DataEngineServerError('data-engine-disabled', 503); });
    expect((await meetingHistory(input, context)).status).toBe(503);
    expect(assertDataEngineEnabled).toHaveBeenLastCalledWith('groups');
    expect(listMeetingDateHistory).not.toHaveBeenCalled();

    jest.mocked(listMeetingDateHistory).mockResolvedValue({ owner: 'verified-owner', groupId: 'group', generation: 'g1', entries: [], nextCursor: null });
    const response = await meetingHistory(input, context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(listMeetingDateHistory).toHaveBeenCalledWith('verified-owner', 'group', 'g1', undefined);
  });

  it('passes exact resource identifiers and forbids cached document responses', async () => {
    const response = await read(request(), documentContext);
    expect(readDocument).toHaveBeenCalledWith('verified-owner', { collection: 'sermons', id: 'sermon-1' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ value: null, metadata: null });
  });

  it('passes a valid clock challenge on the authenticated sermon list without using it as a pagination key', async () => {
    const input = request('http://localhost/api/data-engine/collections/sermons');
    input.headers.set('x-engine-action-clock', 'fresh-1');
    expect((await list(input, listContext)).status).toBe(200);
    expect(listDocuments).toHaveBeenLastCalledWith('verified-owner', 'sermons', { actionClockChallenge: 'fresh-1' });
    input.headers.set('x-engine-action-clock', 'x'.repeat(81));
    expect((await list(input, listContext)).status).toBe(200);
    expect(listDocuments).toHaveBeenLastCalledWith('verified-owner', 'sermons', {});
  });

  it('passes only bounded pagination to the owner-constrained list implementation', async () => {
    const response = await list(request('http://localhost/api/data-engine/collections/sermons?limit=10&cursor=abc'), listContext);
    expect(listDocuments).toHaveBeenCalledWith('verified-owner', 'sermons', { limit: 10, cursor: 'abc' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ snapshots: [], nextCursor: null });
  });

  it('supports default pagination', async () => {
    expect((await list(request(), listContext)).status).toBe(200);
    expect(listDocuments).toHaveBeenCalledWith('verified-owner', 'sermons', {});
  });

  it.each(['owner=victim', 'where=private', 'limit=1&limit=2', 'cursor=a&cursor=b', 'limit=1.5', 'limit=-1', 'limit='])('rejects arbitrary or malformed query parameters: %s', async query => {
    expect((await list(request(`http://localhost/api/data-engine/collections/sermons?${query}`), listContext)).status).toBe(400);
    expect(listDocuments).not.toHaveBeenCalled();
  });

  it('returns a retryable unavailable error for failures of every route', async () => {
    (processCommand as jest.Mock).mockRejectedValue(new Error('database credentials'));
    (readDocument as jest.Mock).mockRejectedValue(new Error('database credentials'));
    (listDocuments as jest.Mock).mockRejectedValue(new Error('database credentials'));
    for (const response of [await POST(request()), await read(request(), documentContext), await list(request(), listContext)]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: 'unavailable' });
    }
  });

  // BUG-20261019-quota-outage-burns-vercel-functions: with the daily quota spent the store SDK retries for
  // minutes; every route the screen polls was killed at 10 s and the browser, giving up at 8 s, asked again.
  it('answers 503 with Retry-After within a few seconds when the store never answers, and the next poll does not wait again', async () => {
    let answer: Response | undefined;
    jest.useFakeTimers();
    try {
      (readCollectionChanges as jest.Mock).mockImplementation(() => new Promise(() => undefined));
      (readDocument as jest.Mock).mockImplementation(() => new Promise(() => undefined));
      void changes(request('http://localhost/api/data-engine/changes/sermons?after=66&limit=100'), listContext).then(response => { answer = response; });
      await jest.advanceTimersByTimeAsync(3_000);
      expect(answer?.status).toBe(503);
      expect(answer?.headers.get('Retry-After')).toMatch(/^\d+$/);

      let next: Response | undefined;
      void read(request(), documentContext).then(response => { next = response; });
      await jest.advanceTimersByTimeAsync(0);
      expect(next?.status).toBe(503);
      expect(readDocument).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
    expect(await answer!.json()).toEqual({ code: 'unavailable' });
  });

  it('serves authenticated changes with an explicit cursor and optional bounded page size', async () => {
    const response = await changes(request('http://localhost/api/data-engine/changes/sermons?after=2&limit=10'), listContext);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ cursor: 3 });
    expect(readCollectionChanges).toHaveBeenCalledWith('verified-owner', 'sermons', 2, { limit: 10 });
    await changes(request('http://localhost/api/data-engine/changes/sermons?after=0'), listContext);
    expect(readCollectionChanges).toHaveBeenLastCalledWith('verified-owner', 'sermons', 0, {});
  });

  it.each(['', 'after=-1', 'after=1.5', 'after=1&after=2', 'after=0&limit=', 'after=0&limit=1&limit=2', 'after=0&owner=victim'])('rejects malformed change query %s', async query => {
    expect((await changes(request(`http://localhost/api/data-engine/changes/sermons?${query}`), listContext)).status).toBe(400);
    expect(readCollectionChanges).not.toHaveBeenCalled();
  });

  it('hides internal change-feed errors', async () => {
    (readCollectionChanges as jest.Mock).mockRejectedValue(new Error('Private backend'));
    const response = await changes(request('http://localhost/api/data-engine/changes/sermons?after=0'), listContext);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'unavailable' });
  });

  it('returns validation errors without sending an invalid command', async () => {
    (readCommandBody as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('Invalid'), { code: 'invalid-argument' }));
    expect((await POST(request())).status).toBe(400);
    expect(processCommand).not.toHaveBeenCalled();
  });
});
