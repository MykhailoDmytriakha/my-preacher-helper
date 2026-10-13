import { POST } from 'app/api/prayer/route';

/**
 * POST /api/prayer stays for shipped bundles. Prayer requests are created only through the data
 * engine, so a shipped bundle's create is refused with 426 — never 409 — and nothing is stored.
 */

jest.mock('next/server', () => ({
  NextResponse: { json: jest.fn((data, options = {}) => ({ status: options.status ?? 200, json: async () => data })) },
}));
const mockAuth = jest.fn();
jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: (...args: unknown[]) => mockAuth(...args) }));
const request = () => ({ json: async () => ({ id: 'p1', userId: 'user-1', title: 'Healing' }) } as Request);

describe('prayer route', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses a caller without a verified token', async () => {
    mockAuth.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
  });

  it('refuses a shipped bundle\'s create with the migration refusal', async () => {
    mockAuth.mockResolvedValue('user-1');
    const response = await POST(request());
    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toMatchObject({ code: 'data-engine-required' });
  });
});
