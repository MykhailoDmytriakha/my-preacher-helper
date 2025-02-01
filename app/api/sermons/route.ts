import { NextResponse } from 'next/server';
import { addDoc, collection, getDocs } from 'firebase/firestore';
import { db } from 'app/config/firebaseConfig';
import { Sermon } from '@services/sermon.service';

// GET /api/sermons
export async function GET() {
  console.log("GET: Request received for retrieving sermons");
  try {
    console.log("GET: Fetching sermons from Firestore...");
    // Retrieve sermons stored in Firestore
    const snapshot = await getDocs(collection(db, 'sermons'));
    console.log(`GET: Retrieved ${snapshot.docs.length} sermon(s) from Firestore`);

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
    const sermon: Omit<Sermon, 'id'> = await request.json();
    console.log("Parsed sermon data:", sermon);

    // Write sermon to Firestore
    const docRef = await addDoc(collection(db, 'sermons'), sermon);
    console.log("Sermon written with ID:", docRef.id);
    
    // Optionally, you can attach the generated ID back to the sermon object:
    const newSermon = { id: docRef.id, ...sermon };
    console.log("New sermon object after attaching ID:", newSermon);

    console.log("Returning success response for created sermon");
    return NextResponse.json({ message: 'Sermon created successfully', sermon: newSermon });
  } catch (error) {
    console.error("Error occurred while creating sermon:", error);
    return NextResponse.json({ error: 'Failed to create sermon' }, { status: 500 });
  }
}