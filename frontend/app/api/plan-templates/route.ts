import { NextResponse } from 'next/server';

import { planTemplatesRepository } from '@/api/repositories/planTemplates.repository';

// GET /api/plan-templates?userId=123
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ message: 'Missing userId' }, { status: 400 });
  }
  try {
    const templates = await planTemplatesRepository.fetchByUserId(userId);
    return NextResponse.json(templates);
  } catch (error) {
    console.error('GET /api/plan-templates: error', error);
    return NextResponse.json({ message: 'Error fetching plan templates' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, userId, name, structure } = body ?? {};
    if (!userId || !name) {
      return NextResponse.json({ message: 'Missing userId or name' }, { status: 400 });
    }
    const created = await planTemplatesRepository.create({ userId, name, structure }, id);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('POST /api/plan-templates: error', error);
    return NextResponse.json({ message: 'Error creating plan template' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, name, structure } = body ?? {};
    if (!id) {
      return NextResponse.json({ message: 'Missing id' }, { status: 400 });
    }
    const updated = await planTemplatesRepository.update(id, { name, structure });
    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    console.error('PUT /api/plan-templates: error', error);
    return NextResponse.json({ message: 'Error updating plan template' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ message: 'Missing id' }, { status: 400 });
  }
  try {
    await planTemplatesRepository.delete(id);
    return NextResponse.json({ message: 'Plan template removed' }, { status: 200 });
  } catch (error) {
    console.error('DELETE /api/plan-templates: error', error);
    return NextResponse.json({ message: 'Error removing plan template' }, { status: 500 });
  }
}
