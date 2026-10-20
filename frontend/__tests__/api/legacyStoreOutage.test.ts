/** @jest-environment node */
import { requireAdminEmail } from '@/api/admin/adminAuth';
import * as defaults from '@/api/admin/ai-defaults/route';
import * as telemetry from '@/api/admin/telemetry/route';
import * as promptTelemetry from '@/api/admin/telemetry/[promptName]/route';
import * as entitlement from '@/api/admin/users/[uid]/entitlement/route';
import * as users from '@/api/admin/users/route';
import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { getFunctionDefault } from '@/api/clients/ai/functionCatalog';
import * as council from '@/api/councils/[id]/route';
import * as councils from '@/api/councils/route';
import * as order from '@/api/service-orders/[id]/route';
import * as orders from '@/api/service-orders/route';
import * as material from '@/api/studies/materials/[id]/route';
import * as materials from '@/api/studies/materials/route';
import { adminAuth, adminDb } from '@/config/firebaseAdminConfig';
import { __resetStoreAvailabilityForTests, withStore } from '@/services/storeAvailability.server';
import { councilsRepository } from '@repositories/councils.repository';
import { serviceOrdersRepository } from '@repositories/serviceOrders.repository';
import { studiesRepository } from '@repositories/studies.repository';

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), init) },
}));
jest.mock('@/api/admin/adminAuth', () => ({ requireAdminEmail: jest.fn() }));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn() }));
jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: { collection: jest.fn(), batch: jest.fn() },
  adminAuth: { listUsers: jest.fn() },
  FieldValue: { serverTimestamp: jest.fn() },
}));
jest.mock('@repositories/councils.repository', () => ({ councilsRepository: { listForOwner: jest.fn(), getForOwner: jest.fn() } }));
jest.mock('@repositories/serviceOrders.repository', () => ({ serviceOrdersRepository: { listForOwner: jest.fn() } }));
jest.mock('@repositories/studies.repository', () => ({ studiesRepository: { listMaterials: jest.fn(), getMaterial: jest.fn() } }));

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockCommit = jest.fn();
const query = { get: mockGet, where: jest.fn(), doc: jest.fn(), set: mockSet, update: mockUpdate };
const admin = jest.mocked(requireAdminEmail);
const uid = jest.mocked(getRequiredAuthenticatedUid);
const defaultText = getFunctionDefault('text');
const id = { params: Promise.resolve({ id: 'qa-legacy-bounds-140-record' }) };
const user = { params: Promise.resolve({ uid: 'qa-legacy-bounds-140-user' }) };
const prompt = { params: Promise.resolve({ promptName: 'qa-legacy-bounds-140-prompt' }) };

