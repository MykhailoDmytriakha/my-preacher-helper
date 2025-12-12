import { NextResponse } from 'next/server';

import { adminDb } from '@/config/firebaseAdminConfig';
import { seriesRepository } from '@repositories/series.repository';

// Error messages
const ERROR_MESSAGES = {
  SERIES_NOT_FOUND: 'Series not found',
} as const;

// GET /api/series/:id
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const series = await seriesRepository.fetchSeriesById(id);

    if (!series) {
      return NextResponse.json({ error: ERROR_MESSAGES.SERIES_NOT_FOUND }, { status: 404 });
    }

    return NextResponse.json(series);
  } catch (error: unknown) {
    console.error(`Error fetching series ${id}:`, error);
    return NextResponse.json({ error: 'Failed to fetch series' }, { status: 500 });
  }
}

// PUT /api/series/:id - update series
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const updateData = await request.json();

    // Validate the series exists first
    const existingSeries = await seriesRepository.fetchSeriesById(id);
    if (!existingSeries) {
      return NextResponse.json({ error: ERROR_MESSAGES.SERIES_NOT_FOUND }, { status: 404 });
    }

    // Validate status if provided
    const validStatuses = ['draft', 'active', 'completed'];
    if (updateData.status && !validStatuses.includes(updateData.status)) {
      return NextResponse.json({
        error: "Invalid status. Must be one of: draft, active, completed"
      }, { status: 400 });
    }

    // Check if there's anything to update
    const validFields = ['title', 'theme', 'description', 'bookOrTopic', 'startDate', 'duration', 'color', 'status'];
    const filteredUpdates: Record<string, unknown> = {};

    for (const field of validFields) {
      if (updateData[field] !== undefined) {
        filteredUpdates[field] = updateData[field];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields provided for update' },
        { status: 400 }
      );
    }

    // Update the series
    await seriesRepository.updateSeries(id, filteredUpdates);

    // Return the updated series
    const updatedSeries = await seriesRepository.fetchSeriesById(id);
    return NextResponse.json(updatedSeries);
  } catch (error: unknown) {
    console.error(`Error updating series ${id}:`, error);
    return NextResponse.json(
      { error: 'Failed to update series', details: (error as Error).message },
      { status: 500 }
    );
  }
}

// DELETE /api/series/:id - Delete a series
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const series = await seriesRepository.fetchSeriesById(id);
    if (!series) {
      return NextResponse.json({ message: ERROR_MESSAGES.SERIES_NOT_FOUND }, { status: 200 });
    }

    // Clear series references from sermons before deleting the series
    if (series.sermonIds.length > 0) {
      const batch = adminDb.batch();
      for (const sermonId of series.sermonIds) {
        const sermonRef = adminDb.collection('sermons').doc(sermonId);
        batch.update(sermonRef, {
          seriesId: null,
          seriesPosition: null
        });
      }
      await batch.commit();
      console.log(`Cleared series references from ${series.sermonIds.length} sermons`);
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
