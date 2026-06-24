import { NextResponse } from 'next/server';

import { deleteTag } from '@clients/firestore.client';

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const tagName = searchParams.get('tagName');
  if (!userId || !tagName) {
    return NextResponse.json({ message: 'Missing userId or tagName' }, { status: 400 });
  }
  try {
    const result = await deleteTag(userId, tagName);
    return NextResponse.json({ message: 'Tag removed', ...result }, { status: 200 });
  } catch (error) {
    console.error('DELETE: Error removing tag', error);
    return NextResponse.json({ message: 'Error removing tag' }, { status: 500 });
  }
}
