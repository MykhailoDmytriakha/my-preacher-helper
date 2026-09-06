import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { GET } from '@/api/sermons/[id]/route';

const get = jest.fn();
jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: () => ({ doc: () => ({ get: () => get() }) }) } }));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn() }));
jest.mock('@repositories/sermons.repository', () => ({ sermonsRepository: {} }));
jest.mock('@repositories/series.repository', () => ({ seriesRepository: {} }));
jest.mock('next/server', () => ({ NextResponse: { json: jest.fn((data, options = {}) => ({ status: options.status ?? 200, json: async () => data })) } }));

const run = () => GET({} as Request, { params: Promise.resolve({ id: 'sermon' }) });
beforeEach(() => {
  jest.clearAllMocks();
  (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue('owner');
  get.mockResolvedValue({ id: 'sermon', exists: true, data: () => ({ userId: 'owner', title: 'New' }) });
});

it('returns the owner document and forbids response caching', async () => {
  const result = await run();
  expect(await result.json()).toEqual({ id: 'sermon', userId: 'owner', title: 'New' });
  expect(NextResponse.json).toHaveBeenCalledWith(expect.anything(), { headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } });
});
it('does not access the database without verified authentication', async () => {
  (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue(null);
  expect((await run()).status).toBe(401);
  expect(get).not.toHaveBeenCalled();
});
it('does not return another owners document', async () => {
  get.mockResolvedValue({ id: 'sermon', exists: true, data: () => ({ userId: 'other', title: 'Secret' }) });
  const result = await run();
  expect(result.status).toBe(403);
  expect(await result.json()).toEqual({ error: 'Forbidden' });
});
it('distinguishes a missing document from a database failure', async () => {
  get.mockResolvedValueOnce({ exists: false });
  expect((await run()).status).toBe(404);
  get.mockRejectedValueOnce(new Error('database unavailable'));
  expect((await run()).status).toBe(503);
});
