import { DELETE } from 'app/api/series/[id]/route';

/**
 * DELETE /api/series/:id stays for shipped bundles. Series are deleted only through the data engine,
 * so a shipped bundle's delete is refused with 426 — never 404 or 409 — and nothing is touched.
 */

jest.mock('next/server', () => ({ NextResponse: { json: (data: unknown, options: { status?: number } = {}) => ({
  status: options.status ?? 200, json: async () => data,
}) } }));
const mockAuth = jest.fn();
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: (...args: unknown[]) => mockAuth(...args) }));
const request = () => new Request('http://localhost/api/series/s1', { method: 'DELETE' });

describe('/api/series/[id] DELETE', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses a caller without a verified token', async () => {
    mockAuth.mockResolvedValue(null);
    expect((await DELETE(request())).status).toBe(401);
  });

  it('refuses a shipped bundle\'s delete with the migration refusal', async () => {
    mockAuth.mockResolvedValue('user-1');
    const response = await DELETE(request());
    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toMatchObject({ code: 'data-engine-required' });
  });
});
