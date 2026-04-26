import 'openai/shims/node';

import { NextResponse } from 'next/server';

import { validateAudioDuration } from '@/utils/server/audioServerUtils';
import { createApiPerformanceTracker } from '@clients/apiPerformanceTelemetry';
import { polishTranscription } from '@clients/polishTranscription.structured';
import {
  createTranscriptionWithRetry,
  mapTranscriptionError,
  type TranscriptionErrorResponse,
} from '@clients/transcriptionRetry';

/**
 * POST /api/thoughts/transcribe
 *
 * Transcribe audio and polish the result for appending to an existing thought.
 *
 * Request: FormData with 'audio' file
 *
 * Response:
 * {
 *   success: boolean;
 *   polishedText?: string;
 *   originalText?: string;
 *   warning?: string;
 *   error?: string;
 * }
 */
export async function POST(request: Request) {
  console.log("Thoughts transcribe route: Received POST request.");
  const tracker = createApiPerformanceTracker({
    route: "/api/thoughts/transcribe",
    method: "POST",
    operation: "thought_audio_transcribe_polish",
  });

  const errorResponse = (
    errorMessage: string,
    status: number,
    extra?: Pick<TranscriptionErrorResponse, 'retryable' | 'phase'>
  ) => {
    tracker.emit({
      status: "error",
      httpStatus: status,
      errorMessage,
    });
    return NextResponse.json(
      { success: false, error: errorMessage, ...extra },
      { status }
    );
  };

  try {
    const formData = await tracker.timePhase("parse_form_data", () => request.formData());
    const audioFile = formData.get('audio');
    tracker.addContext({
      audioPresent: audioFile instanceof Blob,
    });

    // Validate audio file
    if (!(audioFile instanceof Blob)) {
      console.error("Thoughts transcribe route: Invalid audio format received.");
      return errorResponse('Invalid audio format', 400);
    }

    tracker.addContext({
      audioSizeBytes: audioFile.size,
      audioType: audioFile.type || null,
    });

    if (audioFile.size === 0) {
      console.error("Thoughts transcribe route: Empty audio file.");
      return errorResponse('Audio file is empty', 400);
    }

    // Validate audio duration
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
      console.error("Thoughts transcribe route: Audio duration validation failed.", durationValidation);
      return errorResponse(durationValidation.error || 'Audio file is too long', 400);
    }

    console.log("Thoughts transcribe route: Starting transcription", {
      fileSize: audioFile.size,
      fileType: audioFile.type,
      duration: durationValidation.duration,
    });

    let transcriptionText: string;
    try {
      transcriptionText = await tracker.timePhase(
        "transcribe_audio",
        () => createTranscriptionWithRetry(audioFile as Blob, {
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
    } catch (transcriptionError) {
      console.error("Thoughts transcribe route: Transcription failed:", transcriptionError);

      const mappedError = mapTranscriptionError(transcriptionError);
      if (mappedError) {
        return errorResponse(mappedError.error, mappedError.status, {
          retryable: mappedError.retryable,
          phase: mappedError.phase,
        });
      }

      return errorResponse('Failed to transcribe audio. Please try again.', 500);
    }

    console.log("Thoughts transcribe route: Transcription successful", {
      textLength: transcriptionText.length,
      textPreview: transcriptionText.substring(0, 100),
    });

    // Step 2: Polish the transcription (remove filler words, fix grammar)
    const polishResult = await tracker.timePhase(
      "polish_transcription",
      () => polishTranscription(transcriptionText),
      {
        transcriptionLength: transcriptionText.length,
      }
    );

    if (!polishResult.success || !polishResult.polishedText) {
      console.warn("Thoughts transcribe route: Polish failed, returning original", polishResult.error);
      tracker.emit({
        status: "success",
        httpStatus: 200,
        context: {
          polishSuccess: false,
          usedFallback: true,
          polishedLength: transcriptionText.length,
        },
      });
      return NextResponse.json({
        success: true,
        polishedText: transcriptionText,
        originalText: transcriptionText,
        warning: 'Could not polish transcription, returning original',
      });
    }

    console.log("Thoughts transcribe route: Polish successful", {
      originalLength: transcriptionText.length,
      polishedLength: polishResult.polishedText.length,
    });

    tracker.emit({
      status: "success",
      httpStatus: 200,
      context: {
        polishSuccess: true,
        usedFallback: false,
        polishedLength: polishResult.polishedText.length,
      },
    });
    return NextResponse.json({
      success: true,
      polishedText: polishResult.polishedText,
      originalText: transcriptionText,
    });
  } catch (error) {
    console.error('Thoughts transcribe route: Error', error);
    tracker.emit({
      status: "error",
      httpStatus: 500,
      error,
      errorMessage: 'Failed to process audio',
    });
    return NextResponse.json(
      { success: false, error: 'Failed to process audio' },
      { status: 500 }
    );
  }
}
