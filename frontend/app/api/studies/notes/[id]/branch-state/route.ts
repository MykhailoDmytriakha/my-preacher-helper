import { NextResponse } from 'next/server';

import { studiesRepository } from '@repositories/studies.repository';

function getUserId(request: Request): string | null {
  return new URL(request.url).searchParams.get('userId');
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = getUserId(request);

  if (!userId) {
    return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
  }

  try {
    const note = await studiesRepository.getNote(id);

    if (!note) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (note.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const branchState = await studiesRepository.getNoteBranchState(id);
    return NextResponse.json(branchState);
  } catch (error) {
    console.error(`GET /api/studies/notes/${id}/branch-state error`, error);
    return NextResponse.json({ error: 'Failed to load study note branch state' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = getUserId(request);

  if (!userId) {
    return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
  }

  try {
    const note = await studiesRepository.getNote(id);

    if (!note) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (note.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payload = await request.json();
    const updatedState = await studiesRepository.upsertNoteBranchState(id, {
      userId,
      branchRecords: payload.branchRecords || [],
      readFoldedBranchIds: payload.readFoldedBranchIds || [],
      previewFoldedBranchIds: payload.previewFoldedBranchIds || [],
    });

    return NextResponse.json(updatedState);
  } catch (error) {
    console.error(`PUT /api/studies/notes/${id}/branch-state error`, error);
    return NextResponse.json({ error: 'Failed to save study note branch state' }, { status: 500 });
  }
}
