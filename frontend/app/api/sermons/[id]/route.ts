import { NextResponse } from 'next/server';
import { fetchSermonById, deleteSermonById } from '@clients/firestore.client';
import { adminDb } from 'app/config/firebaseAdminConfig';

// GET /api/sermons/:id
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  try {
    const sermon = await fetchSermonById(id);
    return NextResponse.json(sermon);
  } catch (error: any) {
    if (error.message === "Sermon not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to fetch sermon' }, { status: 500 });
  }
}

// PUT /api/sermons/:id – обновление проповеди
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  try {
    const { title, verse } = await request.json();
    if (!title || !verse) {
      return NextResponse.json(
        { error: 'Title and verse are required' },
        { status: 400 }
      );
    }
    
    // Use Admin SDK to update the sermon
    const sermonDocRef = adminDb.collection("sermons").doc(id);
    await sermonDocRef.update({ title, verse });
    
    const updatedSermon = await fetchSermonById(id);
    return NextResponse.json(updatedSermon);
  } catch (error: any) {
    console.error("Ошибка при обновлении проповеди:", error);
    return NextResponse.json(
      { error: 'Не удалось обновить проповедь', details: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/sermons/:id - Delete a sermon
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  try {
    const sermon = await fetchSermonById(id);
    if (!sermon) {
      return NextResponse.json({ message: 'Проповедь уже отсутствует' }, { status: 200 });
    }
    await deleteSermonById(id);
    return NextResponse.json({ message: 'Проповедь успешно удалена' }, { status: 200 });
  } catch (error: any) {
    console.error(`Ошибка при удалении проповеди ${id}:`, error);
    return NextResponse.json(
      { message: 'Не удалось удалить проповедь', error: error.message },
      { status: 500 }
    );
  }
}
