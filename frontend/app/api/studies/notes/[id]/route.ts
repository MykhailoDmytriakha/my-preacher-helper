import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { studiesRepository } from '@repositories/studies.repository';

// Error messages
const ERROR_MESSAGES = {
  USER_NOT_AUTHENTICATED: 'User not authenticated',
} as const;

// GET is intentionally left in place because the Phase 5 inventory did not
// classify it. Service fallback paths no longer call it.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });
  const { id } = await params;

  try {
    const note = await studiesRepository.getNote(id);
    if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (note.userId !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(note);
  } catch (error) {
    console.error(`GET /api/studies/notes/${id} error`, error);
    return NextResponse.json({ error: 'Failed to load study note' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });
  const { id } = await params;
  try {
    const existing = await studiesRepository.getNote(id);
    if (!existing) return NextResponse.json({ success: true });
    if (existing.userId !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    await studiesRepository.deleteNote(id, uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/studies/notes/${id} error`, error);
    return NextResponse.json({ error: 'Failed to delete study note' }, { status: 500 });
  }
}
