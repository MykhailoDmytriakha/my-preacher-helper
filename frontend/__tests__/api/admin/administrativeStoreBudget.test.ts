/** @jest-environment node */
import { requireAdminEmail } from '@/api/admin/adminAuth';
import * as telemetry from '@/api/admin/telemetry/route';
import * as promptTelemetry from '@/api/admin/telemetry/[promptName]/route';
import * as users from '@/api/admin/users/route';
import { adminAuth, adminDb } from '@/config/firebaseAdminConfig';
import { __resetStoreAvailabilityForTests, withStore } from '@/services/storeAvailability.server';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), init) } }));
jest.mock('@/api/admin/adminAuth', () => ({ requireAdminEmail: jest.fn() }));
jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), batch: jest.fn() }, adminAuth: { listUsers: jest.fn() } }));

const get = jest.fn();
const commit = jest.fn();
const query = { get, where: jest.fn() };
const prompt = { params: Promise.resolve({ promptName: 'qa-admin-budget-292' }) };
const rows = [
  { name: 'telemetry summary', method: 'GET', run: telemetry.GET },
  { name: 'prompt telemetry', method: 'GET', run: (request: Request) => promptTelemetry.GET(request, prompt) },
  { name: 'user list', method: 'GET', run: users.GET },
  { name: 'telemetry purge', method: 'DELETE', run: telemetry.DELETE },
  { name: 'prompt purge', method: 'DELETE', run: (request: Request) => promptTelemetry.DELETE(request, prompt) },
];
const request = (method: string) => new Request('http://localhost/api/qa-admin-budget-292', { method });
const never = () => new Promise<never>(() => undefined);
const empty = { docs: [], size: 0 };
const answer = async (row: typeof rows[number], wait = 7_500) => {
  let response: Response | undefined;
  let failure: unknown;
  void row.run(request(row.method)).then(value => { response = value; }, error => { failure = error; });
  await jest.advanceTimersByTimeAsync(wait);
  expect(failure).toBeUndefined();
  expect(response).toBeDefined();
  return response!;
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  __resetStoreAvailabilityForTests();
  jest.mocked(requireAdminEmail).mockResolvedValue({ ok: true, uid: 'qa-admin-budget-292', email: 'qa-admin-budget@example.com' });
  query.where.mockReturnValue(query);
  jest.mocked(adminDb.collection).mockReturnValue(query as never);
  jest.mocked(adminDb.batch).mockReturnValue({ delete: jest.fn(), commit } as never);
  jest.mocked(adminAuth.listUsers).mockResolvedValue({ users: [] });
  get.mockImplementation(never);
  commit.mockResolvedValue(undefined);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it.each(rows.filter(row => row.method === 'GET'))('$name returns a healthy scan that takes longer than an ordinary document read', async row => {
  get.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(empty), 3_500)));
  const response = await answer(row);
  expect(response.status).toBe(200);
});

it.each(rows)('$name does not pause the next healthy ordinary read after its own deadline', async row => {
  await answer(row);
  const next = await withStore(async () => 'ordinary record').then(value => ({ value }), error => ({ error }));
  expect(next).toEqual({ value: 'ordinary record' });
});

it.each(rows)('$name reports its own deadline without advertising a database outage', async row => {
  const response = await answer(row);
  expect(response.status).toBe(504);
  expect(response.headers.has('Retry-After')).toBe(false);
});

it.each(rows)('$name retains the shared read pause for an actual quota refusal', async row => {
  get.mockRejectedValue(Object.assign(new Error('Quota exhausted'), { code: 8 }));
  const response = await answer(row, 0);
  expect(response.status).toBe(503);
  expect(response.headers.get('Retry-After')).toBe('30');
  await expect(withStore(async () => 'ordinary record')).rejects.toMatchObject({ code: 'unavailable' });
});

it.each(rows)('$name rejects an unauthenticated caller without reading the store', async row => {
  jest.mocked(requireAdminEmail).mockResolvedValue({ ok: false, response: new Response('{}', { status: 401 }) as never });
  const response = await answer(row, 0);
  expect(response.status).toBe(401);
  expect(get).not.toHaveBeenCalled();
});

it('keeps the ordinary interactive silence deadline and shared read pause', async () => {
  const first = withStore(never).catch(error => error);
  await jest.advanceTimersByTimeAsync(3_100);
  expect(await first).toMatchObject({ code: 'unavailable' });
  await expect(withStore(async () => 'next')).rejects.toMatchObject({ code: 'unavailable' });
});

it('still attempts an ordinary write during an actual quota pause', async () => {
  await withStore(() => Promise.reject(Object.assign(new Error('Quota'), { code: 8 }))).catch(() => {});
  await expect(withStore(async () => 'saved', { write: true })).resolves.toBe('saved');
});

it('does not let an expired administrative rejection poison a newer healthy read', async () => {
  let rejectRead!: (error: unknown) => void;
  get.mockReturnValue(new Promise((_resolve, reject) => { rejectRead = reject; }));
  await answer(rows[0]);
  const afterDeadline = await withStore(async () => 'newer healthy record').then(value => ({ value }), error => ({ error }));
  rejectRead(Object.assign(new Error('Old quota result'), { code: 8 }));
  await jest.advanceTimersByTimeAsync(0);
  const afterLateRejection = await withStore(async () => 'newer healthy record').then(value => ({ value }), error => ({ error }));
  expect({ afterDeadline, afterLateRejection }).toEqual({
    afterDeadline: { value: 'newer healthy record' },
    afterLateRejection: { value: 'newer healthy record' },
  });
});
