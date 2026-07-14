import { TIER_LIMITS } from '@/api/clients/ai/tierPolicy';
import { adminDb } from '@/config/firebaseAdminConfig';
import {
  getUsagePeriodStart,
  normalizeEntitlementUsage,
  resolveEffectiveTier,
} from '@/services/userEntitlement.server';

import type { UserEntitlement } from '@/models/models';

export type UsageResource = 'ai' | 'transcription';

export class UsageExhaustedError extends Error {
  readonly code = 'USAGE_EXHAUSTED';

  constructor(readonly resource: UsageResource) {
    super(`${resource === 'ai' ? 'AI' : 'Transcription'} usage limit exhausted`);
    this.name = 'UsageExhaustedError';
  }
}

export interface UsageRemaining {
  aiLimit: number;
  aiUsed: number;
  aiRemaining: number;
  transcriptionSecondsLimit: number;
  transcriptionSecondsUsed: number;
  transcriptionSecondsRemaining: number;
  aiBlocked: boolean;
  transcriptionBlocked: boolean;
  periodResets: boolean;
}

const isPriorCalendarMonth = (periodStart: string, now: Date): boolean => {
  const start = new Date(periodStart);
  if (Number.isNaN(start.getTime())) return false;

  const startMonth = start.getUTCFullYear() * 12 + start.getUTCMonth();
  const currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return startMonth < currentMonth;
};

export function resolveUsageRemaining(
  entitlement: UserEntitlement | null | undefined,
  now: Date
): UsageRemaining {
  const limits = TIER_LIMITS[resolveEffectiveTier(entitlement, now)];
  const usage = normalizeEntitlementUsage(entitlement?.usage, now);
  const periodResets = isPriorCalendarMonth(usage.periodStart, now);
  const aiUsed = periodResets ? 0 : usage.aiUsed;
  const transcriptionSecondsUsed = periodResets ? 0 : usage.transcriptionSecondsUsed;
  const aiRemaining = Math.max(0, limits.aiCallsPerPeriod - aiUsed);
  const transcriptionSecondsRemaining = Math.max(
    0,
    limits.transcriptionSecondsPerPeriod - transcriptionSecondsUsed
  );

  return {
    aiLimit: limits.aiCallsPerPeriod,
    aiUsed,
    aiRemaining,
    transcriptionSecondsLimit: limits.transcriptionSecondsPerPeriod,
    transcriptionSecondsUsed,
    transcriptionSecondsRemaining,
    aiBlocked: aiRemaining <= 0,
    transcriptionBlocked: transcriptionSecondsRemaining <= 0,
    periodResets,
  };
}

export function assertAiUsageAvailable(
  entitlement: UserEntitlement | null | undefined,
  now: Date
): void {
  if (resolveUsageRemaining(entitlement, now).aiBlocked) {
    throw new UsageExhaustedError('ai');
  }
}

export function assertTranscriptionUsageAvailable(
  entitlement: UserEntitlement | null | undefined,
  seconds: number,
  now: Date
): void {
  const remaining = resolveUsageRemaining(entitlement, now);
  if (
    remaining.transcriptionBlocked
    || !Number.isFinite(seconds)
    || seconds <= 0
    || seconds > remaining.transcriptionSecondsRemaining
  ) {
    throw new UsageExhaustedError('transcription');
  }
}

type UsageCounter = 'aiUsed' | 'transcriptionSecondsUsed';

async function consumeUsage(
  userId: string,
  counter: UsageCounter,
  amount: number,
  now: Date
): Promise<void> {
  const userRef = adminDb.collection('users').doc(userId);
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const data = snapshot.exists ? snapshot.data() : undefined;
    const usage = normalizeEntitlementUsage(data?.usage, now);
    const periodResets = isPriorCalendarMonth(usage.periodStart, now);
    const current = periodResets ? 0 : usage[counter];

    transaction.set(userRef, {
      usage: {
        ...usage,
        ...(periodResets ? {
          aiUsed: 0,
          transcriptionSecondsUsed: 0,
          periodStart: getUsagePeriodStart(now),
        } : {}),
        [counter]: current + amount,
      },
    }, { merge: true });
  });
}

export async function consumeAiUsage(userId: string, now: Date): Promise<void> {
  await consumeUsage(userId, 'aiUsed', 1, now);
}

export async function consumeTranscriptionSeconds(
  userId: string,
  seconds: number,
  now: Date
): Promise<void> {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  await consumeUsage(userId, 'transcriptionSecondsUsed', seconds, now);
}
