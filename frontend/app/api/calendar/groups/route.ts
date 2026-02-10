import { NextResponse } from 'next/server';

import { groupsRepository } from '@repositories/groups.repository';

// GET /api/calendar/groups?userId=<uid>&startDate=<ISO>&endDate=<ISO>
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
    }

    const groups = await groupsRepository.fetchGroupsWithMeetingDates(userId, startDate, endDate);
    return NextResponse.json({ groups });
  } catch (error: unknown) {
    console.error('Error fetching groups for calendar:', error);
    return NextResponse.json({ error: 'Failed to fetch groups for calendar' }, { status: 500 });
  }
}
