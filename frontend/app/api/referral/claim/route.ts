import { after, NextResponse } from 'next/server';
import { z } from 'zod';

import { adminAuth, adminDb } from '@/config/firebaseAdminConfig';
import { ownerMailConfigured, sendOwnerNotice } from '@/services/ownerMail.server';
import {
  buildReferralWarningEmail,
  computeReferralPromotion,
  readReferralLedger,
  readReferralWarning,
  recordReferral,
  REFERRAL_WARNING_AT,
  type ReferralWarningContext,
} from '@/services/referral.server';

import type { UserEntitlement } from '@/models/models';

export const dynamic = 'force-dynamic';

const BEARER_PREFIX = 'Bearer ';
const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
};

const uidSchema = z.string().min(1).max(128).refine((uid) => {
  if (!uid.trim() || uid.includes('/') || /^\.+$/.test(uid)) return false;
  return Array.from(uid).every((character) => {
    const codePoint = character.codePointAt(0) as number;
    return codePoint >= 32 && codePoint !== 127;
  });
}, { message: 'Invalid user uid' });

const claimSchema = z.object({ ref: uidSchema }).strict();

const jsonResponse = (body: unknown, status = 200): NextResponse =>
  NextResponse.json(body, { status, headers: NO_STORE_HEADERS });

const unauthorized = (): NextResponse => jsonResponse({ error: 'unauthorized' }, 401);

/**
 * How long the letter may take after the claim answered — the email lookups in Auth as much as the
 * mail server. Past it nothing new starts, and the mail server's waits are capped to what is left.
 * The hard stop is the platform's: this route keeps the duration it always had (no override, so
 * Vercel's default — 300 s, a project default never above 800 s), and work left to `after` runs on
 * `waitUntil`, which ends with the function (vercel.com/docs/functions/functions-api-reference).
 */
const OWNER_NOTICE_BUDGET_MS = 8_000;

type ReferralWarning = Pick<ReferralWarningContext, 'referralCount'> & {
  invitees: Array<{ uid: string; registeredAt: string | null }>;
};

/**
 * Tells the owner an inviter reached REFERRAL_WARNING_AT (F6). Runs after the claim committed and
 * answered, and only for the claim that set the flag, so a retried transaction cannot send twice. A
 * failed letter never fails the claim: the flag stays on the user and the admin page shows it anyway.
 */
async function notifyOwnerOfReferralWarning(inviterUid: string, warning: ReferralWarning, flaggedAt: string) {
  if (!ownerMailConfigured()) return;
  const deadline = Date.now() + OWNER_NOTICE_BUDGET_MS;
  let expired = false;
  const emailOf = async (uid: string): Promise<string | null> => {
    try { return (await adminAuth.getUser(uid)).email ?? null; } catch { return null; }
  };
  const notice = (async () => {
    const [inviterEmail, inviteeEmails] = await Promise.all([
      emailOf(inviterUid),
      Promise.all(warning.invitees.map((invitee) => emailOf(invitee.uid))),
    ]);
    const remainingMs = deadline - Date.now();
    if (expired || remainingMs <= 0) return;
    await sendOwnerNotice(buildReferralWarningEmail({
      inviter: { uid: inviterUid, email: inviterEmail },
      referralCount: warning.referralCount,
      invitees: warning.invitees.map((invitee, index) => ({ ...invitee, email: inviteeEmails[index] })),
      flaggedAt,
    }), { timeoutMs: remainingMs });
  })();
  let budget: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      notice.then(() => 'sent' as const),
      new Promise<'timedOut'>((resolve) => {
        budget = setTimeout(() => {
          expired = true;
          resolve('timedOut');
        }, OWNER_NOTICE_BUDGET_MS);
      }),
    ]).finally(() => clearTimeout(budget));
    if (outcome === 'timedOut') {
      notice.catch(() => undefined);
      console.error('Referral warning letter not confirmed within the budget', { inviterUid });
    }
  } catch (error) {
    console.error('Referral warning letter was not sent', { inviterUid, error });
  }
}

