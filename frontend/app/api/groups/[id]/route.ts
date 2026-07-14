import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { groupsRepository } from '@repositories/groups.repository';
import { seriesRepository } from '@repositories/series.repository';

const ERROR_MESSAGES = {
  GROUP_NOT_FOUND: 'Group not found',
} as const;

// NOTE: the old PUT /api/groups/:id (series-binding cascade) was removed in the
// playlist migration — a group's series membership now lives in series.items and
// is written by the client sweep (useSeriesMembership). DELETE stays: it clears
// this group from the authenticated owner's series via the Admin SDK.

// DELETE /api/groups/:id
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const group = await groupsRepository.fetchGroupById(id);
    if (!group) {
      return NextResponse.json({ message: ERROR_MESSAGES.GROUP_NOT_FOUND }, { status: 200 });
    }
    if (group.userId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await seriesRepository.removeGroupFromAllSeries(id, uid);
    await groupsRepository.deleteGroup(id);

    return NextResponse.json({ message: 'Group deleted successfully' }, { status: 200 });
  } catch (error: unknown) {
    const { id } = await params;
    console.error(`Error deleting group ${id}:`, error);
    return NextResponse.json(
      { message: 'Failed to delete group', error: (error as Error).message },
      { status: 500 }
    );
  }
}
