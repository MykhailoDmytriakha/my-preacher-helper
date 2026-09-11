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
  serviceOrdersRepository: { listForOwner: jest.fn(), seedMissingForOwner: jest.fn() },
}));

const mockUid = getRequiredAuthenticatedUid as jest.MockedFunction<typeof getRequiredAuthenticatedUid>;
const mockList = serviceOrdersRepository.listForOwner as jest.Mock;
const mockSeed = serviceOrdersRepository.seedMissingForOwner as jest.Mock;

const request = (body?: unknown) =>
  new Request('http://localhost/api/service-orders', {
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const draft = (catalogKey: string) => ({
  catalogKey,
  title: 'Погребение',
  steps: [{ id: 's1', title: 'Перед началом', body: '', scriptureRefs: [] }],
  rank: 1000,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUid.mockResolvedValue('owner-1');
  mockList.mockResolvedValue([{ id: 'o1', userId: 'owner-1', title: 'Погребение', steps: [], rank: 1000 }]);
  mockSeed.mockImplementation(async (_uid: string, drafts: unknown[]) =>
    drafts.map((entry, index) => ({ id: `new-${index}`, ...(entry as object) }))
  );
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

describe('creating the standard set over HTTPS', () => {
  it('stores the rites under the verified caller, never under the name the payload claims', async () => {
    const response = await POST(request({ orders: [{ ...draft('funeral'), userId: 'someone-else' }] }));

    expect(response.status).toBe(201);
    const [uid, drafts] = mockSeed.mock.calls[0];
    expect(uid).toBe('owner-1');
    expect(drafts[0].userId).toBe('owner-1');
  });

  it('refuses a caller who brought no verified token', async () => {
    mockUid.mockResolvedValue(null);

    const response = await POST(request({ orders: [draft('funeral')] }));

    expect(response.status).toBe(401);
    expect(mockSeed).not.toHaveBeenCalled();
  });

  /**
   * Without its own key a rite cannot be told apart from one already stored, and "create only
   * what is missing" quietly becomes "create again" — which is the doubled set this route exists
   * to prevent.
   */
  it('refuses a rite that does not say which rite it is', async () => {
    const response = await POST(request({ orders: [{ title: 'Погребение', steps: [] }] }));

    expect(response.status).toBe(400);
    expect(mockSeed).not.toHaveBeenCalled();
  });

  /** An invented key is not a standard rite, and it travels on to places that expect only ten. */
  it('refuses a key that is not one of the ten rites', async () => {
    const response = await POST(request({ orders: [draft('constructor')] }));

    expect(response.status).toBe(400);
    expect(mockSeed).not.toHaveBeenCalled();
  });

  it('refuses the same rite twice in one request', async () => {
    const response = await POST(request({ orders: [draft('funeral'), draft('funeral')] }));

    expect(response.status).toBe(400);
    expect(mockSeed).not.toHaveBeenCalled();
  });

  /** Too long is refused, never shortened: a rite handed back with its words cut says nothing. */
  it('refuses text beyond the limits instead of trimming it', async () => {
    const response = await POST(
      request({ orders: [{ ...draft('funeral'), title: 'а'.repeat(201) }] })
    );

    expect(response.status).toBe(413);
    expect(mockSeed).not.toHaveBeenCalled();
  });

  it('refuses an empty request', async () => {
    const response = await POST(request({ orders: [] }));

    expect(response.status).toBe(400);
  });

  it('keeps only the fields a step is allowed to have', async () => {
    await POST(
      request({
        orders: [
          {
            ...draft('funeral'),
            steps: [
              { id: 's1', title: 'Перед началом', body: 'слова', scriptureRefs: ['Ин. 11:25'], secret: 'no' },
              { title: 'без имени' },
            ],
          },
        ],
      })
    );

    const [, drafts] = mockSeed.mock.calls[0];
    expect(drafts[0].steps).toEqual([
      { id: 's1', title: 'Перед началом', body: 'слова', scriptureRefs: ['Ин. 11:25'] },
    ]);
  });
});
