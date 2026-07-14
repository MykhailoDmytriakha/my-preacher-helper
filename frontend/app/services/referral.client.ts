'use client';

import type { User } from 'firebase/auth';

export const PENDING_REFERRAL_KEY = 'pendingReferral';
export const PENDING_REFERRAL_TS_KEY = 'pendingReferralTs';

// Mirror the server's new-account eligibility window: a captured referral older
// than this can never earn a reward (the invitee account would already be >24h
// old), and dropping it also stops a stale ref left on a shared device from
// mis-attributing a later, unrelated sign-up.
const PENDING_REFERRAL_TTL_MS = 24 * 60 * 60 * 1000;

// Transient/retryable HTTP statuses: keep the pending referral so a later auth
// event (e.g. a guest upgrading to a verified account) can retry. Every terminal
// status clears it — 200 (done), 400 (self/invalid), 404 (unknown inviter) and
// 409 (account already too old) can never succeed on retry.
const RETRYABLE_STATUSES = new Set([401, 403, 429, 500, 502, 503, 504]);

function clearPendingReferral(): void {
  try {
    localStorage.removeItem(PENDING_REFERRAL_KEY);
    localStorage.removeItem(PENDING_REFERRAL_TS_KEY);
  } catch {
    // The server response is already authoritative; storage is only delivery state.
  }
}

export function capturePendingReferral(search: string, currentUid?: string | null): void {
  const referralUid = new URLSearchParams(search).get('ref')?.trim();
  if (!referralUid || referralUid === currentUid) return;

  try {
    localStorage.setItem(PENDING_REFERRAL_KEY, referralUid);
    localStorage.setItem(PENDING_REFERRAL_TS_KEY, String(Date.now()));
  } catch {
    // Referral capture must never break the public landing page.
  }
}

/**
 * Best-effort delivery only. The server independently verifies every eligibility
 * and authorization fact before writing any referral or promotion field.
 */
export async function claimPendingReferral(
  user: Pick<User, 'uid' | 'getIdToken'>
): Promise<void> {
  let referralUid: string | undefined;
  let capturedAt: string | null = null;
  try {
    referralUid = localStorage.getItem(PENDING_REFERRAL_KEY)?.trim();
    capturedAt = localStorage.getItem(PENDING_REFERRAL_TS_KEY);
  } catch {
    return;
  }
  if (!referralUid) return;

  // Drop a stale capture; past the eligibility window it can no longer pay out.
  const capturedMs = capturedAt ? Number(capturedAt) : NaN;
  if (Number.isFinite(capturedMs) && Date.now() - capturedMs > PENDING_REFERRAL_TTL_MS) {
    clearPendingReferral();
    return;
  }

  if (referralUid === user.uid) {
    clearPendingReferral();
    return;
  }

  try {
    const token = await user.getIdToken();
    const response = await fetch('/api/referral/claim', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: referralUid }),
    });
    // Keep the pending referral only for transient failures a later auth event can
    // retry; every terminal status (including success) clears it so it fires once.
    if (!RETRYABLE_STATUSES.has(response.status)) {
      clearPendingReferral();
    }
  } catch {
    // A transport/token failure has no server response, so keep the attribution
    // for a later auth-state event instead of silently losing it.
  }
}
