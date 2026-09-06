import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { seriesRepository } from '@repositories/series.repository';
import { sermonsRepository } from '@repositories/sermons.repository';

/** Read recovery bypasses the browser transport, never the owner's access boundary. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    const { adminDb } = await import('@/config/firebaseAdminConfig');
    const { id } = await params;
    const snapshot = await adminDb.collection('sermons').doc(id).get();
    if (!snapshot.exists) return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
    const sermon = snapshot.data()!;
    if (sermon.userId !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
    return NextResponse.json({ ...sermon, id: snapshot.id }, { headers });
  } catch {
    return NextResponse.json({ error: 'Sermon read unavailable' }, { status: 503, headers });
  }
}

// DELETE /api/sermons/:id - Delete a sermon
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const sermon = await sermonsRepository.fetchSermonById(id);
    if (!sermon) {
      return NextResponse.json({ message: 'Проповедь уже отсутствует' }, { status: 200 });
    }
    if (sermon.userId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Atomically delete the sermon AND detach it from every series it belongs to — one
    // write batch, all-or-nothing. If anything fails, nothing is committed and we return an
    // error (below), instead of the old flow that deleted the sermon, swallowed a failed
    // series cleanup, and returned 200 with dangling references.
    await seriesRepository.deleteSermonAndDetachFromAllSeries(id, uid);

    return NextResponse.json({ message: 'Проповедь успешно удалена' }, { status: 200 });
  } catch (error: unknown) {
    const { id } = await params;
    console.error(`Ошибка при удалении проповеди ${id}:`, error);
    return NextResponse.json(
      { message: 'Не удалось удалить проповедь', error: (error as Error).message },
      { status: 500 }
    );
  }
}
