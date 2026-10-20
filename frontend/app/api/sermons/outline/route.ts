import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { legacyBoundaryResponse } from '@/data-engine/legacyBoundary.server';
import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';
import { StoreUnavailableError, storeUnavailableResponse, withStore } from '@/services/storeAvailability.server';
import { sermonsRepository } from '@repositories/sermons.repository';

const SERMON_NOT_FOUND_ERROR = 'Sermon not found';

// GET /api/sermons/outline?sermonId=<id>
export async function GET(request: Request) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get("sermonId");
    
    if (!sermonId) {
      return NextResponse.json({ error: "sermonId is required" }, { status: 400 });
    }
    const sermon = await withStore(() => sermonsRepository.fetchSermonById(sermonId));
    if (!sermon) {
      return NextResponse.json({ error: SERMON_NOT_FOUND_ERROR }, { status: 404 });
    }
    if (sermon.userId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const outline = await sermonsRepository.fetchSermonOutlineBySermonId(sermonId);
    return NextResponse.json(outline);
  } catch (error: unknown) {
    if (error instanceof StoreUnavailableError) return storeUnavailableResponse(error);
    const boundary = legacyBoundaryResponse(error);
    if (boundary) return boundary;
    if ((error as Error).message === SERMON_NOT_FOUND_ERROR) {
      return NextResponse.json({ error: (error as Error).message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to fetch sermon outline' }, { status: 500 });
  }
}

/** PUT stays for shipped bundles: the plan is written only through the data engine (426 refusal). */
export async function PUT(request: Request) {
  return refuseLegacyWriteRoute(request);
}
