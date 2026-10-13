import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { GET, POST } from '@/api/service-orders/route';
import { serviceOrdersRepository } from '@repositories/serviceOrders.repository';

/**
 * THE SECOND ROAD IS STILL A DOOR, and a door is checked.
 *
 * This route exists because the browser's own Firestore goes silent on one of the owner's
 * devices. It reaches the database with an admin key, which bypasses the Security Rules — so
 * the rule those rules would have enforced is written out here instead: every answer belongs to
 * the verified caller, and nothing in the payload can say otherwise.
 */

// jsdom has no `Response.json`; the route only ever speaks through NextResponse, so the
// envelope is stubbed and the route's own decisions stay real.
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((data, options = {}) => ({
      status: options.status ?? 200,
      headers: new Map(Object.entries(options.headers ?? {})),
      json: async () => data,
    })),
  },
}));
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn(),
}));
jest.mock('@repositories/serviceOrders.repository', () => ({
  serviceOrdersRepository: { listForOwner: jest.fn() },
}));

const mockUid = getRequiredAuthenticatedUid as jest.MockedFunction<typeof getRequiredAuthenticatedUid>;
const mockList = serviceOrdersRepository.listForOwner as jest.Mock;

const request = (body?: unknown) =>
  new Request('http://localhost/api/service-orders', {
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockUid.mockResolvedValue('owner-1');
  mockList.mockResolvedValue([{ id: 'o1', userId: 'owner-1', title: 'Погребение', steps: [], rank: 1000 }]);
});

describe('reading the rites over HTTPS', () => {
  it('answers the caller with his own rites', async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toHaveLength(1);
    expect(mockList).toHaveBeenCalledWith('owner-1');
  });

  it('refuses a caller who brought no verified token', async () => {
    mockUid.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  /** A read meant to prove what the server holds must not be answered by something in between. */
  it('forbids caching the answer', async () => {
    await GET(request());

    expect(NextResponse.json).toHaveBeenCalledWith(expect.anything(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  });
});

// Seeding the standard set is the data engine's; a shipped bundle's seed is refused with 426.
it('refuses a shipped bundle\'s seed with the migration refusal and lists nothing', async () => {
  const response = await POST(request({ orders: [{ catalogKey: 'funeral', title: 'Погребение', steps: [], rank: 1000 }] }));
  expect(response.status).toBe(426);
  expect(await response.json()).toMatchObject({ code: 'data-engine-required' });
  expect(mockList).not.toHaveBeenCalled();
});
