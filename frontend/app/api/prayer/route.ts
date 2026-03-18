import { NextResponse } from 'next/server';

import { prayerRequestsRepository } from '@repositories/prayerRequests.repository';

// GET /api/prayer?userId=<uid>
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

  try {
    const requests = await prayerRequestsRepository.fetchByUserId(userId);
    return NextResponse.json(requests);
  } catch (error) {
    console.error('Error fetching prayer requests:', error);
    return NextResponse.json({ error: 'Failed to fetch prayer requests' }, { status: 500 });
  }
}

// POST /api/prayer
export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { userId, title } = payload;
    if (!userId || !title?.trim()) {
      return NextResponse.json({ error: 'Missing required fields: userId, title' }, { status: 400 });
    }

    const created = await prayerRequestsRepository.create({
      userId,
      title: title.trim(),
      description: payload.description?.trim() || undefined,
      categoryId: payload.categoryId || undefined,
      tags: payload.tags || [],
      status: 'active',
      updates: [],
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Error creating prayer request:', error);
    return NextResponse.json({ error: 'Failed to create prayer request' }, { status: 500 });
  }
}
