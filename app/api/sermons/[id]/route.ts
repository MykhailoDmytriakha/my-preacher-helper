import { NextResponse } from 'next/server';
import { fetchSermonById, deleteSermonById } from '@clients/firestore.client'

// GET /api/sermons/:id
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  console.log(`G: ${id} req`);
  
  try {
    const sermon = await fetchSermonById(id);
    console.log(`G: ${id} ok`);
    return NextResponse.json(sermon);
  } catch (error: any) {
    console.error(`G: ${id} err: ${error.message}`);

    if (error.message === "Sermon not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    
    return NextResponse.json({ error: 'Failed to fetch sermon' }, { status: 500 });
  }
}

// PUT /api/sermons/:id - Update sermon details
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  // TODO: Update sermon details (title, verse, structure, etc.)
  const { id } = params;
  const updatedData = await request.json();
  console.log('Updating sermon with id:', id, updatedData);
  return NextResponse.json({ message: 'Sermon updated', id, updatedData });
}

// DELETE /api/sermons/:id - Delete a sermon
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  console.log(`D: ${params.id} req`);
  try {
    // Check if the sermon exists
    const sermon = await fetchSermonById(params.id);
    if (!sermon) {
      console.log(`D: ${params.id} absent`);
      return NextResponse.json({ message: 'Проповедь уже отсутствует' }, { status: 200 });
    }

    // Delete the sermon using Firestore client deletion
    await deleteSermonById(params.id);
    console.log(`D: ${params.id} ok`);

    return NextResponse.json({ message: 'Проповедь успешно удалена' }, { status: 200 });
  } catch (error: any) {
    console.error(`D: ${params.id} err: ${error.message}`);
    return NextResponse.json({ message: 'Не удалось удалить проповедь', error: error.message }, { status: 500 });
  }
}
