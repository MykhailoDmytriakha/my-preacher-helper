import { getAuthenticatedIdentity } from '@/api/auth/getAuthenticatedIdentity.server';
import { adminAuth } from '@/config/firebaseAdminConfig';

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminAuth: { verifyIdToken: jest.fn() },
}));

const mockVerifyIdToken = adminAuth.verifyIdToken as jest.Mock;

const requestWithAuthorization = (authorization?: string): Request =>
  ({
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'authorization' ? authorization ?? null : null,
    },
  }) as unknown as Request;

describe('getAuthenticatedIdentity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns uid, email, and verification from one verified token decode', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-1',
      email: 'verified@example.com',
      email_verified: true,
    });

    await expect(
      getAuthenticatedIdentity(requestWithAuthorization('Bearer firebase-token'))
    ).resolves.toEqual({
      uid: 'user-1',
      email: 'verified@example.com',
      emailVerified: true,
    });
    expect(mockVerifyIdToken).toHaveBeenCalledTimes(1);
    expect(mockVerifyIdToken).toHaveBeenCalledWith('firebase-token');
  });

  it('preserves an unverified or missing token email only as untrusted claims', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: false });

    await expect(
      getAuthenticatedIdentity(requestWithAuthorization('Bearer token'))
    ).resolves.toEqual({ uid: 'user-1', email: undefined, emailVerified: false });
  });

  it.each([undefined, 'Basic token', 'Bearer   '])(
    'returns null without a usable bearer token: %s',
    async (authorization) => {
      await expect(
        getAuthenticatedIdentity(requestWithAuthorization(authorization))
      ).resolves.toBeNull();
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    }
  );

  it('returns null when verification fails or the decoded token has no uid', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('invalid token'));
    await expect(
      getAuthenticatedIdentity(requestWithAuthorization('Bearer bad'))
    ).resolves.toBeNull();

    mockVerifyIdToken.mockResolvedValueOnce({ email: 'nobody@example.com' });
    await expect(
      getAuthenticatedIdentity(requestWithAuthorization('Bearer no-uid'))
    ).resolves.toBeNull();
  });
});
