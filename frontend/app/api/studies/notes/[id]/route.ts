import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { isOwnersTombstone, legacyBoundaryResponse } from '@/data-engine/legacyBoundary.server';
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
    // A note deleted through the engine is a tombstone that names its owner only in
    // `_dataEngineOwner`: for that owner it is simply gone, not someone else's note.
    if (!note || isOwnersTombstone(note as unknown as Record<string, unknown>, uid)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (note.userId !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(note);
  } catch (error) {
    const refusal = legacyBoundaryResponse(error);
    if (refusal) return refusal;
    if (error && typeof error === 'object' && 'status' in error && (error.status === 400 || error.status === 403)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Request refused' }, { status: error.status });
    }
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
    if (!existing || isOwnersTombstone(existing as unknown as Record<string, unknown>, uid)) return NextResponse.json({ success: true });
    if (existing.userId !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    await studiesRepository.deleteNote(id, uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    const refusal = legacyBoundaryResponse(error);
    if (refusal) return refusal;
    if (error && typeof error === 'object' && 'status' in error && (error.status === 400 || error.status === 403)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Request refused' }, { status: error.status });
    }
    console.error(`DELETE /api/studies/notes/${id} error`, error);
    return NextResponse.json({ error: 'Failed to delete study note' }, { status: 500 });
  }
}
