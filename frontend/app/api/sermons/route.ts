import { NextResponse } from 'next/server';
import { addDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from 'app/config/firebaseConfig';
import { Sermon } from '@/models/models';
import { log } from '@utils/logger';
import { v4 as uuidv4 } from 'uuid';

// GET /api/sermons?userId=<uid>
export async function GET(request: Request) {
  log.info("GET: Request received for retrieving sermons");
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "User not authenticated" }, { status: 401 });
    }
    
    log.info(`GET: Fetching sermons for userId: ${userId} from Firestore...`);
    const q = query(collection(db, 'sermons'), where("userId", "==", userId));
    const snapshot = await getDocs(q);
    log.info(`GET: Retrieved ${snapshot.docs.length} sermon(s) from Firestore for userId: ${userId}`);

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
    if (Array.isArray(sermon.thoughts)) {
      sermon.thoughts = sermon.thoughts.map((thought: any) => {
        if (!thought.id) {
          return { ...thought, id: uuidv4() };
        }
        return thought;
      });
    }
    log.info("Parsed sermon data:", sermon);

    const userId = sermon.userId;
    if (!userId) {
      return NextResponse.json({ error: "User not authenticated" }, { status: 401 });
    }

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
