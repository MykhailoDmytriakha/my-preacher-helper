import { NextResponse } from 'next/server';

import { toDateOnlyKey } from '@/utils/dateOnly';
import { sermonsRepository } from '@repositories/sermons.repository';

// POST /api/sermons/[id]/preach-dates
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const data = await request.json();

        // Validation
        if (!data.date || !data.church || !data.church.name) {
            return NextResponse.json({ error: 'Missing required fields: date and church name' }, { status: 400 });
        }

        const normalizedDate = toDateOnlyKey(data.date);
        if (!normalizedDate) {
            return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
        }

        data.date = normalizedDate;

        if (data.status && data.status !== 'planned' && data.status !== 'preached') {
            return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
        }

        const preachDate = await sermonsRepository.addPreachDate(id, data);
        return NextResponse.json({ preachDate });
    } catch (error: unknown) {
        console.error(`Error adding preach date to sermon ${id}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorMessage === "Sermon not found") {
            return NextResponse.json({ error: errorMessage }, { status: 404 });
        }
        return NextResponse.json({ error: 'Failed to add preach date' }, { status: 500 });
    }
}

// GET /api/sermons/[id]/preach-dates
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const sermon = await sermonsRepository.fetchSermonById(id);
        return NextResponse.json({ preachDates: sermon.preachDates || [] });
    } catch (error: unknown) {
        console.error(`Error fetching preach dates for sermon ${id}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorMessage === "Sermon not found") {
            return NextResponse.json({ error: errorMessage }, { status: 404 });
        }
        return NextResponse.json({ error: 'Failed to fetch preach dates' }, { status: 500 });
    }
}
