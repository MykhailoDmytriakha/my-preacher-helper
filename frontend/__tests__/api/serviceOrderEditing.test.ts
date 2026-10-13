import { DELETE, GET, PATCH } from '@/api/service-orders/[id]/route';
import { POST as create } from '@/api/service-orders/custom/route';
import { PATCH as place } from '@/api/service-orders/placement/route';
import { POST as seed } from '@/api/service-orders/route';

/**
 * ONE ORDER OF SERVICE OVER HTTPS. Reading stays for a shipped bundle, filtered by owner. Every
 * write is the data engine's: a shipped bundle's rename, steps, reorder, custom create, seed and
 * delete all get the 426 refusal — never 409, which that client reads as "stale, the body is the
 * order" — and nothing reaches the database.
 */

jest.mock('next/server', () => ({ NextResponse: { json: (value: unknown, options: { status?: number } = {}) => ({ status: options.status ?? 200, json: async () => value }) } }));
const mockAuth = jest.fn();
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: (...args: unknown[]) => mockAuth(...args) }));
const mockGet = jest.fn();
const mockCollection = jest.fn((_name: string) => ({ doc: (id: string) => ({ id, get: () => mockGet(id) }) }));
jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: (name: string) => mockCollection(name) } }));
const doc = (data: Record<string, unknown>) => ({ exists: true, data: () => data });
const current = { userId: 'owner', title: 'Visit', steps: [{ id: 's1', title: 'Listen' }] };
const request = (value?: unknown) => ({ json: async () => value } as Request);
const context = { params: Promise.resolve({ id: 'order1' }) };
const writes = () => [
  PATCH(request({ aggregate: 'meta', updates: { title: 'New' } })),
  DELETE(request()),
  place(request({ ranks: [{ id: 'a', rank: 1 }] })),
  create(request({ title: 'New', steps: [], rank: 1 })),
  seed(request({ orders: [{ catalogKey: 'funeral', title: 'Funeral', steps: [], rank: 1 }] })),
];
beforeEach(() => { jest.clearAllMocks(); mockAuth.mockResolvedValue('owner'); mockGet.mockResolvedValue(doc(current)); });

it('reads only the authenticated owner\'s live order', async () => {
  const own = await GET(request(), context);
  expect(own.status).toBe(200);
  expect(await own.json()).toMatchObject({ id: 'order1', title: 'Visit' });
  mockGet.mockResolvedValueOnce(doc({ ...current, userId: 'someone-else' }));
  expect((await GET(request(), context)).status).toBe(404);
  mockGet.mockResolvedValueOnce({ exists: false, data: () => undefined });
  expect((await GET(request(), context)).status).toBe(404);
  // A tombstone written before 2026-09-18 still carries userId; it is not an order to open.
  mockGet.mockResolvedValueOnce(doc({ ...current, _dataEngine: { protocol: 1, deleted: true } }));
  expect((await GET(request(), context)).status).toBe(404);
});

it('requires authentication for reads and every write', async () => {
  mockAuth.mockResolvedValue(null);
  expect((await GET(request(), context)).status).toBe(401);
  for (const response of await Promise.all(writes())) expect(response.status).toBe(401);
  expect(mockCollection).not.toHaveBeenCalled();
});

it('refuses every write from a shipped bundle with 426 and never touches the database', async () => {
  for (const response of await Promise.all(writes())) {
    expect(response.status).toBe(426);
    expect(await response.json()).toMatchObject({ code: 'data-engine-required' });
  }
  expect(mockCollection).not.toHaveBeenCalled();
});
