import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { legacyBoundaryResponse, refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';
import { studiesRepository } from '@repositories/studies.repository';

export async function GET(request: Request) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) {
    return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  // userId is a redundant echo of the authenticated caller; only reject an explicit
  // mismatch — never 401 an authenticated caller for omitting it.
  const userId = searchParams.get('userId');
  if (userId && userId !== uid) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const materials = await studiesRepository.listMaterials(uid);
    return NextResponse.json(materials.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
  } catch (error) {
    const refusal = legacyBoundaryResponse(error);
    if (refusal) return refusal;
    if (error && typeof error === 'object' && 'status' in error && (error.status === 400 || error.status === 403)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Request refused' }, { status: error.status });
    }
    console.error('GET /api/studies/materials error', error);
    return NextResponse.json({ error: 'Failed to fetch study materials' }, { status: 500 });
  }
}

/** POST stays for shipped bundles: study materials are created only through the data engine. */
export async function POST(request: Request) {
  return refuseLegacyWriteRoute(request);
}
