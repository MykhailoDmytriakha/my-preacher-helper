import { NextResponse } from 'next/server';
import { createTranscription, generateThought } from "@clients/openAI.client";
import { getCustomTags, getRequiredTags } from '@clients/firestore.client';
import { sermonsRepository } from '@repositories/sermons.repository';
import { Sermon, Thought } from '@/models/models';
import { adminDb } from 'app/config/firebaseAdminConfig';
import { FieldValue } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import enTranslation from '../../../locales/en/translation.json';

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
      console.log("Thoughts route: Manual thought:", thought);
      console.log("Will not apply AI to manual thought");
      
      // Add id and date to the thought, and use the tags provided in the request
      const thoughtWithId: Thought = {
        id: uuidv4(),
        text: thought.text,
        tags: thought.tags || [], // Use tags from the request or default to empty array
        date: thought.date || new Date().toISOString(),
      };
      
      // Only add outlinePointId if it exists and is not undefined
      if (thought.outlinePointId) {
        thoughtWithId.outlinePointId = thought.outlinePointId;
      }
      
      // Include optional fields if provided
      if (typeof thought.position === 'number') {
        (thoughtWithId as unknown as Record<string, unknown>).position = thought.position;
      }

      //verify that thought has everything that is needed
      if (!thoughtWithId.id || !thoughtWithId.text || !thoughtWithId.tags || !thoughtWithId.date) {
        return NextResponse.json({ error: "Thought is missing required fields" }, { status: 500 });
      }
      
      console.log("Manual thought with tags:", thoughtWithId);
      
      // Use Admin SDK instead of client SDK
      const sermonDocRef = adminDb.collection("sermons").doc(sermonId);
      await sermonDocRef.update({
        thoughts: FieldValue.arrayUnion(thoughtWithId)
      });
      
      console.log("Firestore update: Stored new manual thought into sermon document.");
      return NextResponse.json(thoughtWithId);
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
    const forceTag = formData.get('forceTag') as string | null; // Extract forceTag from form data
    const outlinePointId = formData.get('outlinePointId') as string | null; // NEW: outline point to attach
    
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

    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    const availableTags = [
      ...(await getRequiredTags()),
      ...(await getCustomTags(sermon.userId))
    ].map(t => t.name);
    
    let transcriptionText: string;
    try {
      transcriptionText = await createTranscription(file);
    } catch (transcriptionError) {
      console.error("Thoughts route: Transcription failed:", transcriptionError);
      
      // Check if it's a specific OpenAI error
      if (transcriptionError instanceof Error) {
        if (transcriptionError.message.includes('Audio file might be corrupted or unsupported')) {
          return NextResponse.json(
            { error: 'Audio file might be corrupted or unsupported. Please try recording again.' },
            { status: 400 }
          );
        } else if (transcriptionError.message.includes('400')) {
          return NextResponse.json(
            { error: 'Audio file format not supported. Please try recording again.' },
            { status: 400 }
          );
        }
      }
      
      return NextResponse.json(
        { error: 'Failed to transcribe audio. Please try again.' },
        { status: 500 }
      );
    }
    
    // Call generateThought and get the new result structure
    const generationResult = await generateThought(transcriptionText, sermon, availableTags, forceTag);
    
    // Check if the generation was successful and meaning was preserved
    if (!generationResult.meaningSuccessfullyPreserved || !generationResult.formattedText || !generationResult.tags) {
      // Handle generation failure or meaning not preserved
      console.error("Thoughts route: Failed to generate thought or meaning not preserved.", generationResult);
      // Return the original transcription so user can see what was recognized
      return NextResponse.json(
        { 
          error: enTranslation.audio.thoughtGenerationFailed, 
          originalText: generationResult.originalText,
          transcriptionText: transcriptionText
        }, 
        { status: 500 }
      );
    }
    
    // Proceed with the successfully generated thought
    console.log("Thoughts route: Thought generation successful. Original Text:", generationResult.originalText);
    if (forceTag) {
      console.log(`Thoughts route: Force tag "${forceTag}" applied. Tags overridden from [${generationResult.tags.join(", ")}] to [${forceTag}]`);
    }
    
    const thought: Thought = {
      id: uuidv4(),
      text: generationResult.formattedText, // Use formattedText
      tags: generationResult.tags, // Use tags (already processed with forceTag if applicable)
      date: new Date().toISOString()
      // originalText: generationResult.originalText // Optionally add originalText to the Thought model if needed
    };

    // Attach outlinePointId if provided
    if (outlinePointId) {
      thought.outlinePointId = outlinePointId;
    }
    
    //verify that thought has everything that is needed
    if (!thought.id || !thought.text || !thought.tags || !thought.date) {
      console.error("Thoughts route: Generated thought is missing required fields after processing", thought);
      return NextResponse.json({ error: "Generated thought is missing required fields after processing" }, { status: 500 });
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
      console.error("Thoughts route: Missing sermonId or thought");
      return NextResponse.json({ error: "sermonId and thought are required" }, { status: 400 });
    }   
    if (!updatedThoughtNew.id) {
      console.error("Thoughts route: Missing thought.id");
      return NextResponse.json({ error: "Thought id is required" }, { status: 400 });
    }
    
    // map updatedThought to the Thought type, only fields that are needed
    const updatedThought: Thought = {
      id: updatedThoughtNew.id,
      text: updatedThoughtNew.text,
      tags: updatedThoughtNew.tags || [],
      date: updatedThoughtNew.date,
    };
    
    // Only add outlinePointId if it exists and is not undefined
    if (updatedThoughtNew.outlinePointId) {
      updatedThought.outlinePointId = updatedThoughtNew.outlinePointId;
    }
    if (typeof updatedThoughtNew.position === 'number') {
      (updatedThought as unknown as Record<string, unknown>).position = updatedThoughtNew.position;
    }
    
    // Add keyFragments if it exists
    if (updatedThoughtNew.keyFragments) {
      updatedThought.keyFragments = updatedThoughtNew.keyFragments;
    }
    
    // verify that updatedThought has everything that is needed
    if (!updatedThought.id || !updatedThought.text || !updatedThought.tags || !updatedThought.date) {
      console.error("Thoughts route: Thought is missing required fields");
      return NextResponse.json({ error: "Thought is missing required fields" }, { status: 500 });
    }

    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error("Thoughts route: Sermon not found");
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }

    const oldThought = sermon.thoughts.find((th) => th.id === updatedThought.id);
    if (!oldThought) {
      console.error("Thoughts route: Thought not found in sermon. Looking for thought with ID:", updatedThought.id);
      return NextResponse.json({ error: "Thought not found in sermon" }, { status: 404 });
    }
    console.log("Thoughts route: Thought to update:", JSON.stringify(oldThought));
    console.log("Thoughts route: Updated thought:", JSON.stringify(updatedThought));
    
    // Use Admin SDK with transaction to ensure atomic update
    try {
      await adminDb.runTransaction(async (transaction) => {
        const sermonDocRef = adminDb.collection("sermons").doc(sermonId);
        const sermonDoc = await transaction.get(sermonDocRef);
        
        if (!sermonDoc.exists) {
          throw new Error("Sermon document not found");
        }
        
        const sermonData = sermonDoc.data();
        if (!sermonData) {
          throw new Error("Sermon data is empty");
        }
        
        // Get current thoughts array and create updated array
        const currentThoughts = sermonData.thoughts || [];
        const updatedThoughts = currentThoughts.filter((t: Thought) => t.id !== oldThought.id);
        updatedThoughts.push(updatedThought);
        
        // Update in a single transaction
        transaction.update(sermonDocRef, { thoughts: updatedThoughts });
      });
      
      console.log("Thoughts route: Successfully updated thought in transaction");
      return NextResponse.json(updatedThought);
    } catch (error) {
      console.error("Thoughts route: Error updating thought in transaction:", error);
      return NextResponse.json({ error: "Failed to update thought." }, { status: 500 });
    }
  } catch (error) {
    console.error("Thoughts route: Error updating thought:", error);
    return NextResponse.json({ error: "Failed to update thought." }, { status: 500 });
  }
}
