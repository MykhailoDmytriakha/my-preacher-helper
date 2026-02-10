import { NextResponse } from 'next/server';

import { groupsRepository } from '@repositories/groups.repository';
import { seriesRepository } from '@repositories/series.repository';

const ERROR_MESSAGES = {
  GROUP_NOT_FOUND: 'Group not found',
} as const;

// GET /api/groups/:id
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const group = await groupsRepository.fetchGroupById(id);
    if (!group) {
      return NextResponse.json({ error: ERROR_MESSAGES.GROUP_NOT_FOUND }, { status: 404 });
    }

    return NextResponse.json(group);
  } catch (error: unknown) {
    console.error(`Error fetching group ${id}:`, error);
    return NextResponse.json({ error: 'Failed to fetch group' }, { status: 500 });
  }
}

// PUT /api/groups/:id
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const payload = await request.json();
    const group = await groupsRepository.fetchGroupById(id);

    if (!group) {
      return NextResponse.json({ error: ERROR_MESSAGES.GROUP_NOT_FOUND }, { status: 404 });
    }

    const next = await groupsRepository.updateGroup(id, {
      title: payload.title !== undefined ? String(payload.title).trim() : undefined,
      description:
        payload.description !== undefined ? String(payload.description).trim() || undefined : undefined,
      status: payload.status,
      templates: payload.templates,
      flow: payload.flow,
      meetingDates: payload.meetingDates,
      seriesId: payload.seriesId,
      seriesPosition: payload.seriesPosition,
    });

    return NextResponse.json(next);
  } catch (error: unknown) {
    console.error(`Error updating group ${id}:`, error);
    return NextResponse.json({ error: 'Failed to update group' }, { status: 500 });
  }
}

// DELETE /api/groups/:id
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const group = await groupsRepository.fetchGroupById(id);
    if (!group) {
      return NextResponse.json({ message: ERROR_MESSAGES.GROUP_NOT_FOUND }, { status: 200 });
    }

    await seriesRepository.removeGroupFromAllSeries(id);
    await groupsRepository.deleteGroup(id);

    return NextResponse.json({ message: 'Group deleted successfully' }, { status: 200 });
  } catch (error: unknown) {
    console.error(`Error deleting group ${id}:`, error);
    return NextResponse.json(
      { message: 'Failed to delete group', error: (error as Error).message },
      { status: 500 }
    );
  }
}
