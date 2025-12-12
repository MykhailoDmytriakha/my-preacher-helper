import { NextResponse } from 'next/server';

import { createTranscription } from '@clients/openAI.client';
import { polishTranscription } from '@clients/polishTranscription.structured';

/**
 * POST /api/studies/transcribe
 * 
 * Transcribe audio and polish the result for Study Notes.
 * 
 * Request: FormData with 'audio' file
 * 
 * Response:
 * {
 *   success: boolean;
 *   polishedText?: string;  // Cleaned up transcription
 *   originalText?: string;  // Raw transcription before polish
 *   error?: string;
 * }
 */
export async function POST(request: Request) {
    console.log("Studies transcribe route: Received POST request.");

    try {
        const formData = await request.formData();
        const audioFile = formData.get('audio');

        // Validate audio file
        if (!(audioFile instanceof Blob)) {
            console.error("Studies transcribe route: Invalid audio format received.");
            return NextResponse.json(
                { success: false, error: 'Invalid audio format' },
                { status: 400 }
            );
        }

        // Check file size (must have content)
        if (audioFile.size === 0) {
            console.error("Studies transcribe route: Empty audio file.");
            return NextResponse.json(
                { success: false, error: 'Audio file is empty' },
                { status: 400 }
            );
        }

        console.log("Studies transcribe route: Starting transcription", {
            fileSize: audioFile.size,
            fileType: audioFile.type,
        });

        // Step 1: Transcribe audio to text
        let transcriptionText: string;
        try {
            transcriptionText = await createTranscription(audioFile as Blob);
        } catch (transcriptionError) {
            console.error("Studies transcribe route: Transcription failed:", transcriptionError);

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

        console.log("Studies transcribe route: Transcription successful", {
            textLength: transcriptionText.length,
            textPreview: transcriptionText.substring(0, 100),
        });

        // Step 2: Polish the transcription (remove filler words, fix grammar)
        const polishResult = await polishTranscription(transcriptionText);

        if (!polishResult.success || !polishResult.polishedText) {
            // If polish fails, return the original transcription
            // This is a graceful degradation - user still gets text, just not polished
            console.warn("Studies transcribe route: Polish failed, returning original", polishResult.error);
            return NextResponse.json({
                success: true,
                polishedText: transcriptionText, // Use original as fallback
                originalText: transcriptionText,
                warning: 'Could not polish transcription, returning original',
            });
        }

        console.log("Studies transcribe route: Polish successful", {
            originalLength: transcriptionText.length,
            polishedLength: polishResult.polishedText.length,
        });

        return NextResponse.json({
            success: true,
            polishedText: polishResult.polishedText,
            originalText: transcriptionText,
        });

    } catch (error) {
        console.error('Studies transcribe route: Error', error);
        return NextResponse.json(
            { success: false, error: 'Failed to process audio' },
            { status: 500 }
        );
    }
}
