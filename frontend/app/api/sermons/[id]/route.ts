import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { isOwnersTombstone } from '@/data-engine/legacyBoundary.server';
import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';
import { StoreUnavailableError, storeUnavailableResponse, withStore } from '@/services/storeAvailability.server';

/** Read recovery bypasses the browser transport, never the owner's access boundary. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    const { adminDb } = await import('@/config/firebaseAdminConfig');
    const { id } = await params;
    const snapshot = await withStore(() => adminDb.collection('sermons').doc(id).get());
    if (!snapshot.exists || isOwnersTombstone(snapshot.data(), uid)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
    const sermon = snapshot.data()!;
    if (sermon.userId !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
    return NextResponse.json({ ...sermon, id: snapshot.id }, { headers });
  } catch (error) {
    if (error instanceof StoreUnavailableError) return storeUnavailableResponse(error);
    return NextResponse.json({ error: 'Sermon read unavailable' }, { status: 503, headers });
  }
}

/**
 * DELETE stays for shipped bundles. Sermons are deleted only through the data engine, which also
 * detaches them from their series, so an old bundle's delete gets the 426 refusal.
 */
export async function DELETE(request: Request) {
  return refuseLegacyWriteRoute(request);
}
