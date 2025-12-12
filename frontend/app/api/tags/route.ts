import { NextResponse } from 'next/server';

import { Tag } from '@/models/models';
import { getRequiredTags, saveTag, getCustomTags, deleteTag, updateTagInDb } from '@clients/firestore.client'

// GET api/tags?userId=123
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const requiredTags = await getRequiredTags();
  let customTags: Tag[] = [];
  if (userId) {
    customTags = await getCustomTags(userId) as Tag[];
  }
  const tags = {
    requiredTags: requiredTags,
    customTags: customTags || [],
  };
  return NextResponse.json(tags);
} 

export async function POST(request: Request) {
  try {
    const tag = await request.json();
    console.log('Received tag:', tag);
    tag.required = false;
    await saveTag(tag);
    return NextResponse.json({ message: 'Tag created' }, { status: 201 });
  } catch (error: unknown) {
    if ((error as Error)?.message === 'RESERVED_NAME') {
      return NextResponse.json({ message: 'Reserved tag name' }, { status: 400 });
    }
    console.error('POST: Error creating tag', error);
    return NextResponse.json({ message: 'Error creating tag' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const tag = await request.json();
    // Update tag using Firestore client update function
    console.log('Received tag for update:', tag);
    if (tag.required) {
      return NextResponse.json({ message: 'Required tags cannot be updated' }, { status: 400 });
    }
    const updatedTag = await updateTagInDb(tag);
    return NextResponse.json({ message: 'Tag updated', tag: updatedTag }, { status: 200 });
  } catch (error: unknown) {
    console.error('PUT: Error updating tag', error);
    return NextResponse.json({ message: 'Error updating tag', error: (error as Error).message }, { status: 500 });
  }
}

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
