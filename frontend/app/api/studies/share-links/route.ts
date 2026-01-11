import { randomUUID } from 'crypto';

import { NextResponse } from 'next/server';

import { studiesRepository } from '@repositories/studies.repository';
import { studyNoteShareLinksRepository } from '@repositories/studyNoteShareLinks.repository';

const ERROR_MESSAGES = {
  USER_NOT_AUTHENTICATED: 'User not authenticated',
  NOTE_ID_REQUIRED: 'noteId is required',
  NOTE_NOT_FOUND: 'Study note not found',
  FORBIDDEN: 'Forbidden',
} as const;

function getUserId(request: Request): string | null {
  return new URL(request.url).searchParams.get('userId');
}

export async function GET(request: Request) {
  const userId = getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });
  }

  try {
    const links = await studyNoteShareLinksRepository.listByOwner(userId);
    return NextResponse.json(links);
  } catch (error) {
    console.error('GET /api/studies/share-links error', error);
    return NextResponse.json({ error: 'Failed to fetch share links' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { noteId, userId } = payload as { noteId?: string; userId?: string };

    if (!userId) {
      return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });
    }

    if (!noteId) {
      return NextResponse.json({ error: ERROR_MESSAGES.NOTE_ID_REQUIRED }, { status: 400 });
    }

    const note = await studiesRepository.getNote(noteId);
    if (!note) {
      return NextResponse.json({ error: ERROR_MESSAGES.NOTE_NOT_FOUND }, { status: 404 });
    }

    if (note.userId !== userId) {
      return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 });
    }

    const existing = await studyNoteShareLinksRepository.findByOwnerAndNoteId(userId, noteId);
    if (existing) {
      return NextResponse.json(existing, { status: 200 });
    }

    const token = randomUUID();
    const created = await studyNoteShareLinksRepository.createLink({ ownerId: userId, noteId, token });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('POST /api/studies/share-links error', error);
    return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 });
  }
}
