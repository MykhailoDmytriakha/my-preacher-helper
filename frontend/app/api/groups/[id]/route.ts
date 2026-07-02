import { NextResponse } from 'next/server';

import { groupsRepository } from '@repositories/groups.repository';
import { seriesRepository } from '@repositories/series.repository';

const ERROR_MESSAGES = {
  GROUP_NOT_FOUND: 'Group not found',
} as const;

// NOTE: the old PUT /api/groups/:id (series-binding cascade) was removed in the
// playlist migration — a group's series membership now lives in series.items and
// is written by the client sweep (useSeriesMembership). DELETE stays: it clears
// this group from every series via the Admin SDK (removeGroupFromAllSeries).

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
