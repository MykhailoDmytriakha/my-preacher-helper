import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { legacyBoundaryResponse } from '@/data-engine/legacyBoundary.server';
import { prayerRequestsRepository } from '@repositories/prayerRequests.repository';

// POST /api/prayer
export async function POST(request: Request) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await request.json();
    const { userId, title } = payload;
    if (userId && userId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!title?.trim()) {
      return NextResponse.json({ error: 'Missing required field: title' }, { status: 400 });
    }

    const created = await prayerRequestsRepository.create(
      {
        userId: uid,
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
    const refusal = legacyBoundaryResponse(error);
    if (refusal) return refusal;
    if (error && typeof error === 'object' && 'status' in error && (error.status === 400 || error.status === 403)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Request refused' }, { status: error.status });
    }
    console.error('Error creating prayer request:', error);
    if (error instanceof Error && error.message.startsWith('Forbidden:')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to create prayer request' }, { status: 500 });
  }
}
