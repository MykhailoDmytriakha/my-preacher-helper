import { QueryClient, dehydrate, hydrate } from '@tanstack/react-query';

import { fetchUserEntitlement, USER_ENTITLEMENT_QUERY_KEY } from '@/hooks/useUserEntitlement';

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
          ai: {
            used: 0,
            baseLimit: 100,
            hardCap: 110,
            baseRemaining: 100,
            graceRemaining: 10,
            state: 'normal',
            resetsAt: '2026-08-01T00:00:00.000Z',
          },
          transcription: {
            used: 0,
            baseLimit: 3600,
            hardCap: 3960,
            baseRemaining: 3600,
            graceRemaining: 360,
            state: 'normal',
            resetsAt: '2026-08-01T00:00:00.000Z',
          },
          audio: {
            used: 0,
            baseLimit: 1200,
            hardCap: 1320,
            baseRemaining: 1200,
            graceRemaining: 120,
            state: 'normal',
            resetsAt: '2026-08-01T00:00:00.000Z',
          },
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
        limits: {
          aiCallsPerPeriod: 100,
          transcriptionSecondsPerPeriod: 3600,
          audioSecondsPerPeriod: 1200,
        },
        paidTier: 'free',
      }),
    }) as jest.Mock;

    await fetchUserEntitlement({ getIdToken } as never);

    expect(global.fetch).toHaveBeenCalledWith('/api/me/entitlement', {
      headers: { Authorization: 'Bearer firebase-id-token' },
    });
  });

  it('hydrates a legacy persisted cache without exposing its stale shape under v2', () => {
    const persistedClient = new QueryClient();
    persistedClient.setQueryData(['me', 'entitlement', 'user-1'], {
      usage: { aiRemaining: 12 },
    });
    const state = dehydrate(persistedClient);
    const runtimeClient = new QueryClient();

    expect(() => hydrate(runtimeClient, state)).not.toThrow();
    expect(runtimeClient.getQueryData([...USER_ENTITLEMENT_QUERY_KEY, 'user-1'])).toBeUndefined();
  });
});
