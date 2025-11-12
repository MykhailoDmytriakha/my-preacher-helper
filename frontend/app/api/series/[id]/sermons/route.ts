import { NextRequest, NextResponse } from 'next/server';
import { seriesRepository } from '@repositories/series.repository';
import { sermonsRepository } from '@repositories/sermons.repository';

// POST /api/series/:id/sermons - add sermon to series
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { id: seriesId } = params;

  try {
    const { sermonId, position } = await request.json();

    if (!sermonId) {
      return NextResponse.json({ error: 'sermonId is required' }, { status: 400 });
    }

    // Validate that series exists
    const series = await seriesRepository.fetchSeriesById(seriesId);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    // Add sermon to series
    await seriesRepository.addSermonToSeries(seriesId, sermonId, position);

    // Update the sermon's seriesId field
    await sermonsRepository.updateSermonSeriesInfo(sermonId, seriesId, position);

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
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const { id: seriesId } = params;

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
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    // Reorder sermons in series
    await seriesRepository.reorderSermonsInSeries(seriesId, sermonIds);

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
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const { id: seriesId } = params;

  try {
    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get('sermonId');

    if (!sermonId) {
      return NextResponse.json({ error: 'sermonId query parameter is required' }, { status: 400 });
    }

    // Validate that series exists
    const series = await seriesRepository.fetchSeriesById(seriesId);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    // Remove sermon from series
    await seriesRepository.removeSermonFromSeries(seriesId, sermonId);

    // Clear the sermon's seriesId field
    await sermonsRepository.updateSermonSeriesInfo(sermonId, null, null);

    return NextResponse.json({ message: 'Sermon removed from series successfully' });
  } catch (error: unknown) {
    console.error(`Error removing sermon from series ${seriesId}:`, error);
    return NextResponse.json(
      { error: 'Failed to remove sermon from series', details: (error as Error).message },
      { status: 500 }
    );
  }
}
