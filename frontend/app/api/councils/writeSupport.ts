import { NextResponse } from 'next/server';

import { legacyBoundaryResponse } from '@/data-engine/legacyBoundary.server';

/** The answer a council read gives when it fails; a write refusal keeps its 426 contract. */
export function writeError(error: unknown) {
  const boundary = legacyBoundaryResponse(error);
  if (boundary) return boundary;
  const code = (error as { code?: string }).code;
  const status = code === 'not-found' ? 404 : code === 'permission-denied' ? 403 : 503;
  return NextResponse.json(
    { error: status === 404 ? 'Council not found' : status === 403 ? 'Forbidden' : 'Council write failed', code: code ?? 'unavailable' },
    { status }
  );
}

export const noStore = { 'Cache-Control': 'no-store' };
