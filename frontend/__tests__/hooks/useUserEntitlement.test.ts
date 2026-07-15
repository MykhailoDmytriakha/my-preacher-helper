import { fetchUserEntitlement } from '@/hooks/useUserEntitlement';

describe('fetchUserEntitlement', () => {
  const getIdToken = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    getIdToken.mockResolvedValue('firebase-id-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('attaches the current Firebase token to the own-entitlement request', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        effectiveTier: 'free',
        availableModels: [],
        preferred: {},
        usage: {
          aiLimit: 100,
          aiUsed: 0,
          aiRemaining: 100,
          transcriptionSecondsLimit: 3600,
          transcriptionSecondsUsed: 0,
          transcriptionSecondsRemaining: 3600,
          audioSecondsUsed: 0,
          aiBlocked: false,
          transcriptionBlocked: false,
          periodResets: false,
        },
        limits: { aiCallsPerPeriod: 100, transcriptionSecondsPerPeriod: 3600 },
        paidTier: 'free',
      }),
    }) as jest.Mock;

    await fetchUserEntitlement({ getIdToken } as never);

    expect(global.fetch).toHaveBeenCalledWith('/api/me/entitlement', {
      headers: { Authorization: 'Bearer firebase-id-token' },
    });
  });
});
