import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';
import { serviceOrdersRepository } from '@repositories/serviceOrders.repository';

/**
 * THE RITES OVER ORDINARY HTTPS — the second road to the same database, for reading.
 *
 * The browser normally reads Firestore itself. On a device where that transport goes silent —
 * measured on the owner's iPad, zero server snapshots while this road answered in 205 ms — a
 * section with only one road shows a skeleton for ever. Every answer here is the caller's own:
 * the token is verified and the query filtered by it, because an admin key bypasses the
 * Security Rules that would otherwise say the same thing.
 */

export async function GET(request: Request) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const orders = await serviceOrdersRepository.listForOwner(uid);
    return NextResponse.json(orders, {
      // A rite read to prove what the server holds must never come from a cache in between.
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Error listing service orders:', error);
    return NextResponse.json({ error: 'Failed to list service orders' }, { status: 500 });
  }
}

/** POST /api/service-orders — orders of service are seeded through the data engine; a shipped bundle's seed gets the refusal. */
export async function POST(request: Request) {
  return refuseLegacyWriteRoute(request);
}
