import { NextResponse } from 'next/server';
import { createTranscription, generateThought } from "@clients/openAI.client";
import { fetchSermonById } from '@clients/firestore.client';
import { Sermon } from '@/models/models';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from 'app/config/firebaseConfig';
import { log } from '@utils/logger';

// POST api/thoughts
export async function POST(request: Request) {
  // TODO: i want to know what is the length of this audio, and leter to track this data
  // TODO: check length to limit time, no more that defined in constant
  log.info("Thoughts route: Received POST request.");
  try {
    log.info("Thoughts route: Starting transcription process.");
    
    const formData = await request.formData();
    const audioFile = formData.get('audio');
    const sermonId = formData.get('sermonId') as string;
    if (!sermonId) {
      console.error("Thoughts route: sermonId is null.");
      return NextResponse.json({ error: 'sermonId is required' }, { status: 400 });
    }
    
    if (!(audioFile instanceof Blob)) {
      console.error("Thoughts route: Invalid audio format received.");
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
    
    const thought = await generateThought(transcriptionText, sermon);
    const thoughtWithDate = {
      ...thought,
      date: new Date().toISOString()
    };
    log.info("Generated thought:", thoughtWithDate);
    const sermonDocRef = doc(db, "sermons", sermonId);
    await updateDoc(sermonDocRef, { thoughts: arrayUnion(thoughtWithDate) });
    log.info("Firestore update: Stored new thought into sermon document.");
    // TODO store  thought to firestore
    
    return NextResponse.json(thoughtWithDate);
  } catch (error) {
    console.error('Thoughts route: Transcription error:', error);
    return NextResponse.json(
      { error: 'Failed to transcribe audio' },
      { status: 500 }
    );
  }
}

// Added DELETE method to remove a thought from a sermon
export async function DELETE(request: Request) {
  log.info("Thoughts route: Received DELETE request.");
  try {
    const body = await request.json();
    const { sermonId, thought } = body;
    if (!sermonId || !thought) {
      return NextResponse.json({ error: "sermonId and thought are required" }, { status: 400 });
    }
    log.info("Thoughts route: Deleting thought:", thought);
    const sermonDocRef = doc(db, "sermons", sermonId);
    await updateDoc(sermonDocRef, { thoughts: arrayRemove(thought) });
    log.info("Successfully deleted thought.");
    return NextResponse.json({ message: "Thought deleted successfully." });
  } catch (error) {
    console.error("Error deleting thought:", error);
    return NextResponse.json({ error: "Failed to delete thought." }, { status: 500 });
  }
}

// After the DELETE method, add the following PUT method implementation
export async function PUT(request: Request) {
  log.info("Thoughts route: Received PUT request for updating a thought.");
  try {
    const body = await request.json();
    const { sermonId, thought: updatedThought } = body;
    if (!sermonId || !updatedThought) {
      return NextResponse.json({ error: "sermonId and thought are required" }, { status: 400 });
    }

    const sermon = await fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }

    const oldThought = sermon.thoughts.find((th) => th.date === updatedThought.date);
    if (!oldThought) {
      return NextResponse.json({ error: "Thought not found in sermon" }, { status: 404 });
    }
    log.info("Thoughts route: Thought to update:", oldThought);
    const sermonDocRef = doc(db, "sermons", sermonId);

    await updateDoc(sermonDocRef, { thoughts: arrayRemove(oldThought) });
    await updateDoc(sermonDocRef, { thoughts: arrayUnion(updatedThought) });

    log.info("Successfully updated thought.");
    return NextResponse.json(updatedThought);
  } catch (error) {
    console.error("Error updating thought:", error);
    return NextResponse.json({ error: "Failed to update thought." }, { status: 500 });
  }
}