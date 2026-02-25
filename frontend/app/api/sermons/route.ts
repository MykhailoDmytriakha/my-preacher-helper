import { NextResponse } from 'next/server';

import { seriesRepository } from '@/api/repositories/series.repository';
import { adminDb } from '@/config/firebaseAdminConfig';
import { Sermon } from '@/models/models';

// GET /api/sermons?userId=<uid>
export async function GET(request: Request) {
  console.log("GET: Request received for retrieving sermons");
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "User not authenticated" }, { status: 401 });
    }

    console.log(`GET: Fetching sermons for userId: ${userId} from Firestore...`);
    const sermonsRef = adminDb.collection('sermons');
    const q = sermonsRef.where("userId", "==", userId);
    const snapshot = await q.get();
    console.log(`GET: Retrieved ${snapshot.docs.length} sermon(s) from Firestore for userId: ${userId}`);

    const sermons: Sermon[] = snapshot.docs.map(doc => {
      console.log(`GET: Processing Firestore document with id: ${doc.id}`);
      return {
        id: doc.id,
        ...doc.data()
      } as Sermon;
    });

    console.log(`GET: Total sermons retrieved: ${sermons.length}`);
    return NextResponse.json(sermons);
  } catch (error) {
    console.error('GET: Error fetching sermons:', error);
    return NextResponse.json({ error: 'Failed to fetch sermons' }, { status: 500 });
  }
}

// POST /api/sermons
export async function POST(request: Request) {
  console.log("POST request received for creating a sermon");
  try {
    const sermon = await request.json();
    console.log("Parsed sermon data:", sermon);

    const userId = sermon.userId;
    const title = sermon.title;
    const verse = sermon.verse;
    const date = sermon.date;
    const seriesId = sermon.seriesId;
    const seriesPosition = sermon.seriesPosition;
    if (!userId || !title || !verse || !date) {
      return NextResponse.json({ error: "User not authenticated or sermon data is missing" }, { status: 400 });
    }

    const sermonData: Partial<Sermon> = { userId, title, verse, date, thoughts: sermon.thoughts || [] };
    if (seriesId) {
      sermonData.seriesId = seriesId;
    }
    if (seriesPosition) {
      sermonData.seriesPosition = seriesPosition;
    }
    const docRef = await adminDb.collection('sermons').add(sermonData);
    console.log("Sermon written with ID:", docRef.id);

    // Sync sermon into the series.items array so it appears in the series list.
    // Previously only sermon.seriesId was saved, causing the sermon to be invisible in the series view.
    if (seriesId) {
      try {
        await seriesRepository.addSermonToSeries(seriesId, docRef.id, seriesPosition);
        console.log(`Sermon ${docRef.id} linked to series ${seriesId}`);
      } catch (seriesError) {
        // Non-fatal: sermon is created, log and continue
        console.error(`Failed to link sermon ${docRef.id} to series ${seriesId}:`, seriesError);
      }
    }

    const newSermon = { ...sermon, id: docRef.id };
    console.log("New sermon object after attaching ID:", newSermon);

    console.log("Returning success response for created sermon");
    return NextResponse.json({ message: 'Sermon created successfully', sermon: newSermon });
  } catch (error) {
    console.error("Error occurred while creating sermon:", error);
    return NextResponse.json({ error: 'Failed to create sermon' }, { status: 500 });
  }
}
