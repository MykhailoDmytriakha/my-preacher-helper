import { NextResponse } from 'next/server';

import { adminDb } from '@/config/firebaseAdminConfig';

export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get('sermonId');
    if (!sermonId) {
      return NextResponse.json({ error: 'sermonId is required' }, { status: 400 });
    }

    const body = await request.json();
    const thoughtsBySection = body.thoughtsBySection ?? body.structure;

    if (thoughtsBySection === undefined) {
      return NextResponse.json({ error: 'thoughtsBySection is required in the request body' }, { status: 400 });
    }

    const sermonDocRef = adminDb.collection('sermons').doc(sermonId);
    await sermonDocRef.update({ thoughtsBySection, structure: thoughtsBySection });
    console.log(`ThoughtsBySection updated for sermon ${sermonId}`);
    return NextResponse.json({ message: 'ThoughtsBySection updated successfully' });
  } catch (error) {
    console.error('Error updating thoughtsBySection:', error);
    return NextResponse.json({ error: 'Failed to update thoughtsBySection' }, { status: 500 });
  }
}
