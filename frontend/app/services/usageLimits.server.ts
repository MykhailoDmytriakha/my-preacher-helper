import { TIER_LIMITS } from '@/api/clients/ai/tierPolicy';
import { adminDb } from '@/config/firebaseAdminConfig';
import {
  getUsagePeriodStart,
  normalizeEntitlementUsage,
  resolveEffectiveTier,
} from '@/services/userEntitlement.server';

import {
  hardCap,
  UsageCapReachedError,
} from './usageLimits';

import type {
  UsageMetricSnapshot,
  UsageResource,
} from './usageLimits';
import type { UserEntitlement } from '@/models/models';

export { UsageCapReachedError } from './usageLimits';

export interface UsageRemaining {
  ai: UsageMetricSnapshot;
  transcription: UsageMetricSnapshot;
  audio: UsageMetricSnapshot;
  periodResets: boolean;
  // Compatibility aliases remain until STAGE B migrates every existing UI consumer.
  aiLimit: number;
  aiUsed: number;
  aiRemaining: number;
  transcriptionSecondsLimit: number;
  transcriptionSecondsUsed: number;
  transcriptionSecondsRemaining: number;
  audioSecondsLimit: number;
  audioSecondsUsed: number;
  audioSecondsRemaining: number;
  aiBlocked: boolean;
  transcriptionBlocked: boolean;
  audioBlocked: boolean;
}

export interface UsageAdmission {
  readonly userId: string;
  readonly resources: readonly UsageResource[];
}

const isPriorCalendarMonth = (periodStart: string, now: Date): boolean => {
  const start = new Date(periodStart);
  if (Number.isNaN(start.getTime())) return false;

  const startMonth = start.getUTCFullYear() * 12 + start.getUTCMonth();
  const currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return startMonth < currentMonth;
};

const getResetsAt = (effectivePeriodStart: string): string => {
  const start = new Date(effectivePeriodStart);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString();
};

const createMetricSnapshot = (
  used: number,
  baseLimit: number,
  kind: 'discrete' | 'continuous',
  resetsAt: string
): UsageMetricSnapshot => {
  const cap = hardCap(baseLimit, kind);
  const state = used >= cap
    ? 'blocked'
    : used >= baseLimit
      ? 'grace'
      : used >= baseLimit * 0.8
        ? 'warning'
        : 'normal';

  return {
    used,
    baseLimit,
    hardCap: cap,
    baseRemaining: Math.max(0, baseLimit - used),
    graceRemaining: Math.max(0, cap - Math.max(baseLimit, used)),
    state,
    resetsAt,
  };
};

export function resolveUsageRemaining(
  entitlement: UserEntitlement | null | undefined,
  now: Date
): UsageRemaining {
  const limits = TIER_LIMITS[resolveEffectiveTier(entitlement, now)];
  const usage = normalizeEntitlementUsage(entitlement?.usage, now);
  const periodResets = isPriorCalendarMonth(usage.periodStart, now);
  const effectivePeriodStart = periodResets ? getUsagePeriodStart(now) : usage.periodStart;
  const resetsAt = getResetsAt(effectivePeriodStart);
  const aiUsed = periodResets ? 0 : usage.aiUsed;
  const transcriptionSecondsUsed = periodResets ? 0 : usage.transcriptionSecondsUsed;
  const audioSecondsUsed = periodResets ? 0 : usage.audioSecondsUsed;
  const ai = createMetricSnapshot(aiUsed, limits.aiCallsPerPeriod, 'discrete', resetsAt);
  const transcription = createMetricSnapshot(
    transcriptionSecondsUsed,
    limits.transcriptionSecondsPerPeriod,
    'continuous',
    resetsAt
  );
  const audio = createMetricSnapshot(
    audioSecondsUsed,
    limits.audioSecondsPerPeriod,
    'continuous',
    resetsAt
  );

  return {
    ai,
    transcription,
    audio,
    periodResets,
    aiLimit: ai.baseLimit,
    aiUsed: ai.used,
    aiRemaining: ai.baseRemaining,
    transcriptionSecondsLimit: transcription.baseLimit,
    transcriptionSecondsUsed: transcription.used,
    transcriptionSecondsRemaining: transcription.baseRemaining,
    audioSecondsLimit: audio.baseLimit,
    audioSecondsUsed: audio.used,
    audioSecondsRemaining: audio.baseRemaining,
    aiBlocked: ai.state === 'blocked',
    transcriptionBlocked: transcription.state === 'blocked',
    audioBlocked: audio.state === 'blocked',
  };
}

const throwIfBlocked = (resource: UsageResource, metric: UsageMetricSnapshot): void => {
  if (metric.state === 'blocked') {
    throw new UsageCapReachedError(
      resource,
      metric.used,
      metric.baseLimit,
      metric.hardCap,
      metric.resetsAt
    );
  }
};

export function assertAiUsageAvailable(
  entitlement: UserEntitlement | null | undefined,
  now: Date
): void {
  throwIfBlocked('ai', resolveUsageRemaining(entitlement, now).ai);
}

export function assertTranscriptionUsageAvailable(
  entitlement: UserEntitlement | null | undefined,
  now: Date
): void {
  throwIfBlocked('transcription', resolveUsageRemaining(entitlement, now).transcription);
}

export function assertAudioAvailable(
  entitlement: UserEntitlement | null | undefined,
  now: Date
): void {
  throwIfBlocked('audio', resolveUsageRemaining(entitlement, now).audio);
}

/** Checks every resource once at the route boundary and returns an in-memory request admission. */
export function createUsageAdmission(
  userId: string,
  entitlement: UserEntitlement | null | undefined,
  resources: readonly UsageResource[],
  now: Date
): UsageAdmission {
  const usage = resolveUsageRemaining(entitlement, now);
  resources.forEach((resource) => throwIfBlocked(resource, usage[resource]));
  return Object.freeze({ userId, resources: Object.freeze([...new Set(resources)]) });
}

export const isUsageAdmitted = (
  admission: UsageAdmission | undefined,
  userId: string,
  resource: UsageResource
): boolean => admission?.userId === userId && admission.resources.includes(resource);

type UsageCounter = 'aiUsed' | 'transcriptionSecondsUsed' | 'audioSecondsUsed';

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
          audioSecondsUsed: 0,
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

export async function consumeAudioSeconds(
  userId: string,
  seconds: number,
  now: Date
): Promise<void> {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  await consumeUsage(userId, 'audioSecondsUsed', seconds, now);
}
