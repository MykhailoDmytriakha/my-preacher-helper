import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';
import { councilsRepository } from '@repositories/councils.repository';

import { noStore, writeError } from './writeSupport';

/**
 * THE COUNCILS OVER ORDINARY HTTPS — the road that answers on the device where the browser's
 * own Firestore does not. Every answer is the caller's own: the token is verified and the query
 * filtered by it, because the admin key would otherwise answer about anyone.
 */

/** GET /api/councils — every council belonging to the caller. */
export async function GET(request: Request) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const councils = await councilsRepository.listForOwner(uid);
    return NextResponse.json(councils, { headers: noStore });
  } catch (error) {
    console.error('Error listing councils:', error);
    return writeError(error);
  }
}

/** POST /api/councils — councils are written only through the data engine; a shipped bundle's create gets the refusal. */
export async function POST(request: Request) {
  return refuseLegacyWriteRoute(request);
}
