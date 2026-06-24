import { NextResponse } from 'next/server';

import { groupsRepository } from '@repositories/groups.repository';
import { seriesRepository } from '@repositories/series.repository';

const ERROR_MESSAGES = {
  GROUP_NOT_FOUND: 'Group not found',
} as const;

// PUT /api/groups/:id
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const payload = await request.json();
    const group = await groupsRepository.fetchGroupById(id);

    if (!group) {
      return NextResponse.json({ error: ERROR_MESSAGES.GROUP_NOT_FOUND }, { status: 404 });
    }

    const hasSeriesUpdate = 'seriesId' in payload || 'seriesPosition' in payload;
    if (!hasSeriesUpdate) {
      return NextResponse.json({ error: 'No series fields provided for update' }, { status: 400 });
    }

    // Handle series sync if seriesId changed
    if (payload.seriesId !== undefined && payload.seriesId !== group.seriesId) {
      if (group.seriesId) {
        // Remove from old series
        try {
          await seriesRepository.removeGroupFromSeries(group.seriesId, id);
        } catch (e) {
          console.error(`Failed to remove group ${id} from old series ${group.seriesId}:`, e);
        }
      }
      if (payload.seriesId) {
        // Add to new series
        try {
          await seriesRepository.addGroupToSeries(payload.seriesId, id, payload.seriesPosition);
        } catch (e) {
          console.error(`Failed to add group ${id} to new series ${payload.seriesId}:`, e);
        }
      }
    }

    const nextSeriesId =
      payload.seriesId !== undefined ? payload.seriesId || null : group.seriesId ?? null;
    const nextSeriesPosition =
      payload.seriesPosition !== undefined ? payload.seriesPosition ?? null : group.seriesPosition ?? null;

    await groupsRepository.updateGroupSeriesInfo(id, nextSeriesId, nextSeriesPosition);
    const updated = await groupsRepository.fetchGroupById(id);

    return NextResponse.json(updated);
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
