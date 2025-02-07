import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const tags = {
    requiredTags: [
      { id: 'intro', name: 'Вступление', color: '#4F46E5' },
      { id: 'main', name: 'Основная часть', color: '#059669' },
      { id: 'conclusion', name: 'Заключение', color: '#DC2626' },
    ],
    customTags: [
      { id: 'custom1', name: 'Кастомный тег 1', color: '#FF0000' },
      { id: 'custom2', name: 'Кастомный тег 2', color: '#00FF00' },
    ],
  };
  return NextResponse.json(tags);
} 

export async function POST(request: Request) {
  const tag = await request.json();
  console.log('Received tag:', tag);
  return NextResponse.json({ message: 'Tag received' });
}

export async function PUT(request: Request) {
  const tag = await request.json();
  if (tag.command === 'generate') {
    console.log('Received tag:', tag);
    return NextResponse.json({ message: 'Tag received' });
  } else {
    return NextResponse.json({ message: 'Invalid command' }, { status: 400 });
  }
}
