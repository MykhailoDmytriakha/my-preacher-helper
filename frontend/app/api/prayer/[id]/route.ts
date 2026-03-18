import { NextResponse } from 'next/server';

import { prayerRequestsRepository } from '@repositories/prayerRequests.repository';

type Params = { params: Promise<{ id: string }> };

// GET /api/prayer/:id
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const prayer = await prayerRequestsRepository.fetchById(id);
    if (!prayer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(prayer);
  } catch (error) {
    console.error(`Error fetching prayer ${id}:`, error);
    return NextResponse.json({ error: 'Failed to fetch prayer request' }, { status: 500 });
  }
}

// PUT /api/prayer/:id
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const payload = await request.json();
    const updated = await prayerRequestsRepository.update(id, {
      title: payload.title?.trim(),
      description: payload.description?.trim() || undefined,
      categoryId: payload.categoryId || undefined,
      tags: payload.tags,
      status: payload.status,
      answeredAt: payload.answeredAt,
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error(`Error updating prayer ${id}:`, error);
    return NextResponse.json({ error: 'Failed to update prayer request' }, { status: 500 });
  }
}

// DELETE /api/prayer/:id
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    await prayerRequestsRepository.delete(id);
    return NextResponse.json({ message: 'Deleted' });
  } catch (error) {
    console.error(`Error deleting prayer ${id}:`, error);
    return NextResponse.json({ error: 'Failed to delete prayer request' }, { status: 500 });
  }
}
