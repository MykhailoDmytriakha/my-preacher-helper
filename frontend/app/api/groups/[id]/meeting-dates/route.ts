import { NextRequest, NextResponse } from 'next/server';

import { groupsRepository } from '@repositories/groups.repository';

// GET /api/groups/:id/meeting-dates
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: groupId } = await params;

  try {
    const group = await groupsRepository.fetchGroupById(groupId);
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    return NextResponse.json({ meetingDates: group.meetingDates || [] });
  } catch (error: unknown) {
    console.error(`Error fetching meeting dates for group ${groupId}:`, error);
    return NextResponse.json({ error: 'Failed to fetch meeting dates' }, { status: 500 });
  }
}

// POST /api/groups/:id/meeting-dates
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: groupId } = await params;

  try {
    const payload = await request.json();
    if (!payload.date) {
      return NextResponse.json({ error: 'date is required' }, { status: 400 });
    }

    const meetingDate = await groupsRepository.addMeetingDate(groupId, {
      date: payload.date,
      location: payload.location,
      audience: payload.audience,
      notes: payload.notes,
      outcome: payload.outcome,
    });

    return NextResponse.json({ meetingDate }, { status: 201 });
  } catch (error: unknown) {
    console.error(`Error adding meeting date for group ${groupId}:`, error);
    return NextResponse.json({ error: 'Failed to add meeting date' }, { status: 500 });
  }
}