type RouteCase = { name: string; method: string; body?: unknown; mutation?: boolean; run: (request: Request) => Promise<Response> };
const routes: RouteCase[] = [
  { name: 'council list', method: 'GET', run: councils.GET },
  { name: 'council detail', method: 'GET', run: request => council.GET(request, id) },
  { name: 'service order list', method: 'GET', run: orders.GET },
  { name: 'service order detail', method: 'GET', run: request => order.GET(request, id) },
  { name: 'material list', method: 'GET', run: materials.GET },
  { name: 'material detail', method: 'GET', run: request => material.GET(request, id) },
  { name: 'model defaults read', method: 'GET', run: defaults.GET },
  { name: 'model defaults save', method: 'POST', mutation: true, body: { text: { providerId: defaultText.providerId, modelId: defaultText.modelId } }, run: defaults.POST },
  { name: 'user list', method: 'GET', run: users.GET },
  { name: 'entitlement save', method: 'POST', mutation: true, body: { paidTier: 'free' }, run: request => entitlement.POST(request, user) },
  { name: 'telemetry summary', method: 'GET', run: telemetry.GET },
  { name: 'telemetry purge', method: 'DELETE', mutation: true, run: telemetry.DELETE },
  { name: 'prompt telemetry list', method: 'GET', run: request => promptTelemetry.GET(request, prompt) },
  { name: 'prompt review save', method: 'PATCH', mutation: true, body: { eventId: 'qa-legacy-bounds-140-event', quality: 'good' }, run: request => promptTelemetry.PATCH(request, prompt) },
  { name: 'prompt telemetry purge', method: 'DELETE', mutation: true, run: request => promptTelemetry.DELETE(request, prompt) },
];
const requestFor = (row: RouteCase) => new Request('http://localhost/api/qa-local', {
  method: row.method, headers: { Authorization: 'Bearer local-fixture', 'Content-Type': 'application/json' },
  ...(row.body === undefined ? {} : { body: JSON.stringify(row.body) }),
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  __resetStoreAvailabilityForTests();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  admin.mockResolvedValue({ ok: true, uid: 'owner', email: 'owner@example.com' });
  uid.mockResolvedValue('owner');
  query.where.mockReturnValue(query);
  query.doc.mockReturnValue(query);
  jest.mocked(adminDb.collection).mockReturnValue(query as never);
  jest.mocked(adminDb.batch).mockReturnValue({ delete: jest.fn(), commit: mockCommit } as never);
  jest.mocked(adminAuth.listUsers).mockResolvedValue({ users: [] });
  mockGet.mockImplementation(() => new Promise(() => {}));
  mockSet.mockImplementation(() => new Promise(() => {}));
  mockUpdate.mockImplementation(() => new Promise(() => {}));
  mockCommit.mockImplementation(() => new Promise(() => {}));
  jest.mocked(councilsRepository.listForOwner).mockImplementation(() => mockGet());
  jest.mocked(councilsRepository.getForOwner).mockImplementation(() => mockGet());
  jest.mocked(serviceOrdersRepository.listForOwner).mockImplementation(() => mockGet());
  jest.mocked(studiesRepository.listMaterials).mockImplementation(() => mockGet());
  jest.mocked(studiesRepository.getMaterial).mockImplementation(() => mockGet());
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it.each(routes)('$name answers a silent store before the browser gives up', async row => {
  let response: Response | undefined;
  void row.run(requestFor(row)).then(value => { response = value; });
  await jest.advanceTimersByTimeAsync(row.mutation ? 5_100 : 3_100);
  expect(response).toBeDefined();
  expect(response?.status).toBe(503);
  expect(Number(response?.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(await response?.json()).toEqual({ code: 'unavailable' });
});

it.each(routes)('$name reports actual quota refusal with the shared pause', async row => {
  const failure = Object.assign(new Error('Store quota exhausted'), { code: 8 });
  mockGet.mockRejectedValue(failure);
  mockSet.mockRejectedValue(failure);
  const response = await row.run(requestFor(row));
  expect(response.status).toBe(503);
  expect(response.headers.get('Retry-After')).toBe('30');
  expect(await response.json()).toEqual({ code: 'unavailable' });
});

it.each(routes.filter(row => row.mutation))('$name still asks the store during a read pause', async row => {
  await withStore(() => Promise.reject(Object.assign(new Error('Quota'), { code: 8 }))).catch(() => {});
  let response: Response | undefined;
  void row.run(requestFor(row)).then(value => { response = value; });
  await jest.advanceTimersByTimeAsync(5_100);
  expect(mockGet.mock.calls.length + mockSet.mock.calls.length).toBeGreaterThan(0);
  expect(response?.status).toBe(503);
});

it('counts authentication time in the existing read budget', async () => {
  let authenticate!: (value: string) => void;
  uid.mockReturnValue(new Promise(resolve => { authenticate = resolve; }));
  let response: Response | undefined;
  void councils.GET(requestFor(routes[0])).then(value => { response = value; });
  await jest.advanceTimersByTimeAsync(2_500);
  authenticate('owner');
  await jest.advanceTimersByTimeAsync(600);
  expect(response?.status).toBe(503);
});

it.each(routes)('$name keeps an unauthenticated caller away from the store', async row => {
  uid.mockResolvedValue(null);
  admin.mockResolvedValue({ ok: false, response: new Response('{}', { status: 401 }) as never });
  const response = await row.run(requestFor(row));
  expect(response.status).toBe(401);
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockSet).not.toHaveBeenCalled();
  expect(adminDb.collection).not.toHaveBeenCalled();
});


it.each(routes.filter(row => ['model defaults save', 'entitlement save'].includes(row.name)))('$name also bounds the read after a successful write', async row => {
  mockSet.mockResolvedValue(undefined);
  let response: Response | undefined;
  void row.run(requestFor(row)).then(value => { response = value; });
  await jest.advanceTimersByTimeAsync(5_100);
  expect(mockSet).toHaveBeenCalledTimes(1);
  expect(mockGet).toHaveBeenCalled();
  expect(response?.status).toBe(503);
});

it('bounds a prompt review whose read succeeds but update stays silent', async () => {
  const row = routes.find(row => row.name === 'prompt review save')!;
  mockGet.mockResolvedValue({ exists: true, data: () => ({ promptName: 'qa-legacy-bounds-140-prompt' }) });
  let response: Response | undefined;
  void row.run(requestFor(row)).then(value => { response = value; });
  await jest.advanceTimersByTimeAsync(5_100);
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(response?.status).toBe(503);
});

it.each(routes.filter(row => row.method === 'DELETE'))('$name bounds a silent later batch without replaying completed batches', async row => {
  const docs = Array.from({ length: 501 }, (_, id) => ({ ref: { id: String(id) } }));
  mockGet.mockResolvedValue({ docs, size: docs.length });
  mockCommit.mockResolvedValueOnce(undefined);
  let response: Response | undefined;
  void row.run(requestFor(row)).then(value => { response = value; });
  await jest.advanceTimersByTimeAsync(5_100);
  expect(mockCommit).toHaveBeenCalledTimes(2);
  expect(response?.status).toBe(503);
});

it('lets an already-started review finish once after the refusal response', async () => {
  const row = routes.find(row => row.name === 'prompt review save')!;
  let finishRead!: (value: unknown) => void;
  mockGet.mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
  mockUpdate.mockResolvedValue(undefined);
  let response: Response | undefined;
  void row.run(requestFor(row)).then(value => { response = value; });
  await jest.advanceTimersByTimeAsync(5_100);
  expect(response?.status).toBe(503);
  expect(mockUpdate).not.toHaveBeenCalled();
  finishRead({ exists: true, data: () => ({ promptName: 'qa-legacy-bounds-140-prompt' }) });
  await jest.advanceTimersByTimeAsync(0);
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(response?.status).toBe(503);
});

it('does not label a slow Auth listing as a store outage when both store reads succeed', async () => {
  let finishAuth!: (value: { users: [] }) => void;
  jest.mocked(adminAuth.listUsers).mockReturnValue(new Promise(resolve => { finishAuth = resolve; }));
  mockGet.mockResolvedValue({ docs: [] });
  let response: Response | undefined;
  void users.GET(requestFor(routes[8])).then(value => { response = value; });
  await jest.advanceTimersByTimeAsync(5_100);
  expect(response).toBeUndefined();
  finishAuth({ users: [] });
  await jest.advanceTimersByTimeAsync(0);
  expect(response?.status).toBe(200);
});
