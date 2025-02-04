import { NextResponse } from 'next/server';
import { addDoc, collection, getDocs } from 'firebase/firestore';
import { db } from 'app/config/firebaseConfig';
import { Sermon } from '@/models/models';
import { log } from '@utils/logger';

// GET /api/sermons
export async function GET() {
  log.info("GET: Request received for retrieving sermons");
  try {
    log.info("GET: Fetching sermons from Firestore...");
    // Retrieve sermons stored in Firestore
    const snapshot = await getDocs(collection(db, 'sermons'));
    log.info(`GET: Retrieved ${snapshot.docs.length} sermon(s) from Firestore`);

    const sermons: Sermon[] = snapshot.docs.map(doc => {
      log.info(`GET: Processing Firestore document with id: ${doc.id}`);
      return {
        id: doc.id,
        ...doc.data()
      } as Sermon;
    });
    
    log.info(`GET: Total sermons retrieved: ${sermons.length}`);
    return NextResponse.json(sermons);
  } catch (error) {
    console.error('GET: Error fetching sermons:', error);
    return NextResponse.json({ error: 'Failed to fetch sermons' }, { status: 500 });
  }
}

// POST /api/sermons
export async function POST(request: Request) {
  log.info("POST request received for creating a sermon");
  try {
    const sermon = await request.json();
    log.info("Parsed sermon data:", sermon);

    // Extract user id from request headers
    const userId = sermon.userId;
    if (!userId) {
      return NextResponse.json({ error: "User not authenticated" }, { status: 401 });
    }

    // Write sermon to Firestore
    const docRef = await addDoc(collection(db, 'sermons'), sermon);
    log.info("Sermon written with ID:", docRef.id);
    
    const newSermon = { id: docRef.id, ...sermon };
    log.info("New sermon object after attaching ID:", newSermon);

    log.info("Returning success response for created sermon");
    return NextResponse.json({ message: 'Sermon created successfully', sermon: newSermon });
  } catch (error) {
    console.error("Error occurred while creating sermon:", error);
    return NextResponse.json({ error: 'Failed to create sermon' }, { status: 500 });
  }
}