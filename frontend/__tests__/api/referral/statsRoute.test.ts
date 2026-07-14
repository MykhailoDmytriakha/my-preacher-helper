jest.mock('@/config/firebaseAdminConfig', () => ({
  adminAuth: {
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

import { GET } from '@/api/referral/stats/route';

const { adminAuth, adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminAuth: { verifyIdToken: jest.Mock };
  adminDb: { collection: jest.Mock };
};

const whereMock = jest.fn();
const countMock = jest.fn();
const getMock = jest.fn();

describe('GET /api/referral/stats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    adminAuth.verifyIdToken.mockResolvedValue({ uid: 'caller-uid' });
    getMock.mockResolvedValue({ data: () => ({ count: 4 }) });
    countMock.mockReturnValue({ get: getMock });
    whereMock.mockReturnValue({ count: countMock });
    adminDb.collection.mockReturnValue({ where: whereMock });
  });

  it('returns 401 without a valid Bearer token', async () => {
    const missingResponse = await GET(new Request('http://localhost/api/referral/stats'));
    expect(missingResponse.status).toBe(401);

    adminAuth.verifyIdToken.mockRejectedValueOnce(new Error('revoked'));
    const invalidResponse = await GET(new Request('http://localhost/api/referral/stats', {
      headers: { authorization: 'Bearer invalid-token' },
    }));

    expect(invalidResponse.status).toBe(401);
    expect(invalidResponse.headers.get('Cache-Control')).toContain('no-store');
    expect(getMock).not.toHaveBeenCalled();
  });

  it('counts only referrals for the uid from the verified token', async () => {
    const request = new Request('http://localhost/api/referral/stats?uid=victim-uid', {
      headers: { authorization: 'Bearer valid-token' },
    });
    const bodyReader = jest.fn().mockResolvedValue({ uid: 'victim-uid' });
    Object.defineProperty(request, 'json', { value: bodyReader });

    const response = await GET(request);

    expect(adminAuth.verifyIdToken).toHaveBeenCalledWith('valid-token', true);
    expect(adminDb.collection).toHaveBeenCalledWith('referralEvents');
    expect(whereMock).toHaveBeenCalledWith('inviterUid', '==', 'caller-uid');
    expect(bodyReader).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    await expect(response.json()).resolves.toEqual({ invitedCount: 4 });
  });
});
