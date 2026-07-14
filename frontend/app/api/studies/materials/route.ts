import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { studiesRepository } from '@repositories/studies.repository';

export async function GET(request: Request) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) {
    return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  // userId is a redundant echo of the authenticated caller; only reject an explicit
  // mismatch — never 401 an authenticated caller for omitting it.
  const userId = searchParams.get('userId');
  if (userId && userId !== uid) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const materials = await studiesRepository.listMaterials(uid);
    return NextResponse.json(materials.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
  } catch (error) {
    console.error('GET /api/studies/materials error', error);
    return NextResponse.json({ error: 'Failed to fetch study materials' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
    }

    const payload = await request.json();
    const { userId, title, type, noteIds } = payload;
    if (!title || !type) {
      return NextResponse.json({ error: 'title and type are required' }, { status: 400 });
    }
    if (userId && userId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const material = await studiesRepository.createMaterial({
      userId: uid,
      title,
      type,
      description: payload.description || '',
      noteIds: noteIds || [],
      sections: payload.sections || [],
    });

    return NextResponse.json(material, { status: 201 });
  } catch (error) {
    console.error('POST /api/studies/materials error', error);
    return NextResponse.json({ error: 'Failed to create study material' }, { status: 500 });
  }
}
