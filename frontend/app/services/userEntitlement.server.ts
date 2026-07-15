import { providerIds } from '@/api/clients/ai/providerId';
import { adminDb } from '@/config/firebaseAdminConfig';
import { TIER_VALUES } from '@/models/models';

import type { ProviderId } from '@/api/clients/ai/providerId';
import type { Tier, UserEntitlement, UserSettings } from '@/models/models';

const USERS_COLLECTION = 'users';

const isTier = (value: unknown): value is Tier =>
  typeof value === 'string' && TIER_VALUES.includes(value as Tier);

const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === 'string' && providerIds.includes(value as ProviderId);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toUsageValue = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

export const getUsagePeriodStart = (now: Date): string =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

function getPromotion(value: unknown): UserEntitlement['promotion'] {
  if (!isRecord(value) || !isTier(value.tier) || typeof value.expiresAt !== 'string') {
    return undefined;
  }

  return { tier: value.tier, expiresAt: value.expiresAt };
}

export function normalizeEntitlementUsage(
  value: unknown,
  now: Date
): Required<NonNullable<UserEntitlement['usage']>> {
  const usage = isRecord(value) ? value : {};
  const storedPeriodStart = typeof usage.periodStart === 'string'
    && !Number.isNaN(Date.parse(usage.periodStart))
    ? usage.periodStart
    : getUsagePeriodStart(now);

  return {
    // Legacy fallbacks preserve counters written before Phase 5a migration.
    aiUsed: toUsageValue(usage.aiUsed ?? usage.aiUsage),
    transcriptionSecondsUsed: toUsageValue(
      usage.transcriptionSecondsUsed ?? usage.transcriptionSeconds
    ),
    audioSecondsUsed: toUsageValue(usage.audioSecondsUsed),
    periodStart: storedPeriodStart,
  };
}

export type UserEntitlementWithTextPreference = UserEntitlement & Pick<
  UserSettings,
  'preferredProviderId' | 'preferredModelId' | 'preferredText'
>;

export type UserEntitlementWithModelPreferences = UserEntitlement & Pick<
  UserSettings,
  'preferredProviderId' | 'preferredModelId' | 'preferredTranscription' | 'preferredText' | 'preferredTts'
>;

function getTextPreference(data: Record<string, unknown> | undefined) {
  return {
    ...(isProviderId(data?.preferredProviderId)
      ? { preferredProviderId: data.preferredProviderId }
      : {}),
    ...(typeof data?.preferredModelId === 'string'
      ? { preferredModelId: data.preferredModelId }
      : {}),
  };
}

function getFunctionPreference(value: unknown): { providerId: ProviderId; modelId: string } | undefined {
  if (!isRecord(value) || !isProviderId(value.providerId) || typeof value.modelId !== 'string') {
    return undefined;
  }

  return { providerId: value.providerId, modelId: value.modelId };
}

function getModelPreferences(data: Record<string, unknown> | undefined) {
  const preferredTranscription = getFunctionPreference(data?.preferredTranscription);
  const preferredText = getFunctionPreference(data?.preferredText);
  const preferredTts = getFunctionPreference(data?.preferredTts);

  return {
    ...getTextPreference(data),
    ...(preferredTranscription ? { preferredTranscription } : {}),
    ...(preferredText ? { preferredText } : {}),
    ...(preferredTts ? { preferredTts } : {}),
  };
}

function getDefaultEntitlement(now: Date): UserEntitlementWithTextPreference {
  return {
    paidTier: 'free',
    usage: normalizeEntitlementUsage(undefined, now),
  };
}

/**
 * Normalizes one `users/{uid}` document without issuing a Firestore read.
 * Bulk admin reads use this seam so their defaults stay identical to the
 * single-user server reader without introducing an N+1 query pattern.
 */
export function normalizeUserEntitlementServerSide(
  data: Record<string, unknown> | undefined,
  now: Date
): UserEntitlement {
  const promotion = getPromotion(data?.promotion);

  return {
    paidTier: isTier(data?.paidTier) ? data.paidTier : 'free',
    ...(typeof data?.lastSeenAt === 'string' ? { lastSeenAt: data.lastSeenAt } : {}),
    ...(promotion ? { promotion } : {}),
    usage: normalizeEntitlementUsage(data?.usage, now),
  };
}

/**
 * Returns the tier that server-side feature and model policies must use.
 * An active promotion can raise, but never lower, the paid tier.
 */
export function resolveEffectiveTier(
  entitlement: UserEntitlement | null | undefined,
  now: Date
): Tier {
  const paidTier = entitlement?.paidTier ?? 'free';
  const promotion = entitlement?.promotion;
  if (
    promotion
    && new Date(promotion.expiresAt) > now
    && TIER_VALUES.indexOf(promotion.tier) > TIER_VALUES.indexOf(paidTier)
  ) {
    return promotion.tier;
  }

  return paidTier;
}

/**
 * Reads and normalizes server-managed entitlement fields from `users/{uid}`.
 * This Admin SDK seam is intentionally separate from client settings reads/writes.
 */
export function getUserEntitlementServerSide(uid: string): Promise<UserEntitlement>;
export function getUserEntitlementServerSide(
  uid: string,
  options: { includeTextPreference: true }
): Promise<UserEntitlementWithTextPreference>;
export function getUserEntitlementServerSide(
  uid: string,
  options: { includeModelPreferences: true }
): Promise<UserEntitlementWithModelPreferences>;
export async function getUserEntitlementServerSide(
  uid: string,
  options?: { includeTextPreference?: boolean; includeModelPreferences?: boolean }
): Promise<UserEntitlementWithModelPreferences> {
  const now = new Date();
  const snapshot = await adminDb.collection(USERS_COLLECTION).doc(uid).get();
  if (!snapshot.exists) return getDefaultEntitlement(now);

  const data = snapshot.data() as Record<string, unknown> | undefined;

  return {
    ...normalizeUserEntitlementServerSide(data, now),
    ...(options?.includeTextPreference || options?.includeModelPreferences ? getModelPreferences(data) : {}),
  };
}
