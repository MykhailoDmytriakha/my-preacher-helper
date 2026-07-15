jest.mock('@/config/firebaseAdminConfig', () => ({
  adminAuth: {
    listUsers: jest.fn(),
    verifyIdToken: jest.fn(),
  },
  adminDb: {
    collection: jest.fn(),
  },
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

import { GET } from '@/api/admin/users/route';

const { adminAuth, adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminAuth: { listUsers: jest.Mock; verifyIdToken: jest.Mock };
  adminDb: { collection: jest.Mock };
};

const mockListUsers = adminAuth.listUsers;
const mockVerifyIdToken = adminAuth.verifyIdToken;
const mockCollection = adminDb.collection;
const mockUsersGet = jest.fn();
const mockReferralEventsGet = jest.fn();

const createRequest = (pageToken?: string, authenticated = true): Request => {
  const url = new URL('http://localhost/api/admin/users');
  if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken);
  return new Request(url, authenticated
    ? { headers: { authorization: 'Bearer valid-token' } }
    : undefined);
};

describe('GET /api/admin/users', () => {
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_EMAIL = 'owner@example.com';
    mockVerifyIdToken.mockResolvedValue({
      uid: 'admin-uid',
      email: 'owner@example.com',
      email_verified: true,
    });
    mockCollection.mockImplementation((collection: string) => ({
      get: collection === 'referralEvents' ? mockReferralEventsGet : mockUsersGet,
    }));
    mockUsersGet.mockResolvedValue({ docs: [] });
    mockReferralEventsGet.mockResolvedValue({ docs: [] });
    mockListUsers.mockResolvedValue({ users: [] });
  });

  afterAll(() => {
    if (originalAdminEmail === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = originalAdminEmail;
    }
  });

  it('returns 401 before reading any user data when Authorization is missing', async () => {
    const response = await GET(createRequest(undefined, false));

    expect(response.status).toBe(401);
    expect(mockListUsers).not.toHaveBeenCalled();
    expect(mockCollection).not.toHaveBeenCalled();
  });

  it('returns 403 before reading any user data for a non-admin token', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'other-uid',
      email: 'other@example.com',
      email_verified: true,
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    expect(mockListUsers).not.toHaveBeenCalled();
    expect(mockCollection).not.toHaveBeenCalled();
  });

  it('returns the allowlisted Auth fields merged with normalized entitlements', async () => {
    mockListUsers.mockResolvedValue({
      users: [
        {
          uid: 'older-user',
          email: 'older@example.com',
          emailVerified: false,
          disabled: false,
          metadata: {
            lastSignInTime: '2026-07-01T10:00:00.000Z',
            creationTime: '2026-01-01T10:00:00.000Z',
          },
        },
        {
          uid: 'recent-user',
          email: 'recent@example.com',
          emailVerified: true,
          disabled: true,
          metadata: {
            lastSignInTime: '2026-07-12T10:00:00.000Z',
            creationTime: '2026-02-01T10:00:00.000Z',
          },
        },
      ],
      pageToken: 'next-auth-page',
    });
    mockUsersGet.mockResolvedValue({
      docs: [
        {
          id: 'recent-user',
          data: () => ({
            paidTier: 'tier1',
            lastSeenAt: '2026-07-13T09:30:00.000Z',
            promotion: { tier: 'tier3', expiresAt: '2099-01-01T00:00:00.000Z' },
            usage: { aiUsed: 7, transcriptionSecondsUsed: 120, audioSecondsUsed: 45 },
            role: 'admin',
            referredBy: 'inviter-uid',
            providerData: [{ secret: 'must-not-leak' }],
          }),
        },
      ],
    });
    mockReferralEventsGet.mockResolvedValue({
      docs: [
        { data: () => ({ inviterUid: 'recent-user' }) },
        { data: () => ({ inviterUid: 'recent-user' }) },
        { data: () => ({ inviterUid: 'other-user' }) },
        { data: () => ({ inviterUid: 42 }) },
      ],
    });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(mockListUsers).toHaveBeenCalledWith(1000, undefined);
    expect(mockCollection).toHaveBeenCalledWith('users');
    expect(mockCollection).toHaveBeenCalledWith('referralEvents');
    expect(mockUsersGet).toHaveBeenCalledTimes(1);
    expect(mockReferralEventsGet).toHaveBeenCalledTimes(1);
    expect(body.nextPageToken).toBe('next-auth-page');
    expect(body.users.map((user: { uid: string }) => user.uid)).toEqual([
      'recent-user',
      'older-user',
    ]);
    expect(body.users[0]).toEqual(expect.objectContaining({
      uid: 'recent-user',
      email: 'recent@example.com',
      emailVerified: true,
      disabled: true,
      lastSignInTime: '2026-07-12T10:00:00.000Z',
      lastSeenAt: '2026-07-13T09:30:00.000Z',
      creationTime: '2026-02-01T10:00:00.000Z',
      paidTier: 'tier1',
      effectiveTier: 'tier3',
      role: 'admin',
      referredBy: 'inviter-uid',
      referralCount: 2,
      usage: expect.objectContaining({ aiUsed: 7, transcriptionSecondsUsed: 120, audioSecondsUsed: 45 }),
    }));
    expect(body.users[0]).not.toHaveProperty('providerData');
    expect(body.users[1]).toEqual(expect.objectContaining({
      uid: 'older-user',
      lastSignInTime: '2026-07-01T10:00:00.000Z',
      lastSeenAt: null,
      paidTier: 'free',
      effectiveTier: 'free',
      referralCount: 0,
      usage: expect.objectContaining({ aiUsed: 0, transcriptionSecondsUsed: 0, audioSecondsUsed: 0 }),
    }));
  });

  it('passes the forward page token to Firebase Auth unchanged', async () => {
    await GET(createRequest('opaque+/= token'));

    expect(mockListUsers).toHaveBeenCalledWith(1000, 'opaque+/= token');
  });

  it('returns a no-store 500 without leaking Firebase errors', async () => {
    mockListUsers.mockRejectedValue(new Error('sensitive Firebase details'));

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
  });
});
