import { NextResponse } from 'next/server';

import { adminAuth, adminDb } from '@/config/firebaseAdminConfig';

export const dynamic = 'force-dynamic';

const BEARER_PREFIX = 'Bearer ';
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
};

const jsonResponse = (body: unknown, status = 200): NextResponse =>
  NextResponse.json(body, { status, headers: NO_STORE_HEADERS });

const unauthorized = (): NextResponse => jsonResponse({ error: 'unauthorized' }, 401);

/** Returns referral statistics for the Firebase caller only; no caller-supplied UID is accepted. */
export async function GET(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith(BEARER_PREFIX)) return unauthorized();

  const token = authorization.slice(BEARER_PREFIX.length).trim();
  if (!token) return unauthorized();

  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(token, true)).uid;
  } catch {
    return unauthorized();
  }

  try {
    const snapshot = await adminDb
      .collection('referralEvents')
      .where('inviterUid', '==', uid)
      .count()
      .get();
    return jsonResponse({ invitedCount: snapshot.data().count });
  } catch {
    return jsonResponse({ error: 'internalServerError' }, 500);
  }
}
