import { NextResponse } from 'next/server';

import { studiesRepository } from '@repositories/studies.repository';

import type { StudyNote } from '@/models/models';

// Error messages
const ERROR_MESSAGES = {
  USER_NOT_AUTHENTICATED: 'User not authenticated',
} as const;

function getUserId(request: Request): string | null {
  return new URL(request.url).searchParams.get('userId');
}

/**
 * Fields a client is allowed to set/change. `isDraft`, `createdAt`,
 * `updatedAt`, and `legacyContent` are server-derived — never accept
 * them from the request body.
 */
const ALLOWED_UPDATE_FIELDS = [
  'title',
  'content',
  'scriptureRefs',
  'tags',
  'type',
  'materialIds',
  'relatedSermonIds',
  'rootNode',
] as const satisfies readonly (keyof StudyNote)[];

function pickAllowedUpdates(body: Record<string, unknown>): Partial<StudyNote> {
  const out: Partial<StudyNote> = {};
  for (const key of ALLOWED_UPDATE_FIELDS) {
    if (key in body) {
      (out as Record<string, unknown>)[key] = body[key];
    }
  }
  return out;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });

  try {
    const note = await studiesRepository.getNote(id);
    if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (note.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(note);
  } catch (error) {
    console.error(`GET /api/studies/notes/${id} error`, error);
    return NextResponse.json({ error: 'Failed to load study note' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const existing = await studiesRepository.getNote(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Never allow switching ownership
    if (body.userId && body.userId !== userId) {
      return NextResponse.json({ error: 'Cannot change userId' }, { status: 400 });
    }

    const updates = pickAllowedUpdates(body);
    const updated = await studiesRepository.updateNote(id, { ...updates, userId });
    return NextResponse.json(updated);
  } catch (error) {
    console.error(`PUT /api/studies/notes/${id} error`, error);
    return NextResponse.json({ error: 'Failed to update study note' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });
  try {
    const existing = await studiesRepository.getNote(id);
    if (!existing) return NextResponse.json({ success: true });
    if (existing.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    await studiesRepository.deleteNote(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/studies/notes/${id} error`, error);
    return NextResponse.json({ error: 'Failed to delete study note' }, { status: 500 });
  }
}
