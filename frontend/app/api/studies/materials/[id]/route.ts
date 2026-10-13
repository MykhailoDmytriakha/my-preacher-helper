import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { legacyBoundaryResponse, refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';
import { studiesRepository } from '@repositories/studies.repository';

const REQUEST_REFUSED = 'Request refused';

// Error messages
const ERROR_MESSAGES = {
  USER_NOT_AUTHENTICATED: 'User not authenticated',
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });
  const { id } = await params;
  try {
    const material = await studiesRepository.getMaterial(id);
    if (!material) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (material.userId !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(material);
  } catch (error) {
    const refusal = legacyBoundaryResponse(error);
    if (refusal) return refusal;
    if (error && typeof error === 'object' && 'status' in error && (error.status === 400 || error.status === 403)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : REQUEST_REFUSED }, { status: error.status });
    }
    console.error(`GET /api/studies/materials/${id} error`, error);
    return NextResponse.json({ error: 'Failed to fetch material' }, { status: 500 });
  }
}

/**
 * PUT and DELETE stay for shipped bundles. Study materials are written only through the data
 * engine, so both answer with the 426 refusal.
 */
export async function PUT(request: Request) {
  return refuseLegacyWriteRoute(request);
}

export async function DELETE(request: Request) {
  return refuseLegacyWriteRoute(request);
}
