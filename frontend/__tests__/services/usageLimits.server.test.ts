jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
    runTransaction: jest.fn(),
  },
}));

import { TIER_LIMITS } from '@/api/clients/ai/tierPolicy';
import {
  assertAiUsageAvailable,
  assertTranscriptionUsageAvailable,
  consumeAiUsage,
  consumeAudioSeconds,
  consumeTranscriptionSeconds,
  resolveUsageRemaining,
  UsageExhaustedError,
} from '@/services/usageLimits.server';

const { adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminDb: { collection: jest.Mock; runTransaction: jest.Mock };
};

const now = new Date('2026-07-12T12:00:00.000Z');
const currentPeriod = '2026-07-01T00:00:00.000Z';
const mockUserRef = { path: 'users/user-1' };
const mockDoc = jest.fn(() => mockUserRef);
const transactionGet = jest.fn();
const transactionSet = jest.fn();

describe('usage limits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    adminDb.collection.mockReturnValue({ doc: mockDoc });
    adminDb.runTransaction.mockImplementation(async (callback) => callback({
      get: transactionGet,
      set: transactionSet,
    }));
  });

  it('does not block a free user with used=0', () => {
    const remaining = resolveUsageRemaining({
      paidTier: 'free',
      usage: { aiUsed: 0, transcriptionSecondsUsed: 0, audioSecondsUsed: 0, periodStart: currentPeriod },
    }, now);

    expect(TIER_LIMITS.free.aiCallsPerPeriod).toBeGreaterThan(0);
    expect(remaining.aiLimit).toBe(100);
    expect(remaining.aiUsed).toBe(0);
    expect(remaining.aiRemaining).toBe(TIER_LIMITS.free.aiCallsPerPeriod);
    expect(remaining.transcriptionSecondsLimit).toBe(3600);
    expect(remaining.transcriptionSecondsUsed).toBe(0);
    expect(remaining.audioSecondsUsed).toBe(0);
    expect(remaining.aiBlocked).toBe(false);
    expect(remaining.transcriptionBlocked).toBe(false);
  });

  it('returns the current period limits and post-reset used values for partial usage', () => {
    const remaining = resolveUsageRemaining({
      paidTier: 'free',
      usage: { aiUsed: 40, transcriptionSecondsUsed: 900, audioSecondsUsed: 0, periodStart: currentPeriod },
    }, now);

    expect(remaining).toMatchObject({
      aiLimit: 100,
      aiUsed: 40,
      aiRemaining: 60,
      transcriptionSecondsLimit: 3600,
      transcriptionSecondsUsed: 900,
      transcriptionSecondsRemaining: 2700,
      audioSecondsUsed: 0,
      periodResets: false,
    });
  });

  it('blocks exactly at and above the AI limit', () => {
    const atLimit = {
      paidTier: 'free' as const,
      usage: {
        aiUsed: TIER_LIMITS.free.aiCallsPerPeriod,
        transcriptionSecondsUsed: 0,
        audioSecondsUsed: 0,
        periodStart: currentPeriod,
      },
    };
    const overLimit = {
      ...atLimit,
      usage: { ...atLimit.usage, aiUsed: TIER_LIMITS.free.aiCallsPerPeriod + 1 },
    };

    expect(resolveUsageRemaining(atLimit, now).aiBlocked).toBe(true);
    expect(resolveUsageRemaining(overLimit, now).aiBlocked).toBe(true);
    expect(() => assertAiUsageAvailable(atLimit, now)).toThrow(UsageExhaustedError);
  });

  it('restores the full period when the stored anchor is in a prior calendar month', () => {
    const remaining = resolveUsageRemaining({
      paidTier: 'free',
      usage: {
        aiUsed: TIER_LIMITS.free.aiCallsPerPeriod,
        transcriptionSecondsUsed: TIER_LIMITS.free.transcriptionSecondsPerPeriod,
        audioSecondsUsed: 777,
        periodStart: '2026-06-30T23:59:59.999Z',
      },
    }, now);

    expect(remaining).toEqual({
      aiLimit: TIER_LIMITS.free.aiCallsPerPeriod,
      aiUsed: 0,
      aiRemaining: TIER_LIMITS.free.aiCallsPerPeriod,
      transcriptionSecondsLimit: TIER_LIMITS.free.transcriptionSecondsPerPeriod,
      transcriptionSecondsUsed: 0,
      transcriptionSecondsRemaining: TIER_LIMITS.free.transcriptionSecondsPerPeriod,
      audioSecondsUsed: 0,
      aiBlocked: false,
      transcriptionBlocked: false,
      periodResets: true,
    });
  });

  it('rejects a transcription that is larger than the remaining seconds', () => {
    const entitlement = {
      paidTier: 'free' as const,
      usage: {
        aiUsed: 0,
        transcriptionSecondsUsed: TIER_LIMITS.free.transcriptionSecondsPerPeriod - 2,
        audioSecondsUsed: 0,
        periodStart: currentPeriod,
      },
    };

    expect(() => assertTranscriptionUsageAvailable(entitlement, 3, now))
      .toThrow(UsageExhaustedError);
    expect(() => assertTranscriptionUsageAvailable(entitlement, 2, now)).not.toThrow();
  });

  it('increments AI usage through an Admin SDK transaction and merge', async () => {
    transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        usage: { aiUsed: 4, transcriptionSecondsUsed: 20, audioSecondsUsed: 8, periodStart: currentPeriod },
      }),
    });

    await consumeAiUsage('user-1', now);

    expect(adminDb.collection).toHaveBeenCalledWith('users');
    expect(mockDoc).toHaveBeenCalledWith('user-1');
    expect(transactionSet).toHaveBeenCalledWith(mockUserRef, {
      usage: { aiUsed: 5, transcriptionSecondsUsed: 20, audioSecondsUsed: 8, periodStart: currentPeriod },
    }, { merge: true });
  });

  it('resets both counters before consuming transcription in a new month', async () => {
    transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        usage: { aiUsed: 100, transcriptionSecondsUsed: 300, audioSecondsUsed: 45, periodStart: '2026-06-01T00:00:00.000Z' },
      }),
    });

    await consumeTranscriptionSeconds('user-1', 12.5, now);

    expect(transactionSet).toHaveBeenCalledWith(mockUserRef, {
      usage: { aiUsed: 0, transcriptionSecondsUsed: 12.5, audioSecondsUsed: 0, periodStart: currentPeriod },
    }, { merge: true });
  });

  it('does not write an invalid transcription amount', async () => {
    await consumeTranscriptionSeconds('user-1', 0, now);
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
  });

  it('increments generated audio seconds through the same transaction', async () => {
    transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        usage: { aiUsed: 4, transcriptionSecondsUsed: 20, audioSecondsUsed: 3.25, periodStart: currentPeriod },
      }),
    });

    await consumeAudioSeconds('user-1', 6.75, now);

    expect(transactionSet).toHaveBeenCalledWith(mockUserRef, {
      usage: { aiUsed: 4, transcriptionSecondsUsed: 20, audioSecondsUsed: 10, periodStart: currentPeriod },
    }, { merge: true });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not write an invalid audio amount (%p)',
    async (seconds) => {
      await consumeAudioSeconds('user-1', seconds, now);
      expect(adminDb.runTransaction).not.toHaveBeenCalled();
    }
  );
});
