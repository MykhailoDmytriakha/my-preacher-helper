import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { GET } from '@/api/sermons/[id]/route';
import { __resetStoreAvailabilityForTests } from '@/services/storeAvailability.server';

const get = jest.fn();
jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: () => ({ doc: () => ({ get: () => get() }) }) } }));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn() }));
jest.mock('@repositories/sermons.repository', () => ({ sermonsRepository: {} }));
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

// BUG-20261019-routes-hang-when-store-refuses: the browser calls this read by itself with an 8 s
// timeout; a store that never answered held it to the wall, and the browser took that for "offline".
it('answers 503 "unavailable" within three seconds when the store does not answer', async () => {
  jest.useFakeTimers();
  let answer: Response | undefined;
  try {
    __resetStoreAvailabilityForTests();
    get.mockImplementation(() => new Promise(() => undefined));
    void run().then((response) => { answer = response as unknown as Response; });
    await jest.advanceTimersByTimeAsync(3_000);
    expect(answer?.status).toBe(503);
    expect(await answer?.json()).toEqual({ code: 'unavailable' });
  } finally {
    jest.useRealTimers();
    __resetStoreAvailabilityForTests();
  }
});
