import { NextResponse } from 'next/server';
import { createTranscription, generateThought } from "@clients/openAI.client";
import { fetchSermonById, getCustomTags, getRequiredTags } from '@clients/firestore.client';
import { Sermon, Thought } from '@/models/models';
import { adminDb } from 'app/config/firebaseAdminConfig';
import { FieldValue } from 'firebase-admin/firestore';

// POST api/thoughts
export async function POST(request: Request) {
  // TODO: i want to know what is the length of this audio, and leter to track this data
  // TODO: check length to limit time, no more that defined in constant
  console.log("Thoughts route: Received POST request.");

  const url = new URL(request.url);
  if (url.searchParams.get('manual') === 'true') {
    try {
      console.log("Thoughts route: Processing manual thought creation.");
      const body = await request.json();
      const { sermonId, thought } = body;
      if (!sermonId || !thought) {
        return NextResponse.json({ error: 'sermonId and thought are required' }, { status: 400 });
      }
      const sermon = await fetchSermonById(sermonId) as Sermon;
      const availableTags = [
        ...(await getRequiredTags()),
        ...(await getCustomTags(sermon.userId))
      ].map(t => t.name);
      const manualThought = await generateThought(thought.text, sermon, availableTags);
      //verify that manualThought has everything that is needed
      if (!manualThought.id || !manualThought.text || !manualThought.tags || !manualThought.date) {
        return NextResponse.json({ error: "Thought is missing required fields" }, { status: 500 });
      }
      const thoughtWithDate = {
        ...manualThought,
        date: new Date().toISOString()
      };
      console.log("Manual (fixed) thought:", thoughtWithDate);
      
      // Use Admin SDK instead of client SDK
      const sermonDocRef = adminDb.collection("sermons").doc(sermonId);
      await sermonDocRef.update({
        thoughts: FieldValue.arrayUnion(thoughtWithDate)
      });
      
      console.log("Firestore update: Stored new manual thought into sermon document.");
      return NextResponse.json(thoughtWithDate);
    } catch (error) {
      console.error('Thoughts route: Manual POST error:', error);
      return NextResponse.json({ error: 'Failed to process manual thought' }, { status: 500 });
    }
  }

  try {
    console.log("Thoughts route: Starting transcription process.");
    
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

    const sermon = await fetchSermonById(sermonId) as Sermon;
    const availableTags = [
      ...(await getRequiredTags()),
      ...(await getCustomTags(sermon.userId))
    ].map(t => t.name);
    const transcriptionText = await createTranscription(file);
    
    const thought = await generateThought(transcriptionText, sermon, availableTags);
    //verify that thought has everything that is needed
    if (!thought.id || !thought.text || !thought.tags || !thought.date) {
      return NextResponse.json({ error: "Thought is missing required fields" }, { status: 500 });
    }
    console.log("Generated thought:", thought);
    
    // Use Admin SDK instead of client SDK
    const sermonDocRef = adminDb.collection("sermons").doc(sermonId);
    await sermonDocRef.update({
      thoughts: FieldValue.arrayUnion(thought)
    });
    
    console.log("Firestore update: Stored new thought into sermon document.");
    return NextResponse.json(thought);
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
  console.log("Thoughts route: Received DELETE request.");
  try {
    const body = await request.json();
    const { sermonId, thought } = body;
    if (!sermonId || !thought) {
      return NextResponse.json({ error: "sermonId and thought are required" }, { status: 400 });
    }
    console.log("Thoughts route: Deleting thought:", thought);
    
    // Use Admin SDK instead of client SDK
    const sermonDocRef = adminDb.collection("sermons").doc(sermonId);
    await sermonDocRef.update({
      thoughts: FieldValue.arrayRemove(thought)
    });
    
    console.log("Successfully deleted thought.");
    return NextResponse.json({ message: "Thought deleted successfully." });
  } catch (error) {
    console.error("Error deleting thought:", error);
    return NextResponse.json({ error: "Failed to delete thought." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  console.log("Thoughts route: Received PUT request for updating a thought.");
  try {
    const body = await request.json();
    const { sermonId, thought: updatedThoughtNew } = body;
    if (!sermonId || !updatedThoughtNew) {
      return NextResponse.json({ error: "sermonId and thought are required" }, { status: 400 });
    }   
    if (!updatedThoughtNew.id) {
      return NextResponse.json({ error: "Thought id is required" }, { status: 400 });
    }
    console.log("updatedThoughtNew:", updatedThoughtNew);
    // map updatedThought to the Thought type, only fields that are needed
    const updatedThought: Thought = {
      id: updatedThoughtNew.id,
      text: updatedThoughtNew.text,
      tags: updatedThoughtNew.tags,
      date: updatedThoughtNew.date
    };
    console.log("updatedThought:", updatedThought);
    // verify that updatedThought has everything that is needed
    if (!updatedThought.id || !updatedThought.text || !updatedThought.tags || !updatedThought.date) {
      return NextResponse.json({ error: "Thought is missing required fields" }, { status: 500 });
    }

    const sermon = await fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }

    const oldThought = sermon.thoughts.find((th) => th.id === updatedThought.id);
    if (!oldThought) {
      return NextResponse.json({ error: "Thought not found in sermon" }, { status: 404 });
    }
    console.log("Thoughts route: Thought to update:", updatedThought);
    
    // Use Admin SDK instead of client SDK
    const sermonDocRef = adminDb.collection("sermons").doc(sermonId);
    await sermonDocRef.update({
      thoughts: FieldValue.arrayRemove(oldThought)
    });
    await sermonDocRef.update({
      thoughts: FieldValue.arrayUnion(updatedThought)
    });

    console.log("Successfully updated thought.");
    return NextResponse.json(updatedThought);
  } catch (error) {
    console.error("Error updating thought:", error);
    return NextResponse.json({ error: "Failed to update thought." }, { status: 500 });
  }
}