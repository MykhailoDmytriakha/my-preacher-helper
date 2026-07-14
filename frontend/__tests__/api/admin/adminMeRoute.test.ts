jest.mock('@/api/admin/adminAuth', () => ({
  requireAdminEmail: jest.fn(),
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

import { GET } from '@/api/admin/me/route';

const { requireAdminEmail: mockRequireAdminEmail } = jest.requireMock('@/api/admin/adminAuth') as {
  requireAdminEmail: jest.Mock;
};

describe('GET /api/admin/me', () => {
  it('returns the admin gate response without replacing its status or body', async () => {
    const denial = { status: 403, json: async () => ({ error: 'Forbidden' }) };
    mockRequireAdminEmail.mockResolvedValue({ ok: false, response: denial });

    await expect(GET(new Request('http://localhost/api/admin/me'))).resolves.toBe(denial);
  });

  it('returns only the boolean admin signal for an authorized caller', async () => {
    mockRequireAdminEmail.mockResolvedValue({ ok: true, uid: 'admin-uid', email: 'owner@example.com' });

    const response = await GET(new Request('http://localhost/api/admin/me'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ admin: true });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
});
