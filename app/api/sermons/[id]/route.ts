import { NextResponse } from 'next/server';
import { db } from 'app/config/firebaseConfig';
import { doc, getDoc } from "firebase/firestore";

// GET /api/sermons/:id
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  console.log(`Fetching sermon with id: ${id}`);
  
  try {
    // Create a reference to the document in the "sermons" collection using the provided id.
    const docRef = doc(db, 'sermons', id);
    
    // Fetch the document snapshot
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      console.log(`Sermon with id ${id} not found in Firestore`);
      return NextResponse.json({ error: 'Sermon not found' }, { status: 404 });
    }
    
    // Combine the document id with its data.
    const sermon = { id: docSnap.id, ...docSnap.data() };
    console.log('Sermon retrieved:', sermon);
    
    return NextResponse.json(sermon);
  } catch (error) {
    console.error(`Error fetching sermon with id ${id}:`, error);
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
