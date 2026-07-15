import type { UserEntitlement } from '@/models/models';

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
  },
}));

import {
  getUserEntitlementServerSide,
  resolveEffectiveTier,
} from '@/services/userEntitlement.server';

const { adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminDb: { collection: jest.Mock };
};
const mockCollection = adminDb.collection;
const mockGet = jest.fn();
const mockDoc = jest.fn(() => ({ get: mockGet }));

const now = new Date('2026-07-12T12:00:00.000Z');

describe('resolveEffectiveTier', () => {
  it('returns the paid tier when there is no promotion', () => {
    expect(resolveEffectiveTier({ paidTier: 'tier2' }, now)).toBe('tier2');
  });

  it('keeps the paid tier when an active promotion is lower', () => {
    const entitlement: UserEntitlement = {
      paidTier: 'tier4',
      promotion: { tier: 'tier1', expiresAt: '2026-07-13T12:00:00.000Z' },
    };

    expect(resolveEffectiveTier(entitlement, now)).toBe('tier4');
  });

  it('returns an active promotion when it is higher than the paid tier', () => {
    const entitlement: UserEntitlement = {
      paidTier: 'tier1',
      promotion: { tier: 'tier4', expiresAt: '2026-07-13T12:00:00.000Z' },
    };

    expect(resolveEffectiveTier(entitlement, now)).toBe('tier4');
  });

  it('falls back to the paid tier for an expired or exactly-now promotion', () => {
    expect(resolveEffectiveTier({
      paidTier: 'tier2',
      promotion: { tier: 'tier3', expiresAt: '2026-07-12T11:59:59.999Z' },
    }, now)).toBe('tier2');
    expect(resolveEffectiveTier({
      paidTier: 'tier2',
      promotion: { tier: 'tier3', expiresAt: '2026-07-12T12:00:00.000Z' },
    }, now)).toBe('tier2');
  });

  it('falls back to the paid tier for invalid or missing promotion expiry', () => {
    expect(resolveEffectiveTier({
      paidTier: 'tier2',
      promotion: { tier: 'tier3', expiresAt: 'not-an-iso-date' },
    }, now)).toBe('tier2');
    expect(resolveEffectiveTier({
      paidTier: 'tier2',
      promotion: { tier: 'tier3' },
    } as UserEntitlement, now)).toBe('tier2');
  });

  it('defaults missing entitlement values to free', () => {
    expect(resolveEffectiveTier(null, now)).toBe('free');
    expect(resolveEffectiveTier(undefined, now)).toBe('free');
  });
});

describe('getUserEntitlementServerSide', () => {
  const periodStart = '2026-07-01T00:00:00.000Z';

  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection.mockReturnValue({ doc: mockDoc });
  });

  it('returns free tier and zero usage when the user document is missing', async () => {
    mockGet.mockResolvedValue({ exists: false });

    await expect(getUserEntitlementServerSide('user-1')).resolves.toEqual({
      paidTier: 'free',
      usage: { aiUsed: 0, transcriptionSecondsUsed: 0, audioSecondsUsed: 0, periodStart: expect.any(String) },
    });
    expect(mockCollection).toHaveBeenCalledWith('users');
    expect(mockDoc).toHaveBeenCalledWith('user-1');
  });

  it('normalizes present entitlement fields and defaults missing usage values', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        paidTier: 'tier2',
        lastSeenAt: '2026-07-12T11:00:00.000Z',
        promotion: { tier: 'tier3', expiresAt: '2026-08-01T00:00:00.000Z' },
        usage: { aiUsed: 12, periodStart },
      }),
    });

    await expect(getUserEntitlementServerSide('user-1')).resolves.toEqual({
      paidTier: 'tier2',
      lastSeenAt: '2026-07-12T11:00:00.000Z',
      promotion: { tier: 'tier3', expiresAt: '2026-08-01T00:00:00.000Z' },
      usage: { aiUsed: 12, transcriptionSecondsUsed: 0, audioSecondsUsed: 0, periodStart },
    });
  });

  it('returns normalized text preferences from the same read only when requested', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        paidTier: 'tier2',
        preferredProviderId: 'gemini',
        preferredModelId: 'gemini-2.5-flash-lite',
      }),
    });

    await expect(getUserEntitlementServerSide('user-1', {
      includeTextPreference: true,
    })).resolves.toEqual({
      paidTier: 'tier2',
      usage: { aiUsed: 0, transcriptionSecondsUsed: 0, audioSecondsUsed: 0, periodStart: expect.any(String) },
      preferredProviderId: 'gemini',
      preferredModelId: 'gemini-2.5-flash-lite',
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('normalizes all three per-function preferences only for the server model read', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        preferredTranscription: { providerId: 'openai', modelId: 'gpt-4o-mini-transcribe' },
        preferredText: { providerId: 'openrouter', modelId: 'qwen/qwen3.7-plus' },
        preferredTts: { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' },
      }),
    });

    await expect(getUserEntitlementServerSide('user-1', {
      includeModelPreferences: true,
    })).resolves.toMatchObject({
      paidTier: 'free',
      preferredTranscription: { providerId: 'openai', modelId: 'gpt-4o-mini-transcribe' },
      preferredText: { providerId: 'openrouter', modelId: 'qwen/qwen3.7-plus' },
      preferredTts: { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' },
    });
  });

  it('falls back safely for missing or malformed stored fields', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        paidTier: 'enterprise',
        promotion: { tier: 'tier4' },
        lastSeenAt: 42,
        usage: { aiUsed: -1, transcriptionSecondsUsed: '60' },
        preferredProviderId: 'microsoft',
        preferredModelId: 42,
      }),
    });

    await expect(getUserEntitlementServerSide('user-1', {
      includeTextPreference: true,
    })).resolves.toEqual({
      paidTier: 'free',
      usage: { aiUsed: 0, transcriptionSecondsUsed: 0, audioSecondsUsed: 0, periodStart: expect.any(String) },
    });
  });

  it.each(['not-a-record', 42])(
    'defaults garbage scalar fields safely when promotion is %p',
    async (promotion) => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          paidTier: 4,
          promotion,
          usage: { aiUsed: Number.NaN, transcriptionSecondsUsed: Number.POSITIVE_INFINITY },
        }),
      });

      await expect(getUserEntitlementServerSide('user-1')).resolves.toEqual({
        paidTier: 'free',
        usage: { aiUsed: 0, transcriptionSecondsUsed: 0, audioSecondsUsed: 0, periodStart: expect.any(String) },
      });
    }
  );

  it('normalizes legacy usage names without losing stored counters', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        usage: { aiUsage: 7, transcriptionSeconds: 42 },
      }),
    });

    await expect(getUserEntitlementServerSide('legacy-user')).resolves.toEqual({
      paidTier: 'free',
      usage: {
        aiUsed: 7,
        transcriptionSecondsUsed: 42,
        audioSecondsUsed: 0,
        periodStart: expect.any(String),
      },
    });
  });

  it('defaults audio usage for entitlement data persisted before audio metering', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        usage: { aiUsed: 3, transcriptionSecondsUsed: 15, periodStart },
      }),
    });

    await expect(getUserEntitlementServerSide('stale-user')).resolves.toMatchObject({
      usage: {
        aiUsed: 3,
        transcriptionSecondsUsed: 15,
        audioSecondsUsed: 0,
        periodStart,
      },
    });
  });
});
