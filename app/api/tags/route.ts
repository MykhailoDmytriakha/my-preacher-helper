import { NextResponse } from 'next/server';
import { getRequiredTags, saveTag, getCustomTags, deleteTag } from '@clients/firestore.client'
import { log } from '@utils/logger';
import { Tag } from '@/models/models';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const requiredTags = await getRequiredTags();
  log.info('Required tags:', requiredTags.map(tag => tag.name));
  let customTags: Tag[] = [];
  if (userId) {
    customTags = await getCustomTags(userId) as Tag[];
    log.info('Custom tags:', customTags.map(tag => tag.name));
  }
  const tags = {
    requiredTags: requiredTags,
    customTags: customTags || [],
  };
  return NextResponse.json(tags);
} 

export async function POST(request: Request) {
  const tag = await request.json();
  console.log('Received tag:', tag);
  tag.required = false;
  await saveTag(tag);
  return NextResponse.json({ message: 'Tag received' });
}

export async function PUT(request: Request) {
  const tag = await request.json();
  if (tag.command === 'generate') {
    const requiredTags = await getRequiredTags();
    console.log('Received tag:', requiredTags);
    return NextResponse.json({ message: 'Tag received' });
  } else {
    return NextResponse.json({ message: 'Invalid command' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const tagName = searchParams.get('tagName');
  if (!userId || !tagName) {
    return NextResponse.json({ message: 'Missing userId or tagName' }, { status: 400 });
  }
  await deleteTag(userId, tagName);
  return NextResponse.json({ message: 'Tag removed' });
}
