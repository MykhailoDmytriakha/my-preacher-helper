import { NextResponse } from 'next/server';

import { PrayerStatus } from '@/models/models';
import { prayerRequestsRepository } from '@repositories/prayerRequests.repository';

type Params = { params: Promise<{ id: string }> };

// PUT /api/prayer/:id/status
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { status, answerText } = body;
    const validStatuses: PrayerStatus[] = ['active', 'answered', 'not_answered'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    const updated = await prayerRequestsRepository.setStatus(id, status, answerText);
    return NextResponse.json(updated);
  } catch (error) {
    console.error(`Error updating status for prayer ${id}:`, error);
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });
  }
}
