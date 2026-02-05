import { NextResponse } from 'next/server';

import { validateAudioDuration } from '@/utils/server/audioServerUtils';
import { createTranscription } from '@clients/openAI.client';
import { polishTranscription } from '@clients/polishTranscription.structured';

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

  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio');

    // Validate audio file
    if (!(audioFile instanceof Blob)) {
      console.error("Thoughts transcribe route: Invalid audio format received.");
      return NextResponse.json(
        { success: false, error: 'Invalid audio format' },
        { status: 400 }
      );
    }

    if (audioFile.size === 0) {
      console.error("Thoughts transcribe route: Empty audio file.");
      return NextResponse.json(
        { success: false, error: 'Audio file is empty' },
        { status: 400 }
      );
    }

    // Validate audio duration
    const durationValidation = await validateAudioDuration(audioFile);
    if (!durationValidation.valid) {
      console.error("Thoughts transcribe route: Audio duration validation failed.", durationValidation);
      return NextResponse.json(
        { success: false, error: durationValidation.error || 'Audio file is too long' },
        { status: 400 }
      );
    }

    console.log("Thoughts transcribe route: Starting transcription", {
      fileSize: audioFile.size,
      fileType: audioFile.type,
      duration: durationValidation.duration,
    });

    let transcriptionText: string;
    try {
      transcriptionText = await createTranscription(audioFile as Blob);
    } catch (transcriptionError) {
      console.error("Thoughts transcribe route: Transcription failed:", transcriptionError);

      if (transcriptionError instanceof Error) {
        const errorMessage = transcriptionError.message.toLowerCase();
        if (errorMessage.includes('corrupted') || errorMessage.includes('unsupported')) {
          return NextResponse.json(
            { success: false, error: 'Audio file might be corrupted or unsupported. Please try recording again.' },
            { status: 400 }
          );
        }
        if (errorMessage.includes('empty')) {
          return NextResponse.json(
            { success: false, error: 'Audio recording failed - file is empty. Please try recording again.' },
            { status: 400 }
          );
        }
        if (errorMessage.includes('too small') || errorMessage.includes('too short')) {
          return NextResponse.json(
            { success: false, error: 'Audio recording is too short. Please record for at least 1 second.' },
            { status: 400 }
          );
        }
      }

      return NextResponse.json(
        { success: false, error: 'Failed to transcribe audio. Please try again.' },
        { status: 500 }
      );
    }

    console.log("Thoughts transcribe route: Transcription successful", {
      textLength: transcriptionText.length,
      textPreview: transcriptionText.substring(0, 100),
    });

    // Step 2: Polish the transcription (remove filler words, fix grammar)
    const polishResult = await polishTranscription(transcriptionText);

    if (!polishResult.success || !polishResult.polishedText) {
      console.warn("Thoughts transcribe route: Polish failed, returning original", polishResult.error);
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

    return NextResponse.json({
      success: true,
      polishedText: polishResult.polishedText,
      originalText: transcriptionText,
    });
  } catch (error) {
    console.error('Thoughts transcribe route: Error', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process audio' },
      { status: 500 }
    );
  }
}
