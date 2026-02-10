import { NextRequest, NextResponse } from 'next/server';

import { groupsRepository } from '@repositories/groups.repository';
import { seriesRepository } from '@repositories/series.repository';
import { sermonsRepository } from '@repositories/sermons.repository';

const VALID_TYPES = ['sermon', 'group'] as const;
type SeriesItemType = (typeof VALID_TYPES)[number];
const ERROR_SERIES_NOT_FOUND = 'Series not found';

const isValidType = (value: string): value is SeriesItemType =>
  VALID_TYPES.includes(value as SeriesItemType);

async function syncSeriesItemPositions(seriesId: string) {
  const series = await seriesRepository.fetchSeriesById(seriesId);
  if (!series) return;

  await Promise.all(
    (series.items || []).map((item) => {
      if (item.type === 'sermon') {
        return sermonsRepository.updateSermonSeriesInfo(item.refId, seriesId, item.position);
      }
      return groupsRepository.updateGroupSeriesInfo(item.refId, seriesId, item.position);
    })
  );
}

// POST /api/series/:id/items
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: seriesId } = await params;

  try {
    const payload = await request.json();
    const type = String(payload.type || '');
    const refId = String(payload.refId || '').trim();
    const position =
      payload.position === undefined || payload.position === null ? undefined : Number(payload.position);

    if (!isValidType(type)) {
      return NextResponse.json({ error: 'Invalid item type' }, { status: 400 });
    }

    if (!refId) {
      return NextResponse.json({ error: 'refId is required' }, { status: 400 });
    }

    const series = await seriesRepository.fetchSeriesById(seriesId);
    if (!series) {
      return NextResponse.json({ error: ERROR_SERIES_NOT_FOUND }, { status: 404 });
    }

    if (type === 'sermon') {
      await seriesRepository.addSermonToSeries(seriesId, refId, position);
    } else {
      await seriesRepository.addGroupToSeries(seriesId, refId, position);
    }

    await syncSeriesItemPositions(seriesId);
    return NextResponse.json({ message: 'Item added to series successfully' });
  } catch (error: unknown) {
    console.error(`Error adding item to series ${seriesId}:`, error);
    return NextResponse.json({ error: 'Failed to add item to series' }, { status: 500 });
  }
}

// PUT /api/series/:id/items
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: seriesId } = await params;

  try {
    const payload = await request.json();
    const itemIds = payload.itemIds;

    if (!Array.isArray(itemIds) || !itemIds.every((id) => typeof id === 'string')) {
      return NextResponse.json({ error: 'itemIds must be an array of strings' }, { status: 400 });
    }

    if (itemIds.length === 0) {
      return NextResponse.json({ error: 'itemIds cannot be empty' }, { status: 400 });
    }

    const series = await seriesRepository.fetchSeriesById(seriesId);
    if (!series) {
      return NextResponse.json({ error: ERROR_SERIES_NOT_FOUND }, { status: 404 });
    }

    await seriesRepository.reorderSeriesItems(seriesId, itemIds);
    await syncSeriesItemPositions(seriesId);

    return NextResponse.json({ message: 'Series items reordered successfully' });
  } catch (error: unknown) {
    console.error(`Error reordering mixed items in series ${seriesId}:`, error);
    return NextResponse.json({ error: 'Failed to reorder series items' }, { status: 500 });
  }
}

// DELETE /api/series/:id/items?type=sermon|group&refId=<id>
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: seriesId } = await params;

  try {
    const { searchParams } = new URL(request.url);
    const type = String(searchParams.get('type') || '');
    const refId = String(searchParams.get('refId') || '').trim();

    if (!isValidType(type)) {
      return NextResponse.json({ error: 'Invalid item type' }, { status: 400 });
    }

    if (!refId) {
      return NextResponse.json({ error: 'refId query parameter is required' }, { status: 400 });
    }

    const series = await seriesRepository.fetchSeriesById(seriesId);
    if (!series) {
      return NextResponse.json({ error: ERROR_SERIES_NOT_FOUND }, { status: 404 });
    }

    if (type === 'sermon') {
      await seriesRepository.removeSermonFromSeries(seriesId, refId);
      await sermonsRepository.updateSermonSeriesInfo(refId, null, null);
    } else {
      await seriesRepository.removeGroupFromSeries(seriesId, refId);
      await groupsRepository.updateGroupSeriesInfo(refId, null, null);
    }

    await syncSeriesItemPositions(seriesId);
    return NextResponse.json({ message: 'Item removed from series successfully' });
  } catch (error: unknown) {
    console.error(`Error removing item from series ${seriesId}:`, error);
    return NextResponse.json({ error: 'Failed to remove item from series' }, { status: 500 });
  }
}