/** Work the person must not wait for; without a request scope to defer to, it still runs, detached. */
function afterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith(BEARER_PREFIX)) return unauthorized();

  const token = authorization.slice(BEARER_PREFIX.length).trim();
  if (!token) return unauthorized();

  let invitee: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>;
  try {
    invitee = await adminAuth.verifyIdToken(token, true);
  } catch {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalidRequest' }, 400);
  }

  const bodyResult = claimSchema.safeParse(body);
  if (!bodyResult.success) return jsonResponse({ error: 'invalidRequest' }, 400);

  const inviterUid = bodyResult.data.ref;
  if (inviterUid === invitee.uid) {
    return jsonResponse({ error: 'selfReferral' }, 400);
  }
  if (invitee.email_verified !== true) {
    return jsonResponse({ error: 'emailNotVerified' }, 403);
  }

  try {
    const inviteeRecord = await adminAuth.getUser(invitee.uid);
    const now = new Date();
    const creationTime = Date.parse(inviteeRecord.metadata.creationTime ?? '');
    if (
      Number.isNaN(creationTime)
      || now.getTime() - creationTime > NEW_ACCOUNT_WINDOW_MS
    ) {
      return jsonResponse({ error: 'notEligible' }, 409);
    }

    const inviteeRef = adminDb.collection('users').doc(invitee.uid);
    const inviterRef = adminDb.collection('users').doc(inviterUid);
    const inviterGateSnapshot = await inviterRef.get();
    if (!inviterGateSnapshot.exists) {
      return jsonResponse({ error: 'unknownInviter' }, 404);
    }
    const referralEventRef = adminDb.collection('referralEvents').doc(invitee.uid);

    const result = await adminDb.runTransaction(async (transaction) => {
      const inviteeSnapshot = await transaction.get(inviteeRef);
      const inviteeData = inviteeSnapshot.exists ? inviteeSnapshot.data() : undefined;
      if (
        inviteeData
        && Object.prototype.hasOwnProperty.call(inviteeData, 'referredBy')
      ) {
        return { status: 'alreadyClaimed' as const, warning: null };
      }

      const inviterSnapshot = await transaction.get(inviterRef);
      if (!inviterSnapshot.exists) return { status: 'unknownInviter' as const, warning: null };

      // F6: the inviter's referrals with this one, from the ledger on the inviter document this
      // transaction already reads and writes — every claim for this inviter goes through it, so two
      // claims at once cannot both set the flag, and the claim grows no new query. The third flags
      // the inviter once for a human look; the promotion below still accrues.
      const inviterData = inviterSnapshot.data();
      const ledger = recordReferral(readReferralLedger(inviterData?.referralLedger), invitee.uid, now.toISOString());
      const referralCount = ledger.count;
      const flagNow = referralCount >= REFERRAL_WARNING_AT && readReferralWarning(inviterData?.referralWarning) === null;
      const promotion = computeReferralPromotion(
        inviterData?.promotion as UserEntitlement['promotion'],
        now
      );

      transaction.set(inviteeRef, { referredBy: inviterUid }, { merge: true });
      transaction.set(
        inviterRef,
        flagNow
          ? { promotion, referralLedger: ledger, referralWarning: { at: now.toISOString(), referralCount } }
          : { promotion, referralLedger: ledger },
        { merge: true }
      );
      transaction.set(referralEventRef, {
        inviterUid,
        inviteeUid: invitee.uid,
        registeredAt: now.toISOString(),
        promoTier: promotion.tier,
        promoStartAt: now.toISOString(),
        promoEndAt: promotion.expiresAt,
      });
      const warning: ReferralWarning | null = flagNow
        ? { referralCount, invitees: ledger.invitees.map((entry) => ({ uid: entry.uid, registeredAt: entry.at })) }
        : null;
      return { status: 'granted' as const, warning };
    });

    if (result.status === 'unknownInviter') {
      return jsonResponse({ error: 'unknownInviter' }, 404);
    }
    const { warning } = result;
    if (warning) afterResponse(() => notifyOwnerOfReferralWarning(inviterUid, warning, now.toISOString()));
    return jsonResponse({ status: result.status });
  } catch {
    return jsonResponse({ error: 'internalServerError' }, 500);
  }
}
