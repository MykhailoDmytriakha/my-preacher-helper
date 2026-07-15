jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
    runTransaction: jest.fn(),
  },
}));

import { TIER_LIMITS } from '@/api/clients/ai/tierPolicy';
import {
  assertAudioAvailable,
  assertAiUsageAvailable,
  assertTranscriptionUsageAvailable,
  consumeAiUsage,
  consumeAudioSeconds,
  consumeTranscriptionSeconds,
  resolveUsageRemaining,
  UsageCapReachedError,
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

  it.each([
    ['ai', 'aiUsed', 100, 110, assertAiUsageAvailable],
    ['transcription', 'transcriptionSecondsUsed', 3_600, 3_960, assertTranscriptionUsageAvailable],
    ['audio', 'audioSecondsUsed', 1_200, 1_320, assertAudioAvailable],
  ] as const)(
    'applies the grace boundary matrix to %s usage',
    (resource, counter, baseLimit, cap, assertAvailable) => {
      const values = [baseLimit - 1, baseLimit, cap - 1, cap, cap + 1];
      const expectedStates = ['warning', 'grace', 'grace', 'blocked', 'blocked'];

      values.forEach((used, index) => {
        const entitlement = {
          paidTier: 'free' as const,
          usage: {
            aiUsed: 0,
            transcriptionSecondsUsed: 0,
            audioSecondsUsed: 0,
            periodStart: currentPeriod,
            [counter]: used,
          },
        };
        const snapshot = resolveUsageRemaining(entitlement, now)[resource];

        expect(snapshot).toMatchObject({
          used,
          baseLimit,
          hardCap: cap,
          state: expectedStates[index],
          resetsAt: '2026-08-01T00:00:00.000Z',
        });
        expect(snapshot.baseRemaining).toBe(Math.max(0, baseLimit - used));
        expect(snapshot.graceRemaining).toBe(Math.max(0, cap - Math.max(baseLimit, used)));

        if (used >= cap) {
          expect(() => assertAvailable(entitlement, now)).toThrow(UsageCapReachedError);
        } else {
          expect(() => assertAvailable(entitlement, now)).not.toThrow();
        }
      });
    }
  );

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

    expect(remaining).toMatchObject({
      ai: { used: 0, state: 'normal', resetsAt: '2026-08-01T00:00:00.000Z' },
      transcription: { used: 0, state: 'normal', resetsAt: '2026-08-01T00:00:00.000Z' },
      audio: { used: 0, state: 'normal', resetsAt: '2026-08-01T00:00:00.000Z' },
      periodResets: true,
    });
  });

  it('admits a transcription started below hard cap even when it will cross the cap', () => {
    const entitlement = {
      paidTier: 'free' as const,
      usage: {
        aiUsed: 0,
        transcriptionSecondsUsed: 3_959,
        audioSecondsUsed: 0,
        periodStart: currentPeriod,
      },
    };

    expect(() => assertTranscriptionUsageAvailable(entitlement, now)).not.toThrow();
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
