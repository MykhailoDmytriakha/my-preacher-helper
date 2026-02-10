import { NextResponse } from 'next/server';

import { toDateOnlyKey } from '@/utils/dateOnly';
import { sermonsRepository } from '@repositories/sermons.repository';

import type { PreachDate } from '@/models/models';

// PUT /api/sermons/[id]/preach-dates/[dateId]
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string; dateId: string }> }
) {
    const { id, dateId } = await params;
    try {
        const updates = await request.json() as Partial<PreachDate>;

        // Basic validation to prevent updating id or createdAt
        const { id: _id, createdAt: _createdAt, ...safeUpdates } = updates;
        if (
            safeUpdates.status &&
            safeUpdates.status !== 'planned' &&
            safeUpdates.status !== 'preached'
        ) {
            return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
        }

        if (safeUpdates.date !== undefined) {
            const normalizedDate = toDateOnlyKey(safeUpdates.date);
            if (!normalizedDate) {
                return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
            }
            safeUpdates.date = normalizedDate;
        }

        const preachDate = await sermonsRepository.updatePreachDate(id, dateId, safeUpdates);
        return NextResponse.json({ preachDate });
    } catch (error: unknown) {
        console.error(`Error updating preach date ${dateId} in sermon ${id}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorMessage === "Sermon not found" || errorMessage === "Preach date not found") {
            return NextResponse.json({ error: errorMessage }, { status: 404 });
        }
        return NextResponse.json({ error: 'Failed to update preach date' }, { status: 500 });
    }
}

// DELETE /api/sermons/[id]/preach-dates/[dateId]
export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string; dateId: string }> }
) {
    const { id, dateId } = await params;
    try {
        await sermonsRepository.deletePreachDate(id, dateId);
        return NextResponse.json({ message: 'Preach date deleted' });
    } catch (error: unknown) {
        console.error(`Error deleting preach date ${dateId} from sermon ${id}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorMessage === "Sermon not found") {
            return NextResponse.json({ error: errorMessage }, { status: 404 });
        }
        return NextResponse.json({ error: 'Failed to delete preach date' }, { status: 500 });
    }
}
