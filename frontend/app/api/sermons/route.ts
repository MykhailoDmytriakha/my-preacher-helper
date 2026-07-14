import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { adminDb } from '@/config/firebaseAdminConfig';
import { Sermon } from '@/models/models';

// POST /api/sermons
export async function POST(request: Request) {
  console.log("POST request received for creating a sermon");
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sermon = await request.json();
    console.log("Parsed sermon data:", sermon);

    const userId = uid;
    const title = sermon.title;
    const verse = sermon.verse;
    const date = sermon.date;
    if (sermon.userId && sermon.userId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!title || !verse || !date) {
      return NextResponse.json({ error: "User not authenticated or sermon data is missing" }, { status: 400 });
    }

    // Playlist model: series membership is written EXCLUSIVELY by the client
    // sweep into series.items — the create no longer writes the deprecated
    // seriesId/seriesPosition back-ref nor links the sermon into a series.
    const sermonData: Partial<Sermon> = { userId, title, verse, date, thoughts: sermon.thoughts || [] };

    // Idempotent create when the client supplies the id (offline buffer): a
    // replayed create reuses the same doc instead of duplicating. Ownership
    // mismatch (incl. a missing userId) is rejected so a client id can never
    // reach another user's sermon.
    const clientId = typeof sermon.id === 'string' && sermon.id ? sermon.id : undefined;
    let docRef;
    if (clientId) {
      const ref = adminDb.collection('sermons').doc(clientId);
      const existing = await ref.get();
      if (existing.exists) {
        const existingData = existing.data() as { userId?: string } | undefined;
        if (!existingData || existingData.userId !== userId) {
          return NextResponse.json({ error: 'Forbidden: sermon id belongs to another user' }, { status: 403 });
        }
        return NextResponse.json({ message: 'Sermon already exists', sermon: { ...existingData, id: clientId } });
      }
      await ref.set(sermonData);
      docRef = ref;
    } else {
      docRef = await adminDb.collection('sermons').add(sermonData);
    }
    console.log("Sermon written with ID:", docRef.id);

    const newSermon = { ...sermon, userId, id: docRef.id };
    console.log("New sermon object after attaching ID:", newSermon);

    console.log("Returning success response for created sermon");
    return NextResponse.json({ message: 'Sermon created successfully', sermon: newSermon });
  } catch (error) {
    console.error("Error occurred while creating sermon:", error);
    return NextResponse.json({ error: 'Failed to create sermon' }, { status: 500 });
  }
}
