import { NextResponse } from 'next/server';
import { studiesRepository } from '@repositories/studies.repository';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
  }

  try {
    const materials = await studiesRepository.listMaterials(userId);
    return NextResponse.json(materials.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
  } catch (error) {
    console.error('GET /api/studies/materials error', error);
    return NextResponse.json({ error: 'Failed to fetch study materials' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { userId, title, type, noteIds } = payload;
    if (!userId || !title || !type) {
      return NextResponse.json({ error: 'userId, title and type are required' }, { status: 400 });
    }

    const material = await studiesRepository.createMaterial({
      userId,
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
