import { NextResponse } from 'next/server';

import { requireAdminEmail } from '@/api/admin/adminAuth';
import { adminAuth, adminDb } from '@/config/firebaseAdminConfig';
import {
  normalizeUserEntitlementServerSide,
  resolveEffectiveTier,
} from '@/services/userEntitlement.server';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
};

const ADMIN_ROLES = ['user', 'admin', 'superuser'] as const;
type AdminRole = typeof ADMIN_ROLES[number];

const isAdminRole = (value: unknown): value is AdminRole =>
  typeof value === 'string' && ADMIN_ROLES.includes(value as AdminRole);

const toTimestamp = (value: string | undefined): string | null => value ?? null;

const timestampValue = (value: string | null): number => {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const jsonResponse = (body: unknown, status = 200): NextResponse =>
  NextResponse.json(body, { status, headers: NO_STORE_HEADERS });

export async function GET(request: Request): Promise<NextResponse> {
  const admin = await requireAdminEmail(request);
  if (!admin.ok) return admin.response;

  try {
    const pageToken = new URL(request.url).searchParams.get('pageToken') || undefined;
    // Scale note: both collection reads are unbounded; replace with indexed/materialized
    // summaries before the admin population grows beyond the current operational scale.
    const [authPage, entitlementSnapshot, referralEventsSnapshot] = await Promise.all([
      adminAuth.listUsers(1000, pageToken),
      adminDb.collection('users').get(),
      adminDb.collection('referralEvents').get(),
    ]);
    const entitlementDocuments = new Map<string, Record<string, unknown>>(
      entitlementSnapshot.docs.map((document) => [
        document.id,
        document.data() as Record<string, unknown>,
      ])
    );
    const referralCounts = new Map<string, number>();
    referralEventsSnapshot.docs.forEach((document) => {
      const inviterUid = document.data().inviterUid;
      if (typeof inviterUid === 'string') {
        referralCounts.set(inviterUid, (referralCounts.get(inviterUid) ?? 0) + 1);
      }
    });
    const now = new Date();

    const users = authPage.users.map((authUser) => {
      const entitlementData = entitlementDocuments.get(authUser.uid);
      const entitlement = normalizeUserEntitlementServerSide(entitlementData, now);

      return {
        uid: authUser.uid,
        email: authUser.email ?? null,
        emailVerified: authUser.emailVerified,
        disabled: authUser.disabled,
        lastSignInTime: toTimestamp(authUser.metadata.lastSignInTime),
        lastSeenAt: entitlement.lastSeenAt ?? null,
        creationTime: toTimestamp(authUser.metadata.creationTime),
        paidTier: entitlement.paidTier,
        promotion: entitlement.promotion ?? null,
        usage: entitlement.usage,
        role: isAdminRole(entitlementData?.role) ? entitlementData.role : null,
        referredBy: typeof entitlementData?.referredBy === 'string'
          ? entitlementData.referredBy
          : null,
        referralCount: referralCounts.get(authUser.uid) ?? 0,
        effectiveTier: resolveEffectiveTier(entitlement, now),
      };
    }).sort((left, right) =>
      timestampValue(right.lastSignInTime) - timestampValue(left.lastSignInTime));

    return jsonResponse({
      users,
      ...(authPage.pageToken ? { nextPageToken: authPage.pageToken } : {}),
    });
  } catch {
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
