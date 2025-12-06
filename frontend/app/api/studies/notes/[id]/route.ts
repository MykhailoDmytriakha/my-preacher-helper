import { NextResponse } from 'next/server';
import { studiesRepository } from '@repositories/studies.repository';

function getUserId(request: Request): string | null {
  return new URL(request.url).searchParams.get('userId');
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });

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
  if (!userId) return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
  try {
    const updates = await request.json();
    const existing = await studiesRepository.getNote(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Never allow switching ownership
    if (updates.userId && updates.userId !== userId) {
      return NextResponse.json({ error: 'Cannot change userId' }, { status: 400 });
    }

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
  if (!userId) return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
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
