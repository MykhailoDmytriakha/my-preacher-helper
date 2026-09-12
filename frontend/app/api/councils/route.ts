import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { councilsRepository } from '@repositories/councils.repository';

import { councilBodySchema, noStore, writeError } from './writeSupport';

/**
 * THE COUNCILS OVER ORDINARY HTTPS — the road that answers on the device where the browser's
 * own Firestore does not. Every answer is the caller's own: the token is verified and the query
 * filtered by it, because the admin key would otherwise answer about anyone.
 */

const createSchema = z.object({ id: z.string().min(1).max(64), council: councilBodySchema }).strict();

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

/** POST /api/councils — create at the client's id; a replay returns the same council. */
export async function POST(request: Request) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid council' }, { status: 400 });
  try {
    const created = await councilsRepository.createForOwner(uid, parsed.data.id, parsed.data.council);
    return NextResponse.json(created, { status: 201, headers: noStore });
  } catch (error) {
    console.error('Error creating council:', error);
    return writeError(error);
  }
}
