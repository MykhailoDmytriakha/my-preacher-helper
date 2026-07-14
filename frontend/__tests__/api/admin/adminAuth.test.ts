jest.mock('@/config/firebaseAdminConfig', () => ({
  adminAuth: {
    verifyIdToken: jest.fn(),
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

import { requireAdminEmail } from '@/api/admin/adminAuth';

const { adminAuth } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminAuth: { verifyIdToken: jest.Mock };
};
const mockVerifyIdToken = adminAuth.verifyIdToken;

describe('requireAdminEmail', () => {
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_EMAIL = ' owner@example.com ';
  });

  afterAll(() => {
    if (originalAdminEmail === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = originalAdminEmail;
    }
  });

  it('returns the verified identity when the normalized emails match', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'admin-uid',
      email: '  OWNER@EXAMPLE.COM  ',
      email_verified: true,
    });

    await expect(requireAdminEmail(new Request('http://localhost/api/admin', {
      headers: { authorization: 'Bearer valid-token' },
    }))).resolves.toEqual({
      ok: true,
      uid: 'admin-uid',
      email: 'owner@example.com',
    });
    expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-token', true);
  });

  it('returns 403 for a verified non-admin email', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-uid',
      email: 'user@example.com',
      email_verified: true,
    });

    const result = await requireAdminEmail(new Request('http://localhost/api/admin', {
      headers: { authorization: 'Bearer valid-token' },
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      expect(result.response.headers.get('Cache-Control')).toContain('no-store');
    }
  });

  it('returns 403 when the admin email is present but email_verified is false', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'admin-uid',
      email: 'owner@example.com',
      email_verified: false,
    });

    const result = await requireAdminEmail(new Request('http://localhost/api/admin', {
      headers: { authorization: 'Bearer valid-token' },
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('returns 403 when the admin email is present but email_verified is absent', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'admin-uid',
      email: 'owner@example.com',
    });

    const result = await requireAdminEmail(new Request('http://localhost/api/admin', {
      headers: { authorization: 'Bearer valid-token' },
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it.each([undefined, '   '])(
    'returns 403 when a verified token has no usable email (%p)',
    async (email) => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'user-uid', email });

      const result = await requireAdminEmail(new Request('http://localhost/api/admin', {
        headers: { authorization: 'Bearer valid-token' },
      }));

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
    }
  );

  it('returns 401 when the bearer token is missing', async () => {
    const result = await requireAdminEmail(new Request('http://localhost/api/admin'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it('returns 401 when the bearer token is empty', async () => {
    const result = await requireAdminEmail(new Request('http://localhost/api/admin', {
      headers: { authorization: 'Bearer    ' },
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it('returns 401 when Firebase rejects the bearer token', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('invalid token'));

    const result = await requireAdminEmail(new Request('http://localhost/api/admin', {
      headers: { authorization: 'Bearer invalid-token' },
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('returns 401 when Firebase reports that the token was revoked', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('auth/id-token-revoked'));

    const result = await requireAdminEmail(new Request('http://localhost/api/admin', {
      headers: { authorization: 'Bearer revoked-token' },
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(mockVerifyIdToken).toHaveBeenCalledWith('revoked-token', true);
  });

  it('returns 401 if a decoded token unexpectedly has no uid', async () => {
    mockVerifyIdToken.mockResolvedValue({ email: 'owner@example.com' });

    const result = await requireAdminEmail(new Request('http://localhost/api/admin', {
      headers: { authorization: 'Bearer valid-token' },
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it.each([undefined, '', '   '])(
    'returns 503 when ADMIN_EMAIL is not configured (%p)',
    async (adminEmail) => {
      if (adminEmail === undefined) {
        delete process.env.ADMIN_EMAIL;
      } else {
        process.env.ADMIN_EMAIL = adminEmail;
      }
      mockVerifyIdToken.mockResolvedValue({
        uid: 'admin-uid',
        email: 'owner@example.com',
        email_verified: true,
      });

      const result = await requireAdminEmail(new Request('http://localhost/api/admin', {
        headers: { authorization: 'Bearer valid-token' },
      }));

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(503);
    }
  );
});
