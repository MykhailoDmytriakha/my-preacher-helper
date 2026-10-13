import { DELETE } from '@/api/groups/[id]/route';

/**
 * DELETE /api/groups/:id stays for shipped bundles. Groups are deleted only through the data engine,
 * so a shipped bundle's delete is refused with 426 — never 404 or 409 — and nothing is touched.
 */

jest.mock('next/server', () => ({
  NextResponse: { json: jest.fn((data, options = {}) => ({ status: options.status ?? 200, json: async () => data })) },
}));
const mockAuth = jest.fn();
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: (...args: unknown[]) => mockAuth(...args) }));
const request = () => new Request('http://localhost/api/groups/g1', { method: 'DELETE' });

describe('/api/groups/[id] route', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses a caller without a verified token', async () => {
    mockAuth.mockResolvedValue(null);
    expect((await DELETE(request())).status).toBe(401);
  });

  it('refuses a shipped bundle\'s delete with the migration refusal', async () => {
    mockAuth.mockResolvedValue('owner');
    const response = await DELETE(request());
    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toMatchObject({ code: 'data-engine-required' });
  });
});
