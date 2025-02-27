import { NextResponse } from 'next/server';
import { adminDb } from 'app/config/firebaseAdminConfig';

export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get('sermonId');
    if (!sermonId) {
      return NextResponse.json({ error: 'sermonId is required' }, { status: 400 });
    }

    const { structure } = await request.json();
    if (structure === undefined) {
      return NextResponse.json({ error: 'structure is required in the request body' }, { status: 400 });
    }

    const sermonDocRef = adminDb.collection('sermons').doc(sermonId);
    // const sermon = (await sermonDocRef.get()).data();
    // console.log("previous structure", sermon?.structure);
    // console.log("new structure", structure);
    await sermonDocRef.update({ structure });
    console.log(`Structure updated for sermon ${sermonId}`);
    return NextResponse.json({ message: 'Structure updated successfully' });
  } catch (error) {
    console.error('Error updating structure:', error);
    return NextResponse.json({ error: 'Failed to update structure' }, { status: 500 });
  }
} 