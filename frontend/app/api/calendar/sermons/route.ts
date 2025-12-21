import { NextResponse } from 'next/server';

import { sermonsRepository } from '@repositories/sermons.repository';

// GET /api/calendar/sermons?userId=<uid>&startDate=<ISO>&endDate=<ISO>
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');
        const startDate = searchParams.get('startDate') || undefined;
        const endDate = searchParams.get('endDate') || undefined;

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
        }

        const sermons = await sermonsRepository.fetchSermonsWithPreachDates(userId, startDate, endDate);
        return NextResponse.json({ sermons });
    } catch (error: any) {
        console.error(`Error fetching sermons for calendar:`, error);
        return NextResponse.json({ error: 'Failed to fetch sermons for calendar' }, { status: 500 });
    }
}
