import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { adminDb } from '@/config/firebaseAdminConfig';
import { groupsRepository } from '@repositories/groups.repository';
import { seriesRepository } from '@repositories/series.repository';

// Error messages
const ERROR_MESSAGES = {
  SERIES_NOT_FOUND: 'Series not found',
} as const;

// DELETE /api/series/:id - Delete a series
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const series = await seriesRepository.fetchSeriesById(id);
    if (!series) {
      return NextResponse.json({ message: ERROR_MESSAGES.SERIES_NOT_FOUND }, { status: 200 });
    }
    if (series.userId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const items = series.items || [];
    const sermonRefs = items.filter((item) => item.type === 'sermon').map((item) => item.refId);
    const groupRefs = items.filter((item) => item.type === 'group').map((item) => item.refId);

    // Legacy fallback for old series documents without items
    if (items.length === 0 && series.sermonIds.length > 0) {
      sermonRefs.push(...series.sermonIds);
    }

    // Clear series references from sermons before deleting the series
    if (sermonRefs.length > 0) {
      const batch = adminDb.batch();
      let ownedSermonCount = 0;
      for (const sermonId of Array.from(new Set(sermonRefs))) {
        const sermonRef = adminDb.collection('sermons').doc(sermonId);
        const sermonDoc = await sermonRef.get();
        if (!sermonDoc.exists || sermonDoc.data()?.userId !== uid) {
          continue;
        }
        batch.update(sermonRef, {
          seriesId: null,
          seriesPosition: null
        });
        ownedSermonCount += 1;
      }
      if (ownedSermonCount > 0) {
        await batch.commit();
      }
      console.log(`Cleared series references from ${ownedSermonCount} owned sermons`);
    }

    if (groupRefs.length > 0) {
      const ownedGroups = (await Promise.all(
        Array.from(new Set(groupRefs)).map((groupId) => groupsRepository.fetchGroupById(groupId))
      )).filter((group): group is NonNullable<typeof group> => group?.userId === uid);
      await Promise.all(ownedGroups.map((group) =>
        groupsRepository.updateGroupSeriesInfo(group.id, null, null)
      ));
      console.log(`Cleared series references from ${ownedGroups.length} owned groups`);
    }

    await seriesRepository.deleteSeries(id);
    return NextResponse.json({ message: 'Series deleted successfully' }, { status: 200 });
  } catch (error: unknown) {
    const { id } = await params;
    console.error(`Error deleting series ${id}:`, error);
    return NextResponse.json(
      { message: 'Failed to delete series', error: (error as Error).message },
      { status: 500 }
    );
  }
}
