import { NextResponse } from 'next/server';
import { createTranscription, generateThought } from "@clients/openAI.client";
import { fetchSermonById } from '@clients/firestore.client';
import { Sermon } from '@/models/models';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from 'app/config/firebaseConfig';

// POST api/thoughts
export async function POST(request: Request) {
  // TODO: i want to know what is the length of this audio, and leter to track this data
  // TODO: check length to limit time, no more that defined in constant
  console.log("Transcription service: Received POST request.");
  try {
    console.log("Transcription service: Starting transcription process.");
    
    const formData = await request.formData();
    const audioFile = formData.get('audio');
    const sermonId = formData.get('sermonId') as string;
    if (!sermonId) {
      console.error("Transcription service: sermonId is null.");
      return NextResponse.json({ error: 'sermonId is required' }, { status: 400 });
    }
    
    if (!(audioFile instanceof Blob)) {
      console.error("Transcription service: Invalid audio format received.");
      return NextResponse.json(
        { error: 'Invalid audio format' },
        { status: 400 }
      );
    }

    const file = new File([audioFile], 'recording.webm', {
      type: 'audio/webm',
    });

    const transcriptionText = await createTranscription(file);
    const sermon = await fetchSermonById(sermonId) as Sermon;
    
    // Generate structured thought using JSON mode
    const thought = await generateThought(transcriptionText, sermon);
    const thoughtWithDate = {
      ...thought,
      date: new Date().toISOString()
    };
    console.log("Generated thought:", thoughtWithDate);
    const sermonDocRef = doc(db, "sermons", sermonId);
    await updateDoc(sermonDocRef, { thoughts: arrayUnion(thoughtWithDate) });
    console.log("Firestore update: Stored new thought into sermon document.");
    // TODO store  thought to firestore
    
    return NextResponse.json(thoughtWithDate);
  } catch (error) {
    console.error('Transcription service: Transcription error:', error);
    return NextResponse.json(
      { error: 'Failed to transcribe audio' },
      { status: 500 }
    );
  }
}

// Added DELETE method to remove a thought from a sermon
export async function DELETE(request: Request) {
  console.log("Transcription service: Received DELETE request.");
  try {
    const body = await request.json();
    const { sermonId, thought } = body;
    if (!sermonId || !thought) {
      return NextResponse.json({ error: "sermonId and thought are required" }, { status: 400 });
    }
    const sermonDocRef = doc(db, "sermons", sermonId);
    await updateDoc(sermonDocRef, { thoughts: arrayRemove(thought) });
    console.log("Successfully deleted thought.");
    return NextResponse.json({ message: "Thought deleted successfully." });
  } catch (error) {
    console.error("Error deleting thought:", error);
    return NextResponse.json({ error: "Failed to delete thought." }, { status: 500 });
  }
}