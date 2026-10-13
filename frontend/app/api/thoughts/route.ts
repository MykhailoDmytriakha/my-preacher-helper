import 'openai/shims/node';

import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { usageCapResponse } from '@/api/errors/usageCapResponse';
import { legacyBoundaryResponse } from '@/data-engine/legacyBoundary.server';
import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';
import { assertServerWritable, serverEditResponse, writeOwnedDocument } from '@/data-engine/serverEdit.server';
import { Sermon, Thought } from '@/models/models';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { addSermonThought } from '@/utils/sermonThoughtEdits';
import { validateAudioDuration } from '@/utils/server/audioServerUtils';
import { sanitizeAvailableThoughtTags, stripStructureTags } from '@/utils/thoughtTagSanitizer';
import { createApiPerformanceTracker } from '@clients/apiPerformanceTelemetry';
import { getCustomTags } from '@clients/firestore.client';
import { generateThoughtStructured } from '@clients/thought.structured';
import {
  createTranscriptionWithRetry,
  mapTranscriptionError,
  type TranscriptionErrorResponse,
} from '@clients/transcriptionRetry';
import { sermonsRepository } from '@repositories/sermons.repository';

import type { DocumentData } from '@/data-engine/types';

const SERMON_NOT_FOUND_ERROR = 'Sermon not found';

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
    tags: stripStructureTags(thought.tags as string[]),
    date: (thought.date as string) || new Date().toISOString(),
  };

  if (thought.outlinePointId) {
    thoughtWithId.outlinePointId = thought.outlinePointId as string;
  }

  if (thought.subPointId) {
    thoughtWithId.subPointId = thought.subPointId as string;
  }

  if (typeof thought.position === 'number') {
    (thoughtWithId as unknown as Record<string, unknown>).position = thought.position;
  }

  return thoughtWithId;
}

