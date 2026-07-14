import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { studiesRepository } from '@repositories/studies.repository';

// Error messages
const ERROR_MESSAGES = {
  USER_NOT_AUTHENTICATED: 'User not authenticated',
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });
  const { id } = await params;
  try {
    const material = await studiesRepository.getMaterial(id);
    if (!material) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (material.userId !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(material);
  } catch (error) {
    console.error(`GET /api/studies/materials/${id} error`, error);
    return NextResponse.json({ error: 'Failed to fetch material' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });
  const { id } = await params;
  try {
    const existing = await studiesRepository.getMaterial(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.userId !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const updates = await request.json();
    if (updates.userId && updates.userId !== uid) {
      return NextResponse.json({ error: 'Cannot change userId' }, { status: 400 });
    }
    const updated = await studiesRepository.updateMaterial(id, { ...updates, userId: uid });
    return NextResponse.json(updated);
  } catch (error) {
    console.error(`PUT /api/studies/materials/${id} error`, error);
    return NextResponse.json({ error: 'Failed to update material' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: ERROR_MESSAGES.USER_NOT_AUTHENTICATED }, { status: 401 });
  const { id } = await params;
  try {
    const existing = await studiesRepository.getMaterial(id);
    if (!existing) return NextResponse.json({ success: true });
    if (existing.userId !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    await studiesRepository.deleteMaterial(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/studies/materials/${id} error`, error);
    return NextResponse.json({ error: 'Failed to delete material' }, { status: 500 });
  }
}
