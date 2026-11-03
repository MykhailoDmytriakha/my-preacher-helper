import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';
import { StoreUnavailableError, storeUnavailableResponse, withStore } from '@/services/storeAvailability.server';
import { studyNoteShareLinksRepository } from '@repositories/studyNoteShareLinks.repository';

const ERROR_MESSAGES = {
  USER_NOT_AUTHENTICATED: 'User not authenticated',
  NOTE_ID_REQUIRED: 'noteId is required',
  NOTE_NOT_FOUND: 'Study note not found',
  FORBIDDEN: 'Forbidden',
} as const;

export async function GET(request: Request) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) {
    return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });
  }

  try {
    const links = await withStore(() => studyNoteShareLinksRepository.listByOwner(uid));
    return NextResponse.json(links);
  } catch (error) {
    if (error instanceof StoreUnavailableError) return storeUnavailableResponse(error);
    console.error('GET /api/studies/share-links error', error);
    return NextResponse.json({ error: 'Failed to fetch share links' }, { status: 500 });
  }
}

/** Old bundles retain an authenticated refusal instead of a second capability writer. */
export async function POST(request: Request) {
  return refuseLegacyWriteRoute(request);
}
