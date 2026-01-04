import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

import { adminDb } from '@/config/firebaseAdminConfig';
import { Sermon, Thought } from '@/models/models';
import { getCustomTags, getRequiredTags } from '@clients/firestore.client';
import { createTranscription } from '@clients/openAI.client';
import { generateThoughtStructured } from '@clients/thought.structured';
import { sermonsRepository } from '@repositories/sermons.repository';

// Error messages
const ERROR_MESSAGES = {
  SERMON_ID_AND_THOUGHT_REQUIRED: 'sermonId and thought are required',
} as const;

function isCompleteThought(thought: Thought): boolean {
  return Boolean(thought.id && thought.text && thought.tags && thought.date);
}

function buildManualThought(thought: Record<string, unknown>): Thought {
  const thoughtWithId: Thought = {
    id: uuidv4(),
    text: thought.text as string,
    tags: (thought.tags as string[]) || [],
    date: (thought.date as string) || new Date().toISOString(),
  };

  if (thought.outlinePointId) {
    thoughtWithId.outlinePointId = thought.outlinePointId as string;
  }

  if (typeof thought.position === 'number') {
    (thoughtWithId as unknown as Record<string, unknown>).position = thought.position;
  }

  return thoughtWithId;
}

async function appendThoughtToSermon(sermonId: string, thought: Thought, union: (value: Thought) => unknown) {
  const sermonDocRef = adminDb.collection("sermons").doc(sermonId);
  await sermonDocRef.update({
    thoughts: union(thought)
  });
}

function normalizeGenerationResult(params: {
  generationResult: { meaningSuccessfullyPreserved: boolean; formattedText: string | null; tags: string[] | null };
  transcriptionText: string;
}): { formattedText: string; tags: string[]; usedFallback: boolean } {
  const { generationResult, transcriptionText } = params;
  if (!generationResult.meaningSuccessfullyPreserved || !generationResult.formattedText || !generationResult.tags) {
    return { formattedText: transcriptionText, tags: [], usedFallback: true };
  }
  return {
    formattedText: generationResult.formattedText,
    tags: generationResult.tags,
    usedFallback: false,
  };
}

function mapTranscriptionError(transcriptionError: unknown): { status: number; error: string } | null {
  if (!(transcriptionError instanceof Error)) {
    return null;
  }

  const errorMessage = transcriptionError.message.toLowerCase();
  if (errorMessage.includes('audio file might be corrupted or unsupported')) {
    return { status: 400, error: 'Audio file might be corrupted or unsupported. Please try recording again.' };
  }
  if (errorMessage.includes('audio file is empty')) {
    return { status: 400, error: 'Audio recording failed - file is empty. Please try recording again.' };
  }
  if (errorMessage.includes('audio file is too small')) {
    return { status: 400, error: 'Audio recording is too short. Please record for at least 1 second.' };
  }
  if (errorMessage.includes('400') || errorMessage.includes('invalid_request_error')) {
    return { status: 400, error: 'Audio file format not supported. Please try recording again.' };
  }
  return null;
}

async function handleManualPost(request: Request) {
  try {
    console.log("Thoughts route: Processing manual thought creation.");
    const body = await request.json();
    const { sermonId, thought } = body as { sermonId?: string; thought?: Record<string, unknown> };
    if (!sermonId || !thought) {
      return NextResponse.json({ error: ERROR_MESSAGES.SERMON_ID_AND_THOUGHT_REQUIRED }, { status: 400 });
    }
    console.log("Thoughts route: Manual thought:", thought);
    console.log("Will not apply AI to manual thought");

    const thoughtWithId = buildManualThought(thought);
    if (!isCompleteThought(thoughtWithId)) {
      return NextResponse.json({ error: "Thought is missing required fields" }, { status: 500 });
    }

    console.log("Manual thought with tags:", thoughtWithId);
    await appendThoughtToSermon(sermonId, thoughtWithId, FieldValue.arrayUnion);
    console.log("Firestore update: Stored new manual thought into sermon document.");
    return NextResponse.json(thoughtWithId);
  } catch (error) {
    console.error('Thoughts route: Manual POST error:', error);
    return NextResponse.json({ error: 'Failed to process manual thought' }, { status: 500 });
  }
}

async function handleAutoPost(request: Request) {
  try {
    console.log("Thoughts route: Starting transcription process.");

    const formData = await request.formData();
    const audioFile = formData.get('audio');
    const sermonId = formData.get('sermonId') as string;
    const forceTag = formData.get('forceTag') as string | null;
    const outlinePointId = formData.get('outlinePointId') as string | null;

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
      transcriptionText = await createTranscription(audioFile as Blob);
    } catch (transcriptionError) {
      console.error("Thoughts route: Transcription failed:", transcriptionError);
      const mappedError = mapTranscriptionError(transcriptionError);
      if (mappedError) {
        return NextResponse.json({ error: mappedError.error }, { status: mappedError.status });
      }
      return NextResponse.json(
        { error: 'Failed to transcribe audio. Please try again.' },
        { status: 500 }
      );
    }

    const generationResult = await generateThoughtStructured(transcriptionText, sermon, availableTags, { forceTag });
    const normalized = normalizeGenerationResult({ generationResult, transcriptionText });
    if (normalized.usedFallback) {
      console.warn("Thoughts route: Failed to generate thought or meaning not preserved. Falling back to raw transcription.", generationResult);
    }

    console.log("Thoughts route: Thought generation successful. Original Text:", generationResult.originalText);
    if (forceTag) {
      console.log(`Thoughts route: Force tag "${forceTag}" applied. Tags overridden from [${normalized.tags.join(", ")}] to [${forceTag}]`);
    }

    const thought: Thought = {
      id: uuidv4(),
      text: normalized.formattedText,
      tags: normalized.tags,
      date: new Date().toISOString()
    };

    if (outlinePointId) {
      thought.outlinePointId = outlinePointId;
    }

    if (!isCompleteThought(thought)) {
      console.error("Thoughts route: Generated thought is missing required fields after processing", thought);
      return NextResponse.json({ error: "Generated thought is missing required fields after processing" }, { status: 500 });
    }
    console.log("Generated thought:", thought);

    await appendThoughtToSermon(sermonId, thought, FieldValue.arrayUnion);
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

// POST api/thoughts
export async function POST(request: Request) {
  // TODO: i want to know what is the length of this audio, and leter to track this data
  // TODO: check length to limit time, no more that defined in constant
  console.log("Thoughts route: Received POST request.");

  const url = new URL(request.url);
  if (url.searchParams.get('manual') === 'true') {
    return handleManualPost(request);
  }
  return handleAutoPost(request);
}

// Added DELETE method to remove a thought from a sermon
export async function DELETE(request: Request) {
  console.log("Thoughts route: Received DELETE request.");
  try {
    const body = await request.json();
    const { sermonId, thought } = body;
    if (!sermonId || !thought) {
      return NextResponse.json({ error: ERROR_MESSAGES.SERMON_ID_AND_THOUGHT_REQUIRED }, { status: 400 });
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
      return NextResponse.json({ error: ERROR_MESSAGES.SERMON_ID_AND_THOUGHT_REQUIRED }, { status: 400 });
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
