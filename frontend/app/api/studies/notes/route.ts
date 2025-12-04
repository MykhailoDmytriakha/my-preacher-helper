import { NextResponse } from 'next/server';
import { studiesRepository } from '@repositories/studies.repository';
import { StudyNote } from '@/models/models';

function filterNotes(notes: StudyNote[], params: URLSearchParams) {
  let result = [...notes];
  const search = (params.get('q') || '').toLowerCase().trim();
  const tag = params.get('tag');
  const book = params.get('book');
  const chapter = params.get('chapter');
  const draftsOnly = params.get('draftOnly') === 'true';

  if (draftsOnly) {
    result = result.filter((note) => note.isDraft);
  }

  if (tag) {
    result = result.filter((note) => note.tags?.includes(tag));
  }

  if (book) {
    result = result.filter((note) =>
      note.scriptureRefs?.some((ref) => ref.book.toLowerCase() === book.toLowerCase())
    );
  }

  if (chapter) {
    const chapterNum = Number(chapter);
    if (!Number.isNaN(chapterNum)) {
      result = result.filter((note) =>
        note.scriptureRefs?.some((ref) => Number(ref.chapter) === chapterNum)
      );
    }
  }

  if (search) {
    result = result.filter((note) => {
      const text = `${note.title || ''} ${note.content} ${note.tags.join(' ')} ${note.scriptureRefs
        ?.map((ref) => `${ref.book} ${ref.chapter}:${ref.fromVerse}${ref.toVerse ? '-' + ref.toVerse : ''}`)
        .join(' ')}`.toLowerCase();
      return text.includes(search);
    });
  }

  return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
  }

  try {
    const notes = await studiesRepository.listNotes(userId);
    const filtered = filterNotes(notes, searchParams);
    return NextResponse.json(filtered);
  } catch (error) {
    console.error('GET /api/studies/notes error', error);
    return NextResponse.json({ error: 'Failed to fetch study notes' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { userId, content } = payload;
    if (!userId || !content) {
      return NextResponse.json({ error: 'userId and content are required' }, { status: 400 });
    }

    const note = await studiesRepository.createNote({
      userId,
      content,
      title: payload.title || '',
      scriptureRefs: payload.scriptureRefs || [],
      tags: payload.tags || [],
      materialIds: payload.materialIds || [],
      relatedSermonIds: payload.relatedSermonIds || [],
    });

    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    console.error('POST /api/studies/notes error', error);
    return NextResponse.json({ error: 'Failed to create study note' }, { status: 500 });
  }
}
