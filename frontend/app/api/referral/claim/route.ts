import { NextResponse } from 'next/server';
import { z } from 'zod';

import { adminAuth, adminDb } from '@/config/firebaseAdminConfig';
import { computeReferralPromotion } from '@/services/referral.server';

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
        return 'alreadyClaimed' as const;
      }

      const inviterSnapshot = await transaction.get(inviterRef);
      if (!inviterSnapshot.exists) return 'unknownInviter' as const;

      const inviterData = inviterSnapshot.data();
      const promotion = computeReferralPromotion(
        inviterData?.promotion as UserEntitlement['promotion'],
        now
      );

      transaction.set(inviteeRef, { referredBy: inviterUid }, { merge: true });
      transaction.set(inviterRef, { promotion }, { merge: true });
      transaction.set(referralEventRef, {
        inviterUid,
        inviteeUid: invitee.uid,
        registeredAt: now.toISOString(),
        promoTier: promotion.tier,
        promoStartAt: now.toISOString(),
        promoEndAt: promotion.expiresAt,
      });
      return 'granted' as const;
    });

    if (result === 'unknownInviter') {
      return jsonResponse({ error: 'unknownInviter' }, 404);
    }
    return jsonResponse({ status: result });
  } catch {
    return jsonResponse({ error: 'internalServerError' }, 500);
  }
}
