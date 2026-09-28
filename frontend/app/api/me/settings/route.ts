import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { readOwnSettings, writeOwnSettings } from '@/data-engine/serverEdit.server';

import type { DocumentData } from '@/data-engine/types';

export const dynamic = 'force-dynamic';

const INVALID_REQUEST = 'Invalid request';
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' },
});
const failure = (error: unknown) => {
  const known = error as { code?: string; status?: number };
  if (known.code && known.status) return json({ code: known.code, error: known.code }, known.status);
  console.error('me/settings: request failed', error);
  return json({ error: 'Settings request failed' }, 500);
};

/** Caller identity comes exclusively from the verified Firebase token. */
export async function GET(request: Request) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return json({ error: 'Unauthorized' }, 401);
  try {
    const value = await readOwnSettings(uid);
    return json({ settings: value ? { ...value, id: uid, userId: uid } : null });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return json({ error: 'Unauthorized' }, 401);
  let body: unknown;
  try { body = await request.json(); }
  catch { return json({ error: INVALID_REQUEST }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: INVALID_REQUEST }, 400);
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !['operation', 'patch'].includes(key))
    || typeof input.operation !== 'string' || !['bootstrap', 'language', 'legacy', 'heartbeat'].includes(input.operation)
    || !input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)
    || JSON.stringify(input.patch).length > 16_384) return json({ error: INVALID_REQUEST }, 400);
  try {
    await writeOwnSettings(uid, input.operation as 'bootstrap' | 'language' | 'legacy' | 'heartbeat', input.patch as DocumentData);
    return json({ accepted: true });
  } catch (error) { return failure(error); }
}
