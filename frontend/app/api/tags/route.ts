import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { deleteTag } from '@clients/firestore.client';

export async function DELETE(request: Request) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  // userId is a redundant echo of the authenticated caller; only tagName is truly required,
  // and only an explicit userId mismatch is rejected (never 401/400 an authed caller for
  // omitting the redundant echo).
  const userId = searchParams.get('userId');
  const tagName = searchParams.get('tagName');
  if (!tagName) {
    return NextResponse.json({ message: 'Missing tagName' }, { status: 400 });
  }
  if (userId && userId !== uid) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }
  try {
    const result = await deleteTag(uid, tagName);
    return NextResponse.json({ message: 'Tag removed', ...result }, { status: 200 });
  } catch (error) {
    console.error('DELETE: Error removing tag', error);
    return NextResponse.json({ message: 'Error removing tag' }, { status: 500 });
  }
}
