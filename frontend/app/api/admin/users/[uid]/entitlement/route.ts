import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminEmail } from '@/api/admin/adminAuth';
import { adminDb } from '@/config/firebaseAdminConfig';
import { TIER_VALUES } from '@/models/models';
import { getUserEntitlementServerSide } from '@/services/userEntitlement.server';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
};

const tierSchema = z.enum(TIER_VALUES);
const isoDateTimeSchema = z.string().datetime({ offset: true }).refine(
  (value) => !Number.isNaN(Date.parse(value)),
  { message: 'Invalid ISO-8601 date-time' }
);
const promotionSchema = z.object({
  tier: tierSchema,
  expiresAt: isoDateTimeSchema,
}).strict();
const usageSchema = z.object({
  aiUsed: z.number().finite().nonnegative().optional(),
  transcriptionSecondsUsed: z.number().finite().nonnegative().optional(),
  periodStart: isoDateTimeSchema.optional(),
}).strict();
const entitlementPatchSchema = z.object({
  paidTier: tierSchema.optional(),
  promotion: promotionSchema.nullable().optional(),
  usage: usageSchema.optional(),
  // Intentional forward seam: persisted for future role-based admin support,
  // but not trusted for authorization while the admin gate remains email-based.
  role: z.enum(['user', 'admin', 'superuser']).optional(),
}).strict().refine(
  (patch) => Object.values(patch).some((value) => value !== undefined),
  { message: 'At least one entitlement field is required' }
);

const uidSchema = z.string().min(1).max(128).refine((uid) => {
  if (!uid.trim() || uid.includes('/') || /^\.+$/.test(uid)) return false;
  return Array.from(uid).every((character) => {
    const codePoint = character.codePointAt(0) as number;
    return codePoint >= 32 && codePoint !== 127;
  });
}, { message: 'Invalid user uid' });

const jsonResponse = (body: unknown, status = 200): NextResponse =>
  NextResponse.json(body, { status, headers: NO_STORE_HEADERS });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ uid: string }> }
): Promise<NextResponse> {
  const admin = await requireAdminEmail(request);
  if (!admin.ok) return admin.response;

  const uidResult = uidSchema.safeParse((await params).uid);
  if (!uidResult.success) {
    return jsonResponse({ error: 'Invalid user uid' }, 400);
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const patchResult = entitlementPatchSchema.safeParse(requestBody);
  if (!patchResult.success) {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  try {
    await adminDb.collection('users').doc(uidResult.data).set(patchResult.data, { merge: true });
    const entitlement = await getUserEntitlementServerSide(uidResult.data);
    return jsonResponse(entitlement);
  } catch {
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
