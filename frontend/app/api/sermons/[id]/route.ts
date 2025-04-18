import { NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';
import { adminDb } from 'app/config/firebaseAdminConfig';

// GET /api/sermons/:id
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  try {
    const sermon = await sermonsRepository.fetchSermonById(id);
    return NextResponse.json(sermon);
  } catch (error: any) {
    if (error.message === "Sermon not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to fetch sermon' }, { status: 500 });
  }
}

// PUT /api/sermons/:id – update sermon (title, verse, isPreached)
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  try {
    // Get title, verse, and isPreached from the request body
    const { title, verse, isPreached } = await request.json(); 
    
    // Prepare the update object
    const updateData: { title?: string; verse?: string; isPreached?: boolean } = {};
    if (title) updateData.title = title;
    if (verse) updateData.verse = verse;
    // Only include isPreached if it's explicitly provided (true or false)
    if (typeof isPreached === 'boolean') {
      updateData.isPreached = isPreached;
    }

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No fields provided for update' },
        { status: 400 }
      );
    }
    
    // Use Admin SDK to update the sermon
    const sermonDocRef = adminDb.collection("sermons").doc(id);
    await sermonDocRef.update(updateData); // Update with the constructed object
    
    // Fetch the updated sermon to return it
    const updatedSermon = await sermonsRepository.fetchSermonById(id);
    return NextResponse.json(updatedSermon);
  } catch (error: any) {
    console.error("Error updating sermon:", error);
    return NextResponse.json(
      { error: 'Failed to update sermon', details: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/sermons/:id - Delete a sermon
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  try {
    const sermon = await sermonsRepository.fetchSermonById(id);
    if (!sermon) {
      return NextResponse.json({ message: 'Проповедь уже отсутствует' }, { status: 200 });
    }
    await sermonsRepository.deleteSermonById(id);
    return NextResponse.json({ message: 'Проповедь успешно удалена' }, { status: 200 });
  } catch (error: any) {
    console.error(`Ошибка при удалении проповеди ${id}:`, error);
    return NextResponse.json(
      { message: 'Не удалось удалить проповедь', error: error.message },
      { status: 500 }
    );
  }
}
