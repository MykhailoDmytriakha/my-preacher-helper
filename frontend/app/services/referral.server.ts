import { TIER_VALUES } from '@/models/models';

import type { Tier, UserEntitlement } from '@/models/models';

export const REFERRAL_REWARD_TIER: Tier = 'tier1';
export const REFERRAL_REWARD_DAYS = 30;

const REWARD_DURATION_MS = REFERRAL_REWARD_DAYS * 24 * 60 * 60 * 1000;

/**
 * Computes the next server-managed referral promotion.
 * Active equal or higher promotions keep their tier and accumulate reward time.
 */
export function computeReferralPromotion(
  current: UserEntitlement['promotion'] | undefined,
  now: Date
): NonNullable<UserEntitlement['promotion']> {
  const currentExpiry = current ? new Date(current.expiresAt) : undefined;
  const currentIsActive = Boolean(currentExpiry && currentExpiry > now);
  const currentIsEqualOrHigher = Boolean(
    current
    && TIER_VALUES.indexOf(current.tier) >= TIER_VALUES.indexOf(REFERRAL_REWARD_TIER)
  );

  if (current && currentExpiry && currentIsActive && currentIsEqualOrHigher) {
    return {
      tier: current.tier,
      expiresAt: new Date(currentExpiry.getTime() + REWARD_DURATION_MS).toISOString(),
    };
  }

  return {
    tier: REFERRAL_REWARD_TIER,
    expiresAt: new Date(now.getTime() + REWARD_DURATION_MS).toISOString(),
  };
}
