import { NextResponse } from 'next/server';
import { fetchSermonById } from '@clients/firestore.client'

// GET /api/sermons/:id
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  console.log(`Fetching sermon with id: ${id}`);
  
  try {
    const sermon = await fetchSermonById(id);
    return NextResponse.json(sermon);
  } catch (error: any) {
    console.error(`Error fetching sermon with id ${id}:`, error);

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
  // TODO: Delete the sermon by params.id
  const { id } = params;
  console.log('Deleting sermon with id:', id);
  return NextResponse.json({ message: 'Sermon deleted', id });
}
