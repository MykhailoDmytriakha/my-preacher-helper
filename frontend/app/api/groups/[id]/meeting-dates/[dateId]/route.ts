import { NextRequest, NextResponse } from 'next/server';

import { groupsRepository } from '@repositories/groups.repository';

// PUT /api/groups/:id/meeting-dates/:dateId
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dateId: string }> }
) {
  const { id: groupId, dateId } = await params;

  try {
    const payload = await request.json();
    const meetingDate = await groupsRepository.updateMeetingDate(groupId, dateId, {
      date: payload.date,
      location: payload.location,
      audience: payload.audience,
      notes: payload.notes,
      outcome: payload.outcome,
    });

    return NextResponse.json({ meetingDate });
  } catch (error: unknown) {
    console.error(`Error updating meeting date ${dateId} for group ${groupId}:`, error);
    return NextResponse.json({ error: 'Failed to update meeting date' }, { status: 500 });
  }
}

// DELETE /api/groups/:id/meeting-dates/:dateId
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; dateId: string }> }
) {
  const { id: groupId, dateId } = await params;

  try {
    await groupsRepository.deleteMeetingDate(groupId, dateId);
    return NextResponse.json({ message: 'Meeting date deleted successfully' });
  } catch (error: unknown) {
    console.error(`Error deleting meeting date ${dateId} for group ${groupId}:`, error);
    return NextResponse.json({ error: 'Failed to delete meeting date' }, { status: 500 });
  }
}
