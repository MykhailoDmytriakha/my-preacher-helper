/** @jest-environment node */
import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { GET as changes } from '@/api/data-engine/changes/[collection]/route';
import { GET as list } from '@/api/data-engine/collections/[collection]/route';
import { POST } from '@/api/data-engine/commands/route';
import { GET as read } from '@/api/data-engine/documents/[collection]/[id]/route';
import { listDocuments, processCommand, readCollectionChanges, readCommandBody, readDocument } from '@/data-engine/server';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: {} }));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn() }));
jest.mock('@/data-engine/server', () => ({
  ...jest.requireActual('@/data-engine/server'),
  processCommand: jest.fn(),
  readCommandBody: jest.fn(),
  readDocument: jest.fn(),
  listDocuments: jest.fn(),
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

describe('DataEngine HTTP routes', () => {
  it.each([undefined, 'false', '1'])('keeps every HTTP route disabled unless deployment explicitly opts in: %s', async enabled => {
    if (enabled === undefined) delete process.env.DATA_ENGINE_ENABLED;
    else process.env.DATA_ENGINE_ENABLED = enabled;
    for (const response of [await POST(request()), await read(request(), documentContext), await list(request(), listContext), await changes(request(), listContext)]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: 'data-engine-disabled' });
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(readCommandBody).not.toHaveBeenCalled();
    expect(processCommand).not.toHaveBeenCalled();
    expect(readDocument).not.toHaveBeenCalled();
    expect(listDocuments).not.toHaveBeenCalled();
    expect(readCollectionChanges).not.toHaveBeenCalled();
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

  it('passes exact resource identifiers and forbids cached document responses', async () => {
    const response = await read(request(), documentContext);
    expect(readDocument).toHaveBeenCalledWith('verified-owner', { collection: 'sermons', id: 'sermon-1' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ value: null, metadata: null });
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
