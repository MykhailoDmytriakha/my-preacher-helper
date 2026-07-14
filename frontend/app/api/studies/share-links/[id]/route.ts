import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { studyNoteShareLinksRepository } from '@repositories/studyNoteShareLinks.repository';

const ERROR_MESSAGES = {
  USER_NOT_AUTHENTICATED: 'User not authenticated',
  FORBIDDEN: 'Forbidden',
} as const;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) {
    return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });
  }
  const { id } = await params;

  try {
    const existing = await studyNoteShareLinksRepository.getById(id);
    if (!existing) {
      return NextResponse.json({ success: true });
    }

    if (existing.ownerId !== uid) {
      return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 });
    }

    await studyNoteShareLinksRepository.deleteLink(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/studies/share-links/${id} error`, error);
    return NextResponse.json({ error: 'Failed to delete share link' }, { status: 500 });
  }
}
