import { NextResponse } from 'next/server';
import { createTranscription, generateThought } from "@clients/openAI.client";
import { fetchSermonById } from '@clients/firestore.client';
import { Sermon } from '@/models/models';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
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