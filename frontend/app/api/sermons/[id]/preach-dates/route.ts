import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { legacyBoundaryResponse } from '@/data-engine/legacyBoundary.server';
import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';
import { StoreUnavailableError, storeUnavailableResponse, withStore } from '@/services/storeAvailability.server';
import { sermonsRepository } from '@repositories/sermons.repository';

const SERMON_NOT_FOUND_ERROR = 'Sermon not found';

// GET /api/sermons/[id]/preach-dates
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const uid = await getRequiredAuthenticatedUid(request);
        if (!uid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const sermon = await withStore(() => sermonsRepository.fetchSermonById(id));
        if (!sermon) {
            return NextResponse.json({ error: SERMON_NOT_FOUND_ERROR }, { status: 404 });
        }
        if (sermon.userId !== uid) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        return NextResponse.json({ preachDates: sermon.preachDates || [] });
    } catch (error: unknown) {
    if (error instanceof StoreUnavailableError) return storeUnavailableResponse(error);
    const boundary = legacyBoundaryResponse(error);
    if (boundary) return boundary;
        const { id } = await params;
        console.error(`Error fetching preach dates for sermon ${id}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorMessage === SERMON_NOT_FOUND_ERROR) {
            return NextResponse.json({ error: errorMessage }, { status: 404 });
        }
        return NextResponse.json({ error: 'Failed to fetch preach dates' }, { status: 500 });
    }
}

/** POST stays for shipped bundles: preach dates are written only through the data engine (426 refusal). */
export async function POST(request: Request) {
  return refuseLegacyWriteRoute(request);
}
