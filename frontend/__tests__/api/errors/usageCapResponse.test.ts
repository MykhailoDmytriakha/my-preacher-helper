jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    })),
  },
}));

import { usageCapResponse } from '@/api/errors/usageCapResponse';
import { UsageCapReachedError } from '@/services/usageLimits';

describe('usageCapResponse', () => {
  it('returns only the typed additive envelope with no raw message', async () => {
    const response = usageCapResponse(new UsageCapReachedError(
      'audio',
      1_320,
      1_200,
      1_320,
      '2026-08-01T00:00:00.000Z'
    ));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({
      code: 'USAGE_CAP_REACHED',
      resource: 'audio',
      used: 1_320,
      baseLimit: 1_200,
      hardCap: 1_320,
      resetsAt: '2026-08-01T00:00:00.000Z',
    });
    expect(body).not.toHaveProperty('message');
  });
});
