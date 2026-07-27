import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { adminDb } from '@/config/firebaseAdminConfig';

export async function PUT(request: Request) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get('sermonId');
    if (!sermonId) {
      return NextResponse.json({ error: 'sermonId is required' }, { status: 400 });
    }

    const sermonDocRef = adminDb.collection('sermons').doc(sermonId);
    const sermonDoc = await sermonDocRef.get();
    if (!sermonDoc.exists) {
      return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
    }
    if (sermonDoc.data()?.userId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const thoughtsBySection = body.thoughtsBySection ?? body.structure;
    if (thoughtsBySection === undefined) {
      return NextResponse.json({ error: 'thoughtsBySection is required in the request body' }, { status: 400 });
    }

    // Regrouping thoughts CHANGES content, so it must advance the thoughts
    // counter like every other writer of that aggregate. Writing straight past
    // it left the number stale, and a later save built on the old grouping was
    // then waved through by the guard.
    await sermonDocRef.update({
      thoughtsBySection,
      structure: thoughtsBySection,
      'rev.thoughts': FieldValue.increment(1),
    });
    console.log(`ThoughtsBySection updated for sermon ${sermonId}`);
    return NextResponse.json({ message: 'ThoughtsBySection updated successfully' });
  } catch (error) {
    console.error('Error updating thoughtsBySection:', error);
    return NextResponse.json({ error: 'Failed to update thoughtsBySection' }, { status: 500 });
  }
}
