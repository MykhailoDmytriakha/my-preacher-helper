import { NextResponse } from 'next/server';

import { adminAuth } from '@/config/firebaseAdminConfig';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
};

type AdminEmailResult =
  | { ok: true; uid: string; email: string }
  | { ok: false; response: NextResponse };

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const errorResponse = (error: string, status: number): NextResponse =>
  NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS });

export async function requireAdminEmail(request: Request): Promise<AdminEmailResult> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return { ok: false, response: errorResponse('Unauthorized', 401) };
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    return { ok: false, response: errorResponse('Unauthorized', 401) };
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(token, true);
  } catch {
    return { ok: false, response: errorResponse('Unauthorized', 401) };
  }

  if (!decoded.uid) {
    return { ok: false, response: errorResponse('Unauthorized', 401) };
  }

  if (typeof decoded.email !== 'string' || !normalizeEmail(decoded.email)) {
    return { ok: false, response: errorResponse('Forbidden', 403) };
  }

  if (decoded.email_verified !== true) {
    return { ok: false, response: errorResponse('Forbidden', 403) };
  }

  const configuredAdminEmail = normalizeEmail(process.env.ADMIN_EMAIL ?? '');
  if (!configuredAdminEmail) {
    return { ok: false, response: errorResponse('Admin access is not configured', 503) };
  }

  const email = normalizeEmail(decoded.email);
  if (email !== configuredAdminEmail) {
    return { ok: false, response: errorResponse('Forbidden', 403) };
  }

  return { ok: true, uid: decoded.uid, email };
}
