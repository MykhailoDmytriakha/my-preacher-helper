import { NextResponse } from 'next/server';
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

        const preachDate = await sermonsRepository.addPreachDate(id, data);
        return NextResponse.json({ preachDate });
    } catch (error: any) {
        console.error(`Error adding preach date to sermon ${id}:`, error);
        if (error.message === "Sermon not found") {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        return NextResponse.json({ error: 'Failed to add preach date' }, { status: 500 });
    }
}

// GET /api/sermons/[id]/preach-dates
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const sermon = await sermonsRepository.fetchSermonById(id);
        return NextResponse.json({ preachDates: sermon.preachDates || [] });
    } catch (error: any) {
        console.error(`Error fetching preach dates for sermon ${id}:`, error);
        if (error.message === "Sermon not found") {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        return NextResponse.json({ error: 'Failed to fetch preach dates' }, { status: 500 });
    }
}
