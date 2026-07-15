jest.mock('@/config/firebaseAdminConfig', () => ({
  adminAuth: {
    verifyIdToken: jest.fn(),
  },
  adminDb: {
    collection: jest.fn(),
  },
}));

jest.mock('@/services/userEntitlement.server', () => ({
  getUserEntitlementServerSide: jest.fn(),
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((body, init = {}) => ({
      status: init.status ?? 200,
      headers: new Headers(init.headers),
      json: async () => body,
    })),
  },
}));

import { POST } from '@/api/admin/users/[uid]/entitlement/route';

const { adminAuth, adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminAuth: { verifyIdToken: jest.Mock };
  adminDb: { collection: jest.Mock };
};
const { getUserEntitlementServerSide: mockGetUserEntitlementServerSide } = jest.requireMock(
  '@/services/userEntitlement.server'
) as { getUserEntitlementServerSide: jest.Mock };
const mockSet = jest.fn();
const mockDoc = jest.fn(() => ({ set: mockSet }));
const mockCollection = adminDb.collection;
const mockVerifyIdToken = adminAuth.verifyIdToken;

const createRequest = (body: unknown) => new Request(
  'http://localhost/api/admin/users/user-1/entitlement',
  {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }
);

describe('POST /api/admin/users/[uid]/entitlement', () => {
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_EMAIL = 'owner@example.com';
    mockCollection.mockReturnValue({ doc: mockDoc });
    mockVerifyIdToken.mockResolvedValue({
      uid: 'admin-uid',
      email: 'owner@example.com',
      email_verified: true,
    });
    mockSet.mockResolvedValue(undefined);
  });

  afterAll(() => {
    if (originalAdminEmail === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = originalAdminEmail;
    }
  });

  it('writes paid tier and promotion through Admin SDK and returns the readback', async () => {
    const promotion = { tier: 'tier3', expiresAt: '2026-08-12T12:00:00.000Z' };
    const entitlement = {
      paidTier: 'tier2',
      promotion,
      usage: {
        aiUsed: 0,
        transcriptionSecondsUsed: 0,
        audioSecondsUsed: 0,
        periodStart: '2026-07-01T00:00:00.000Z',
      },
    };
    mockGetUserEntitlementServerSide.mockResolvedValue(entitlement);

    const response = await POST(createRequest({ paidTier: 'tier2', promotion }), {
      params: Promise.resolve({ uid: 'user-1' }),
    });

    expect(mockCollection).toHaveBeenCalledWith('users');
    expect(mockDoc).toHaveBeenCalledWith('user-1');
    expect(mockSet).toHaveBeenCalledWith({ paidTier: 'tier2', promotion }, { merge: true });
    expect(mockGetUserEntitlementServerSide).toHaveBeenCalledWith('user-1');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(entitlement);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('preserves explicit promotion clearing and partial usage updates', async () => {
    const body = {
      promotion: null,
      usage: { aiUsed: 12, audioSecondsUsed: 27.5 },
      role: 'admin',
    };
    mockGetUserEntitlementServerSide.mockResolvedValue({
      paidTier: 'free',
      usage: {
        aiUsed: 12,
        transcriptionSecondsUsed: 0,
        audioSecondsUsed: 27.5,
        periodStart: '2026-07-01T00:00:00.000Z',
      },
    });

    const response = await POST(createRequest(body), {
      params: Promise.resolve({ uid: 'user-1' }),
    });

    expect(mockSet).toHaveBeenCalledWith(body, { merge: true });
    expect(response.status).toBe(200);
  });

  it('returns 403 without touching Firestore for an unverified admin-email token', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'attacker-uid',
      email: 'owner@example.com',
      email_verified: false,
    });

    const response = await POST(createRequest({ paidTier: 'tier2' }), {
      params: Promise.resolve({ uid: 'user-1' }),
    });

    expect(response.status).toBe(403);
    expect(mockCollection).not.toHaveBeenCalled();
  });

  it.each([
    [{ paidTier: 'enterprise' }, 'bad tier'],
    [{ promotion: { tier: 'tier2', expiresAt: 'not-a-date' } }, 'garbage expiry'],
    [{ promotion: { tier: 'tier2', expiresAt: '2026-08-12T12:00:00' } }, 'expiry without offset'],
    [{ promotion: { tier: 'tier2', expiresAt: '2026-08-12T12:00:00+99:99' } }, 'invalid offset'],
    [{ usage: { aiUsed: -1 } }, 'negative usage'],
    [{ usage: { audioSecondsUsed: -1 } }, 'negative audio usage'],
    [{ usage: { periodStart: '2026-07-01T00:00:00' } }, 'period anchor without offset'],
    [{ paidTier: 'tier2', injected: true }, 'unknown root field'],
    [{ usage: { aiUsed: 1, injected: true } }, 'unknown nested field'],
    [{}, 'empty patch'],
  ])('returns 400 for %s (%s)', async (body, _label) => {
    const response = await POST(createRequest(body), {
      params: Promise.resolve({ uid: 'user-1' }),
    });

    expect(response.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    const request = new Request('http://localhost/api/admin/users/user-1/entitlement', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': 'application/json',
      },
      body: '{',
    });

    const response = await POST(request, {
      params: Promise.resolve({ uid: 'user-1' }),
    });

    expect(response.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('rejects a uid that could escape the intended document segment', async () => {
    const response = await POST(createRequest({ paidTier: 'tier2' }), {
      params: Promise.resolve({ uid: 'user/another' }),
    });

    expect(response.status).toBe(400);
    expect(mockDoc).not.toHaveBeenCalled();
  });

  it.each(['.', '..', '...'])(
    'rejects an all-dots uid (%s) at the schema boundary',
    async (uid) => {
      const response = await POST(createRequest({ paidTier: 'tier2' }), {
        params: Promise.resolve({ uid }),
      });

      expect(response.status).toBe(400);
      expect(mockCollection).not.toHaveBeenCalled();
    }
  );

  it('returns 500 without exposing the database error', async () => {
    mockSet.mockRejectedValue(new Error('sensitive database details'));

    const response = await POST(createRequest({ paidTier: 'tier2' }), {
      params: Promise.resolve({ uid: 'user-1' }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
  });
});
