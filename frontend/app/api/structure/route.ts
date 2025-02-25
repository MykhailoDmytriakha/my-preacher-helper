import { NextResponse } from 'next/server';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from 'app/config/firebaseConfig';
import { log } from '@utils/logger';

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

    const sermonDocRef = doc(db, 'sermons', sermonId);
    // const sermon = (await getDoc(sermonDocRef)).data();
    // console.log("previous structure", sermon?.structure);
    // console.log("new structure", structure);
    await updateDoc(sermonDocRef, { structure });
    log.info(`Structure updated for sermon ${sermonId}`);
    return NextResponse.json({ message: 'Structure updated successfully' });
  } catch (error) {
    log.error('Error updating structure:', error);
    return NextResponse.json({ error: 'Failed to update structure' }, { status: 500 });
  }
} 