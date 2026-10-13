/** @jest-environment node */
import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { DELETE } from '@/api/tags/route';

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({ getRequiredAuthenticatedUid: jest.fn() }));
jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }) } }));

const request = () => new Request('http://localhost/api/tags?userId=u1&tagName=Examples', { method: 'DELETE' });

describe('Tags API Route', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses a shipped bundle\'s tag delete with data-engine-required, never 404 or 409', async () => {
    jest.mocked(getRequiredAuthenticatedUid).mockResolvedValue('u1');
    const response = await DELETE(request());
    expect(response.status).toBe(426);
    expect(await response.json()).toEqual({ code: 'data-engine-required', error: 'data-engine-required' });
  });

  it('answers an unknown caller 401 before anything else', async () => {
    jest.mocked(getRequiredAuthenticatedUid).mockResolvedValue(null);
    expect((await DELETE(request())).status).toBe(401);
  });
});
