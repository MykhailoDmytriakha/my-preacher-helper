import { NextRequest, NextResponse } from 'next/server';

import { seriesRepository } from '@repositories/series.repository';
import { sermonsRepository } from '@repositories/sermons.repository';

// Error messages
const ERROR_MESSAGES = {
  SERIES_NOT_FOUND: 'Series not found',
} as const;

async function syncSermonPositions(seriesId: string) {
  const series = await seriesRepository.fetchSeriesById(seriesId);
  if (!series) return;

  const sermonItems = (series.items || [])
    .filter((item) => item.type === 'sermon')
    .map((item) => ({ sermonId: item.refId, position: item.position }));

  if (sermonItems.length > 0) {
    await Promise.all(
      sermonItems.map((item) =>
        sermonsRepository.updateSermonSeriesInfo(item.sermonId, seriesId, item.position)
      )
    );
    return;
  }

  // Legacy fallback for series documents without mixed items
  await Promise.all(
    (series.sermonIds || []).map((sermonId, index) =>
      sermonsRepository.updateSermonSeriesInfo(sermonId, seriesId, index + 1)
    )
  );
}

// POST /api/series/:id/sermons - add sermon to series
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: seriesId } = await params;

  try {
    const { sermonId, position } = await request.json();

    if (!sermonId) {
      return NextResponse.json({ error: 'sermonId is required' }, { status: 400 });
    }

    // Validate that series exists
    const series = await seriesRepository.fetchSeriesById(seriesId);
    if (!series) {
      return NextResponse.json({ error: ERROR_MESSAGES.SERIES_NOT_FOUND }, { status: 404 });
    }

    // Add sermon to series
    await seriesRepository.addSermonToSeries(seriesId, sermonId, position);

    // Sync all sermon positions after mutation to keep references stable
    await syncSermonPositions(seriesId);

    return NextResponse.json({ message: 'Sermon added to series successfully' });
  } catch (error: unknown) {
    console.error(`Error adding sermon to series ${seriesId}:`, error);
    return NextResponse.json(
      { error: 'Failed to add sermon to series', details: (error as Error).message },
      { status: 500 }
    );
  }
}

// PUT /api/series/:id/sermons - reorder sermons in series
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: seriesId } = await params;

  try {
    const { sermonIds } = await request.json();

    if (!Array.isArray(sermonIds)) {
      return NextResponse.json({ error: 'sermonIds must be an array' }, { status: 400 });
    }

    if (sermonIds.length === 0) {
      return NextResponse.json({ error: 'sermonIds array cannot be empty' }, { status: 400 });
    }

    // Validate that series exists
    const series = await seriesRepository.fetchSeriesById(seriesId);
    if (!series) {
      return NextResponse.json({ error: ERROR_MESSAGES.SERIES_NOT_FOUND }, { status: 404 });
    }

    // Reorder sermons in series
    await seriesRepository.reorderSermonsInSeries(seriesId, sermonIds);
    await syncSermonPositions(seriesId);

    return NextResponse.json({ message: 'Sermons reordered successfully' });
  } catch (error: unknown) {
    console.error(`Error reordering sermons in series ${seriesId}:`, error);
    return NextResponse.json(
      { error: 'Failed to reorder sermons', details: (error as Error).message },
      { status: 500 }
    );
  }
}

// DELETE /api/series/:id/sermons?sermonId=<sermonId> - remove sermon from series
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: seriesId } = await params;

  try {
    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get('sermonId');

    if (!sermonId) {
      return NextResponse.json({ error: 'sermonId query parameter is required' }, { status: 400 });
    }

    // Validate that series exists
    const series = await seriesRepository.fetchSeriesById(seriesId);
    if (!series) {
      return NextResponse.json({ error: ERROR_MESSAGES.SERIES_NOT_FOUND }, { status: 404 });
    }

    // Remove sermon from series
    await seriesRepository.removeSermonFromSeries(seriesId, sermonId);

    // Clear the sermon's seriesId field
    await sermonsRepository.updateSermonSeriesInfo(sermonId, null, null);
    await syncSermonPositions(seriesId);

    return NextResponse.json({ message: 'Sermon removed from series successfully' });
  } catch (error: unknown) {
    console.error(`Error removing sermon from series ${seriesId}:`, error);
    return NextResponse.json(
      { error: 'Failed to remove sermon from series', details: (error as Error).message },
      { status: 500 }
    );
  }
}
