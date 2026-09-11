import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { GET } from '@/api/owner-list/route';

/**
 * A NEW DOOR INTO THE APP IS A DOOR, and a door is checked.
 *
 * This route exists because the browser's own Firestore goes silent on one of the owner's
 * devices. It reads with an admin key, which bypasses the Security Rules — so everything those
 * rules would have said has to be said here: who is asking, which collections may be asked for,
 * and whose documents come back.
 */

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((data, options = {}) => ({ status: options.status ?? 200, json: async () => data })),
  },
}));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn(),
}));

const where = jest.fn();
const orderBy = jest.fn();
const limit = jest.fn();
const startAfter = jest.fn();
const get = jest.fn();
const collection = jest.fn();

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: { collection: (name: string) => collection(name) },
}));

const query = {
  where: (...args: unknown[]) => { where(...args); return query; },
  orderBy: (...args: unknown[]) => { orderBy(...args); return query; },
  limit: (...args: unknown[]) => { limit(...args); return query; },
  startAfter: (...args: unknown[]) => { startAfter(...args); return query; },
  get: () => get(),
};

const mockUid = getRequiredAuthenticatedUid as jest.MockedFunction<typeof getRequiredAuthenticatedUid>;

const page = (count: number, from = 0) => ({
  size: count,
  docs: Array.from({ length: count }, (_, index) => ({
    id: `d${from + index}`,
    data: () => ({ userId: 'owner-1', title: `Документ ${from + index}` }),
  })),
});

const request = (collectionName: string) =>
  new Request(`http://localhost/api/owner-list?collection=${collectionName}`);

beforeEach(() => {
  jest.clearAllMocks();
  mockUid.mockResolvedValue('owner-1');
  collection.mockReturnValue(query);
  get.mockResolvedValue(page(2));
});

it('answers the caller with his own documents', async () => {
  const response = await GET(request('sermons'));

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual([
    { userId: 'owner-1', title: 'Документ 0', id: 'd0' },
    { userId: 'owner-1', title: 'Документ 1', id: 'd1' },
  ]);
  expect(where).toHaveBeenCalledWith('userId', '==', 'owner-1');
});

it('refuses a caller who brought no verified token', async () => {
  mockUid.mockResolvedValue(null);

  const response = await GET(request('sermons'));

  expect(response.status).toBe(401);
  expect(collection).not.toHaveBeenCalled();
});

/** A route that reads "whatever the caller names" is a route that reads everything. */
it.each(['users', 'feedback', 'admin', '', 'sermons/../users'])(
  'refuses a collection that is not on the list: %s',
  async (name) => {
    const response = await GET(request(encodeURIComponent(name)));

    expect(response.status).toBe(400);
    expect(collection).not.toHaveBeenCalled();
  }
);

it('never lets one caller be answered from another caller\'s cached response', async () => {
  await GET(request('sermons'));

  expect(NextResponse.json).toHaveBeenCalledWith(expect.anything(), {
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' },
  });
});

/**
 * The browser's own query has no limit, so a limit here would quietly lose documents — and the
 * calendar, which filters by date after reading, would drop a sermon without a word.
 */
it('follows the pages to the end instead of returning the first of them', async () => {
  get.mockResolvedValueOnce(page(500)).mockResolvedValueOnce(page(3, 500));

  const response = await GET(request('sermons'));

  await expect(response.json()).resolves.toHaveLength(503);
  expect(startAfter).toHaveBeenCalledTimes(1);
});

it('refuses a list too long to read this way rather than shortening it', async () => {
  get.mockResolvedValue(page(500));

  const response = await GET(request('sermons'));

  expect(response.status).toBe(507);
});
