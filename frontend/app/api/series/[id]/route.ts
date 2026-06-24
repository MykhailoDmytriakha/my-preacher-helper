import { NextResponse } from 'next/server';

import { adminDb } from '@/config/firebaseAdminConfig';
import { groupsRepository } from '@repositories/groups.repository';
import { seriesRepository } from '@repositories/series.repository';

// Error messages
const ERROR_MESSAGES = {
  SERIES_NOT_FOUND: 'Series not found',
} as const;

// DELETE /api/series/:id - Delete a series
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const series = await seriesRepository.fetchSeriesById(id);
    if (!series) {
      return NextResponse.json({ message: ERROR_MESSAGES.SERIES_NOT_FOUND }, { status: 200 });
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
      for (const sermonId of Array.from(new Set(sermonRefs))) {
        const sermonRef = adminDb.collection('sermons').doc(sermonId);
        batch.update(sermonRef, {
          seriesId: null,
          seriesPosition: null
        });
      }
      await batch.commit();
      console.log(`Cleared series references from ${sermonRefs.length} sermons`);
    }

    if (groupRefs.length > 0) {
      await Promise.all(
        Array.from(new Set(groupRefs)).map((groupId) =>
          groupsRepository.updateGroupSeriesInfo(groupId, null, null)
        )
      );
      console.log(`Cleared series references from ${groupRefs.length} groups`);
    }

    await seriesRepository.deleteSeries(id);
    return NextResponse.json({ message: 'Series deleted successfully' }, { status: 200 });
  } catch (error: unknown) {
    console.error(`Error deleting series ${id}:`, error);
    return NextResponse.json(
      { message: 'Failed to delete series', error: (error as Error).message },
      { status: 500 }
    );
  }
}
