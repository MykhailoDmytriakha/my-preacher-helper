import { TIER_VALUES } from '@/models/models';
import { escapeHtml } from '@/services/ownerMail.server';

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

/**
 * F6: at this many referrals the inviter is flagged for a human look and the owner gets a letter.
 * A signal, never a block: the promotion keeps accruing, and the owner decides in the admin page.
 */
export const REFERRAL_WARNING_AT = 3;

/** How many recent invitees the inviter's ledger keeps for the letter. */
export const REFERRAL_LEDGER_LIMIT = 20;

/**
 * F6: the referrals granted to an inviter, kept on the inviter's own document — the one every
 * claim already reads and writes in its transaction. Referrals from before the check shipped
 * (2026-10-04) enter once by `scripts/backfill-referral-ledger.js`, which sets it from the
 * referral events.
 */
export interface ReferralLedger {
  count: number;
  invitees: Array<{ uid: string; at: string }>;
}

export function readReferralLedger(value: unknown): ReferralLedger {
  if (!value || typeof value !== 'object') return { count: 0, invitees: [] };
  const { count, invitees } = value as { count?: unknown; invitees?: unknown };
  return {
    count: Number.isInteger(count) && (count as number) > 0 ? (count as number) : 0,
    invitees: Array.isArray(invitees)
      ? invitees.filter((item): item is { uid: string; at: string } =>
        Boolean(item) && typeof item.uid === 'string' && typeof item.at === 'string')
      : [],
  };
}

/**
 * Adds the invitee unless it is among the last REFERRAL_LEDGER_LIMIT: a claim repeated after its
 * `referredBy` marker was lost adds nothing. One pushed out by twenty newer invitees would count
 * again, but that count is long past REFERRAL_WARNING_AT, so the flag cannot change.
 */
export function recordReferral(ledger: ReferralLedger, inviteeUid: string, at: string): ReferralLedger {
  if (ledger.invitees.some((entry) => entry.uid === inviteeUid)) return ledger;
  return {
    count: ledger.count + 1,
    invitees: [...ledger.invitees, { uid: inviteeUid, at }].slice(-REFERRAL_LEDGER_LIMIT),
  };
}

/**
 * The flag as it was set, or null for anything else. One reading for the claim (is the inviter
 * flagged already?) and the admin page (show it?), so a malformed value can neither silence the
 * letter nor hide the flag from the admin.
 */
export function readReferralWarning(value: unknown): { at: string; referralCount: number } | null {
  if (!value || typeof value !== 'object') return null;
  const { at, referralCount } = value as { at?: unknown; referralCount?: unknown };
  return typeof at === 'string' && !Number.isNaN(Date.parse(at))
    && Number.isInteger(referralCount) && (referralCount as number) >= 1
    ? { at, referralCount: referralCount as number }
    : null;
}

export interface ReferralWarningContext {
  inviter: { uid: string; email: string | null };
  referralCount: number;
  invitees: Array<{ uid: string; email: string | null; registeredAt: string | null }>;
  flaggedAt: string;
}

/** The letter to the owner when an inviter reaches REFERRAL_WARNING_AT. */
export function buildReferralWarningEmail(context: ReferralWarningContext): { subject: string; text: string; html: string } {
  const inviter = context.inviter.email ?? context.inviter.uid;
  const lines = context.invitees.map((invitee) =>
    `${invitee.email ?? '(no email)'} · ${invitee.uid} · ${invitee.registeredAt ?? 'unknown time'}`);
  return {
    subject: `Referral check: ${inviter} has invited ${context.referralCount} people`,
    text: [
      `${inviter} (${context.inviter.uid}) has brought ${context.referralCount} referrals.`,
      'Their promotion keeps accruing; nothing is blocked. Please check whether these are real people.',
      `Flagged at: ${context.flaggedAt}`,
      '',
      'Invited:',
      ...lines,
      '',
      'Admin page → the user shows "Check referrals"; the promotion can be cleared there.',
    ].join('\n'),
    html: `
      <h2>Referral check</h2>
      <p><strong>${escapeHtml(inviter)}</strong> (${escapeHtml(context.inviter.uid)}) has brought <strong>${context.referralCount}</strong> referrals.</p>
      <p>Their promotion keeps accruing; nothing is blocked. Please check whether these are real people.</p>
      <p><strong>Flagged at:</strong> ${escapeHtml(context.flaggedAt)}</p>
      <p><strong>Invited:</strong></p>
      <ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
      <p>Admin page → the user shows "Check referrals"; the promotion can be cleared there.</p>
    `,
  };
}
