import { NextResponse } from 'next/server';

import { prayerRequestsRepository } from '@repositories/prayerRequests.repository';

// POST /api/prayer
export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { userId, title } = payload;
    if (!userId || !title?.trim()) {
      return NextResponse.json({ error: 'Missing required fields: userId, title' }, { status: 400 });
    }

    const created = await prayerRequestsRepository.create(
      {
        userId,
        title: title.trim(),
        description: payload.description?.trim() || undefined,
        categoryId: payload.categoryId || undefined,
        tags: payload.tags || [],
        status: 'active',
        updates: [],
      },
      typeof payload.id === 'string' ? payload.id : undefined
    );

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Error creating prayer request:', error);
    return NextResponse.json({ error: 'Failed to create prayer request' }, { status: 500 });
  }
}
