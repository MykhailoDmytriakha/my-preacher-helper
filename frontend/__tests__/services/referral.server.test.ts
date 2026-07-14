import {
  computeReferralPromotion,
  REFERRAL_REWARD_DAYS,
  REFERRAL_REWARD_TIER,
} from '@/services/referral.server';

const now = new Date('2026-07-12T12:00:00.000Z');
const rewardExpiry = '2026-08-11T12:00:00.000Z';

describe('computeReferralPromotion', () => {
  it('starts a tier1 promotion from now when no promotion exists', () => {
    expect(computeReferralPromotion(undefined, now)).toEqual({
      tier: REFERRAL_REWARD_TIER,
      expiresAt: rewardExpiry,
    });
    expect(REFERRAL_REWARD_DAYS).toBe(30);
  });

  it('restarts an expired promotion from now', () => {
    expect(computeReferralPromotion({
      tier: 'tier3',
      expiresAt: '2026-07-12T11:59:59.999Z',
    }, now)).toEqual({ tier: 'tier1', expiresAt: rewardExpiry });
  });

  it('replaces an active lower promotion with tier1 based from now', () => {
    expect(computeReferralPromotion({
      // Runtime data can predate the current ascending tier catalog.
      tier: 'free',
      expiresAt: '2026-07-20T12:00:00.000Z',
    }, now)).toEqual({ tier: 'tier1', expiresAt: rewardExpiry });
  });

  it('accumulates one month onto an active equal-tier promotion', () => {
    expect(computeReferralPromotion({
      tier: 'tier1',
      expiresAt: '2026-08-01T12:00:00.000Z',
    }, now)).toEqual({
      tier: 'tier1',
      expiresAt: '2026-08-31T12:00:00.000Z',
    });
  });

  it('never downgrades an active higher-tier promotion and extends it', () => {
    expect(computeReferralPromotion({
      tier: 'tier4',
      expiresAt: '2026-08-01T12:00:00.000Z',
    }, now)).toEqual({
      tier: 'tier4',
      expiresAt: '2026-08-31T12:00:00.000Z',
    });
  });
});
