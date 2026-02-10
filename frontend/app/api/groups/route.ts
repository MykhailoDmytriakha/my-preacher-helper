import { NextResponse } from 'next/server';

import { groupsRepository } from '@repositories/groups.repository';

// GET /api/groups?userId=<uid>
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
    }

    const groups = await groupsRepository.fetchGroupsByUserId(userId);
    return NextResponse.json(groups);
  } catch (error: unknown) {
    console.error('Error fetching groups:', error);
    return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 });
  }
}

// POST /api/groups
export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { userId, title } = payload;

    if (!userId || !title) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, title' },
        { status: 400 }
      );
    }

    const group = await groupsRepository.createGroup({
      userId,
      title: title.trim(),
      description: payload.description?.trim() || undefined,
      status: payload.status || 'draft',
      templates: payload.templates || [],
      flow: payload.flow || [],
      meetingDates: payload.meetingDates || [],
      seriesId: payload.seriesId || null,
      seriesPosition: payload.seriesPosition ?? null,
    });

    return NextResponse.json({ message: 'Group created successfully', group }, { status: 201 });
  } catch (error: unknown) {
    console.error('Error creating group:', error);
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
  }
}
