import { DELETE, GET, PATCH } from '@/api/service-orders/[id]/route';
import { POST as create } from '@/api/service-orders/custom/route';
import { PATCH as place } from '@/api/service-orders/placement/route';

jest.mock('next/server', () => ({ NextResponse: { json: (value: unknown, options: { status?: number } = {}) => ({ status: options.status ?? 200, json: async () => value }) } }));
const mockAuth = jest.fn();
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: (...args: unknown[]) => mockAuth(...args) }));
const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockGetAll = jest.fn();
const mockCreate = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: {
  collection: () => ({ doc: (id = 'new-order') => ({ id, get: () => mockGet(id), create: mockCreate }) }),
  runTransaction: (run: (tx: unknown) => Promise<unknown>) => run({ get: (ref: { id: string }) => mockGet(ref.id), getAll: (...refs: unknown[]) => mockGetAll(...refs), update: mockUpdate, delete: mockDelete }),
} }));
const doc = (data: Record<string, unknown>) => ({ exists: true, data: () => data });
const current = { userId: 'owner', title: 'Visit', steps: [{ id: 's1', title: 'Listen' }], rev: { steps: 3, meta: 2 } };
const request = (value?: unknown) => ({ json: async () => value } as Request);
const context = { params: Promise.resolve({ id: 'order1' }) };
beforeEach(() => { jest.clearAllMocks(); mockAuth.mockResolvedValue('owner'); mockGet.mockResolvedValue(doc(current)); });
it('requires authentication for reads and every write', async () => {
  mockAuth.mockResolvedValue(null);
  expect((await GET(request(), context)).status).toBe(401);
  expect((await PATCH(request({}), context)).status).toBe(401);
  expect((await place(request({}))).status).toBe(401);
  expect((await create(request({}))).status).toBe(401);
  expect((await DELETE(request(), context)).status).toBe(401);
  expect(mockGet).not.toHaveBeenCalled();
});
it('does not expose or update another owner document', async () => {
  mockGet.mockResolvedValue(doc({ ...current, userId: 'someone-else' }));
  expect((await GET(request(), context)).status).toBe(404);
  expect((await PATCH(request({ aggregate: 'steps', expectedRevision: 3, steps: [] }), context)).status).toBe(404);
  expect(mockUpdate).not.toHaveBeenCalled();
});
it('refuses stale steps and returns the current base', async () => {
  const result = await PATCH(request({ aggregate: 'steps', expectedRevision: 2, steps: [] }), context);
  expect(result.status).toBe(409);
  expect((await result.json()).steps).toEqual(current.steps);
  expect(mockUpdate).not.toHaveBeenCalled();
});
it('commits deletion and bumps only the steps revision', async () => {
  const result = await PATCH(request({ aggregate: 'steps', expectedRevision: 3, steps: [] }), context);
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ steps: [], rev: { steps: 4, meta: 2 } });
  expect(mockUpdate.mock.calls[0][1]).toMatchObject({ steps: [], 'rev.steps': 4 });
});
it('guards a stale title and accepts an unchanged opening baseline', async () => {
  const base = { aggregate: 'meta', expectedRevision: 1, expectedBaseline: { title: 'Old' }, updates: { title: 'New' } };
  expect((await PATCH(request(base), context)).status).toBe(409);
  expect((await PATCH(request({ ...base, expectedBaseline: { title: 'Visit' } }), context)).status).toBe(200);
});
it.each([
  { aggregate: 'steps', expectedRevision: 3, steps: [{ id: 'a', title: 'a' }, { id: 'a', title: 'b' }] },
  { aggregate: 'meta', expectedRevision: null, expectedBaseline: null, updates: { userId: 'other' } },
])('rejects invalid or privilege-changing payloads', async value => {
  expect((await PATCH(request(value), context)).status).toBe(400);
  expect(mockUpdate).not.toHaveBeenCalled();
});
it('checks every rank owner before writing any rank', async () => {
  mockGetAll.mockResolvedValue([doc(current), doc({ ...current, userId: 'other' })]);
  expect((await place(request({ ranks: [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }] }))).status).toBe(404);
  expect(mockUpdate).not.toHaveBeenCalled();
});
it('commits all ranks with placement revisions together', async () => {
  mockGetAll.mockResolvedValue([doc(current), doc({ ...current, rev: { placement: 9 } })]);
  expect((await place(request({ ranks: [{ id: 'a', rank: 10 }, { id: 'b', rank: 20 }] }))).status).toBe(200);
  expect(mockUpdate.mock.calls.map(call => call[1])).toEqual([expect.objectContaining({ rank: 10, 'rev.placement': 1 }), expect.objectContaining({ rank: 20, 'rev.placement': 10 })]);
});

it('keeps existing long owner-written text editable', async () => {
  const steps = [{ id: 'a', title: 'a', body: 'x'.repeat(15000) }];
  expect((await PATCH(request({ aggregate: 'steps', expectedRevision: 3, steps }), context)).status).toBe(200);
});

it('creates a custom service belonging only to the authenticated owner', async () => {
  const result = await create(request({ title: 'New', steps: [], rank: 1 }));
  expect(result.status).toBe(201);
  expect(await result.json()).toMatchObject({ id: 'new-order', userId: 'owner', title: 'New' });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect((await create(request({ title: 'New', steps: [], rank: 1, userId: 'other' }))).status).toBe(400);
});
it('deletes only the authenticated owner service', async () => {
  mockGet.mockResolvedValueOnce(doc({ ...current, userId: 'other' }));
  expect((await DELETE(request(), context)).status).toBe(404);
  expect(mockDelete).not.toHaveBeenCalled();
  expect((await DELETE(request(), context)).status).toBe(200);
  expect(mockDelete).toHaveBeenCalledTimes(1);
});
