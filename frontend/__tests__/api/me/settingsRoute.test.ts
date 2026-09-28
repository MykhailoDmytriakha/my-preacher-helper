/** @jest-environment node */
import { GET, POST } from '@/api/me/settings/route';
import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { readOwnSettings, writeOwnSettings } from '@/data-engine/serverEdit.server';

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn() }));
jest.mock('@/data-engine/serverEdit.server', () => ({ readOwnSettings: jest.fn(), writeOwnSettings: jest.fn() }));
jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init: ResponseInit) => new Response(JSON.stringify(body), init) } }));
const caller = jest.mocked(getRequiredAuthenticatedUid);
const read = jest.mocked(readOwnSettings);
const write = jest.mocked(writeOwnSettings);
const request = (body?: unknown) => new Request('https://example.test/api/me/settings?userId=other', body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => { jest.clearAllMocks(); caller.mockResolvedValue('owner'); read.mockResolvedValue({ language: 'ru' }); write.mockResolvedValue(); });

it('requires authentication for both routes', async () => {
  caller.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect((await POST(request({ operation: 'bootstrap', patch: {} }))).status).toBe(401);
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

it('reads the verified owner only with non-cacheable responses', async () => {
  const response = await GET(request());
  expect(read).toHaveBeenCalledWith('owner');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  await expect(response.json()).resolves.toEqual({ settings: { language: 'ru', id: 'owner', userId: 'owner' } });
});

it('returns null for absent settings', async () => {
  read.mockResolvedValue(null);
  await expect((await GET(request())).json()).resolves.toEqual({ settings: null });
});

it('passes only the verified owner to the guarded bootstrap adapter', async () => {
  expect((await POST(request({ operation: 'bootstrap', patch: { displayName: 'Name' } }))).status).toBe(200);
  expect(write).toHaveBeenCalledWith('owner', 'bootstrap', { displayName: 'Name' });
});

it.each([
  { operation: 'bootstrap', patch: {}, userId: 'other' },
  { operation: 'unknown', patch: {} },
  { operation: ['legacy'], patch: { enablePrepMode: true } },
  { operation: ['bootstrap'], patch: { language: 'ru' } },
  { operation: 'bootstrap', patch: [] },
  { operation: 'bootstrap', patch: { displayName: 'x'.repeat(17000) } },
])('rejects malformed or oversized payloads', async body => {
  expect((await POST(request(body))).status).toBe(400);
  expect(write).not.toHaveBeenCalled();
});

it('preserves the terminal engine refusal and never returns it as a conflict document', async () => {
  write.mockRejectedValue(Object.assign(new Error('data-engine-required'), { code: 'data-engine-required', status: 426 }));
  const response = await POST(request({ operation: 'legacy', patch: { language: 'en' } }));
  expect(response.status).toBe(426);
  await expect(response.json()).resolves.toEqual({ code: 'data-engine-required', error: 'data-engine-required' });
});


it('uses the authenticated owner for heartbeat without accepting a body owner', async () => {
  expect((await POST(request({ operation: 'heartbeat', patch: {} }))).status).toBe(200);
  expect(write).toHaveBeenCalledWith('owner', 'heartbeat', {});
  write.mockClear();
  expect((await POST(request({ operation: 'heartbeat', patch: {}, userId: 'other' }))).status).toBe(400);
  expect(write).not.toHaveBeenCalled();
});
