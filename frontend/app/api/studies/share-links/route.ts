import { randomUUID } from 'crypto';

import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { studiesRepository } from '@repositories/studies.repository';
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
    const links = await studyNoteShareLinksRepository.listByOwner(uid);
    return NextResponse.json(links);
  } catch (error) {
    console.error('GET /api/studies/share-links error', error);
    return NextResponse.json({ error: 'Failed to fetch share links' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });
    }

    const payload = await request.json();
    const { noteId, userId } = payload as { noteId?: string; userId?: string };

    // userId is a redundant echo of the authenticated caller; only reject an explicit
    // mismatch — never 401 an authenticated caller for omitting it.
    if (userId && userId !== uid) {
      return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 });
    }

    if (!noteId) {
      return NextResponse.json({ error: ERROR_MESSAGES.NOTE_ID_REQUIRED }, { status: 400 });
    }

    const note = await studiesRepository.getNote(noteId);
    if (!note) {
      return NextResponse.json({ error: ERROR_MESSAGES.NOTE_NOT_FOUND }, { status: 404 });
    }

    if (note.userId !== uid) {
      return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 });
    }

    const existing = await studyNoteShareLinksRepository.findByOwnerAndNoteId(uid, noteId);
    if (existing) {
      return NextResponse.json(existing, { status: 200 });
    }

    const token = randomUUID();
    const created = await studyNoteShareLinksRepository.createLink({ ownerId: uid, noteId, token });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('POST /api/studies/share-links error', error);
    return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 });
  }
}
