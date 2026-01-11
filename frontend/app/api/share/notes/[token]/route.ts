import { NextRequest, NextResponse } from 'next/server';

import { studiesRepository } from '@repositories/studies.repository';
import { studyNoteShareLinksRepository } from '@repositories/studyNoteShareLinks.repository';

const VIEW_COOKIE_PREFIX = 'share_note_viewed_';
const VIEW_TTL_MS = 24 * 60 * 60 * 1000;

function shouldCountView(viewedAtRaw: string | undefined): boolean {
  if (!viewedAtRaw) return true;
  const viewedAt = Number(viewedAtRaw);
  if (Number.isNaN(viewedAt)) return true;
  return Date.now() - viewedAt >= VIEW_TTL_MS;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    const shareLink = await studyNoteShareLinksRepository.findByToken(token);
    if (!shareLink) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const note = await studiesRepository.getNote(shareLink.noteId);
    if (!note) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const cookieName = `${VIEW_COOKIE_PREFIX}${token}`;
    const viewedAtRaw = request.cookies.get(cookieName)?.value;
    const shouldIncrement = shouldCountView(viewedAtRaw);

    if (shouldIncrement) {
      await studyNoteShareLinksRepository.incrementViewCount(shareLink.id);
    }

    const response = NextResponse.json(
      { content: note.content },
      { headers: { 'Cache-Control': 'no-store' } }
    );

    if (shouldIncrement) {
      response.cookies.set({
        name: cookieName,
        value: String(Date.now()),
        maxAge: Math.floor(VIEW_TTL_MS / 1000),
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });
    }

    return response;
  } catch (error) {
    console.error(`GET /api/share/notes/${token} error`, error);
    return NextResponse.json({ error: 'Failed to load shared note' }, { status: 500 });
  }
}