async function appendThoughtToSermon(uid: string, sermonId: string, thought: Thought, union: (value: Thought) => unknown) {
  await writeOwnedDocument({
    owner: uid,
    resource: { collection: 'sermons', id: sermonId },
    // Server-side thought writes advance the `thoughts` counter too, so a client
    // editing thoughts cannot later be granted false permission.
    legacy: () => sermonsRepository.updateSermonData(sermonId, {
      thoughts: union(thought)
    }, 'thoughts'),
    // On an engine document the thought and its place in the structure land as one edit,
    // through the same transform the editor uses (idempotent by thought ID).
    // `updatedAt` moves as the legacy updateSermonData moved it, so the sermon rises in "recent".
    engine: current => ({ ...addSermonThought({ ...current, thoughts: current.thoughts ?? [] } as unknown as Sermon, thought) as unknown as DocumentData,
      updatedAt: new Date().toISOString() }),
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
    tags: stripStructureTags(generationResult.tags),
    usedFallback: false,
  };
}

async function handleManualPost(request: Request, uid: string) {
  try {
    console.log("Thoughts route: Processing manual thought creation.");
    const body = await request.json();
    const { sermonId, thought } = body as { sermonId?: string; thought?: Record<string, unknown> };
    if (!sermonId || !thought) {
      return NextResponse.json({ error: ERROR_MESSAGES.SERMON_ID_AND_THOUGHT_REQUIRED }, { status: 400 });
    }
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon | null;
    if (!sermon) {
      return NextResponse.json({ error: SERMON_NOT_FOUND_ERROR }, { status: 404 });
    }
    if (sermon.userId !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    assertServerWritable(sermon as unknown as Record<string, unknown>, 'sermons');
    console.log("Thoughts route: Manual thought:", thought);
    console.log("Will not apply AI to manual thought");

    const thoughtWithId = buildManualThought(thought);
    if (!isCompleteThought(thoughtWithId)) {
      return NextResponse.json({ error: "Thought is missing required fields" }, { status: 400 });
    }

    console.log("Manual thought with tags:", thoughtWithId);
    await appendThoughtToSermon(uid, sermonId, thoughtWithId, FieldValue.arrayUnion);
    console.log("Firestore update: Stored new manual thought into sermon document.");
    return NextResponse.json(thoughtWithId);
  } catch (error) {
    const boundary = legacyBoundaryResponse(error) ?? serverEditResponse(error);
    if (boundary) return boundary;
    console.error('Thoughts route: Manual POST error:', error);
    return NextResponse.json({ error: 'Failed to process manual thought' }, { status: 500 });
  }
}

async function handleAutoPost(request: Request, uid: string) {
  const tracker = createApiPerformanceTracker({
    route: "/api/thoughts",
    method: "POST",
    operation: "thought_audio_create",
  });

  const errorResponse = (
    errorMessage: string,
    status: number,
    extra?: Pick<TranscriptionErrorResponse, 'retryable' | 'phase' | 'kind'>
  ) => {
    tracker.emit({
      status: "error",
      httpStatus: status,
      errorMessage,
    });
    return NextResponse.json({ error: errorMessage, ...extra }, { status });
  };

  try {
    console.log("Thoughts route: Starting transcription process.");

    const formData = await tracker.timePhase("parse_form_data", () => request.formData());
    const audioFile = formData.get('audio');
    const sermonId = formData.get('sermonId') as string;
    const outlinePointId = formData.get('outlinePointId') as string | null;
    const subPointId = formData.get('subPointId') as string | null;
    tracker.addContext({
      sermonId: sermonId || null,
      hasOutlinePointId: Boolean(outlinePointId),
      hasSubPointId: Boolean(subPointId),
      audioPresent: audioFile instanceof Blob,
    });

    if (!sermonId) {
      console.error("Thoughts route: sermonId is null.");
      return errorResponse('sermonId is required', 400);
    }

    if (!(audioFile instanceof Blob)) {
      console.error("Thoughts route: Invalid audio format received.");
      return errorResponse('Invalid audio format', 400, { kind: 'invalid_audio' });
    }

    const sermon = await tracker.timePhase(
      "fetch_sermon",
      () => sermonsRepository.fetchSermonById(sermonId) as Promise<Sermon | null>,
      { sermonId }
    );
    if (!sermon) {
      console.error("Thoughts route: Sermon not found.");
      return errorResponse(SERMON_NOT_FOUND_ERROR, 404);
    }
    if (sermon.userId !== uid) {
      return errorResponse('Forbidden', 403);
    }
    assertServerWritable(sermon as unknown as Record<string, unknown>, 'sermons');

    tracker.addContext({
      audioSizeBytes: audioFile.size,
      audioType: audioFile.type || null,
    });

    const durationValidation = await tracker.timePhase(
      "validate_audio_duration",
      () => validateAudioDuration(audioFile),
      {
        audioSizeBytes: audioFile.size,
        audioType: audioFile.type || null,
      }
    );
    tracker.addContext({
      audioDurationSeconds: durationValidation.duration ?? null,
      audioMaxAllowedSeconds: durationValidation.maxAllowed ?? null,
    });
    if (!durationValidation.valid) {
      console.error("Thoughts route: Audio duration validation failed.", durationValidation);
      return errorResponse(durationValidation.error || 'Audio file is too long', 400, { kind: 'too_long' });
    }

    const usageSeconds = Math.ceil(
      durationValidation.duration ?? durationValidation.maxAllowed ?? 0
    );
    const [
      { getUserEntitlementServerSide },
      { createUsageAdmission, consumeTranscriptionSeconds },
    ] = await Promise.all([
      import('@/services/userEntitlement.server'),
      import('@/services/usageLimits.server'),
    ]);
    const usageNow = new Date();
    const entitlement = await getUserEntitlementServerSide(uid);
    const usageAdmission = createUsageAdmission(
      uid,
      entitlement,
      ['transcription', 'ai'],
      usageNow
    );

    const customTagsPromise = tracker.timePhase(
      "fetch_custom_tags",
      () => getCustomTags(uid),
      { sermonFound: true }
    );

    let transcriptionText: string;
    try {
      transcriptionText = await tracker.timePhase(
        "transcribe_audio",
        () => createTranscriptionWithRetry(audioFile as Blob, {
          userId: uid,
          onRetry: ({ attempt, maxAttempts }) => {
            tracker.addContext({
              transcriptionRetryAttempt: attempt,
              transcriptionMaxAttempts: maxAttempts,
            });
          },
        }),
        {
          audioSizeBytes: audioFile.size,
          audioType: audioFile.type || null,
        }
      );
      tracker.addContext({
        transcriptionLength: transcriptionText.length,
      });
      await consumeTranscriptionSeconds(uid, usageSeconds, usageNow);
    } catch (transcriptionError) {
      console.error("Thoughts route: Transcription failed:", transcriptionError);
      if (isUsageCapReachedError(transcriptionError)) {
        return usageCapResponse(transcriptionError);
      }
      const mappedError = mapTranscriptionError(transcriptionError);
      if (mappedError) {
        return errorResponse(mappedError.error, mappedError.status, {
          retryable: mappedError.retryable,
          phase: mappedError.phase,
          kind: mappedError.kind,
        });
      }
      return errorResponse('Failed to transcribe audio. Please try again.', 500);
    }

    const customTags = await customTagsPromise;
    const availableTags = sanitizeAvailableThoughtTags(customTags.map(t => t.name));
    tracker.addContext({
      customTagsCount: customTags.length,
      availableTagsCount: availableTags.length,
    });

    const generationResult = await tracker.timePhase(
      "generate_thought",
      () => generateThoughtStructured(transcriptionText, sermon, availableTags, {
        userId: uid,
        usageAdmission,
      }),
      {
        availableTagsCount: availableTags.length,
      }
    );
    const normalized = normalizeGenerationResult({ generationResult, transcriptionText });
    tracker.addContext({
      generationMeaningPreserved: generationResult.meaningSuccessfullyPreserved,
      usedFallback: normalized.usedFallback,
      formattedTextLength: normalized.formattedText.length,
      generatedTagsCount: normalized.tags.length,
    });
    if (normalized.usedFallback) {
      console.warn("Thoughts route: Failed to generate thought or meaning not preserved. Falling back to raw transcription.", generationResult);
    }

    console.log("Thoughts route: Thought generation successful. Original Text:", generationResult.originalText);

    const thought: Thought = {
      id: uuidv4(),
      text: normalized.formattedText,
      tags: normalized.tags,
      date: new Date().toISOString()
    };

    if (outlinePointId) {
      thought.outlinePointId = outlinePointId;
    }
    if (subPointId) {
      thought.subPointId = subPointId;
    }

    if (!isCompleteThought(thought)) {
      console.error("Thoughts route: Generated thought is missing required fields after processing", thought);
      return errorResponse("Generated thought is missing required fields after processing", 400);
    }
    console.log("Generated thought:", thought);

    await tracker.timePhase(
      "persist_thought",
      () => appendThoughtToSermon(uid, sermonId, thought, FieldValue.arrayUnion),
      {
        sermonId,
        thoughtId: thought.id,
      }
    );
    console.log("Firestore update: Stored new thought into sermon document.");
    tracker.emit({
      status: "success",
      httpStatus: 200,
      context: {
        thoughtId: thought.id,
      },
    });
    return NextResponse.json(thought);
  } catch (error) {
    const boundary = legacyBoundaryResponse(error) ?? serverEditResponse(error);
    if (boundary) return boundary;
    console.error('Thoughts route: Transcription error:', error);
    if (isUsageCapReachedError(error)) {
      return usageCapResponse(error);
    }
    tracker.emit({
      status: "error",
      httpStatus: 500,
      error,
      errorMessage: 'Failed to transcribe audio',
    });
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

  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get('manual') === 'true') {
    return handleManualPost(request, uid);
  }
  return handleAutoPost(request, uid);
}

/**
 * PUT and DELETE /api/thoughts stay for shipped bundles. Thoughts are edited and removed only through
 * the data engine (the sermon document), so an old bundle's write gets the 426 refusal.
 */
export async function PUT(request: Request) {
  return refuseLegacyWriteRoute(request);
}

export async function DELETE(request: Request) {
  return refuseLegacyWriteRoute(request);
}
