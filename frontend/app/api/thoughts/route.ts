import { NextResponse } from 'next/server';
import { createTranscription, generateThought } from "@clients/openAI.client";
import { generateThoughtStructured } from "@clients/thought.structured";
import { getCustomTags, getRequiredTags } from '@clients/firestore.client';

// Feature flag for structured output
// Set to 'true' to use new structured output implementation
const USE_STRUCTURED_OUTPUT = process.env.USE_STRUCTURED_OUTPUT === 'true';
import { sermonsRepository } from '@repositories/sermons.repository';
import { Sermon, Thought } from '@/models/models';
import { adminDb } from 'app/config/firebaseAdminConfig';
import { FieldValue } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import enTranslation from '@locales/en/translation.json';

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

    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    const availableTags = [
      ...(await getRequiredTags()),
      ...(await getCustomTags(sermon.userId))
    ].map(t => t.name);

    let transcriptionText: string;
    try {
      // Pass Blob directly to avoid double conversion Blob -> File -> File
      transcriptionText = await createTranscription(audioFile as Blob);
    } catch (transcriptionError) {
      console.error("Thoughts route: Transcription failed:", transcriptionError);

      // Check if it's a specific OpenAI or validation error
      if (transcriptionError instanceof Error) {
        const errorMessage = transcriptionError.message.toLowerCase();
        if (errorMessage.includes('audio file might be corrupted or unsupported')) {
          return NextResponse.json(
            { error: 'Audio file might be corrupted or unsupported. Please try recording again.' },
            { status: 400 }
          );
        } else if (errorMessage.includes('audio file is empty')) {
          return NextResponse.json(
            { error: 'Audio recording failed - file is empty. Please try recording again.' },
            { status: 400 }
          );
        } else if (errorMessage.includes('audio file is too small')) {
          return NextResponse.json(
            { error: 'Audio recording is too short. Please record for at least 1 second.' },
            { status: 400 }
          );
        } else if (errorMessage.includes('400') || errorMessage.includes('invalid_request_error')) {
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

    // Call generateThought using either structured output or legacy implementation
    const generationResult = USE_STRUCTURED_OUTPUT
      ? await generateThoughtStructured(transcriptionText, sermon, availableTags, { forceTag })
      : await generateThought(transcriptionText, sermon, availableTags, forceTag);

    if (USE_STRUCTURED_OUTPUT) {
      console.log("Thoughts route: Using STRUCTURED OUTPUT implementation");
    }

    // Check if the generation was successful and meaning was preserved
    if (!generationResult.meaningSuccessfullyPreserved || !generationResult.formattedText || !generationResult.tags) {
      // Handle generation failure or meaning not preserved
      console.warn("Thoughts route: Failed to generate thought or meaning not preserved. Falling back to raw transcription.", generationResult);

      // Fallback: Use the original transcription text standard thought
      generationResult.formattedText = transcriptionText;
      generationResult.tags = []; // Fallback to empty tags
      // Continue execution to save the thought...
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

    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error("Thoughts route: Sermon not found");
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }

    const oldThought = sermon.thoughts.find((th) => th.id === updatedThoughtNew.id);
    if (!oldThought) {
      console.error("Thoughts route: Thought not found in sermon. Looking for thought with ID:", updatedThoughtNew.id);
      return NextResponse.json({ error: "Thought not found in sermon" }, { status: 404 });
    }

    // Merge new data with the persisted thought to avoid losing existing fields
    const mergedThought: Thought = {
      ...oldThought,
      ...updatedThoughtNew,
      id: updatedThoughtNew.id,
      text: updatedThoughtNew.text ?? oldThought.text,
      date: updatedThoughtNew.date ?? oldThought.date,
      tags: Array.isArray(updatedThoughtNew.tags) ? updatedThoughtNew.tags : oldThought.tags,
    };

    // Ensure outlinePointId is explicitly updated when provided (including clearing)
    if (Object.prototype.hasOwnProperty.call(updatedThoughtNew, "outlinePointId")) {
      mergedThought.outlinePointId = updatedThoughtNew.outlinePointId ?? null;
    }

    // Preserve position if new value not provided
    if (!Object.prototype.hasOwnProperty.call(updatedThoughtNew, "position")) {
      if (typeof oldThought.position === "number") {
        (mergedThought as unknown as Record<string, unknown>).position = oldThought.position;
      } else {
        delete (mergedThought as unknown as Record<string, unknown>).position;
      }
    }

    const sanitizedMergedThought = Object.entries(mergedThought).reduce<Record<string, unknown>>((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {}) as unknown as Thought;

    if (!sanitizedMergedThought.id || !sanitizedMergedThought.text || !sanitizedMergedThought.date || !sanitizedMergedThought.tags) {
      console.error("Thoughts route: Thought is missing required fields after merge");
      return NextResponse.json({ error: "Thought is missing required fields" }, { status: 500 });
    }

    console.log("Thoughts route: Thought to update:", JSON.stringify(oldThought));
    console.log("Thoughts route: Updated thought:", JSON.stringify(sanitizedMergedThought));

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

        // Get current thoughts array and replace the matching thought in-place
        const currentThoughts = sermonData.thoughts || [];
        const updatedThoughts = currentThoughts.map((t: Thought) =>
          t.id === sanitizedMergedThought.id ? sanitizedMergedThought : t
        );

        // Update in a single transaction
        transaction.update(sermonDocRef, { thoughts: updatedThoughts });
      });

      console.log("Thoughts route: Successfully updated thought in transaction");
      return NextResponse.json(sanitizedMergedThought);
    } catch (error) {
      console.error("Thoughts route: Error updating thought in transaction:", error);
      return NextResponse.json({ error: "Failed to update thought." }, { status: 500 });
    }
  } catch (error) {
    console.error("Thoughts route: Error updating thought:", error);
    return NextResponse.json({ error: "Failed to update thought." }, { status: 500 });
  }
}
