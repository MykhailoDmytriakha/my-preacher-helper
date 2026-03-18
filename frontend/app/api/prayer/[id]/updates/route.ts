import { NextResponse } from 'next/server';

import { prayerRequestsRepository } from '@repositories/prayerRequests.repository';

type Params = { params: Promise<{ id: string }> };

// POST /api/prayer/:id/updates
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const { text } = await request.json();
    if (!text?.trim()) return NextResponse.json({ error: 'Missing text' }, { status: 400 });
    const updated = await prayerRequestsRepository.addUpdate(id, text.trim());
    return NextResponse.json(updated, { status: 201 });
  } catch (error) {
    console.error(`Error adding update to prayer ${id}:`, error);
    return NextResponse.json({ error: 'Failed to add update' }, { status: 500 });
  }
}
