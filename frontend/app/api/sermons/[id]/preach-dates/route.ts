import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { toDateOnlyKey } from '@/utils/dateOnly';
import { sermonsRepository } from '@repositories/sermons.repository';

// POST /api/sermons/[id]/preach-dates
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const uid = await getRequiredAuthenticatedUid(request);
        if (!uid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const sermon = await sermonsRepository.fetchSermonById(id);
        if (!sermon) {
            return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
        }
        if (sermon.userId !== uid) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

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
        const { id } = await params;
        console.error(`Error adding preach date to sermon ${id}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorMessage === "Sermon not found") {
            return NextResponse.json({ error: errorMessage }, { status: 404 });
        }
        return NextResponse.json({ error: 'Failed to add preach date' }, { status: 500 });
    }
}

// GET /api/sermons/[id]/preach-dates
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const uid = await getRequiredAuthenticatedUid(request);
        if (!uid) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const sermon = await sermonsRepository.fetchSermonById(id);
        if (!sermon) {
            return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
        }
        if (sermon.userId !== uid) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        return NextResponse.json({ preachDates: sermon.preachDates || [] });
    } catch (error: unknown) {
        const { id } = await params;
        console.error(`Error fetching preach dates for sermon ${id}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorMessage === "Sermon not found") {
            return NextResponse.json({ error: errorMessage }, { status: 404 });
        }
        return NextResponse.json({ error: 'Failed to fetch preach dates' }, { status: 500 });
    }
}
