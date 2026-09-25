import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { legacyBoundaryResponse } from '@/data-engine/legacyBoundary.server';
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

    await seriesRepository.deleteSeriesAndDetach(id, uid);
    return NextResponse.json({ message: 'Series deleted successfully' }, { status: 200 });
  } catch (error: unknown) {
    const boundary = legacyBoundaryResponse(error);
    if (boundary) return boundary;
    const { id } = await params;
    console.error(`Error deleting series ${id}:`, error);
    return NextResponse.json(
      { message: 'Failed to delete series', error: (error as Error).message },
      { status: 500 }
    );
  }
}
